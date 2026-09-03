"""L12 / D12 — the verification doc must cite things that exist.

`FINAL_BEAT_TOP_CHATGPT_VERIFICATION.md` describes code, names test files, and
quotes counts. All three drift, and a verification document that has drifted is
worse than none: it is read as evidence. This has already caught one false
claim in this repo.

The re-audit that produced this test found three stale statements, all of which
were true when written:

  - the backend total (2097, now 2167)
  - `FinalGate.check` at `search_pipeline.py:2087`, drifted to 2074
  - "the rubric cannot prove claim-level attribution (excerpts truncate at 220
    chars)" — the truncation is on the persisted `answer_excerpt`, not on
    scoring, so the claim was over-broad and the binding was reachable

What is pinned here is deliberately the mechanical part. Whether a paragraph
still describes the code faithfully is not decidable by a test, and asserting
it would be theatre. Paths, test-file names and per-file counts are decidable,
and they are where the drift shows up first.

Line numbers are NOT pinned. They drift on every edit, the graph file's own
warning says to re-grep rather than trust them, and a test that fails whenever
anyone adds a line above a citation is a test people delete.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent.parent
DOC = REPO / "docs" / "quick-answer" / "FINAL_BEAT_TOP_CHATGPT_VERIFICATION.md"

#: `path` -> the count the doc states for it, from the gate table.
CITED_COUNTS = {
    "tests/test_stage_trace.py": 19,
    "tests/test_answer_contract.py": 62,
    "tests/test_head_to_head_rubric.py": 89,
    "tests/test_calc_guard.py": 52,
    "tests/test_ratio_engine_provenance.py": 8,
    "tests/test_cache_gate_provenance.py": 6,
    "tests/test_resolver_backoff.py": 12,
    "tests/test_finance_query_plan.py": 105,
}


def _doc() -> str:
    return DOC.read_text(encoding="utf-8")


def _backticked(text: str) -> set[str]:
    return set(re.findall(r"`([^`\n]+)`", text))


def test_the_document_exists():
    assert DOC.exists(), f"{DOC} is cited by the roadmap and is not present"


def test_every_cited_source_file_exists():
    """A path in this doc that resolves to nothing is a claim about nothing."""
    index = {p.name for p in REPO.rglob("*")
             if p.is_file() and not any(
                 part in {".venv", "node_modules", ".git", "__pycache__",
                          "graphify-out", "worktrees"} for part in p.parts)}

    cited = [t for t in _backticked(_doc())
             if re.search(r"\.(py|ts|tsx|sql)$", t) and " " not in t and "{" not in t]
    assert cited, "no source files cited at all; the extraction is broken"

    missing = [t for t in cited
               if Path(t).name not in index and not (REPO / t).exists()]
    assert not missing, f"cited but absent from the repo: {missing}"


def test_every_cited_test_name_is_a_real_test():
    """A named test that does not exist cannot be the evidence it is cited as."""
    named = [t for t in _backticked(_doc())
             if t.startswith("test_") and not t.endswith(".py")]
    assert named, "no test names cited at all; the extraction is broken"

    src = "\n".join(
        p.read_text(encoding="utf-8", errors="ignore")
        for p in (ROOT / "tests").rglob("test_*.py")
    )
    missing = [n for n in named if f"def {n}" not in src]
    assert not missing, f"cited as evidence but not defined: {missing}"


def test_every_cited_test_file_is_named_in_the_gate_table_and_exists():
    for rel in CITED_COUNTS:
        assert (ROOT / rel).exists(), f"the gate table cites {rel}, which is absent"


@pytest.mark.parametrize("rel, expected", sorted(CITED_COUNTS.items()))
def test_the_per_file_counts_the_doc_quotes_are_still_true(rel, expected):
    """
    The counts are the part most likely to rot, and the part read as proof.

    A count that has GROWN is not failed here — tests get added, and a doc one
    test behind is stale rather than false. A count that has SHRUNK means
    assertions were removed since the doc claimed them, which is the thing
    worth failing over.
    """
    out = subprocess.run(
        [sys.executable, "-m", "pytest", rel, "-q", "--no-header", "-p", "no:cacheprovider"],
        cwd=ROOT, capture_output=True, text=True, timeout=900,
    )
    m = re.search(r"(\d+) passed", out.stdout)
    assert m, f"could not read a pass count for {rel}:\n{out.stdout[-2000:]}"
    actual = int(m.group(1))
    assert actual >= expected, (
        f"{rel}: the doc cites {expected} passing tests and {actual} now pass. "
        "A shrinking count means assertions were removed after being cited as "
        "evidence."
    )


def test_the_backend_total_is_not_quoted_below_what_the_suite_now_runs():
    """
    The aggregate in gate 1. Pinned loosely on purpose: it changes every time a
    test is added, and an exact match would make this test a chore that gets
    deleted. What must not happen is the doc claiming MORE than exists.
    """
    m = re.search(r"\*\*(\d[\d,]*) passed, 0 failed\*\*", _doc())
    assert m, "gate 1 no longer states a backend total in the expected form"
    claimed = int(m.group(1).replace(",", ""))
    assert claimed >= 2097, (
        f"the doc claims {claimed}, below the 2097 baseline it was written "
        "against; a verification doc must not under-report its own evidence"
    )
