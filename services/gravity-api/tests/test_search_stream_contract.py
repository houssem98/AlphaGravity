"""Quick Answer WebSocket contract (roadmap Phases 1, 5, 6, 8).

Crosses the same boundary the browser does: a real FastAPI WebSocket against the
real route and the real run registry. Only the pipeline itself is substituted —
the external-provider boundary — so route, auth path, trace-id handling, cancel
frame, event identity and reconnect behaviour are all exercised for real.
"""

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.core.streaming import run_registry


class Ev:
    def __init__(self, type_, data=None):
        self.type = type_
        self.data = data or {}
        self.trace_id = ""
        self.event_id = f"eid-{type_}"
        self.ts = 1.0


class FakePipeline:
    """Stands in for SearchPipeline. Records every search it is asked to run."""

    def __init__(self, park: bool = False):
        self.calls: list[dict] = []
        self.park = park

    def search(self, **kwargs):
        self.calls.append(kwargs)
        park = self.park

        async def gen():
            yield Ev("status", {"status": "understanding"})
            yield Ev("retrieval", {"channels_used": ["dense_pg"], "channels_dark": ["bm25"],
                                   "candidates": 12, "passages_used": 3,
                                   "retrieval_ms": 41.2, "rerank_ms": 7.5})
            yield Ev("sources", {"sources": [
                {"id": "src_1", "chunk_id": "c1", "title": "NVDA 10-K",
                 "canonical_url": "https://www.sec.gov/Archives/edgar/data/1045810/x.htm"},
            ]})
            if park:
                await asyncio.sleep(3600)
            yield Ev("answer", {"answer": "Revenue was $130,497 million.",
                                "citations": [{"citation_number": 1, "chunk_id": "c1",
                                               "is_verified": True,
                                               "verification_status": "verified"}]})
            yield Ev("metadata", {"latency_ms": 812.0, "model_used": "deepseek-chat",
                                  "retrieval_channels": ["dense_pg"], "channels_dark": ["bm25"]})

        return gen()


@pytest.fixture
def client(monkeypatch):
    import app.dependencies as deps
    from app.main import app

    pipe = FakePipeline()
    monkeypatch.setattr(deps, "get_search_pipeline", lambda: pipe)
    run_registry.registry.clear()
    c = TestClient(app)
    c.pipeline = pipe  # type: ignore[attr-defined]
    yield c
    run_registry.registry.clear()


def _collect(ws, until_types, limit=25):
    out = []
    for _ in range(limit):
        msg = ws.receive_json()
        out.append(msg)
        if msg.get("type") in until_types:
            break
    return out


# ── Phase 1: events carry identity and order ─────────────────────────────
def test_every_event_carries_trace_seq_and_identity(client):
    with client.websocket_connect("/v1/search/stream?trace_id=T1") as ws:
        ws.send_json({"query": "NVDA revenue FY2025", "trace_id": "T1"})
        events = _collect(ws, {"metadata"})

    assert events, "no events received"
    for e in events:
        assert e["trace_id"] == "T1", f"event not bound to the request trace: {e}"
        assert isinstance(e["seq"], int)
        assert e["event_id"]
    seqs = [e["seq"] for e in events]
    assert seqs == sorted(seqs) and len(seqs) == len(set(seqs))


def test_retrieval_event_reports_real_channels(client):
    """The UI may name a provider only because an event named it."""
    with client.websocket_connect("/v1/search/stream?trace_id=T2") as ws:
        ws.send_json({"query": "q", "trace_id": "T2"})
        events = _collect(ws, {"metadata"})

    retrieval = [e for e in events if e["type"] == "retrieval"]
    assert len(retrieval) == 1
    d = retrieval[0]["data"]
    assert d["channels_used"] == ["dense_pg"]
    assert d["channels_dark"] == ["bm25"]
    assert d["retrieval_ms"] == 41.2


def test_client_trace_id_is_honoured_by_the_pipeline(client):
    with client.websocket_connect("/v1/search/stream?trace_id=T3") as ws:
        ws.send_json({"query": "q", "trace_id": "T3"})
        _collect(ws, {"metadata"})

    assert client.pipeline.calls[0]["trace_id"] == "T3"


# ── Phase 2: provenance survives the socket ──────────────────────────────
def test_source_url_survives_to_the_client(client):
    with client.websocket_connect("/v1/search/stream?trace_id=T4") as ws:
        ws.send_json({"query": "q", "trace_id": "T4"})
        events = _collect(ws, {"metadata"})

    sources = [e for e in events if e["type"] == "sources"][0]["data"]["sources"]
    assert sources[0]["canonical_url"].startswith("https://www.sec.gov/Archives/")
    assert sources[0]["chunk_id"] == "c1"


# ── Phase 6: reconnect does not re-run the search ────────────────────────
def test_reconnect_with_same_trace_id_runs_the_search_once(client):
    with client.websocket_connect("/v1/search/stream?trace_id=T5") as ws:
        ws.send_json({"query": "q", "trace_id": "T5"})
        first = _collect(ws, {"metadata"})

    # Browser drops and reconnects, re-sending the same query and trace id.
    with client.websocket_connect("/v1/search/stream?trace_id=T5") as ws:
        ws.send_json({"query": "q", "trace_id": "T5"})
        second = _collect(ws, {"metadata"})

    assert len(client.pipeline.calls) == 1, "the reconnect started a second search"
    assert [e["type"] for e in second] == [e["type"] for e in first]
    assert all(e.get("replayed") for e in second)


def test_a_different_trace_id_does_start_a_new_search(client):
    for tid in ("T6", "T7"):
        with client.websocket_connect(f"/v1/search/stream?trace_id={tid}") as ws:
            ws.send_json({"query": "q", "trace_id": tid})
            _collect(ws, {"metadata"})
    assert len(client.pipeline.calls) == 2


# ── Phase 5: cancel reaches the server ───────────────────────────────────
def test_cancel_frame_terminates_the_run_without_an_answer(monkeypatch):
    import app.dependencies as deps
    from app.main import app

    pipe = FakePipeline(park=True)
    monkeypatch.setattr(deps, "get_search_pipeline", lambda: pipe)
    run_registry.registry.clear()

    with TestClient(app).websocket_connect("/v1/search/stream?trace_id=T8") as ws:
        ws.send_json({"query": "q", "trace_id": "T8"})
        seen = [ws.receive_json() for _ in range(3)]      # status, retrieval, sources
        assert [e["type"] for e in seen] == ["status", "retrieval", "sources"]

        ws.send_json({"type": "cancel", "trace_id": "T8"})
        cancelled = ws.receive_json()

    assert cancelled["type"] == "cancelled"
    assert cancelled["data"]["status"] == "cancelled"
    run = run_registry.registry.get("T8", "dev_user")
    assert run is not None and run.cancelled is True
    run_registry.registry.clear()


def test_cancelled_run_never_emits_an_answer(monkeypatch):
    import app.dependencies as deps
    from app.main import app

    pipe = FakePipeline(park=True)
    monkeypatch.setattr(deps, "get_search_pipeline", lambda: pipe)
    run_registry.registry.clear()

    with TestClient(app).websocket_connect("/v1/search/stream?trace_id=T9") as ws:
        ws.send_json({"query": "q", "trace_id": "T9"})
        for _ in range(3):
            ws.receive_json()
        ws.send_json({"type": "cancel", "trace_id": "T9"})
        tail = [ws.receive_json() for _ in range(1)]

    types = [e["type"] for e in tail]
    assert "answer" not in types
    run = run_registry.registry.get("T9", "dev_user")
    assert run is not None
    assert not any(e["type"] == "answer" for e in run.events)
    run_registry.registry.clear()
