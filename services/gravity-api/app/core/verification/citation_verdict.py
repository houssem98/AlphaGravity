"""Deterministic citation verdicts.

A citation used to carry a single boolean, `is_verified`, copied straight from
whatever the model reported as `entailed`. A model that invents citation [99]
against five retrieved passages therefore produced a citation with no source,
no title and no chunk id — marked verified. This module replaces that boolean
with a verdict derived from the retrieved evidence, so `is_verified` can only
be true when the passage the citation points at actually exists and does not
contradict it.

Pure and dependency-free: no network, no model, no pipeline state. Every check
here is deterministic and testable on its own.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.core.reasoning.temporal_verifier import _extract_year_quarter
from app.core.verification.nli_verifier import _extract_numbers, close_enough

# Verdicts, ordered from strongest to weakest claim of support.
VERIFIED = "verified"
PARTIALLY_SUPPORTED = "partially_supported"
UNSUPPORTED = "unsupported"
CONFLICTING = "conflicting"
NOT_VERIFIABLE = "not_verifiable"

VERDICTS = (VERIFIED, PARTIALLY_SUPPORTED, UNSUPPORTED, CONFLICTING, NOT_VERIFIABLE)

# "10%" and "10 percentage points" both parse to the scalar 10. They are not the
# same claim, and a margin answer that swaps one for the other is a classic
# financial error, so the unit travels with the number for that comparison.
_PCT_POINT = re.compile(
    r"(-?[\d,]+\.?\d*)\s*(?:percentage\s+points?|pp\b|ppt\b|bps\b|basis\s+points?)",
    re.IGNORECASE,
)
_PCT = re.compile(r"(-?[\d,]+\.?\d*)\s*(?:%|percent\b)", re.IGNORECASE)

# Filings and answers both write quarters out in words — "the third quarter of
# fiscal 2026" — and the shared temporal extractor only recognises the "Q3 2026"
# and "FY2026" forms. Against prose on both sides it returned nothing, so the
# period layer silently passed every claim: a claim about the first quarter of
# fiscal 2024, cited to a third-quarter fiscal-2026 passage, was graded on its
# number alone — and the number matched.
_ORDINAL_Q = {"first": 1, "second": 2, "third": 3, "fourth": 4,
              "1st": 1, "2nd": 2, "3rd": 3, "4th": 4}
_PROSE_QUARTER = re.compile(
    r"\b(first|second|third|fourth|1st|2nd|3rd|4th)\s+quarter\s+"
    r"(?:of\s+)?(?:the\s+)?(?:fiscal\s+(?:year\s+)?|FY\s*|calendar\s+)?(\d{4})\b",
    re.IGNORECASE,
)
# "fiscal 2026" / "fiscal year 2026" — the bare-word form.
_PROSE_FY = re.compile(r"\bfiscal\s+(?:year\s+)?(\d{4})\b", re.IGNORECASE)


def _periods(text):
    """Every period a piece of text names, as (year, quarter or None)."""
    out = set(_extract_year_quarter(text or ""))
    for m in _PROSE_QUARTER.finditer(text or ""):
        out.add((int(m.group(2)), _ORDINAL_Q[m.group(1).lower()]))
    for m in _PROSE_FY.finditer(text or ""):
        out.add((int(m.group(1)), None))
    return out


def _periods_disagree(claim, source):
    """True when both sides name periods and none of them line up.

    A year named without a quarter is compatible with any quarter of that year:
    "fiscal 2025" does not contradict "Q3 fiscal 2025". Disagreement has to be
    positive evidence of a different period, not merely a coarser one.
    """
    if not claim or not source:
        return False
    for cy, cq in claim:
        for sy, sq in source:
            if cy != sy:
                continue
            if cq is None or sq is None or cq == sq:
                return False
    return True


def _scalars(pat: re.Pattern, text: str) -> set[float]:
    out: set[float] = set()
    for m in pat.finditer(text or ""):
        try:
            out.add(float(m.group(1).replace(",", "")))
        except ValueError:
            continue
    return out


@dataclass
class CitationVerdict:
    status: str
    reasons: list[str] = field(default_factory=list)

    @property
    def is_verified(self) -> bool:
        return self.status == VERIFIED


def _resolve(citation: dict, passages: list) -> tuple[object | None, str | None]:
    """Find the passage a citation points at, or say why it does not resolve.

    Returns (passage, failure_reason). Exactly one is non-None.
    """
    if not passages:
        return None, "no_retrieved_passages"

    chunk_id = citation.get("chunk_id") or ""
    if chunk_id:
        for p in passages:
            if (getattr(p, "chunk_id", None) or "") == chunk_id:
                return p, None
        # A chunk id that names nothing in this answer's own evidence set is a
        # citation to another answer's source, or to no source at all.
        return None, "citation_chunk_not_in_answer_sources"

    num = citation.get("citation_number")
    try:
        num = int(num)
    except (TypeError, ValueError):
        return None, "citation_number_not_an_integer"
    if not (1 <= num <= len(passages)):
        return None, "citation_index_out_of_range"
    return passages[num - 1], None


def _text_of(p) -> str:
    return (getattr(p, "text", "") or "")


# A number written with no unit beside it takes its scale from something the
# passage does not repeat — a table header reading "(in millions)", or an XBRL
# fact stored in whole dollars. A filing table row says "Total net sales
# $ 416,161" and the XBRL fact for the same line says 416161000000; they are one
# figure, and flagging that as "not in source" is a false rejection on a
# perfectly good citation.
#
# The tolerance is deliberately one-sided. A claim that states its unit
# explicitly and states it WRONG — "$130,497 billion" against a source reading
# "$130,497 million" — is a real error and must still fail, so the implied-scale
# allowance applies only to numbers that carry no unit of their own.
_IMPLIED_SCALES = (1.0, 1e3, 1e6, 1e9)

_NUM_WITH_UNIT = re.compile(
    r"([\d,]+(?:\.\d+)?)\s*(trillion|billion|million|thousand|[TBMK](?![a-zA-Z]))",
    re.IGNORECASE,
)


# Filing form designators are not figures. "10-K", "10-Q", "8-K", "20-F" and
# "6-K" each leave a stray integer behind when a passage is scanned for numbers,
# and a stray integer in the source counts as a figure the claim failed to
# account for. An exact-fact passage reading "AAPL revenue for FY2025 (10-K):
# $416,161,000,000" was therefore judged to contain a second, competing figure
# of 10.
_FORM_TOKEN = re.compile(r"\b\d{1,2}-[A-Z]{1,2}\b")
# Section references ("Item 7", "Item 1A") are structure, not figures.
_ITEM_REF = re.compile(r"\bItem\s+\d{1,2}[A-Z]?\b", re.IGNORECASE)


def _scrub(text: str) -> str:
    """Remove tokens that look numeric but state no quantity."""
    t = _FORM_TOKEN.sub(" ", text or "")
    return _ITEM_REF.sub(" ", t)


def _is_bare_year(v: float) -> bool:
    """A plain integer in a plausible year range, carrying no scale.

    Years must not count as claim figures. "Revenue for fiscal year 2025 was
    $130,497 billion" contains two numbers, and 2025 appears verbatim in a
    source that also says "fiscal year 2025" — so treating it as evidence let a
    thousand-fold unit error be scored as *partly* grounded instead of wrong.
    Periods are the period layer's job; this layer grades figures.

    A scaled value is never a year: "$2,025 million" parses to 2.025e9 and is
    left alone.
    """
    return float(v).is_integer() and 1900 <= v <= 2100


def _explicitly_scaled(text: str) -> set[float]:
    """The numeric values in `text` that state their own unit."""
    out: set[float] = set()
    for m in _NUM_WITH_UNIT.finditer(text or ""):
        try:
            out.add(float(m.group(1).replace(",", "")))
        except ValueError:
            continue
    return out


def _found_in_source(value: float, sources: list, implied_ok: bool) -> bool:
    """Is `value` present among the source numbers, allowing implied scale?"""
    if any(close_enough(value, s) for s in sources):
        return True
    if not implied_ok:
        return False
    for factor in _IMPLIED_SCALES[1:]:
        if any(close_enough(value * factor, s) for s in sources):
            return True
        if any(close_enough(value, s * factor) for s in sources):
            return True
    return False


def verdict_for_citation(
    citation: dict,
    passages: list,
    *,
    model_entailed: bool | None = None,
) -> CitationVerdict:
    """Grade one citation against the passages retrieved for this answer.

    `model_entailed` is what the generator or the ALiiCE pass claimed. It can
    only raise a citation that already survives the deterministic layers; it can
    never rescue one that fails them.
    """
    # ── Layer A: citation validity ──────────────────────────────────────
    passage, failure = _resolve(citation, passages)
    if failure == "no_retrieved_passages":
        return CitationVerdict(NOT_VERIFIABLE, [failure])
    if failure:
        return CitationVerdict(UNSUPPORTED, [failure])

    reasons: list[str] = []
    claim = (citation.get("text") or "").strip()
    source_text = _text_of(passage)

    if not claim or not source_text:
        # Nothing to compare. The citation resolves, so it is not unsupported;
        # it simply cannot be graded on content.
        return CitationVerdict(NOT_VERIFIABLE, ["no_comparable_text"])

    conflicts: list[str] = []

    # ── Layer C: entity ─────────────────────────────────────────────────
    cited_ticker = (citation.get("ticker") or "").strip().upper()
    passage_ticker = (getattr(passage, "ticker", "") or "").strip().upper()
    if cited_ticker and passage_ticker and cited_ticker != passage_ticker:
        conflicts.append("entity_mismatch")

    # ── Layer C: period ─────────────────────────────────────────────────
    # Only a decision when both sides actually name a period. A claim that names
    # none is not thereby wrong.
    claim_periods = _periods(claim)
    # The filing date is not a period the passage is *about*, so it can only
    # widen what counts as agreement, never narrow it.
    src_periods = _periods(source_text) | _periods(
        getattr(passage, "filing_date", "") or ""
    )
    if _periods_disagree(claim_periods, src_periods):
        conflicts.append("period_mismatch")

    # ── Layer D: units — percent vs percentage points ───────────────────
    claim_pp, claim_pct = _scalars(_PCT_POINT, claim), _scalars(_PCT, claim)
    src_pp, src_pct = _scalars(_PCT_POINT, source_text), _scalars(_PCT, source_text)
    if claim_pp and not src_pp and claim_pp & src_pct:
        conflicts.append("percentage_point_unit_mismatch")
    if claim_pct and not src_pct and claim_pct & src_pp:
        conflicts.append("percentage_point_unit_mismatch")

    # Percent values are excluded from the scalar comparison below (they are
    # graded on their unit, above), but they are still the figure a margin claim
    # rests on. Without this a claim like "Gross margin was 75.0% in fiscal
    # 2025" had nothing left to check once the year was set aside, and topped
    # out at `partially_supported` however well grounded it was.
    percent_checked = False
    if claim_pct and src_pct:
        percent_checked = True
        if any(not any(close_enough(c, s) for s in src_pct) for c in claim_pct):
            conflicts.append("percent_not_in_source")
    elif claim_pp and src_pp:
        percent_checked = True
        if any(not any(close_enough(c, s) for s in src_pp) for c in claim_pp):
            conflicts.append("percent_not_in_source")

    # ── Layer D: numeric consistency ────────────────────────────────────
    # Percent-like tokens are graded by the unit rule above; comparing them again
    # as bare scalars would double-report the same disagreement.
    claim_nums = [
        n for n in _extract_numbers(_scrub(claim))
        if n not in (claim_pp | claim_pct) and not _is_bare_year(n)
    ]
    src_nums = [
        n for n in _extract_numbers(_scrub(source_text)) if not _is_bare_year(n)
    ]
    # Numbers the claim states a unit for. Those are held to the literal value;
    # the rest may take their scale from a table header the passage does not
    # repeat.
    claim_explicit = _explicitly_scaled(claim)
    numeric_checked = percent_checked
    partial = False
    if claim_nums:
        numeric_checked = True
        if src_nums:
            grounded, ungrounded = [], []
            for n in claim_nums:
                implied_ok = not any(
                    close_enough(n, e * f)
                    for e in claim_explicit for f in _IMPLIED_SCALES
                )
                (grounded if _found_in_source(n, src_nums, implied_ok)
                 else ungrounded).append(n)

            if not grounded:
                # Nothing in the claim is in the cited source. The source does
                # not say this.
                conflicts.append("numeric_not_in_source")
            elif ungrounded:
                # Some grounded, some not. Absence is not contradiction, and
                # separating them is what keeps this layer both honest and
                # useful. The discriminator is whether the source still holds
                # figures of its own that nothing in the claim matched:
                #
                #   "Revenue grew to $130,497M from $70,000M in fiscal 2024"
                #   cited to a source reading "...$130,497 million, up from
                #   $60,922 million..." — the source has 60,922 left over and
                #   the claim has 70,000 left over. Those compete for the same
                #   slot, and the claim is wrong. CONFLICTING.
                #
                #   "Total net sales $ 416,161 6 % $ 391,035 2 % $ 383,285"
                #   cited to an exact-fact passage holding only 416,161 — the
                #   source has nothing left over. It simply does not cover the
                #   other years. Not a contradiction, not full support.
                #   PARTIALLY_SUPPORTED.
                # A source figure counts as accounted for when some grounded
                # claim figure matches it under the same implied-scale rule
                # used to ground it. Comparing raw values here left the matched
                # source number looking unconsumed — 416,161 grounded the claim
                # but 416,161,000,000 stayed in the leftovers — and every
                # partially grounded citation came out as a contradiction.
                source_leftover = [
                    s for s in src_nums
                    if not _found_in_source(s, grounded, True)
                ]
                if source_leftover:
                    conflicts.append("numeric_contradicts_source")
                else:
                    partial = True
        else:
            conflicts.append("numeric_not_in_source")

    if conflicts:
        return CitationVerdict(CONFLICTING, sorted(set(conflicts)))

    # ── Resolution ──────────────────────────────────────────────────────
    if numeric_checked and partial:
        return CitationVerdict(
            PARTIALLY_SUPPORTED,
            ["some_claim_figures_not_in_cited_source"],
        )

    if numeric_checked:
        # The number the claim rests on was found in the cited passage.
        reasons.append("numeric_grounded_in_source")
        if model_entailed is False:
            # Deterministic layers agree, the model does not. Say so rather than
            # picking a winner.
            return CitationVerdict(PARTIALLY_SUPPORTED, reasons + ["model_reported_not_entailed"])
        return CitationVerdict(VERIFIED, reasons)

    # No numeric claim to check deterministically. The model's entailment call is
    # then the only evidence, and it is not enough on its own to say "verified".
    if model_entailed:
        return CitationVerdict(PARTIALLY_SUPPORTED, ["model_entailed_only"])
    return CitationVerdict(PARTIALLY_SUPPORTED, ["resolved_but_uncorroborated"])
