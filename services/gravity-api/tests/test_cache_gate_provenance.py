"""
A replayed answer must say whether it was ever gated.

An external audit reported that cached answers "bypass the entire verification
pipeline". That overstates it — the answer WAS gated before it was cached, and
the cache stores an already-produced answer rather than a fresh one. But the
audit was pointing at something real underneath:

1. `search_pipeline.search` writes the cache entry BEFORE `FinalGate.check`
   runs, so the verdict does not exist yet at the moment it would be stored.
2. `replay_metadata` therefore has no `contract_gate` key at all. On a live
   answer the key is present; on a cache hit it is absent, and
   `metadata.get("contract_gate")` returns None for BOTH "the gate passed
   silently" and "the gate never ran".

That second point is the same mistake this very function's docstring warns
about — "an empty channel list presented as a measurement is worse than one
labelled as missing" — applied to channels but not to the gate.
"""

from __future__ import annotations

import inspect

from app.core.search_pipeline import SearchPipeline, replay_metadata


# ── The key must exist, always ────────────────────────────────────────────


def test_a_replayed_answer_reports_a_gate_verdict():
    prov = {"model_used": "x", "complexity": "simple", "retrieval_channels": ["dense"],
            "channels_dark": [], "passages_used": 3,
            "contract_gate": {"passed": True, "violations": []}}
    md = replay_metadata(prov, 12.0, "t1")
    assert "contract_gate" in md
    assert md["contract_gate"]["passed"] is True


def test_a_legacy_entry_says_the_gate_was_not_recorded():
    """
    Entries written before the gate existed cannot claim it passed. Absent and
    passed must not look the same to a caller.
    """
    md = replay_metadata(None, 12.0, "t1")
    assert "contract_gate" in md
    assert md["contract_gate"] is not None
    assert md["contract_gate"].get("recorded") is False


def test_a_replay_without_a_stored_verdict_is_also_labelled():
    """A provenance dict from before this change has no gate in it."""
    prov = {"model_used": "x", "complexity": "simple", "retrieval_channels": [],
            "channels_dark": [], "passages_used": 0}
    md = replay_metadata(prov, 12.0, "t1")
    assert md["contract_gate"].get("recorded") is False


def test_the_absent_key_can_never_be_mistaken_for_a_pass():
    """The distinction the audit was actually pointing at."""
    for md in (replay_metadata(None, 1.0, "t"),
               replay_metadata({"passages_used": 1}, 1.0, "t")):
        assert md["contract_gate"].get("passed") is not True


# ── The ordering that made the verdict unstorable ─────────────────────────


def test_the_gate_runs_before_the_answer_is_cached():
    """
    Storing first and checking second means the stored entry can never carry a
    verdict, no matter what the replay code does.
    """
    src = inspect.getsource(SearchPipeline.search)
    gate = src.index("FinalGate.check")
    write = src.index("await self.cache.set(")
    assert gate < write, (
        "the cache is written before the gate runs, so the verdict cannot be stored"
    )


def test_the_stored_provenance_carries_the_verdict():
    """
    Specifically the CACHE payload, not the metadata event. The metadata yield
    has carried `contract_gate` all along; that is what made this look fine
    while every replayed answer reported nothing.
    """
    src = inspect.getsource(SearchPipeline.search)
    # rindex: the FIRST "_provenance" is the cache READ near the top of the
    # method. The write is the last one, and it is the write that matters here.
    store = src.rindex('"_provenance"')
    tail = src[store:store + 400]
    assert "contract_gate" in tail, (
        "the cache payload stores no gate verdict, so no replay can report one"
    )
