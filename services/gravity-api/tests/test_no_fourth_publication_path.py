"""
T8 — the question is completeness, not whether the known paths are tested.

The audit said "all publication paths" rested on a source scan. That is wrong as
stated and the graph says so: all three known paths already have BEHAVIOURAL
async tests. The generated answer and the no-evidence exit are covered by
`test_gate_runs_before_publication.py`, and the cache hit by
`test_cache_gate_enforcement.py` and `test_cache_refuses_an_unverdicted_entry.py`.
The auditor's own text concedes the behavioural test is "the valuable part".

What is genuinely unproven is narrower, and no behavioural test can prove it:
**that no FOURTH path exists.** A test can only exercise a path it knows about,
so a publication route added next year inherits nothing and is caught by
nothing. That is a counting question about the source, and this is the one
place where a source scan is the right instrument rather than a substitute for
one.

Same technique round 2's source test used, applied to the thing it was actually
good for.

If this test fails because a path was added, the fix is not to bump the number.
It is to give the new path a behavioural gate test first, then bump the number.
"""

from __future__ import annotations

import ast
from pathlib import Path

_PIPELINE = (Path(__file__).resolve().parents[1] /
             "app" / "core" / "search_pipeline.py")

#: cache hit · no-evidence exit · generated answer. Each has a behavioural test
#: named in this module's docstring.
_KNOWN_PUBLICATION_PATHS = 3


def _answer_yields(tree: ast.AST) -> list[ast.Call]:
    """Every `SearchEvent(type="answer", ...)` constructed anywhere."""
    found = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "SearchEvent"):
            continue
        for kw in node.keywords:
            if (kw.arg == "type" and isinstance(kw.value, ast.Constant)
                    and kw.value.value == "answer"):
                found.append(node)
                break
    return found


def test_the_number_of_publication_paths_is_pinned():
    """
    A fourth path must fail loudly here rather than inherit the three gate
    tests it was never covered by.
    """
    tree = ast.parse(_PIPELINE.read_text(encoding="utf-8-sig"))
    paths = _answer_yields(tree)
    lines = sorted(n.lineno for n in paths)

    assert len(paths) == _KNOWN_PUBLICATION_PATHS, (
        f"search_pipeline.py publishes an answer from {len(paths)} places "
        f"(lines {lines}), but {_KNOWN_PUBLICATION_PATHS} are known and gated. "
        f"A new publication path does not inherit the existing gate tests. "
        f"Give it a behavioural test first, then update this count."
    )


def test_every_publication_path_is_inside_the_search_method():
    """
    All three publish from `SearchPipeline.search` itself. A path that moves
    into a helper generator is a new path for gating purposes even if the count
    is unchanged, because the helper can be called from somewhere the gate is
    not.
    """
    tree = ast.parse(_PIPELINE.read_text(encoding="utf-8-sig"))

    cls = next((n for n in ast.walk(tree)
                if isinstance(n, ast.ClassDef) and n.name == "SearchPipeline"),
               None)
    assert cls is not None, "SearchPipeline class not found"

    search = next((n for n in cls.body
                   if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                   and n.name == "search"), None)
    assert search is not None, "SearchPipeline.search not found"

    inside = {id(n) for n in _answer_yields(search)}
    everywhere = _answer_yields(tree)
    stray = [n.lineno for n in everywhere if id(n) not in inside]

    assert not stray, (
        f"an answer is published from outside SearchPipeline.search at line(s) "
        f"{stray}. The gate runs on the paths inside `search`; a publisher "
        f"elsewhere can be reached without it."
    )
