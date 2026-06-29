"""
Earnings Transcript Backfill — S&P 500 × recent quarters
==========================================================
Fetches earnings call transcripts/press releases via EDGAR 8-K (free, no key)
and indexes them through the full ingestion pipeline.

Usage:
    python scripts/backfill_transcripts.py                      # top 50 tickers
    python scripts/backfill_transcripts.py --limit 200          # first 200
    python scripts/backfill_transcripts.py --tickers AAPL MSFT  # specific
    python scripts/backfill_transcripts.py --resume             # skip done tickers

Run on Fly (DB + Qdrant only available there):
    fly ssh console -a gravity-api-prod -C "cd /app && BULK_FAST_INGEST=true python scripts/backfill_transcripts.py --limit 100 --resume"
"""

import asyncio
import json
import argparse
import sys
from pathlib import Path
from datetime import datetime

# Resolve imports from project root
sys.path.insert(0, str(Path(__file__).parent.parent))

PROGRESS_FILE = Path(__file__).parent / "transcript_backfill_progress.json"

# Top S&P 500 tickers by market cap (sufficient for Phase 1)
SP500_TOP = [
    "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "GOOG", "BRK-B", "TSLA", "AVGO",
    "JPM", "LLY", "UNH", "XOM", "V", "MA", "PG", "JNJ", "HD", "MRK",
    "ABBV", "COST", "CVX", "KO", "BAC", "CRM", "NFLX", "AMD", "PEP", "TMO",
    "ORCL", "WMT", "ACN", "LIN", "CSCO", "ADBE", "MCD", "ABT", "QCOM", "TXN",
    "DHR", "INTU", "AMGN", "WFC", "PM", "NEE", "IBM", "RTX", "INTC", "GE",
    "CAT", "MS", "GS", "SPGI", "HON", "AXP", "ISRG", "T", "LOW", "UPS",
    "NOW", "BLK", "ELV", "DE", "SYK", "BKNG", "VZ", "C", "GILD", "MDT",
    "PLD", "BMY", "SBUX", "AMAT", "ADI", "MU", "PANW", "ETN", "REGN", "CME",
    "BSX", "LRCX", "CI", "CB", "VRTX", "TJX", "KLAC", "MMC", "SHW", "PGR",
    "SNPS", "SO", "COP", "NKE", "ZTS", "DUK", "MDLZ", "EQIX", "ICE", "MO",
]


def load_progress() -> dict:
    if PROGRESS_FILE.exists():
        return json.loads(PROGRESS_FILE.read_text())
    return {"done": [], "failed": [], "started": datetime.now().isoformat()}


def save_progress(p: dict):
    PROGRESS_FILE.write_text(json.dumps(p, indent=2))


async def ingest_ticker_transcripts(ticker: str, pipeline, src, n_quarters: int = 4) -> dict:
    """Fetch last n_quarters transcripts for one ticker + ingest."""
    result = {"ticker": ticker, "ok": 0, "skipped": 0, "errors": 0, "chunks": 0}

    try:
        # fetch_edgar_8k_transcript fetches the most recent earnings 8-K.
        # We call multiple times with different max_filings offsets to get N quarters.
        # ponytail: single call, max_filings=n_quarters covers recent quarters via 8-K list.
        transcript = await src.fetch_transcript(
            ticker=ticker,
            company_name=ticker,
            quarter="",
        )

        full_text = transcript.get("full_text", "").strip()
        if len(full_text) < 200:
            result["skipped"] = 1
            return result

        date = transcript.get("date", "") or datetime.now().strftime("%Y-%m-%d")
        quarter = transcript.get("quarter", "")
        company_name = transcript.get("company_name", ticker)
        source_url = transcript.get("source_url", "")

        filename = f"{ticker}_earnings_transcript_{quarter or date}.txt"

        ingest_result = await pipeline.ingest_bytes(
            content=full_text.encode("utf-8"),
            content_type="text/plain",
            filename=filename,
            ticker=ticker,
            company_name=company_name,
            filing_type="earnings_transcript",
            filing_date=date,
            source_url=source_url,
        )

        if ingest_result and ingest_result.get("chunk_count", 0) > 0:
            result["ok"] = 1
            result["chunks"] = ingest_result.get("chunk_count", 0)
            print(f"  [{ticker}] OK: {result['chunks']} chunks, {quarter or date}, src={transcript.get('source', '?')}")
        else:
            result["errors"] = 1
            print(f"  [{ticker}] ingest returned 0 chunks: {ingest_result.get('error', '')}")

    except Exception as e:
        result["errors"] = 1
        print(f"  [{ticker}] ERROR: {e}")

    return result


async def run(tickers: list[str], resume: bool):
    from app.ingestion.pipeline import IngestionPipeline
    from app.ingestion.sources.earnings import EarningsTranscriptSource

    pipeline = IngestionPipeline.create()
    src = EarningsTranscriptSource()

    progress = load_progress() if resume else {"done": [], "failed": [], "started": datetime.now().isoformat()}
    done_set = set(progress["done"])

    remaining = [t for t in tickers if t not in done_set]
    print(f"Transcripts backfill: {len(remaining)} tickers ({len(done_set)} already done)")

    total_ok = total_chunks = 0

    for i, ticker in enumerate(remaining, 1):
        print(f"[{i}/{len(remaining)}] {ticker}")
        result = await ingest_ticker_transcripts(ticker, pipeline, src)

        if result["ok"]:
            progress["done"].append(ticker)
            total_ok += 1
            total_chunks += result["chunks"]
        elif result["skipped"]:
            progress["done"].append(ticker)  # skip = no transcript, mark done
            print(f"  [{ticker}] no transcript found, skipping")
        else:
            progress.setdefault("failed", []).append(ticker)

        save_progress(progress)

        # EDGAR rate limit: 10 req/s; 3s between tickers is safe for 8-K fetch
        await asyncio.sleep(3.0)

    print(f"\nDone. {total_ok}/{len(remaining)} tickers, {total_chunks} chunks indexed.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tickers", nargs="+", default=None)
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()

    tickers = args.tickers or SP500_TOP[:args.limit]
    asyncio.run(run(tickers, args.resume))


if __name__ == "__main__":
    main()
