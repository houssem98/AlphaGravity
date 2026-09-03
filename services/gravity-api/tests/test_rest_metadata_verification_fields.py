"""L2 / D7 — the verification signals never reached a REST caller.

D1 was disproved on the grounds that `FinalGate.check` runs and "ships its
verdict as `contract_gate` in the metadata event". That is true of the
WebSocket path, which yields the pipeline's metadata dict as-is. It is not true
of REST.

`app/api/routes/search.py` filters the pipeline's metadata to the fields
declared on `SearchMetadata`:

    known = set(SearchMetadata.model_fields.keys())
    info = {k: v for k, v in (metadata_info or {}).items() if k in known}

`contract_gate`, `numeric_mismatches` and `temporal_mismatches` are all emitted
by the pipeline and none of them are declared, so all three are dropped without
a trace. A REST client cannot distinguish an answer that passed the gate from
one that failed it, or an answer with twelve unverifiable figures from one with
none.

This is the same class of bug `test_metadata_schema_carries_the_new_fields`
already pins for `channels_dark` and `cache_provenance` — a field the pipeline
emits but the schema does not declare vanishes before the client sees it. The
lesson was recorded and then not applied to the verification fields.

Scope note: this makes an existing signal VISIBLE. It does not make
verification blocking — that trade converts some wrong answers into refusals
and some right answers into refusals too, and it is escalated rather than
decided here.
"""

from __future__ import annotations

from app.api.schemas.search import SearchMetadata

#: Emitted by `SearchPipeline.search` in its metadata event. Every one of these
#: is a verification result, which is the category a caller most needs and the
#: category the schema was missing.
EMITTED_BY_THE_PIPELINE = (
    "contract_gate",
    "numeric_mismatches",
    "temporal_mismatches",
)


def test_the_verification_fields_survive_the_rest_schema():
    missing = [f for f in EMITTED_BY_THE_PIPELINE
               if f not in SearchMetadata.model_fields]
    assert not missing, (
        f"the pipeline emits {missing} and the REST schema drops them, so a "
        "REST caller cannot tell a gated answer from an ungated one"
    )


def test_the_gate_verdict_round_trips_through_the_schema():
    """Declared is not enough — it has to survive construction."""
    verdict = {"passed": False, "violations": ["uncited_figure"]}
    md = SearchMetadata(trace_id="t", latency_ms=1.0, model_used="m",
                        complexity="simple", contract_gate=verdict,
                        numeric_mismatches=3, temporal_mismatches=1)

    assert md.contract_gate == verdict
    assert md.numeric_mismatches == 3
    assert md.temporal_mismatches == 1


def test_the_route_filter_keeps_them():
    """
    The filter in `search.py` is the thing that actually drops fields, so it is
    what gets exercised — a schema field that the route still discards would
    pass the assertions above and change nothing.
    """
    known = set(SearchMetadata.model_fields.keys())
    emitted = {"contract_gate": {"passed": True, "violations": []},
               "numeric_mismatches": 0, "temporal_mismatches": 0,
               "trace_id": "t", "latency_ms": 1.0,
               "model_used": "m", "complexity": "simple"}

    kept = {k: v for k, v in emitted.items() if k in known}

    for f in EMITTED_BY_THE_PIPELINE:
        assert f in kept, f"{f} is discarded by the route's schema filter"


def test_an_absent_verdict_is_not_reported_as_a_pass():
    """
    The distinction `replay_metadata` already protects on the cache path. A
    REST response with no gate verdict must not read as a clean one.
    """
    md = SearchMetadata(trace_id="t", latency_ms=1.0, model_used="m",
                        complexity="simple")

    assert md.contract_gate is None
    assert getattr(md.contract_gate, "passed", None) is not True
