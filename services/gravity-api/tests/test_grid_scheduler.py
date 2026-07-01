"""Parity tests for the ported diff primitive (mirrors gridResearch.ts tests)."""

from app.core.grid_scheduler import extract_figures, figures_changed


def test_ignores_phrasing_same_figures():
    a = "Revenue was $5,010 million [1], up 12%."
    b = "The company reported revenue of $5,010 million, a 12% increase [3]."
    assert figures_changed(a, b) is False


def test_detects_changed_number():
    assert figures_changed("Revenue $5,010 million", "Revenue $6,200 million") is True


def test_ignores_citation_markers():
    assert extract_figures("gross margin 44% [1][2]") == extract_figures("gross margin 44%")


def test_empty_is_no_change():
    assert figures_changed("", "") is False
