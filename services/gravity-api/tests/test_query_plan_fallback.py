"""
The classification-timeout fallback must not silently drop the live-SEC channel.

The `edgar` auto-add rules live inside QueryUnderstanding.analyze(), so a timeout
skips them and the pipeline uses DEFAULT_QUERY_PLAN verbatim. When that dict
omitted `edgar`, the channel went dark on precisely the queries it exists for —
no error, no metadata trace, the answer just degraded to whatever prose the
corpus held. It fires on the first request after a restart and again under load.
"""
import copy

from app.core.query_understanding import DEFAULT_QUERY_PLAN


class TestTheTimeoutFallbackKeepsLiveSec:
    def test_edgar_is_in_the_default_plan(self):
        assert "edgar" in DEFAULT_QUERY_PLAN["retrieval_channels"]

    def test_the_corpus_channels_are_still_there(self):
        # The fix must ADD the live channel, not trade the indexed ones away.
        for ch in ("dense", "bm25"):
            assert ch in DEFAULT_QUERY_PLAN["retrieval_channels"]

    def test_the_pipeline_copies_the_plan_rather_than_sharing_it(self):
        # search_pipeline deepcopies this dict per request. If a caller mutated
        # the module-level dict instead, one request's channels would leak into
        # every later one — the same class of bug the entities deepcopy fixed.
        plan = copy.deepcopy(DEFAULT_QUERY_PLAN)
        plan["retrieval_channels"].append("mutated")
        plan["entities"]["companies"].append({"ticker": "LEAK"})
        assert "mutated" not in DEFAULT_QUERY_PLAN["retrieval_channels"]
        assert DEFAULT_QUERY_PLAN["entities"]["companies"] == []

    def test_the_plan_still_has_what_the_pipeline_reads(self):
        # A fallback missing any of these raises downstream instead of degrading.
        for key in ("intent", "complexity", "entities", "expanded_terms",
                    "filters", "retrieval_channels", "temporal_intent",
                    "needs_live_data"):
            assert key in DEFAULT_QUERY_PLAN
