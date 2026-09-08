"""CF-4 gate. Calls the real /company/{ticker}/filings handler against the real
Supabase and checks its `total` against a direct count(DISTINCT document_title).

The truth values are not hardcoded — they are recomputed here by paging the same
table with a separate code path (a plain offset walk), so the gate would still
catch a bug in sb_select_all itself.

Run from services/gravity-api:
    .venv/Scripts/python.exe ../../docs/company-feature/gates/cf4-gate.py
"""
import asyncio
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

from app.api.routes.company import company_filings  # noqa: E402
from app.db import supabase_rest  # noqa: E402

AUTH = {"user_id": "gate", "tier": "unlimited", "api_key": "gate"}

# Every ticker measured over the PostgREST 1000-row cap, plus two just under it.
TICKERS = ["TSLA", "GS", "LHX", "NVDA", "AAPL", "NET", "MTCH", "PEG", "AMZN", "AMD"]


async def truth(ticker: str) -> tuple[int, int]:
    """(distinct filings, chunk rows) walked independently of sb_select_all."""
    titles, rows, offset = set(), 0, 0
    while True:
        batch = await supabase_rest.sb_select(
            "chunks",
            {"ticker": f"eq.{ticker}", "order": "filing_date.desc.nullslast,id.asc"},
            select="document_id,document_title",
            limit=1000,
            offset=offset,
        )
        for r in batch:
            doc_id = r.get("document_id") or ""
            if not doc_id or doc_id.startswith("xbrl:"):
                continue
            rows += 1
            titles.add(r.get("document_title") or doc_id)
        if len(batch) < 1000:
            return len(titles), rows
        offset += 1000


async def main() -> int:
    if not supabase_rest.configured():
        print("BLOCKED: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set")
        return 2

    print(f"{'ticker':<8}{'rows':>7}{'endpoint':>10}{'truth':>7}{'docs':>7}  verdict")
    failures = 0
    for t in TICKERS:
        want, rows = await truth(t)
        got = await company_filings(t, limit=20, auth=AUTH)
        total, docs, trunc = got["total"], len(got["documents"]), got.get("truncated")
        ok = total == want and not trunc
        if not ok:
            failures += 1
        print(f"{t:<8}{rows:>7}{total:>10}{want:>7}{docs:>7}  "
              f"{'PASS' if ok else 'FAIL'}{'' if not trunc else ' (truncated)'}")

    print(f"\nRESULT {len(TICKERS) - failures}/{len(TICKERS)} tickers report the true filing count")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
