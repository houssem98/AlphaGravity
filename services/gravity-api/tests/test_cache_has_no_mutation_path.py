"""
T7 is BLOCKED, and this file is what makes the block falsifiable.

The claim was that a cache hit trusts a stored verdict with no binding to the
answer it graded — the stored invariant being "we recorded passed: true" rather
than "this exact answer, these citations and this contract are what passed".

That is true as a description and is not a defect, because nothing can change
one without the other. The write is a single `cache.set(query, {...})` carrying
the answer, the citations and `_provenance.contract_gate` in one dict, which
`SemanticCache.set` serialises whole and stores with `setex`. There is no
partial update, no read-modify-write, and no field-level mutation anywhere in
the class. One writer, one reader.

So the defect needs a mutation path and none exists. The roadmap's instruction
was explicit: spend one iteration looking, then record `BLOCKED — no mutation
path`, and do NOT build a content hash to close a defect nobody has shown
exists.

**This file exists so the block cannot rot into a stale assumption.** A block is
only as good as the premise under it, and that premise is a property of today's
cache API rather than a law. If someone adds an update method, a second writer,
or a way to rewrite the answer without rewriting the verdict, these tests fail
and T7 must be reopened on real evidence instead of re-argued from memory.
"""

from __future__ import annotations

import ast
import inspect
from pathlib import Path

from app.core.caching.semantic_cache import SemanticCache

_PIPELINE = (Path(__file__).resolve().parents[1] /
             "app" / "core" / "search_pipeline.py")


def test_the_cache_exposes_no_partial_update():
    """
    Only `get` and `set`. A mutation path needs somewhere to mutate from, and
    an API that can only replace a whole entry has nowhere.
    """
    public = {
        name for name, _ in inspect.getmembers(SemanticCache, inspect.isfunction)
        if not name.startswith("_")
    }
    assert public == {"get", "set"}, (
        f"SemanticCache grew a method beyond get/set: {sorted(public)}. If it "
        f"can modify part of a stored entry, T7's block no longer holds and the "
        f"defect must be re-examined against the new path."
    )


def test_the_verdict_is_written_in_the_same_call_as_the_answer():
    """
    The atomicity that makes T7 unreachable: one `cache.set` literal carrying
    the answer, the citations and the gate verdict together. Asserted against
    the source because the property is structural — it is about there being no
    second write, which no runtime call can demonstrate.
    """
    tree = ast.parse(_PIPELINE.read_text(encoding="utf-8-sig"))

    set_calls = [
        node for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "set"
        and isinstance(node.func.value, ast.Attribute)
        and node.func.value.attr == "cache"
    ]
    assert len(set_calls) == 1, (
        f"expected exactly one self.cache.set call site; found {len(set_calls)}. "
        f"A second writer is a mutation path and reopens T7."
    )

    payload = next(
        (a for a in set_calls[0].args if isinstance(a, ast.Dict)), None)
    assert payload is not None, "the cache payload is no longer a dict literal"

    keys = {k.value for k in payload.keys if isinstance(k, ast.Constant)}
    assert {"answer", "citations", "_provenance"} <= keys, (
        f"the answer, its citations and its provenance must be written in ONE "
        f"call for the stored verdict to be bound to what it graded; got {keys}"
    )


def test_the_gate_verdict_travels_inside_that_same_payload():
    """`contract_gate` must sit in the `_provenance` written with the answer."""
    tree = ast.parse(_PIPELINE.read_text(encoding="utf-8-sig"))
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "set"
                and isinstance(node.func.value, ast.Attribute)
                and node.func.value.attr == "cache"):
            continue
        payload = next(
            (a for a in node.args if isinstance(a, ast.Dict)), None)
        prov = next(
            (v for k, v in zip(payload.keys, payload.values)
             if isinstance(k, ast.Constant) and k.value == "_provenance"), None)
        assert prov is not None
        nested = {k.value for k in getattr(prov, "keys", [])
                  if isinstance(k, ast.Constant)}
        assert "contract_gate" in nested, (
            "the verdict must be written with the answer it graded; if it moves "
            "to a separate write, the two can diverge and T7 becomes live"
        )
        return
    raise AssertionError("no self.cache.set call site found")
