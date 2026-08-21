"""
The semantic cache must not answer a deep request with a fast result.

`reasoning_depth` gates iterative retrieval and on-demand ingest, so the same
query asked at two depths runs two different pipelines over different evidence.
Before this was namespaced, the deeper request came back in milliseconds with
the shallower answer, at full confidence, with nothing signalling that the depth
it asked for had been dropped.
"""
import json

import pytest

from app.core.caching import semantic_cache as sc_mod
from app.core.caching.semantic_cache import SemanticCache


class _FakeRedis:
    """Dict-backed stand-in: enough of the surface for get/setex/scan_iter."""

    def __init__(self):
        self.store: dict[str, str] = {}

    async def get(self, key):
        return self.store.get(key)

    async def setex(self, key, _ttl, value):
        self.store[key] = value

    async def scan_iter(self, match, count=100):
        prefix = match.rstrip("*")
        for k in list(self.store):
            if k.startswith(prefix):
                yield k


class _FakeEmbedder:
    """Every query embeds identically, so cosine similarity is always 1.0 —
    the namespace is then the ONLY thing that can keep two entries apart."""

    async def embed_query(self, _query):
        return [1.0, 0.0, 0.0]


@pytest.fixture
def cache(monkeypatch):
    fake = _FakeRedis()
    monkeypatch.setattr(sc_mod, "redis_client", fake)
    c = SemanticCache(embedder=_FakeEmbedder(), ttl=60, threshold=0.95)
    return c, fake


class TestTheNamespaceSeparatesDepths:
    def test_depth_is_part_of_the_namespace(self):
        assert SemanticCache._ns(["AAPL"], "fast") != SemanticCache._ns(["AAPL"], "deep")

    def test_the_company_scope_still_separates_companies(self):
        assert SemanticCache._ns(["AAPL"], "fast") != SemanticCache._ns(["MSFT"], "fast")

    def test_depth_is_normalised_so_casing_is_not_a_second_namespace(self):
        assert SemanticCache._ns(["AAPL"], "Deep") == SemanticCache._ns(["AAPL"], " deep ")

    def test_an_unspecified_depth_is_stable(self):
        # Callers that pass nothing must land in one namespace, not a new one
        # per call, or the cache never hits at all.
        assert SemanticCache._ns(["AAPL"]) == SemanticCache._ns(["AAPL"], None)


class TestAFastAnswerDoesNotSatisfyADeepRequest:
    @pytest.mark.asyncio
    async def test_the_deep_request_misses_what_fast_cached(self, cache):
        c, _ = cache
        await c.set("YICC revenue", {"answer": "fast answer"},
                    tickers=["YICC"], depth="fast")
        assert await c.get("YICC revenue", tickers=["YICC"], depth="deep") is None

    @pytest.mark.asyncio
    async def test_the_same_depth_still_hits(self, cache):
        # The separation must not cost the hit rate it was built to protect.
        c, _ = cache
        await c.set("YICC revenue", {"answer": "fast answer"},
                    tickers=["YICC"], depth="fast")
        hit = await c.get("YICC revenue", tickers=["YICC"], depth="fast")
        assert hit == {"answer": "fast answer"}

    @pytest.mark.asyncio
    async def test_a_semantically_similar_query_hits_within_one_depth(self, cache):
        # Embeddings are identical here, so this exercises the similarity path
        # rather than the exact-hash path.
        c, _ = cache
        await c.set("YICC revenue", {"answer": "fast answer"},
                    tickers=["YICC"], depth="fast")
        hit = await c.get("what is YICC revenue", tickers=["YICC"], depth="fast")
        assert hit == {"answer": "fast answer"}

    @pytest.mark.asyncio
    async def test_that_same_similar_query_still_misses_across_depths(self, cache):
        # The similarity path is where the bug actually lived: identical
        # embeddings + a shared namespace returned the wrong-depth answer.
        c, _ = cache
        await c.set("YICC revenue", {"answer": "fast answer"},
                    tickers=["YICC"], depth="fast")
        assert await c.get("what is YICC revenue", tickers=["YICC"], depth="deep") is None

    @pytest.mark.asyncio
    async def test_both_depths_can_be_cached_side_by_side(self, cache):
        c, _ = cache
        await c.set("YICC revenue", {"answer": "fast"}, tickers=["YICC"], depth="fast")
        await c.set("YICC revenue", {"answer": "deep"}, tickers=["YICC"], depth="deep")
        assert (await c.get("YICC revenue", tickers=["YICC"], depth="fast"))["answer"] == "fast"
        assert (await c.get("YICC revenue", tickers=["YICC"], depth="deep"))["answer"] == "deep"

    @pytest.mark.asyncio
    async def test_cross_company_isolation_survives_the_change(self, cache):
        c, _ = cache
        await c.set("revenue", {"answer": "apple"}, tickers=["AAPL"], depth="fast")
        assert await c.get("revenue", tickers=["MSFT"], depth="fast") is None

    @pytest.mark.asyncio
    async def test_the_stored_keys_actually_carry_the_depth(self, cache):
        c, redis = cache
        await c.set("YICC revenue", {"answer": "x"}, tickers=["YICC"], depth="deep")
        assert redis.store, "expected the cache to write something"
        assert all("#deep" in k for k in redis.store)
