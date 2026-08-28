"""The Quick Answer verification eval, as a build gate (roadmap Phase 8 + §15).

The roadmap requires that a failed verification test actually fails the build,
not merely print a lower score. These thresholds are that gate.

They are deliberately absolute rather than "no worse than last time": a ratchet
that only compares against the previous run lets a regression land as the new
baseline. The dataset is versioned, so raising a threshold is a visible change
to this file and not a silent drift.
"""

import pytest

from eval.quick_answer.run_eval import run


@pytest.fixture(scope="module")
def report():
    return run()


def test_every_golden_case_passes(report):
    assert report["failures"] == [], (
        "golden cases regressed: "
        + ", ".join(f"{f['id']} (expected {f['expected']}, got {f['actual']})"
                    for f in report["failures"])
    )


def test_no_adversarial_case_is_waved_through_as_verified(report):
    """The number that matters: an adversarial claim marked supported is an
    answer a user would have trusted."""
    assert report["metrics"]["false_confidence_count"] == 0


def test_every_adversarial_case_is_detected(report):
    assert report["metrics"]["adversarial_detection_rate"] == 1.0


def test_no_sound_citation_is_wrongly_rejected(report):
    """A verifier that rejects everything would pass the test above."""
    assert report["metrics"]["false_rejection_count"] == 0


def test_abstention_is_exact(report):
    assert report["metrics"]["abstention_accuracy"] == 1.0


def test_the_set_still_covers_every_required_category(report):
    """Deleting cases is the cheapest way to make this suite green."""
    required = {
        "exact_fact", "units", "units_adversarial", "temporal_adversarial",
        "entity_adversarial", "evidence_adversarial", "arithmetic_adversarial",
        "citation_adversarial", "abstention", "comparison", "evidence_partial",
    }
    assert required <= set(report["by_category"]), (
        f"missing categories: {required - set(report['by_category'])}"
    )
    assert report["totals"]["cases"] >= 34, "golden set shrank"
