"""GS-5 — dense retrieval on the free tier, over pgvector instead of Qdrant.

The channel this replaces failed silently for a month: `QdrantLazyClient` falls
back to a mock whose `query_points()` returns an empty result instead of raising,
so `dense_search` logged `results=0` on its success path while the cluster no
longer existed. These tests pin the two behaviours that matter — the channel never
breaks the parallel fan-out, and it never widens a company-scoped query.
"""
import pytest

from app.core.retrieval.dense_pg_search import DensePgSearch


class _Recorder:
    def __init__(self, rows=None, raises=None):
        self.rows, self.raises, self.calls = rows or [], raises, []

    async def __call__(self, fn, params):
        self.calls.append((fn, params))
        if self.raises:
            raise self.raises
        return self.rows


@pytest.fixture
def rpc(monkeypatch):
    def install(recorder):
        from app.db import supabase_rest
        monkeypatch.setattr(supabase_rest, "sb_rpc", recorder)
        return recorder
    return install


def _no_network(monkeypatch, vector=None):
    async def fake_embed(self, query):
        return vector if vector is not None else [0.1] * 512
    monkeypatch.setattr(DensePgSearch, "embed_query", fake_embed)


@pytest.mark.asyncio
async def test_rows_become_retrieval_results(monkeypatch, rpc):
    _no_network(monkeypatch)
    rpc(_Recorder(rows=[
        {"id": "c1", "ticker": "NVDA", "text": "competition is intense", "similarity": 0.71},
        {"id": "c2", "ticker": "AMD", "text": "supply constraints", "similarity": 0.55},
    ]))

    out = await DensePgSearch().search("competitive risks", None, 5)

    assert [r.chunk_id for r in out] == ["c1", "c2"]
    assert [r.ticker for r in out] == ["NVDA", "AMD"]
    assert out[0].score == pytest.approx(0.71)
    assert out[0].metadata["source_channel"] == "dense_pg"


@pytest.mark.asyncio
async def test_company_filter_is_pushed_into_the_query(monkeypatch, rpc):
    _no_network(monkeypatch)
    rec = rpc(_Recorder())

    await DensePgSearch().search("inventory", {"companies": ["nvda", "amd"]}, 7)

    _, params = rec.calls[0]
    # Cosine similarity will happily return another company's paragraph. Every
    # other channel here treats unscoped cross-company retrieval as a bug.
    assert params["p_tickers"] == ["NVDA", "AMD"]
    assert params["p_limit"] == 7


@pytest.mark.asyncio
async def test_unscoped_query_sends_null_not_an_empty_list(monkeypatch, rpc):
    _no_network(monkeypatch)
    rec = rpc(_Recorder())

    await DensePgSearch().search("what did filings say about tariffs", None, 5)

    # match_chunks reads NULL as "no ticker restriction"; an empty array would
    # match nothing and the channel would look dark instead of unscoped.
    assert rec.calls[0][1]["p_tickers"] is None


@pytest.mark.asyncio
async def test_database_failure_returns_empty_not_an_exception(monkeypatch, rpc):
    _no_network(monkeypatch)
    rpc(_Recorder(raises=RuntimeError("connection reset")))

    assert await DensePgSearch().search("anything", None, 5) == []


@pytest.mark.asyncio
async def test_a_failed_embedding_does_not_reach_the_database(monkeypatch, rpc):
    # 429 is ordinary traffic on the free tier: embed_query returns None and the
    # channel must stop there rather than query with a null vector.
    _no_network(monkeypatch, vector=None)

    async def none_embed(self, query):
        return None
    monkeypatch.setattr(DensePgSearch, "embed_query", none_embed)
    rec = rpc(_Recorder())

    assert await DensePgSearch().search("anything", None, 5) == []
    assert rec.calls == []
