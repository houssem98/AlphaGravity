"""
Re-embed chunks from Supabase into Qdrant (Gemini, no re-download/re-parse)
===========================================================================
Repair tool for the 2026-07 bulk-ingest campaign: chunk TEXT landed in the
Supabase `chunks` table, but the embedder chain was dead so most chunks never
got dense vectors in Qdrant. This script diffs Supabase vs Qdrant per ticker
and embeds only the missing chunks via gemini-embedding-001 (1024-dim
Matryoshka, L2-normalized — identical to app/embeddings/gemini_embedder.py).

Runs anywhere with env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, QDRANT_URL,
QDRANT_API_KEY, GOOGLE_API_KEY. Resumable: re-running skips existing points.

Usage:
    python scripts/reembed_from_supabase.py --tickers AAPL MSFT
    python scripts/reembed_from_supabase.py --all       # every ticker w/ deficit
    python scripts/reembed_from_supabase.py --all --deficit-only-tickers-file out.txt
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
import urllib.request

COLLECTION = os.getenv("QDRANT_COLLECTION", "gravity_chunks")
DENSE_VECTOR_NAME = "dense"
EMBED_MODEL = "gemini-embedding-001"
EMBED_DIMS = 1024
EMBED_BATCH = 100          # gemini batchEmbedContents max
UPSERT_BATCH = 128

SB_URL = os.environ["SUPABASE_URL"].rstrip("/")
SB_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
QD_URL = os.environ["QDRANT_URL"].rstrip("/")
QD_KEY = os.environ["QDRANT_API_KEY"]
G_KEY = os.environ["GOOGLE_API_KEY"]


def _req(url: str, headers: dict, data: bytes | None = None, method: str | None = None, timeout: int = 120):
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    return json.load(urllib.request.urlopen(r, timeout=timeout))


def sb_get(path: str, range_from: int | None = None, range_to: int | None = None):
    h = {"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"}
    if range_from is not None:
        h["Range"] = f"{range_from}-{range_to}"
        h["Range-Unit"] = "items"
    return _req(f"{SB_URL}/rest/v1/{path}", h)


def qd_post(path: str, body: dict):
    return _req(f"{QD_URL}{path}", {"api-key": QD_KEY, "Content-Type": "application/json"},
                json.dumps(body).encode(), method="POST")


def qd_put(path: str, body: dict):
    return _req(f"{QD_URL}{path}", {"api-key": QD_KEY, "Content-Type": "application/json"},
                json.dumps(body).encode(), method="PUT")


def fetch_supabase_chunks(ticker: str) -> list[dict]:
    """All chunk rows for a ticker, paged past PostgREST's 1000-row cap."""
    rows, off = [], 0
    while True:
        page = sb_get(
            f"chunks?ticker=eq.{urllib.request.quote(ticker)}"
            f"&select=id,document_id,ticker,company,document_title,filing_type,filing_date,section,page,chunk_level,text",
            off, off + 999)
        rows.extend(page)
        if len(page) < 1000:
            return rows
        off += 1000


def fetch_qdrant_ids(ticker: str) -> set[str]:
    ids, offset = set(), None
    while True:
        body = {
            "filter": {"must": [{"key": "ticker", "match": {"value": ticker}}]},
            "limit": 1000, "with_payload": False, "with_vector": False,
        }
        if offset is not None:
            body["offset"] = offset
        res = qd_post(f"/collections/{COLLECTION}/points/scroll", body)["result"]
        ids.update(str(p["id"]) for p in res["points"])
        offset = res.get("next_page_offset")
        if offset is None:
            return ids


def l2(vec: list[float]) -> list[float]:
    n = math.sqrt(sum(v * v for v in vec))
    return [v / n for v in vec] if n > 0 else vec


def embed_batch(texts: list[str], retries: int = 6) -> list[list[float]]:
    """gemini-embedding-001 batch embed, RETRIEVAL_DOCUMENT, 1024-dim, normalized."""
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{EMBED_MODEL}:batchEmbedContents?key={G_KEY}")
    body = {"requests": [{
        "model": f"models/{EMBED_MODEL}",
        "content": {"parts": [{"text": t[:30000]}]},
        "taskType": "RETRIEVAL_DOCUMENT",
        "outputDimensionality": EMBED_DIMS,
    } for t in texts]}
    for attempt in range(retries):
        try:
            res = _req(url, {"Content-Type": "application/json"}, json.dumps(body).encode())
            return [l2(e["values"]) for e in res["embeddings"]]
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 503) and attempt < retries - 1:
                wait = min(60, 2 ** attempt * 5)
                print(f"    embed {e.code}, backoff {wait}s", flush=True)
                time.sleep(wait)
            else:
                raise
    raise RuntimeError("unreachable")


def prefix_text(r: dict) -> str:
    """Replicate chunker.py metadata prefix so vectors match first-ingest semantics."""
    parts = []
    if r.get("ticker"):        parts.append(f"[Ticker: {r['ticker']}]")
    if r.get("company"):       parts.append(f"[Company: {r['company']}]")
    if r.get("filing_type"):   parts.append(f"[Filing: {r['filing_type']}]")
    if r.get("filing_date"):   parts.append(f"[Date: {r['filing_date']}]")
    if r.get("section"):       parts.append(f"[Section: {r['section']}]")
    prefix = " ".join(parts)
    return f"{prefix}\n\n{r['text']}" if prefix else (r["text"] or "")


def reembed_ticker(ticker: str) -> tuple[int, int]:
    rows = fetch_supabase_chunks(ticker)
    have = fetch_qdrant_ids(ticker)
    missing = [r for r in rows if str(r["id"]) not in have and (r.get("text") or "").strip()]
    if not missing:
        return len(rows), 0
    done = 0
    for i in range(0, len(missing), EMBED_BATCH):
        batch = missing[i:i + EMBED_BATCH]
        vecs = embed_batch([prefix_text(r) for r in batch])
        points = [{
            "id": str(r["id"]),
            "vector": {DENSE_VECTOR_NAME: v},
            "payload": {
                "chunk_id": str(r["id"]),
                "document_id": r.get("document_id"),
                "text": r.get("text"),
                "chunk_level": r.get("chunk_level"),
                "section": r.get("section"),
                "page": r.get("page"),
                "ticker": r.get("ticker", ""),
                "company_name": r.get("company", ""),
                "filing_type": r.get("filing_type", ""),
                "filing_date": r.get("filing_date", ""),
                "document_title": r.get("document_title", ""),
                "entitlements": ["public"],
            },
        } for r, v in zip(batch, vecs)]
        for j in range(0, len(points), UPSERT_BATCH):
            qd_put(f"/collections/{COLLECTION}/points?wait=true", {"points": points[j:j + UPSERT_BATCH]})
        done += len(batch)
        print(f"    {ticker}: {done}/{len(missing)}", flush=True)
    return len(rows), done


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tickers", nargs="+", default=None)
    ap.add_argument("--all", action="store_true", help="every distinct Supabase ticker")
    args = ap.parse_args()

    if args.tickers:
        tickers = [t.upper() for t in args.tickers]
    elif args.all:
        # distinct tickers via paged scan of ticker column
        seen, off = set(), 0
        while True:
            page = sb_get("chunks?select=ticker", off, off + 999)
            if not page:
                break
            seen.update(r["ticker"] for r in page if r.get("ticker"))
            if len(page) < 1000:
                break
            off += 1000
        # cheap distinct fallback is incomplete for big tables; prefer explicit list
        tickers = sorted(seen)
        print(f"WARNING: --all scan found {len(tickers)} tickers from first {off+1000} rows; "
              f"pass --tickers for exact control", flush=True)
    else:
        ap.error("pass --tickers or --all")

    t0 = time.time()
    grand = 0
    for n, tk in enumerate(tickers, 1):
        try:
            total, added = reembed_ticker(tk)
            grand += added
            print(f"[{n}/{len(tickers)}] {tk}: supabase={total} embedded+upserted={added}", flush=True)
        except Exception as e:
            print(f"[{n}/{len(tickers)}] {tk}: FAILED {str(e)[:160]}", flush=True)
    print(f"DONE in {time.time()-t0:.0f}s | new vectors: {grand}", flush=True)


if __name__ == "__main__":
    main()
