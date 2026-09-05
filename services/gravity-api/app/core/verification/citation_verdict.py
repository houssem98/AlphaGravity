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

#: A table stating the scale of every bare figure under it (V19).
#:
#: `(in millions)`, `($ in thousands)`, `amounts in thousands`. Real filings
#: declare the unit once in a header and print bare numbers underneath, and
#: `_IMPLIED_SCALES` above is switched off for any claim that states its own
#: unit — so a correct answer written the way a good answer writes it,
#: `$59,070 million` against `(in millions) ... Operating revenue $ 59,070`,
#: was graded `conflicting` — the identical verdict the claim wrong by a
#: factor of a thousand received. The header is a fact the passage states;
#: reading it is not a new allowance.
#:
#: Exported because `eval/head_to_head/rubric.py` needs the identical
#: reading. Two copies of this rule would drift, and the grader importing
#: production's is the direction that keeps them honest.
_DECLARED_SCALE = re.compile(
    r"\(\s*(?:(?:\$|US\$|usd|dollars?|amounts?)\s*)?in\s+"
    r"(thousands|millions|billions)\b"
    r"|\bamounts?\s+(?:are\s+)?in\s+(thousands|millions|billions)\b"
    r"|\bexpressed\s+in\s+(thousands|millions|billions)\b",
    re.I,
)

_SCALE_WORD = {"thousands": 1e3, "millions": 1e6, "billions": 1e9}


def declared_scale(text: str) -> float | None:
    """The scale a table declares for its bare figures, if it declares one.

    The single-scale reading, kept because most tables declare one scale and
    every caller that cannot know a figure's currency needs an answer. For a
    header that declares several, this returns the FIRST — see
    `declared_scales`, and V25 for why that is not good enough on its own.
    """
    m = _DECLARED_SCALE.search(text or "")
    if not m:
        return None
    return _SCALE_WORD.get(next((g for g in m.groups() if g), "").lower())


#: Currency words as filing headers write them, and the ISO code each means.
_CURRENCY_WORD = {
    "dollar": "USD", "dollars": "USD", "usd": "USD",
    "yen": "JPY", "jpy": "JPY",
    "euro": "EUR", "euros": "EUR", "eur": "EUR",
    "pound": "GBP", "pounds": "GBP", "sterling": "GBP", "gbp": "GBP",
    "yuan": "CNY", "renminbi": "CNY", "rmb": "CNY", "cny": "CNY",
    "franc": "CHF", "francs": "CHF", "chf": "CHF",
}

#: The symbols an answer actually writes. `$` is deliberately USD here: a
#: financial answer citing a US filing writes `$`, and treating it as ambiguous
#: would refuse almost everything. Where a filing means something else by `$`
#: it says so in words, and the word wins below.
_CURRENCY_SYMBOL = {"$": "USD", "¥": "JPY", "€": "EUR", "£": "GBP"}

#: `(In millions of dollars and billions of yen)` — a scale bound to a currency.
_SCALE_OF_CURRENCY = re.compile(
    r"\b(thousands|millions|billions)\s+of\s+([A-Za-z]+)", re.I)

_SYMBOLS_RE = re.compile("[" + "".join(_CURRENCY_SYMBOL) + "]")
_CODES_RE = re.compile(r"\b(USD|JPY|EUR|GBP|CNY|CHF)\b")


def declared_scales(text: str) -> dict[str, float]:
    """Every scale a header declares, keyed by the currency it declares it for.

    V25. `declared_scale` returns one float, so a header binding two scales to
    two columns could only answer for one of them — and it answered for the
    first. Aflac's Japan segment table declares

        (In millions of dollars and billions of yen)

    and its yen column is a thousand times larger than the dollar reading of
    the same header. Measured before this existed, `¥1,009 billion` — the
    filing's own figure — was refused, and `¥1,009 million` was accepted.

    The empty-string key means "declared, but for no particular currency",
    which is what an ordinary `(in millions)` header says. A caller that knows
    its figure's currency should prefer the specific entry and fall back to it.
    """
    out: dict[str, float] = {}
    for m in _SCALE_OF_CURRENCY.finditer(text or ""):
        ccy = _CURRENCY_WORD.get(m.group(2).lower())
        if ccy:
            out[ccy] = _SCALE_WORD[m.group(1).lower()]
    if not out:
        one = declared_scale(text)
        if one:
            out[""] = one
    return out


def currencies_in(text: str) -> set[str]:
    """The currencies a piece of text names, by symbol, code or word."""
    found = {_CURRENCY_SYMBOL[s] for s in _SYMBOLS_RE.findall(text or "")}
    found |= {c.upper() for c in _CODES_RE.findall(text or "")}
    for w in re.findall(r"[A-Za-z]+", text or ""):
        c = _CURRENCY_WORD.get(w.lower())
        if c:
            found.add(c)
    return found


def currency_of(text: str) -> str:
    """The single currency a claim states, or `""` when it states none or several.

    V26. Nothing in the binding path compared currency, so a claim of
    `€6,744 million` bound against a source reading `$ 6,744` — the digits
    agreed and no one looked at the symbol. Returning `""` for a mixed or silent
    sentence keeps the check one-directional: it can refuse a claim that names
    the wrong currency, and never manufactures a currency for one that names
    none.
    """
    found = currencies_in(text)
    return next(iter(found)) if len(found) == 1 else ""

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


# Citation markers are provenance, not quantities (V20). `[3]` left a bare 3
# among the claim's figures, which is in no source, so a fully grounded
# sentence was demoted from `verified` to `partially_supported` for the sole
# crime of citing something. The identical sentence without its marker
# verified.
_CITE_MARKER = re.compile(r"\[\s*\d{1,3}\s*\]")


def _scrub(text: str) -> str:
    """Remove tokens that look numeric but state no quantity."""
    t = _FORM_TOKEN.sub(" ", text or "")
    t = _CITE_MARKER.sub(" ", t)
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


def fact_value(citation: dict) -> float | None:
    """The exact figure the cited fact states, when the citation carries one.

    `citation_provenance.payload()` puts the canonical evidence object's fields
    on the citation (E1), so for a filing fact this is the number as XBRL holds
    it — absolute, unrounded, and not recovered from any rendering of it.

    That difference is not cosmetic. `structured_search._fmt_value` prints a
    fact as `${v/1e6:,.0f} million`, so the rounding error is up to half a
    million dollars: negligible against $416B, and 33% against $1.5M. Measured
    against claims quoting the filing's own exact figure, every fact between
    roughly $1M and $120M was graded `conflicting / numeric_not_in_source`
    because the only number the verifier could see was the rounded one:

        fact 12,499,000  rendered "$12 million"  ->  conflicting
        fact  2,500,000  rendered  "$2 million"  ->  conflicting
        fact  1,499,999  rendered  "$1 million"  ->  conflicting

    Reading the field is the fix. Rendering more decimals would be the symptom.
    """
    v = citation.get("value")
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def fact_periods(citation: dict) -> set:
    """The periods the cited fact declares, as `_periods` shapes them.

    Taken from the fact's own `fiscal_year` / `fiscal_quarter` / `period_end`
    rather than from regexes over the passage. It can only ADD periods the
    source is known to be about, so it makes the period check less likely to
    fire, never more — a fact stating its year cannot be argued out of it by
    prose that failed to mention one.
    """
    out: set = set()
    fy, fq = citation.get("fiscal_year"), citation.get("fiscal_quarter")
    try:
        if fy:
            out.add((int(fy), int(fq) if fq else None))
    except (TypeError, ValueError):
        pass
    for key in ("period_end", "period_start"):
        d = str(citation.get(key) or "")
        if len(d) >= 4 and d[:4].isdigit():
            out.add((int(d[:4]), None))
    return out


def _found_in_source(value: float, sources: list, implied_ok: bool,
                     declared: float | None = None) -> bool:
    """Is `value` present among the source numbers, allowing implied scale?"""
    if any(close_enough(value, s) for s in sources):
        return True
    # V19. The passage declared what its bare figures mean, so reading them
    # at that scale is reading the passage rather than guessing at it. Tried
    # in both directions because this function is also called with the roles
    # reversed, to ask which source figures a claim left unaccounted for.
    if declared:
        if any(close_enough(value * declared, s) for s in sources):
            return True
        if any(close_enough(value, s * declared) for s in sources):
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
    # E3. When the citation carries the fact, the fact says which period it is
    # about and no regex has to guess. Widening only: this can silence a false
    # period conflict, never manufacture one.
    ) | fact_periods(citation)
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
    # V19. Read from the whole passage: a table declares its scale in a
    # header that sits well away from the row it governs.
    src_declared = declared_scale(source_text)
    # E3. The exact figure the fact states, when the citation carries one.
    fv = fact_value(citation)
    numeric_checked = percent_checked
    partial = False
    if claim_nums:
        numeric_checked = True
        if src_nums or fv is not None:
            grounded, ungrounded = [], []
            for n in claim_nums:
                implied_ok = not any(
                    close_enough(n, e * f)
                    for e in claim_explicit for f in _IMPLIED_SCALES
                )
                # E3. A claim figure equal to the fact's own value is grounded,
                # and no reading of the passage can argue with that — the fact
                # IS what the filing says, and the prose is a lossy rendering
                # of it.
                if fv is not None and close_enough(n, fv):
                    grounded.append(n)
                    continue
                (grounded if _found_in_source(n, src_nums, implied_ok,
                                             src_declared)
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
                #
                # E3. When the citation carries the fact, the leftover question
                # is already answered and asking the prose again can only get it
                # wrong. An exact fact states ONE figure for one metric in one
                # period; a claim naming more is uncovered, not contradicted.
                # The prose leftovers here are the fact's own value re-rendered
                # at a coarser precision, so scanning them turns "the source
                # does not cover the other year" into "the source contradicts
                # the claim" on the strength of a rounding artefact.
                if fv is not None:
                    partial = True
                else:
                    source_leftover = [
                        s for s in src_nums
                        if not _found_in_source(s, grounded, True, src_declared)
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
