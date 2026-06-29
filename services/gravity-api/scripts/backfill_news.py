"""
News / Press-Release Backfill — S&P 500 recent articles
========================================================
Discovers recent news article URLs per ticker (GDELT free, no key) and indexes
each article body through the full ingestion pipeline as filing_type="news".

News ranks BELOW SEC filings in fusion authority (news=5 vs 10-K=10), so it
adds qualitative/recency coverage without outranking filings on numeric queries.

Usage:
    python scripts/backfill_news.py                      # top 50 tickers
    python scripts/backfill_news.py --limit 100 --days 14
    python scripts/backfill_news.py --tickers AAPL MSFT
    python scripts/backfill_news.py --resume

Run on Fly (DB + Qdrant only there):
    fly ssh console -a gravity-api-prod -C "cd /app && BULK_FAST_INGEST=true python scripts/backfill_news.py --limit 100 --resume"

# ponytail: GDELT free tier returns article URLs + headlines only; full body comes
# from fetching each URL (paywalls/JS pages yield little). For clean full-text news
# set NEWSAPI_KEY (newsapi.org) — NewsSource prefers it automatically.
"""

import asyncio
import json
import argparse
import sys
from pathlib import Path
from datetime import datetime

sys.path.insert(0, str(Path(__file__).parent.parent))

PROGRESS_FILE = Path(__file__).parent / "news_backfill_progress.json"

# Reuse the same top-100 list as transcripts
from scripts.backfill_transcripts import SP500_TOP  # noqa: E402

MAX_ARTICLES_PER_TICKER = 8


def load_progress() -> dict:
    if PROGRESS_FILE.exists():
        return json.loads(PROGRESS_FILE.read_text())
    return {"done": [], "failed": [], "started": datetime.now().isoformat()}


def save_progress(p: dict):
    PROGRESS_FILE.write_text(json.dumps(p, indent=2))


async def ingest_ticker_news(ticker: str, pipeline, news_src, days: int) -> dict:
    """Discover recent article URLs for a ticker, ingest each body as news."""
    result = {"ticker": ticker, "ok": 0, "skipped": 0, "errors": 0, "chunks": 0}

    try:
        articles = await news_src.fetch_company_news(ticker=ticker, company_name=ticker, days=days)
    except Exception as e:
        result["errors"] = 1
        print(f"  [{ticker}] discovery failed: {e}")
        return result

    if not articles:
        result["skipped"] = 1
        print(f"  [{ticker}] no articles")
        return result

    for art in articles[:MAX_ARTICLES_PER_TICKER]:
        url = art.get("url", "")
        if not url or not url.startswith("http"):
            continue
        published = (art.get("published_at", "") or "")[:10]
        try:
            ingest_result = await pipeline.ingest_from_url(
                url=url,
                filing_type="news",
                ticker=ticker,
                company_name=ticker,
                filing_date=published,
            )
            chunks = (ingest_result or {}).get("chunk_count", 0)
            if chunks > 0:
                result["ok"] += 1
                result["chunks"] += chunks
            else:
                result["errors"] += 1
        except Exception as e:
            result["errors"] += 1
            print(f"    [{ticker}] {url[:50]} -> {e}")
        # GDELT/news sites: 1s between fetches is polite
        await asyncio.sleep(1.0)

    print(f"  [{ticker}] {result['ok']} articles, {result['chunks']} chunks")
    return result


async def run(tickers: list[str], days: int, resume: bool):
    from app.ingestion.pipeline import IngestionPipeline
    from app.ingestion.sources.news import NewsSource
    import os

    pipeline = IngestionPipeline.create()
    news_src = NewsSource(api_key=os.getenv("NEWSAPI_KEY", ""))

    progress = load_progress() if resume else {"done": [], "failed": [], "started": datetime.now().isoformat()}
    done_set = set(progress["done"])
    remaining = [t for t in tickers if t not in done_set]
    print(f"News backfill: {len(remaining)} tickers ({len(done_set)} done), {days}d lookback")

    total_ok = total_chunks = 0
    for i, ticker in enumerate(remaining, 1):
        print(f"[{i}/{len(remaining)}] {ticker}")
        result = await ingest_ticker_news(ticker, pipeline, news_src, days)
        if result["ok"] or result["skipped"]:
            progress["done"].append(ticker)
            total_ok += result["ok"]
            total_chunks += result["chunks"]
        else:
            progress.setdefault("failed", []).append(ticker)
        save_progress(progress)
        # GDELT courtesy: 3s between ticker queries
        await asyncio.sleep(3.0)

    print(f"\nDone. {total_ok} articles, {total_chunks} chunks indexed.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tickers", nargs="+", default=None)
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--days", type=int, default=14)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()

    tickers = args.tickers or SP500_TOP[:args.limit]
    asyncio.run(run(tickers, args.days, args.resume))


if __name__ == "__main__":
    main()
