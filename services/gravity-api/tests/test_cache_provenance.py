"""GS-2 — a cached answer must say what produced it.

Measured on prod 2026-08-17: the second identical query returned
`retrieval_channels: []`, `model_used: "unknown"`, `passages_used: 0` — the same
shape a total retrieval failure produces. These tests pin the two pure functions
that fix it, including the JSON round-trip, because the cache stores its payload
as a JSON string and a field that does not survive `json.dumps` is not stored.
"""
import json
from types import SimpleNamespace

from app.core.search_pipeline import cache_provenance_of, replay_metadata


def _routing(model="deepseek-chat", complexity="medium", cost=0.035):
    return SimpleNamespace(
        primary_model=model,
        complexity=SimpleNamespace(value=complexity),
        estimated_cost=cost,
    )


def test_provenance_splits_live_channels_from_dark_ones():
    results = {"structured": [1, 2], "bm25": [3], "dense": [], "graph": [], "splade": []}

    prov = cache_provenance_of(results, _routing(), passages_used=11, trace_id="t-1")

    assert prov["retrieval_channels"] == ["structured", "bm25"]
    assert prov["channels_dark"] == ["dense", "graph", "splade"]
    assert prov["model_used"] == "deepseek-chat"
    assert prov["passages_used"] == 11
    assert prov["trace_id"] == "t-1"


def test_provenance_survives_the_cache_json_round_trip():
    prov = cache_provenance_of({"bm25": [1], "dense": []}, _routing(), 4, "t-2")
    payload = {"answer": "…", "citations": [], "_provenance": prov}

    revived = json.loads(json.dumps(payload))
    restored = revived.pop("_provenance")

    assert "_provenance" not in revived, "provenance must be stripped from the answer payload"
    assert restored == prov

    meta = replay_metadata(restored, latency_ms=12.5, trace_id="t-3")
    assert meta["retrieval_channels"] == ["bm25"]
    assert meta["channels_dark"] == ["dense"]


def test_replay_reports_the_original_run_and_zero_cost():
    prov = cache_provenance_of({"structured": [1]}, _routing(cost=0.035), 7, "t-orig")

    meta = replay_metadata(prov, latency_ms=9.0, trace_id="t-new")

    assert meta["cache_hit"] is True
    assert meta["cache_provenance"] == "replay"
    assert meta["model_used"] == "deepseek-chat"
    assert meta["complexity"] == "medium"
    assert meta["retrieval_channels"] == ["structured"]
    assert meta["passages_used"] == 7
    # The replay did not spend anything, whatever the original run cost.
    assert meta["estimated_cost_usd"] == 0.0
    assert meta["trace_id"] == "t-new"


def test_legacy_entries_say_unknown_instead_of_pretending():
    meta = replay_metadata(None, latency_ms=3.0, trace_id="t-4")

    assert meta["cache_provenance"] == "legacy"
    assert meta["model_used"] == "unknown"
    assert meta["retrieval_channels"] == []
    assert meta["cache_hit"] is True


def test_metadata_schema_carries_the_new_fields():
    # The REST route drops any key not in SearchMetadata, so a field the pipeline
    # emits but the schema does not declare would vanish before the client sees it.
    from app.api.schemas.search import SearchMetadata

    fields = SearchMetadata.model_fields
    assert "channels_dark" in fields
    assert "cache_provenance" in fields
    assert SearchMetadata(trace_id="t", latency_ms=1.0, model_used="m",
                          complexity="simple").cache_provenance == "live"
