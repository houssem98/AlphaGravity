"""CF-24 gate. A mistyped ticker is caught and corrected, not loaded as a blank
profile of nothing.

Before this, "APPL" produced a full company page with every surface empty — the
same shape as a real registrant with no data. The entity resolver handles NAMES
well ("lululemon" -> LULU) but returns UNKNOWN with no candidates for a mistyped
SYMBOL, which is the mistake people actually make.

Run from services/gravity-api:
    .venv/Scripts/python.exe ../../docs/company-feature/gates/cf24-gate.py
"""
import asyncio
import logging
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
API = ROOT / "services" / "gravity-api"
sys.path.insert(0, str(API))

for env_file in (API / ".env", ROOT / ".env"):
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

import structlog  # noqa: E402
structlog.configure(wrapper_class=structlog.make_filtering_bound_logger(logging.CRITICAL))

from app.api.routes.company import company_resolve  # noqa: E402

AUTH = {"user_id": "gate", "tier": "unlimited", "api_key": "gate"}
failures = 0

# Mistyped symbols and misspelled names. The right answer must be the FIRST
# suggestion — burying it at position three is the same as not having it.
TYPOS = [
    ("APPL", "AAPL"), ("amazn", "AMZN"), ("teslla", "TSLA"),
    ("micrsoft", "MSFT"), ("googel", "GOOGL"), ("netflx", "NFLX"),
    ("lululemn", "LULU"), ("nvidiaa", "NVDA"), ("walmrt", "WMT"),
]

# Things that must resolve outright, with no correction offered.
EXACT = [
    ("NVDA", "NVDA"), ("msft", "MSFT"), ("lululemon", "LULU"),
    ("Morgan Stanley", "MS"), ("tesla", "TSLA"), ("googl", "GOOGL"),
]


def check(name: str, ok: bool, detail: str = "") -> None:
    global failures
    if not ok:
        failures += 1
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"\n      {detail}" if detail and not ok else ""))


async def main() -> int:
    for q, want in EXACT:
        r = await company_resolve(q=q, auth=AUTH)
        check(f"{q!r} resolves to {want}",
              r["status"] == "resolved" and r["ticker"] == want,
              f"status={r['status']} ticker={r['ticker']}")
        check(f"{q!r} names the registrant so the reader can confirm it",
              bool(r.get("legal_name")), f"legal_name={r.get('legal_name')!r}")

    hits = 0
    for q, want in TYPOS:
        r = await company_resolve(q=q, auth=AUTH)
        top = r["suggestions"][0]["ticker"] if r["suggestions"] else None
        if top == want:
            hits += 1
        else:
            print(f"      {q!r} -> {top} (wanted {want})")
        check(f"{q!r} is not silently accepted as a ticker", r["status"] == "unknown",
              f"status={r['status']}")
        check(f"{q!r} says why", bool(r.get("reason")))
    check(f"every typo's top suggestion is the intended company ({hits}/{len(TYPOS)})",
          hits == len(TYPOS))

    # A string that names nothing must not invent a confident answer.
    junk = await company_resolve(q="ZZZZ", auth=AUTH)
    check("a string that names no registrant resolves to nothing",
          junk["status"] == "unknown" and junk["ticker"] is None)
    check("and says so in words", "No SEC registrant matches" in (junk.get("reason") or ""),
          f"reason={junk.get('reason')!r}")

    # An ambiguous NAME offers the alternatives rather than picking silently.
    coke = await company_resolve(q="Coca Cola", auth=AUTH)
    check("an ambiguous name resolves but still offers the alternatives",
          coke["status"] == "resolved" and coke["ticker"] == "KO"
          and len(coke["suggestions"]) >= 1,
          f"ticker={coke['ticker']} suggestions={[s['ticker'] for s in coke['suggestions']]}")

    print(f"\nRESULT {'PASS' if failures == 0 else f'FAIL ({failures})'}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
