"""
The skill-coverage eval, run in-process, as a build gate.

Three things are asserted, and the last two matter as much as the first:

  1. every case passes;
  2. no case produced false confidence or an unsupported claim;
  3. the suite has not SHRUNK.

(3) is there because deleting cases is the cheapest way to make a golden suite
green, and a gate that only checks the score cannot tell a fix from a deletion.
The counts and category names below are the floor, not the target — adding
cases is expected and raises the floor on the next edit; removing one fails
here and has to be argued for explicitly.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from eval.quick_answer_skill_coverage import run_eval

# The floor. Raise when cases are added; never lower to get green.
MIN_CASES = 37
REQUIRED_CATEGORIES = {
    "unseen_company", "legal_name", "annual", "quarterly", "missing_metric",
    "future_period", "ambiguity", "unknown_company", "channel_failure",
    "citation_validity", "conflicting_evidence", "insufficient_evidence",
    "no_market_proxy",
}
MIN_ISSUERS = 9
MIN_SECTORS = 9


def _spec() -> dict:
    return json.loads(Path(run_eval.CASES).read_text(encoding="utf-8"))


def _report() -> dict:
    """Run every case in-process and grade it, without touching the filesystem."""
    spec = _spec()
    issuers, cases = spec["issuers"], spec["cases"]
    resolver = run_eval.Resolver(issuers)

    async def go():
        rows = []
        for case in cases:
            result, channel, _ms = await run_eval._run_one(case, issuers, resolver)
            passed, failures = run_eval.grade(case, result, channel)
            rows.append({"id": case["id"], "category": case["category"],
                         "passed": passed, "failures": failures})
        return rows

    return {"rows": asyncio.run(go()), "spec": spec}


@pytest.fixture(scope="module")
def report():
    return _report()


def test_every_case_passes(report):
    failed = [r for r in report["rows"] if not r["passed"]]
    assert not failed, "\n".join(
        f"{r['id']}: {'; '.join(r['failures'])}" for r in failed
    )


def test_no_false_confidence_anywhere(report):
    offenders = [
        (r["id"], f) for r in report["rows"] for f in r["failures"]
        if "false confidence" in f
    ]
    assert offenders == []


def test_no_claim_cites_a_citation_that_does_not_exist(report):
    offenders = [
        (r["id"], f) for r in report["rows"] for f in r["failures"]
        if "does not exist" in f
    ]
    assert offenders == []


def test_the_suite_has_not_shrunk(report):
    assert len(report["rows"]) >= MIN_CASES


def test_every_required_category_is_still_covered(report):
    present = {r["category"] for r in report["rows"]}
    assert REQUIRED_CATEGORIES <= present, REQUIRED_CATEGORIES - present


def test_the_issuer_set_stays_broad(report):
    issuers = report["spec"]["issuers"]
    assert len(issuers) >= MIN_ISSUERS
    assert len({i["sector"] for i in issuers}) >= MIN_SECTORS


def test_the_issuers_are_not_the_ones_someone_hard_coded():
    """
    The universality claim, checked against the source rather than asserted.

    If these tickers were in the alias table or the group aliases, a passing
    suite would prove nothing about an arbitrary registrant.
    """
    from app.core.entities import group_aliases
    from app.core.entity_resolver import _ALIASES

    curated = {t.upper() for t in _ALIASES.values()}
    curated |= {t.upper() for t in getattr(group_aliases, "CANONICAL_NAMES", {})}
    for group in getattr(group_aliases, "GROUPS", {}).values():
        curated |= {str(t).upper() for t in (group or ())}

    unseen = {
        c["company"].upper()
        for c in _spec()["cases"]
        if c["category"] == "unseen_company"
    }
    assert unseen, "no unseen-company cases"
    overlap = unseen & curated
    assert overlap == set(), f"these are not unseen: {sorted(overlap)}"
