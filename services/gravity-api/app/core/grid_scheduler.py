"""
Scheduled grid refresh + email digest (roadmap P2.2).

A saved grid (lib_grid_runs: {def, cells}) is re-run on a cadence. Each cell is
one `/v1/search` fast query — same path the market-ui grid uses — so the answers
reproduce the frontend's runGridCell. We diff the fresh run against the last one
by FIGURES (not phrasing — the LLM re-words every run), persist the new run as the
next baseline, and email the owner what moved via Resend.

Storage is Supabase over PostgREST with the service-role key (no DB password held
locally); see app/db/supabase_rest.py.
"""

from __future__ import annotations

import asyncio
import os
import re
from datetime import datetime, timedelta, timezone

import httpx
import structlog

from app.db.supabase_rest import sb_select, sb_insert, sb_update

logger = structlog.get_logger()

# ── Diff primitive ───────────────────────────────────────────────────────────
# Direct port of extractFigures / figuresChanged in
# apps/market-ui/src/services/gridResearch.ts. Keep the regex in sync with the TS
# source — a divergence means the scheduled diff disagrees with the in-app badge.
_FIG_RE = re.compile(r"\$?\d[\d,]*(?:\.\d+)?\s?(?:%|bn|billion|trillion|million|[mbk])?\b", re.I)


def extract_figures(text: str) -> list[str]:
    if not text:
        return []
    clean = re.sub(r"\[\d+\]", " ", text)
    figs = {re.sub(r"\s+", "", s).lower() for s in _FIG_RE.findall(clean)}
    return sorted(figs)


def figures_changed(old_text: str, new_text: str) -> bool:
    a, b = extract_figures(old_text), extract_figures(new_text)
    return len(a) != len(b) or a != b


def _cell_key(ticker: str, prompt_id: str) -> str:
    return f"{ticker}::{prompt_id}"


# ── Re-run one grid ──────────────────────────────────────────────────────────

async def _answer_for(pipeline, query: str) -> str:
    answer = ""
    async for event in pipeline.search(
        query=query, filters=None, stream=False, reasoning_depth="fast",
    ):
        if event.type == "answer":
            d = event.data if isinstance(event.data, dict) else {}
            answer = d.get("answer", "") if isinstance(event.data, dict) else str(event.data)
    return answer


async def _rerun_grid(grid_def: dict, prev_cells: dict) -> tuple[dict, list[dict]]:
    """Re-run every non-synthesis cell; return (new_cells, changes)."""
    from app.dependencies import get_search_pipeline

    pipeline = get_search_pipeline()
    tickers = grid_def.get("tickers", [])
    prompts = [p for p in grid_def.get("prompts", []) if not p.get("synthesis")]
    sem = asyncio.Semaphore(3)
    new_cells: dict = {}
    changes: list[dict] = []

    async def run_cell(ticker: str, prompt: dict):
        resolved = (prompt.get("prompt") or "").replace("{ticker}", ticker)
        query = f"{ticker} {resolved}"
        async with sem:
            try:
                answer = await _answer_for(pipeline, query)
            except Exception as e:
                logger.warning("grid_cell_rerun_failed", ticker=ticker, error=str(e)[:160])
                return
        key = _cell_key(ticker, prompt["id"])
        new_cells[key] = {
            "ticker": ticker,
            "promptId": prompt["id"],
            "status": "done",
            "answer": answer,
            "modelUsed": "gravity-rag",
            "ragUsed": True,
        }
        old_answer = (prev_cells.get(key) or {}).get("answer", "")
        if old_answer and figures_changed(old_answer, answer):
            changes.append({
                "ticker": ticker,
                "label": prompt.get("label", prompt["id"]),
                "old_figures": extract_figures(old_answer),
                "new_figures": extract_figures(answer),
                "new_answer": answer,
            })

    await asyncio.gather(*[run_cell(t, p) for t in tickers for p in prompts])
    return new_cells, changes


# ── Email (Resend) ───────────────────────────────────────────────────────────

async def _send_digest(email: str, grid_name: str, changes: list[dict], grid_run_id: str) -> bool:
    key = os.getenv("RESEND_API_KEY", "")
    frm = os.getenv("RESEND_FROM", "onboarding@resend.dev")
    subject = (
        f"{grid_name}: {len(changes)} cell(s) changed"
        if changes else f"{grid_name}: no material changes"
    )

    if changes:
        rows = "".join(
            f"<tr><td style='padding:6px 12px;border-bottom:1px solid #eee'><b>{c['ticker']}</b></td>"
            f"<td style='padding:6px 12px;border-bottom:1px solid #eee'>{c['label']}</td>"
            f"<td style='padding:6px 12px;border-bottom:1px solid #eee'>"
            f"{', '.join(c['old_figures']) or '—'} → <b>{', '.join(c['new_figures']) or '—'}</b></td></tr>"
            for c in changes
        )
        body = (
            f"<h2>{grid_name}</h2><p>{len(changes)} cell(s) changed since the last run.</p>"
            f"<table style='border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px'>"
            f"<tr><th style='text-align:left;padding:6px 12px'>Ticker</th>"
            f"<th style='text-align:left;padding:6px 12px'>Column</th>"
            f"<th style='text-align:left;padding:6px 12px'>Figures</th></tr>{rows}</table>"
        )
    else:
        body = f"<h2>{grid_name}</h2><p>Re-ran the grid — no figures changed since the last run.</p>"

    if not key:
        logger.info("resend_key_missing_logging_digest", email=email, grid=grid_name,
                    changes=len(changes), grid_run_id=grid_run_id)
        return False
    try:
        async with httpx.AsyncClient(timeout=20.0) as c:
            r = await c.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={"from": frm, "to": [email], "subject": subject, "html": body},
            )
        if r.status_code >= 300:
            logger.warning("resend_send_failed", status=r.status_code, body=r.text[:200])
            return False
        return True
    except Exception as e:
        logger.warning("resend_send_error", error=str(e)[:160])
        return False


# ── Entry points ─────────────────────────────────────────────────────────────

async def run_grid_now(grid_run_id: str, email: str, always_email: bool = True) -> dict:
    """Re-run a saved grid, diff vs its stored cells, persist the new run, email the diff.

    The core used by both the manual trigger and the scheduler loop. Diffs against
    the last saved run in lib_grid_runs, so a weekly cadence compares week-over-week.
    """
    rows = await sb_select("lib_grid_runs", {"id": f"eq.{grid_run_id}"}, limit=1)
    if not rows:
        return {"ok": False, "error": "grid_run_not_found", "grid_run_id": grid_run_id}
    prev = rows[0]
    grid_def = prev.get("def") or {}
    prev_cells = prev.get("cells") or {}
    started = datetime.now(timezone.utc).isoformat()

    new_cells, changes = await _rerun_grid(grid_def, prev_cells)
    completed = datetime.now(timezone.utc).isoformat()

    # Persist the fresh run as the next diff baseline (and so it shows in /history).
    await sb_insert("lib_grid_runs", [{
        "user_id": prev.get("user_id"),
        "name": grid_def.get("name") or prev.get("name") or "Scheduled grid",
        "def": grid_def,
        "cells": new_cells,
        "started_at": started,
        "completed_at": completed,
    }])

    emailed = False
    if changes or always_email:
        emailed = await _send_digest(email, grid_def.get("name") or prev.get("name") or "Grid",
                                     changes, grid_run_id)

    logger.info("grid_run_now_done", grid_run_id=grid_run_id, cells=len(new_cells),
                changed=len(changes), emailed=emailed)
    return {"ok": True, "grid_run_id": grid_run_id, "cells": len(new_cells),
            "changed": len(changes), "emailed": emailed,
            "changes": [{"ticker": c["ticker"], "label": c["label"]} for c in changes]}


async def run_due_schedules(force_id: str | None = None) -> dict:
    """Run every enabled schedule whose next_run_at has passed (or one, if force_id)."""
    now = datetime.now(timezone.utc)
    if force_id:
        schedules = await sb_select("lib_grid_schedules", {"id": f"eq.{force_id}"}, limit=1)
    else:
        schedules = await sb_select("lib_grid_schedules", {
            "enabled": "eq.true",
            "next_run_at": f"lte.{now.isoformat()}",
        }, limit=50)

    results = []
    for s in schedules:
        # scheduled runs email only on real changes; forced runs always email.
        res = await run_grid_now(s["grid_run_id"], s["email"], always_email=bool(force_id))
        step = timedelta(days=1 if s.get("cadence") == "daily" else 7)
        await sb_update("lib_grid_schedules", {"id": f"eq.{s['id']}"}, {
            "last_run_at": now.isoformat(),
            "next_run_at": (now + step).isoformat(),
        })
        results.append({"schedule_id": s["id"], **res})

    return {"ran": len(results), "results": results}
