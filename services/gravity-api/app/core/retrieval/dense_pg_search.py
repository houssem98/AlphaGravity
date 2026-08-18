"""Dense retrieval over Postgres pgvector — the replacement for the lost Qdrant.

`dense_search.py` still talks to Qdrant, whose free cluster was deleted for
inactivity with ~1.5M vectors unrecoverable. Worse, `QdrantLazyClient` falls back
to a mock whose `query_points()` returns an empty result instead of raising, so
the channel logged `results=0` on its success path for a month and prod quietly
answered from two channels while reporting ten registered.

This channel stores the vectors where the corpus already lives: a `halfvec(512)`
column on `chunks`, read through the `match_chunks` RPC (migration 0007). Nothing
here is paid for — voyage-3.5-lite's free tier covers the embedding.
"""

import structlog

from app.core.retrieval.fusion import RetrievalResult

logger = structlog.get_logger()

VOYAGE_URL = "https://api.voyageai.com/v1/embeddings"
MODEL = "voyage-3.5-lite"
DIMS = 512


class DensePgSearch:
    """Cosine k-NN over chunks.embedding, ticker-scoped."""

    def __init__(self, timeout: float = 12.0):
        self.timeout = timeout

    async def embed_query(self, query: str) -> list[float] | None:
        """Embed with input_type='query'. Voyage embeds queries and documents into
        different spaces on purpose; using 'document' here measurably degrades
        retrieval, so the asymmetry is not optional."""
        import os
        import httpx

        key = os.getenv("VOYAGE_API_KEY", "")
        if not key:
            logger.warning("dense_pg_no_voyage_key")
            return None
        async with httpx.AsyncClient(timeout=self.timeout) as c:
            r = await c.post(
                VOYAGE_URL,
                headers={"Authorization": f"Bearer {key}"},
                json={"input": [query], "model": MODEL,
                      "output_dimension": DIMS, "input_type": "query"},
            )
        if r.status_code != 200:
            # 429 is ordinary traffic on the free tier. An empty channel is honest;
            # a raised exception here would take the whole parallel fan-out with it.
            logger.warning("dense_pg_embed_failed", status=r.status_code, body=r.text[:160])
            return None
        return r.json()["data"][0]["embedding"]

    async def search(
        self,
        query: str,
        filters: dict | None = None,
        top_k: int | None = None,
    ) -> list[RetrievalResult]:
        from app.db import supabase_rest

        top_k = top_k or 20
        tickers = [t.upper() for t in (filters or {}).get("companies", []) or [] if t]

        try:
            vector = await self.embed_query(query)
            if vector is None:
                return []

            rows = await supabase_rest.sb_rpc("match_chunks", {
                "p_query": "[" + ",".join(f"{x:.6f}" for x in vector) + "]",
                "p_tickers": tickers or None,
                "p_limit": top_k,
            })
        except Exception as e:
            # Same contract as every other channel: never break the fan-out. The
            # log line names the channel so a dark channel is visible rather than
            # inferred from an empty result — that silence is what hid Qdrant's
            # death for a month.
            logger.warning("dense_pg_unavailable", error=str(e)[:200])
            return []

        out = [
            RetrievalResult(
                chunk_id=str(r.get("id", ""))[:48],
                document_id=str(r.get("id", "")),
                text=r.get("text", "") or "",
                score=float(r.get("similarity", 0.0)),
                metadata={"source_channel": "dense_pg", "similarity": r.get("similarity")},
                ticker=r.get("ticker", "") or "",
            )
            for r in (rows or [])
        ]
        logger.info("dense_pg_search", results=len(out), tickers=tickers)
        return out
