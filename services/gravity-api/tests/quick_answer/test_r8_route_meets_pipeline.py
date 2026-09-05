"""
R8 QA-15 / roadmap §20, §21 — the layer neither existing test covered.

QA-1 measured this as Decider 1 and it stayed open until now. Two tests each
substitute exactly one thing, and each substitutes the other's subject:

    test_search_stream_contract.py    real route, real run registry,
                                      FAKE pipeline
    test_quick_answer_pipeline_e2e.py real pipeline, fake external boundaries,
                                      NO route

§21 forbids substituting the component under test, and `FakePipeline` is
precisely the component the route test exists to exercise. So the browser's
actual path — WebSocket frame in, real route, real `SearchPipeline`, real
citation normalisation, real verdicts, real events out — was never run in one
piece. Every part was tested; the join was not.

This file is that join. It reuses the e2e module's boundary doubles rather than
growing a second set, so there is one definition of what "the external world is
unavailable here" means:

    retrieval channel  — Qdrant / Elasticsearch refuse connections
    LLM router         — a network call to an inference API
    query understander — an LLM call whose contract is a plain dict
    reranker / cache   — Cohere and Redis, passed as None

Nothing else is substituted. The pipeline is the real class, reached through
the real dependency the route resolves.

The decisive assertion is the same one the e2e file calls decisive — a
fabricated citation must arrive at the CLIENT marked unsupported — because a
verdict that is computed correctly and then lost in serialisation is a verdict
the user never sees.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.core.streaming import run_registry
from tests.test_quick_answer_pipeline_e2e import _pipeline

REAL_ANSWER = json.dumps({
    "answer": "NVIDIA revenue was $130,497 million in FY2025 [1].",
    "citations": [{"citation_number": 1, "chunk_id": "c1",
                   "text": "Revenue was $130,497 million."}],
})

FABRICATED = json.dumps({
    "answer": "NVIDIA revenue was $130,497 million in FY2025 [1].",
    "citations": [{"citation_number": 1, "chunk_id": "does-not-exist",
                   "text": "Revenue was $130,497 million."}],
})


@pytest.fixture
def client_with_real_pipeline(monkeypatch):
    """The real route resolving the REAL pipeline.

    The only line that differs from `test_search_stream_contract`'s fixture is
    what `get_search_pipeline` returns, and that line is the whole point of
    this file.
    """
    import app.dependencies as deps
    from app.main import app

    def _build(answer_json):
        pipe = _pipeline(answer_json)
        monkeypatch.setattr(deps, "get_search_pipeline", lambda: pipe)
        run_registry.registry.clear()
        return TestClient(app)

    yield _build
    run_registry.registry.clear()


#: The route's terminal event. `test_search_stream_contract` uses the same one;
#: waiting for a `complete`/`done` this route never sends is a hang, not a
#: failure, which is how the first version of this file timed out.
TERMINAL = {"metadata", "error"}


def _drain(ws, limit=40):
    out = []
    for _ in range(limit):
        msg = ws.receive_json()
        out.append(msg)
        if msg.get("type") in TERMINAL:
            break
    return out


def _of(events, type_):
    return [e for e in events if e.get("type") == type_]


# ── The join runs at all ──────────────────────────────────────────────────


def test_the_real_route_drives_the_real_pipeline(client_with_real_pipeline):
    """
    Decider 1, closed. Before this, no test sent a frame to the route and had a
    real `SearchPipeline` answer it.
    """
    client = client_with_real_pipeline(REAL_ANSWER)
    with client.websocket_connect("/v1/search/stream") as ws:
        ws.send_json({"query": "What was NVIDIA revenue in FY2025?",
                      "reasoning_depth": "fast"})
        events = _drain(ws)

    assert events, "the route produced no events at all"
    kinds = {e.get("type") for e in events}
    assert "answer" in kinds or "metadata" in kinds, kinds


def test_the_client_receives_the_citation_the_pipeline_built(
        client_with_real_pipeline):
    """The citation must survive the route's serialisation, not merely exist
    inside the pipeline."""
    client = client_with_real_pipeline(REAL_ANSWER)
    with client.websocket_connect("/v1/search/stream") as ws:
        ws.send_json({"query": "What was NVIDIA revenue in FY2025?",
                      "reasoning_depth": "fast"})
        events = _drain(ws)

    cites = [c for e in events
             for c in (e.get("data", {}) or {}).get("citations", []) or []]
    assert cites, "no citation reached the client"
    assert any(c.get("chunk_id") == "c1" for c in cites), cites


# ── The decisive one ──────────────────────────────────────────────────────


def test_a_fabricated_citation_reaches_the_client_marked_unsupported(
        client_with_real_pipeline):
    """
    The original defect, checked across the join rather than inside one half of
    it. The model cites a chunk that does not exist; the verdict layer must
    catch it AND the route must carry that verdict to the browser.

    A verdict computed correctly and lost in serialisation is a verdict the
    user never sees, which is exactly the failure a route test with a fake
    pipeline cannot detect.
    """
    client = client_with_real_pipeline(FABRICATED)
    with client.websocket_connect("/v1/search/stream") as ws:
        ws.send_json({"query": "What was NVIDIA revenue in FY2025?",
                      "reasoning_depth": "fast"})
        events = _drain(ws)

    cites = [c for e in events
             for c in (e.get("data", {}) or {}).get("citations", []) or []]
    assert cites, "no citation reached the client"
    bad = [c for c in cites if c.get("chunk_id") == "does-not-exist"]
    # Measured rather than assumed: the pipeline EMITS the unresolvable
    # citation and marks it, rather than dropping it. The first version of this
    # test allowed either behaviour, which made it look weaker than it is and
    # would have passed silently had the citation vanished.
    assert bad, "the fabricated citation was not emitted at all"
    assert all(c.get("is_verified") is False for c in bad), bad
    assert all(c.get("verification_status") == "unsupported" for c in bad), bad
