"""
R8 QA-13 / roadmap §19 — the theatre audit.

A regression test that passes before its own fix proves nothing. This script
reverts each fix in turn, runs the test that is supposed to guard it, and
records whether the test actually goes red. A fix whose guard stays green is
theatre and the row says to replace it.

Run deliberately, not as part of the suite:

    python -m tests.quick_answer.theatre_audit

It mutates working-tree files and restores each one from git immediately
afterwards, so it REFUSES TO START unless the tree is clean. Every entry
restores in a `finally`, and the tree is re-verified clean at the end.

Coverage spans rounds 3 through 8 rather than only R8's own fixes, because
running it on new tests alone proves nothing about the suite's history — which
is exactly what §19 names as this row's failure mode.
"""

from __future__ import annotations

import io
import subprocess
import sys

GA = "."
CRLF, LF = chr(13) + chr(10), chr(10)

#: (label, round, file, fixed_snippet, reverted_snippet, pytest target)
#:
#: `reverted_snippet` is the code as it stood BEFORE the fix, taken from the
#: guard comment at each site or from this round's own diffs.
CASES = [
    # ── R8 ────────────────────────────────────────────────────────────────
    # V39 lives only in app/core/verification/metric_spans.py since QA-12
    # moved it there; the rubric copy this once duplicated is gone.
    ("V39 metric span boundary (production copy)", "R8",
     "app/core/verification/metric_spans.py",
     "nxt = next((s for s in starts if s >= h.end()), len(excerpt))",
     "nxt = next((s for s in starts if s > h.start()), len(excerpt))",
     "tests/quick_answer/test_r8_metric_to_value.py"),

    ("V41 ground in the metric's span", "R8",
     "app/core/verification/citation_verdict.py",
     "n for n in _extract_numbers(_scrub(_numeric_source))",
     "n for n in _extract_numbers(_scrub(source_text))",
     "tests/quick_answer/test_r8_status_matrix.py"),

    ("V38 every asserted figure binds", "R8",
     "eval/head_to_head/rubric.py",
     "return all(\n            any(_matches(v, t, declared=declared) for t in texts)\n"
     "            for v in values\n        )",
     "return any(_matches(v, t, declared=declared)\n"
     "                   for v in values for t in texts)",
     "tests/quick_answer/test_r8_every_figure_binds.py"),

    ("V38 column verdict requires all", "R8",
     "eval/head_to_head/rubric.py",
     "return all(\n            any(_matches(v, figs[i], declared=declared) for i in idxs)\n"
     "            for v in values\n        )",
     "return any(_matches(v, figs[i], declared=declared)\n"
     "                   for v in values for i in idxs)",
     "tests/quick_answer/test_r8_every_figure_binds.py"),

    ("V33 accession needs a filer", "R8",
     "app/core/retrieval/citation_provenance.py",
     '    if not _clean(m.get("cik")):\n        return None',
     '    if False:\n        return None',
     "tests/quick_answer/test_r8_accession_is_not_enough.py"),

    ("V35 placeholder form dropped", "R8",
     "app/core/retrieval/citation_provenance.py",
     "if form.lower() in _PLACEHOLDER_FORMS:",
     "if False:",
     "tests/quick_answer/test_r8_prose_identity.py"),

    ("V36 restatement status", "R8",
     "app/core/retrieval/citation_provenance.py",
     '        "restatement_status": _restatement_status(m),',
     '        "restatement_status_disabled": _restatement_status(m),',
     "tests/quick_answer/test_r8_scope_and_restatement.py"),

    ("V37 five scope states", "R8",
     "app/core/retrieval/citation_provenance.py",
     '        "scope": _scope_of(dims),',
     '        "scope": "segment" if dims else "consolidated",',
     "tests/quick_answer/test_r8_scope_and_restatement.py"),

    ("V34 entity scope tickers", "R8",
     "app/core/search_pipeline.py",
     "        if scope_tickers and _ptk and _ptk not in scope_tickers:",
     "        if False and _ptk and _ptk not in scope_tickers:",
     "tests/quick_answer/test_r8_entity_binding.py"),

    ("V32 one primary-class predicate", "R8",
     "app/core/skills/scope.py",
     "is_primary_source_class = is_primary_class",
     'is_primary_source_class = lambda c: c in frozenset(\n'
     '    {"sec_filing", "edgar_text", "edgar", "xbrl"})',
     "tests/quick_answer/test_r8_source_class_vocabulary.py"),

    ("V25 scale per currency", "R8",
     "eval/head_to_head/rubric.py",
     "            scales = declared_scales(e)\n"
     "            declared = scales.get(ccy) or scales.get(\"\")",
     "            declared = declared_scale(e)",
     "tests/quick_answer/test_r8_unit_scale.py"),

    ("V26 currency compared", "R8",
     "eval/head_to_head/rubric.py",
     "            if ccy and src_ccy and ccy not in src_ccy:\n                continue",
     "            if False:\n                continue",
     "tests/quick_answer/test_r8_unit_scale.py"),

    ("V27 significant-digit guard (open-scale path)", "R8",
     "eval/head_to_head/rubric.py",
     "        if _sigdigits(got) < _sigdigits(expected):",
     "        if False:",
     "tests/quick_answer/test_r8_unit_scale.py"),

    # QA-13's first pass reverted only the open-scale guard, and the test it
    # ran exercised only the DECLARED one, so V27 reported as theatre while
    # both guards were in fact real. Two guards, two cases.
    ("V27 significant-digit guard (declared-scale path)", "R8",
     "eval/head_to_head/rubric.py",
     "            if (_sigdigits(got) >= _sigdigits(expected)\n"
     "                    and abs(got * declared - expected) / abs(expected) <= tol):",
     "            if (True\n"
     "                    and abs(got * declared - expected) / abs(expected) <= tol):",
     "tests/quick_answer/test_r8_unit_scale.py"),

    ("V17 period column gate", "R8",
     "eval/head_to_head/rubric.py",
     "            if periods and _periods_disagree(periods, _periods(e)):\n"
     "                continue",
     "            if False:\n                continue",
     "tests/quick_answer/test_r8_period_attachment.py"),

    ("V31 column years read as periods", "R8",
     "app/core/verification/citation_verdict.py",
     "    out.update((y, None) for y in column_years(text))",
     "    out.update(())",
     "tests/quick_answer/test_r8_period_attachment.py"),

    # ── Rounds 3-7, from the guard comments at each site ──────────────────
    ("U2 entity name boundary", "R3-7",
     "app/core/verification/metric_spans.py",  # placeholder, replaced below
     "", "", ""),
]

# U2 lives in rubric and the comment states its pre-fix form verbatim.
CASES[-1] = (
    "U2 entity names rather than contains", "R3-7",
    "eval/head_to_head/rubric.py",
    'return re.search(rf"(?<!\\w){re.escape(tok)}(?!\\w)", identity) is not None',
    "return tok in identity",
    "tests/quick_answer/test_r8_entity_binding.py",
)

CASES += [
    ("V22 marker past the end of the list", "R3-7",
     "eval/head_to_head/rubric.py",
     "    if all(not 0 <= i < n_cites for i in named):\n"
     "        # V22. Every marker names a citation the answer does not have.\n"
     "        return []",
     "    if False:\n        return []",
     "tests/test_claim_binds_the_citation_it_names.py"),

    ("V14 declared scale is the only reading", "R3-7",
     "eval/head_to_head/rubric.py",
     "        if declared and not explicit:",
     "        if False and not explicit:",
     "tests/test_declared_table_scale.py"),

    ("V1 an explicit magnitude is not rescaled", "R3-7",
     "eval/head_to_head/rubric.py",
     "        if explicit:\n            # V1. The figure stated its own magnitude",
     "        if False:\n            # V1. The figure stated its own magnitude",
     "tests/test_rubric_asserted_number.py"),

    ("V12 row-label boundary detector", "R3-7",
     "app/core/verification/metric_spans.py",
     "| {m.start() for m in ROW_LABEL.finditer(excerpt)}",
     "| set()",
     "tests/test_head_to_head_rubric.py"),
]


def _read(path: str) -> tuple[str, bool]:
    raw = io.open(path, "rb").read().decode("utf-8")
    crlf = raw.count(CRLF) > 0 and raw.count(CRLF) == raw.count(LF)
    return raw.replace(CRLF, LF), crlf


def _write(path: str, text: str, crlf: bool) -> None:
    io.open(path, "wb").write(
        (text.replace(LF, CRLF) if crlf else text).encode("utf-8"))


def _git_clean() -> bool:
    """No TRACKED modifications. Untracked files are irrelevant: this script
    only ever restores tracked files, so an untracked file cannot be damaged
    by it and must not block the audit."""
    out = subprocess.run(["git", "status", "--porcelain", "."],
                         capture_output=True, text=True, cwd=GA)
    return not [ln for ln in out.stdout.splitlines()
                if ln.strip() and not ln.startswith("??")]


def _restore(path: str) -> None:
    subprocess.run(["git", "checkout", "--", path], cwd=GA, check=True)


def _run(target: str) -> bool:
    """True when the target passes."""
    out = subprocess.run(
        [sys.executable, "-m", "pytest", target, "-q", "--no-header", "-x"],
        capture_output=True, text=True, cwd=GA)
    return out.returncode == 0


def main() -> int:
    if not _git_clean():
        print("REFUSING: working tree is not clean. Commit or stash first.")
        return 2

    rows = []
    for label, rnd, path, fixed, reverted, target in CASES:
        src, crlf = _read(path)
        if src.count(fixed) != 1:
            rows.append((label, rnd, "ANCHOR-MISSING", target))
            print(f"  !! {label}: anchor not found in {path}")
            continue
        try:
            _write(path, src.replace(fixed, reverted), crlf)
            passed = _run(target)
            verdict = "THEATRE" if passed else "real"
            rows.append((label, rnd, verdict, target))
            print(f"  {'!!' if passed else 'ok'} {label:44s} {verdict}")
        finally:
            _restore(path)

    if not _git_clean():
        print("ERROR: tree left dirty after restore.")
        return 3

    print()
    theatre = [r for r in rows if r[2] == "THEATRE"]
    missing = [r for r in rows if r[2] == "ANCHOR-MISSING"]
    print(f"cases          : {len(rows)}")
    print(f"real guards    : {sum(1 for r in rows if r[2] == 'real')}")
    print(f"THEATRE        : {len(theatre)}")
    print(f"anchor missing : {len(missing)}")
    for r in theatre:
        print(f"  THEATRE {r[0]} -> {r[3]}")
    for r in missing:
        print(f"  ANCHOR  {r[0]}")
    return 1 if theatre or missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
