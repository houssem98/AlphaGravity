"""
Which part of a passage speaks about which metric.

Moved into production in R8 QA-12, from `eval/head_to_head/rubric.py`, because
both layers need the same answer and only one of them had it. The vocabulary
itself (`_METRIC_RES`) already lived in `core/finance/query_plan`; the span
logic did not, so `citation_verdict` grounded a claim's figures against every
number in a passage rather than against the numbers belonging to the metric the
claim names. Measured:

    claim     "operating revenue was $54,356 million"
    passage   "Operating revenue $ 59,070  Operating expense 54,356 ..."
    verdict   verified ['numeric_grounded_in_source']

54,356 is the EXPENSE. Production certified it because the figure was present
somewhere, and its contradiction scan only runs when a claim is PARTIALLY
grounded — a fully grounded but misattributed claim never reached it.

This is the same arrangement `declared_scale`, `declared_scales`,
`column_years` and `_periods` already have: production owns the definition and
the evaluator imports it, so the two cannot drift into disagreeing about what a
passage says.
"""

from __future__ import annotations

import re

from app.core.finance.query_plan import _METRIC_RES

__all__ = ["ROW_LABEL", "metric_keys", "metric_spans"]

#: Nouns that start a new line item in a financial table (V12).
#:
#: A BOUNDARY DETECTOR, not a vocabulary. It names no metric, maps to no key,
#: and nothing is ever classified by it — it only marks where one row's figures
#: stop belonging to the row above. That distinction is why this is not the
#: parallel-vocabulary mistake of R14, T1 and T2.
#:
#: It exists because real filings flatten to prose like
#: `"Operating revenue $ 59,070 $ 57,063 Operating expense 54,356 51,967"`, and
#: `operating expense` is not in the metric lexicon, so revenue's span ran on
#: and swallowed the expense row. Invented fixtures hid this by putting the
#: competing label BEFORE the claimed metric, where ordering happened to save
#: it. A real United Airlines table put it after.
ROW_LABEL = re.compile(
    r"\b(?:expenses?|costs?|margins?|incomes?|losses|loss|assets|"
    r"liabilities|equity|cash|taxes|tax|earnings|shares)\b",
    re.I,
)


def metric_keys(text: str) -> set[str]:
    """Metric keys `text` names, using production's vocabulary (U3).

    Consumes each matched span the way `query_plan._metrics_in` does, so the
    `margin` inside `gross margin` cannot also register as a second metric.
    """
    keys: set[str] = set()
    t = text or ""
    for key, _label, _basis, rx in _METRIC_RES:
        m = rx.search(t)
        if m:
            keys.add(key)
            t = t[:m.start()] + " " * (m.end() - m.start()) + t[m.end():]
    return keys


def metric_spans(excerpt: str, key: str) -> list[str] | None:
    """
    The parts of `excerpt` that speak about `key`, or `None` if it does not.

    A metric owns the text from its own mention up to the next metric mention.
    That is what lets "operating expenses were $130 billion while revenue was
    $120 billion" answer the question "what does this say REVENUE was?" with
    `$120 billion` and not `$130 billion` — without needing to know which
    metric owns the 130, or even having `operating expenses` in the vocabulary.

    Spans carrying no figure are dropped, and a metric with no numbered span
    returns `None`. That is the fail-open path: "its highest revenue ever"
    names the metric and states nothing about its value, so it must not be read
    as a contradiction.
    """
    rx = next((r for k, _l, _b, r in _METRIC_RES if k == key), None)
    if rx is None:
        return None
    hits = list(rx.finditer(excerpt))
    if not hits:
        return None
    starts = sorted(
        {m.start() for _k, _l, _b, r in _METRIC_RES for m in r.finditer(excerpt)}
        | {m.start() for m in ROW_LABEL.finditer(excerpt)}
    )
    spans = []
    for h in hits:
        # V39. The next metric begins after this metric's NAME ends, not
        # anywhere after its start. `Operating income` contains `income`, which
        # is itself a metric, so a boundary landed at offset 10 INSIDE the name
        # and the span collapsed to `'Operating '` — no figures, dropped, and
        # this returned None for a metric plainly present in the table. Callers
        # then fell back to searching the WHOLE excerpt, so a claim about
        # operating income bound against the income-before-taxes row beside it.
        nxt = next((s for s in starts if s >= h.end()), len(excerpt))
        span = excerpt[h.start():nxt]
        if any(ch.isdigit() for ch in span):
            spans.append(span)
    return spans or None
