"""
The blind head-to-head rubric, and why it is shaped like this.

The roadmap asks whether AlphaGravity beats a top ChatGPT finance answer, with
a fixed weighting: correctness 30, evidence 20, reasoning 15, period/entity 10,
scope 10, clarity 10, latency 5.

Three things this module refuses to do, each because the alternative produces a
number that looks like a result and is not one:

**It does not grade with a model by default.** Repeated identical LLM-judge
calls flip their pairwise preference often enough that a single call at a fixed
threshold is a biased coin. Every dimension below that CAN be scored
mechanically is scored mechanically — correctness against a recorded
ground-truth figure, evidence against citation presence and class, period and
entity against the plan. What genuinely needs judgement is left `None` and
reported as ungraded rather than guessed.

**It does not let either side be scored by its own author.** The reference
answers live in `cases.json` as data, recorded before the run, and the grader
cannot see which system produced which answer — `blind_pairs()` shuffles and
returns opaque labels.

**It does not tune on the reference.** The ground-truth figures come from the
filings, not from the reference answer. If the reference is wrong, it loses
points; that is the whole purpose of an independent key.

A run that cannot score a dimension reports it as ungraded. An aggregate over
partially-graded dimensions is reported with the coverage attached, because
"we won 62 to 58" means nothing if a third of the rubric never ran.
"""

from __future__ import annotations

import hashlib
import random
import re
from dataclasses import dataclass, field

#: Production's metric vocabulary, imported rather than restated (U3).
#:
#: This module otherwise imports nothing from `app`, and that independence is
#: deliberate — a grader coupled to the thing it grades can be tuned by
#: changing the thing. A metric LEXICON is the exception, and the reason is
#: R14, T1 and T2: every one of those was a second vocabulary invented beside
#: the first and left to drift. Twenty-five metric patterns restated here would
#: be the same mistake with a new name.
#:
#: Note this is the opposite call from `_ACCESSION_RE`, which is deliberately
#: redeclared rather than imported. The distinction is what the thing is: an
#: accession format is a per-purpose rule (what may enter a URL vs what counts
#: as evidence), while a metric lexicon is a shared vocabulary that both sides
#: must read identically or the grader cannot see what the system saw.
from app.core.finance.query_plan import _METRIC_RES

__all__ = [
    "DIMENSIONS", "Dimension", "Scorecard", "blind_pairs", "score_answer",
]


@dataclass(frozen=True)
class Dimension:
    key: str
    weight: int
    mechanical: bool
    what: str


#: The roadmap's weights, verbatim. They sum to 100 and a test asserts it.
DIMENSIONS: tuple[Dimension, ...] = (
    Dimension("correctness", 30, True,
              "the stated figure matches the filing"),
    Dimension("evidence", 20, True,
              "claims carry citations, and to primary sources where required"),
    Dimension("reasoning", 15, False,
              "the derivation is stated and sound"),
    Dimension("period_entity", 10, True,
              "the right company and the right fiscal period"),
    Dimension("scope", 10, True,
              "coverage is stated; a partial scan is not presented as complete"),
    Dimension("clarity", 10, False,
              "answer first, no padding, no pipeline noise"),
    Dimension("latency", 5, True,
              "wall time to a complete answer"),
)

_BY_KEY = {d.key: d for d in DIMENSIONS}


@dataclass
class Scorecard:
    """One system's score on one case. `None` means ungraded, never zero."""

    system: str = ""
    case_id: str = ""
    scores: dict[str, float | None] = field(default_factory=dict)
    notes: dict[str, str] = field(default_factory=dict)

    @property
    def graded_keys(self) -> list[str]:
        return [k for k, v in self.scores.items() if v is not None]

    @property
    def graded_weight(self) -> int:
        return sum(_BY_KEY[k].weight for k in self.graded_keys if k in _BY_KEY)

    @property
    def weighted(self) -> float | None:
        """
        Weighted score over the dimensions that were actually graded.

        Renormalised to the graded weight, so a run that could not score
        `reasoning` does not silently hand both systems a 15-point hole and
        call the remainder a total.
        """
        gw = self.graded_weight
        if not gw:
            return None
        total = sum(_BY_KEY[k].weight * float(self.scores[k])
                    for k in self.graded_keys if k in _BY_KEY)
        return round(total / gw, 4)

    def as_dict(self) -> dict:
        return {
            "system": self.system,
            "case_id": self.case_id,
            "scores": self.scores,
            "notes": self.notes,
            "graded_weight": self.graded_weight,
            "ungraded": [d.key for d in DIMENSIONS if self.scores.get(d.key) is None],
            "weighted": self.weighted,
        }


# ── Mechanical scoring ────────────────────────────────────────────────────

_SCALE = {"k": 1e3, "m": 1e6, "mm": 1e6, "b": 1e9, "bn": 1e9, "t": 1e12,
          "thousand": 1e3, "million": 1e6, "billion": 1e9, "trillion": 1e12}

#: The sign is part of the number. Without it "-5.48%" parsed as 5.48 and a
#: correctly reported DECLINE scored zero against an expected -5.476 — the
#: rubric marking the right answer wrong, which is the worst kind of grader bug
#: because it pushes the system away from the truth.
_NUM = re.compile(
    r"(?:(?<![\w.])[-−–]\s*)?"
    r"\$?\s*([\d,]+(?:\.\d+)?)\s*"
    r"(k|mm|m|bn|b|t|thousand|million|billion|trillion)?(?![a-z])",
    re.I,
)

#: Words that make a following figure negative even when no minus sign appears.
#: A 10-K says "declined 5.5%", not "grew -5.5%".
_NEGATIVE_CUE = re.compile(
    r"\b(decreas\w*|declin\w*|fell|fall\w*|drop\w*|down|lower|contract\w*|"
    r"loss|negative|shrank|shrunk)\b", re.I)


def _readings(text: str, *, signed: bool = True) -> set[tuple[float, bool]]:
    """
    Every number in the text as `(value, stated_its_own_magnitude)`.

    The flag is what V1 turned on. A figure written `$130 million` has declared
    its magnitude; one written `130` has not. Both produce a scaled and a bare
    reading, but only the second may later be multiplied — see `_matches`.

    When `signed`, a leading minus and nearby decline vocabulary both produce
    the negative reading — alongside the positive one, never instead of it, so
    a genuinely positive figure elsewhere in the same sentence is not flipped.
    """
    out: set[tuple[float, bool]] = set()
    t = text or ""
    for m in _NUM.finditer(t):
        raw, suffix = m.group(1), m.group(2)
        try:
            v = float(raw.replace(",", ""))
        except ValueError:
            continue
        explicit = bool(suffix)
        scaled = v * _SCALE.get((suffix or "").lower(), 1.0)
        out.add((scaled, explicit))
        out.add((v, explicit))   # keep the bare reading: "416,161" in millions
        if not signed:
            continue
        lead = t[max(0, m.start() - 2):m.start()]
        window = t[max(0, m.start() - 60):m.start()]
        if any(c in lead for c in "-−–") or _NEGATIVE_CUE.search(window):
            out.add((-scaled, explicit))
            out.add((-v, explicit))
    return out


def numbers_in(text: str, *, signed: bool = True) -> set[float]:
    """Every number in the text, normalised to base units."""
    return {v for v, _ in _readings(text, signed=signed)}


#: A figure that makes a financial CLAIM, as opposed to a year or an ordinal.
#: Requires a currency mark, a magnitude word, or a percent — the things a
#: number needs in order to assert how much something was.
_CLAIM = re.compile(
    r"\$\s*[\d,]+(?:\.\d+)?"
    r"|[\d,]+(?:\.\d+)?\s*(?:k|mm|m|bn|b|t)\b"
    r"|[\d,]+(?:\.\d+)?\s*(?:thousand|million|billion|trillion)"
    r"|[\d,]+(?:\.\d+)?\s*(?:%|percent|pp|bps)",
    re.I,
)

#: A four-digit year, which an honest abstention must be free to name.
_YEAR = re.compile(r"\b(?:19|20)\d{2}\b")


def _financial_figures(text: str) -> set[str]:
    """Figures that assert a quantity. Years and bare ordinals are excluded."""
    out = set()
    for m in _CLAIM.finditer(text or ""):
        frag = m.group(0).strip()
        # "$2031" would be a claim; "fiscal 2031" is not.
        if _YEAR.fullmatch(frag):
            continue
        out.add(frag)
    return out


_DECLINE_PHRASES = (
    "not available", "not reported", "has not ended", "has not begun",
    "no filing", "no 10-k", "not yet", "future period", "cannot",
    "no data", "no supporting evidence", "unable",
    "not been reported", "nothing", "no results", "not found",
    # The plain negations. Their absence is what made a clean refusal —
    # "The sources DO NOT identify which companies…", "NO SOURCE passage
    # identifies…" — score as an overstated scan: the phrase list recognised
    # "does not" but not "do not", and recognised no leading "no <noun>" form
    # at all.
    "do not", "does not", "did not", "no source", "none of the",
    "cannot be computed", "could not",
)


def _declines_the_period(text: str, case: dict) -> bool:
    """Does the reply actually say the asked-for period is unreported?"""
    t = (text or "").lower()
    return any(p in t for p in _DECLINE_PHRASES)


#: A bulleted or comma-joined list of capitalised names — the shape a set
#: question's answer takes when it actually claims members.
_MEMBER_LIST = re.compile(
    r"(?:^|\n)\s*[-*•]\s*\*{0,2}[A-Z][\w.&'-]+"
    r"|\b[A-Z][\w.&'-]+(?:,\s*[A-Z][\w.&'-]+){2,}",
)


def _names_members(text: str) -> bool:
    """Whether the reply actually lists companies, as opposed to declining to."""
    return bool(_MEMBER_LIST.search(text or ""))


def _figures_attributed_to(text: str, case: dict) -> set[str]:
    """
    Figures stated in the same sentence as the unreported period.

    Sentence scope is the honest granularity: a figure sitting beside "FY2031"
    is being offered as FY2031's, while one in a later sentence about the last
    filed quarter is context. Anything finer would need parsing the model's
    grammar; anything coarser flags the whole reply.
    """
    tokens = [t.lower() for t in case.get("expect_period_tokens", [])]
    # Pull the period out of the question when the case names none.
    if not tokens:
        tokens = [y for y in _YEAR.findall(case.get("query", ""))]
    if not tokens:
        return set()
    out: set[str] = set()
    for sentence in re.split(r"(?<=[.!?])\s+|\n", text or ""):
        low = sentence.lower()
        if not any(tok in low for tok in tokens):
            continue
        if any(p in low for p in _DECLINE_PHRASES):
            # "FY2031 revenue is not available" names the period precisely to
            # deny it. The denial is the answer, not a claim.
            continue
        out |= _financial_figures(sentence)
    return out


def _period_misattributed(text: str, token: str,
                          expected: float | None = None) -> bool:
    """
    Whether the reply hangs its figure on a period other than `token`.

    Presence of the token somewhere in the reply is not attachment, and
    `period_entity` scored presence — so a figure stated for the wrong year
    scored full marks on the dimension whose whole job is catching that.
    Sentence scope is the granularity `_figures_attributed_to` already settled
    on for this same question, for the reason given there.

    Fires only on a POSITIVE competing period. A figure sentence naming no
    period at all returns False rather than a miss: the reply may be carrying
    the period from its neighbour, the text does not say otherwise, and
    guessing against it would be the over-tightening that produced most of the
    grader bugs this file has had to undo.

    **Unless the neighbour is already spoken for (R8).** Given `expected`, a
    sentence carrying the token only settles the question when it also carries
    the figure the answer was supposed to assert. Otherwise the token belongs
    to some OTHER figure and cannot be lent to a sentence that names none:

        "FY2025 guidance was $400,000 million. Actual revenue was $130,497
         million."

    scored full attachment marks while FY2025 was attached to the guidance and
    nothing tied the revenue to it. Presence near a token is not attachment to
    it, and this is the dimension that exists to tell those apart.

    A FIGURELESS sentence carrying the token still scopes the answer exactly as
    before — it claims no figure, so it competes for nothing. Without
    `expected` the behaviour is identical to before it was added.
    """
    tok = token.lower()
    claims = [s for s in re.split(r"(?<=[.!?])\s+|\n", text or "")
              if _financial_figures(s)]
    # NOT `_YEAR`: its \b never matches the 2024 inside "FY2024", which is the
    # commonest way a reply names the year it is misattributing to. A digit
    # boundary is the right one here — it still refuses to find 2025 inside
    # 12025, and 416,161 carries no 19xx/20xx to trip over.
    yearish = re.compile(r"(?<!\d)(?:19|20)\d{2}(?!\d)")
    if not claims:
        return False          # nothing asserted, so nothing to misattach
    # Pass 1: is the token attached to a figure, and is it the right one?
    claimed_by_another_figure = False
    for sentence in claims:
        if tok in sentence.lower():
            if expected is None or _matches(expected, sentence):
                return False  # attached to the expected period, on the figure
            claimed_by_another_figure = True

    # Pass 2: the yearless sentences. One may inherit a period from a
    # neighbour, but not one already claimed by a different figure.
    for sentence in claims:
        if tok in sentence.lower():
            continue
        if not yearish.search(sentence):
            if claimed_by_another_figure:
                continue      # nothing left to inherit
            return False      # names no competing period; do not guess
    return True


#: What the pipeline actually calls its evidence classes. The rubric was
#: written against the names in `answer_contract.SourceClass` and the pipeline
#: emits `app/core/research/evidence`'s names, so every real SEC citation was
#: being scored as non-primary — the grader reporting a fault in the system
#: that was a fault in the grader. Both vocabularies are accepted, and the
#: accession is honoured as the last word: a citation carrying a real accession
#: number came from a filing whatever anyone labelled it.
#:
#: `local_evidence` is NOT here, and its absence is the point. Round 2 excluded
#: it from `FinalGate` — a corpus prose chunk is not a filed figure — and left
#: this set asserting the opposite, so the benchmark handed out primary credit
#: for evidence the system itself refuses. A grader more permissive than the
#: thing it grades cannot certify it.
_PRIMARY_CLASS_NAMES = frozenset({
    "sec_filing", "sec_xbrl", "edgar", "edgar_text", "sec_evidence",
})

#: `structured` is conditional, which is why it is not in the set above.
#:
#: `structured_search` reads the `financials` table, where an id ending `_xbrl`
#: is an exactly-tagged filing fact and everything else is a scrape backfill —
#: `AMD_CostOfGoodsAndServicesSold_FY2025_xbrl` against
#: `AMD_Cost_of_revenue_2026-05-20_backfill`, the same concept at different
#: authority. The retrieval layer already splits on exactly this with
#: `flt["id"] = "like.*_xbrl"`. Excluding `structured` wholesale, as the audit
#: proposed, would blind the rubric to the most authoritative rows in the table.
_XBRL_ID_SUFFIX = "_xbrl"

#: An accession, in either form this repo circulates: `0000320193-25-000079`
#: and the bare 18-digit `000032019325000079` that `sec_filing_resolver.nodash()`
#: and `ingestion/sources/earnings.py` both produce for archive paths.
#:
#: WIDER THAN `sec_filing_resolver.valid_accession` ON PURPOSE, and declared
#: here rather than imported for the same reason that module gives for
#: redeclaring it: the two answer different questions. The resolver decides what
#: may enter a URL path, where the dashed form is the only safe one. This
#: decides whether a value is evidence that the citation came from a filing,
#: and both forms are.
#:
#: What this does NOT establish is that the accession EXISTS. A well-formed
#: invention still passes. Closing that needs a lookup against EDGAR, which is
#: a network call the rubric will not make — the bar this raises is from "any
#: truthy string" to "the shape EDGAR issues", and the honest claim is that and
#: no more.
_ACCESSION_RE = re.compile(r"\A(?:\d{10}-\d{2}-\d{6}|\d{18})\Z")


#: Classes that positively assert the source is NOT a filing, as opposed to
#: saying nothing about it (U1).
#:
#: The accession rule exists to rescue a citation whose class is sloppy or
#: missing — `""`, `"unknown"`, a name nobody recognises. Those make no claim
#: about provenance, and an accession is better evidence than an empty field.
#: `WEB_EVIDENCE` and `news` are not empty fields. They are statements that
#: this is a web page or an article, which CONTRADICT filing provenance, and a
#: string of the right shape should not overrule a producer that told us what
#: the thing is.
#:
#: This set is deliberately of *declared media*, not "everything not primary".
#: An unrecognised class must stay outside it, or the fix inverts the rule it
#: is protecting and the rescue case stops working — which is the failure this
#: file has undone six times.
_DENIES_FILING_PROVENANCE = frozenset({
    "web_evidence", "local_evidence", "web", "news",
    "blog", "analyst", "earnings_call", "transcript",
})


def _has_real_accession(cite: dict) -> bool:
    """Whether the citation carries something actually shaped like an accession.

    The rule this guards is deliberate: a citation carrying a REAL accession came
    from a filing whatever anyone labelled it, so a sloppy `source_class` cannot
    demote a genuine 10-K. Nothing checked the value, so `WEB_EVIDENCE` plus
    `accession="invented"` outranked the class system entirely.
    """
    for field in ("accession", "accession_number"):
        if _ACCESSION_RE.match(str(cite.get(field) or "").strip()):
            return True
    return False


#: The fields a citation may carry its issuer identity in. Read together
#: rather than trusting one: a real pipeline citation was measured carrying
#: `issuer='NVIDIA CORP'` and `cik=1045810` with `ticker=''`, so a
#: ticker-only rule would have called it unidentified.
_ISSUER_FIELDS = ("issuer", "ticker", "company", "document_title")


def _names_the_entity(tok: str, identity: str) -> bool:
    """Whether `identity` NAMES `tok`, rather than merely containing it (U2).

    This was `tok in identity`, which is containment. `apple` bound
    `PINEAPPLE HOLDINGS`, `cat` bound `CATERPILLAR INC` and `intel` bound
    `INTELSAT SA` — a grader whose job is catching an answer that names one
    company while citing another, matching one company inside another's name.

    Lookarounds rather than `\\b` because company names end in characters that
    are not word characters: `\\bat&t\\b` requires a word character after the
    final `t`, and `AT&T INC` has a space. `(?!\\w)` does not.

    The token is escaped. `AT&T`, `3M` and `J.P. Morgan` are company names, and
    an unescaped token would either raise or match the wrong thing.
    """
    return re.search(rf"(?<!\w){re.escape(tok)}(?!\w)", identity) is not None


def _entity_is_bound(token: str, cites: list[dict]) -> bool | None:
    """Whether a cited filing belongs to the entity the answer names.

    `None` means the question could not be asked: no citation carries any
    issuer identity, so there is nothing to check the name against. An
    unanswerable question is not a failed one, and the caller leaves the score
    alone — the same discipline `_claim_is_bound` uses, and the reason this
    file's grader-bug count did not go from six to seven.

    Lenient in the same two ways as claim binding: ANY citation may carry the
    identity, and any of the identity fields may carry it. It fires only when
    the answer names a company that NOTHING it cited belongs to.
    """
    identities = [
        str(c.get(f) or "").strip().lower()
        for c in (cites or []) for f in _ISSUER_FIELDS
    ]
    identities = [i for i in identities if i]
    if not identities:
        return None
    tok = token.strip().lower()
    return any(_names_the_entity(tok, i) for i in identities)


def _is_primary(cites: list[dict]) -> bool:
    for c in cites:
        cls = str(c.get("source_class", "")).strip().lower()
        if cls in _PRIMARY_CLASS_NAMES:
            return True
        if cls == "structured" and \
                str(c.get("id") or "").strip().lower().endswith(_XBRL_ID_SUFFIX):
            return True
        if cls not in _DENIES_FILING_PROVENANCE and _has_real_accession(c):
            return True
        url = str(c.get("view_filing_url") or c.get("url") or "")
        if "sec.gov/Archives" in url:
            return True
    return False


def _matches(expected: float, text: str, tol: float = 0.01) -> bool:
    for got, explicit in _readings(text):
        if expected == 0:
            if got == 0:
                return True
            continue
        if abs(got - expected) / abs(expected) <= tol:
            return True
        if explicit:
            # V1. The figure stated its own magnitude, so reading it at a
            # different one is inventing data rather than interpreting it.
            # Without this, `numbers_in("$130 million")` yields a bare 130,
            # the loop below multiplied it by 1e9, and an answer wrong by a
            # factor of a thousand scored correctness 1.0 — the grader
            # returning the wrong answer about the dimension carrying the most
            # weight.
            continue
        # A figure quoted in millions against an expected in base units. A bare
        # number carries no magnitude of its own, so scaling it is reading it.
        for scale in (1e3, 1e6, 1e9):
            if abs(got * scale - expected) / abs(expected) <= tol:
                return True
    return False


#: A parenthetical aside. Non-nesting on purpose: a nested pair in a financial
#: answer is vanishingly rare, and a recursive strip would be more machinery
#: than the distinction needs.
_PAREN = re.compile(r"\([^()]*\)")


def _asserts(expected: float, text: str, tol: float = 0.01) -> bool:
    """
    Whether the reply ASSERTS `expected`, as opposed to merely containing it.

    `_matches` answers "is this number present anywhere", which is not the same
    question and is the one the rubric was asking. An answer stating a wrong
    headline with the true figure in a parenthetical scored 1.0 under it.

    A figure inside parentheses is an aside, not the claim — with one
    exception, which is why this is not a one-line strip: when nothing outside
    the parentheses makes a competing financial claim, the parenthetical is the
    only thing the answer could be asserting. "Net sales ($416,161 million)"
    states the figure; "net sales were $500,000 million (the filing reports
    $416,161 million)" demotes the truth to a footnote behind a wrong headline.

    Deliberately NOT a first-figure rule. "In FY2024 revenue was X; in FY2025 it
    was Y" asserts Y, and scoring the first figure would mark it wrong — the
    over-tightening that this file's history already paid for once.
    """
    outside = _PAREN.sub(" ", text or "")
    if _matches(expected, outside, tol):
        return True
    if not _matches(expected, text, tol):
        return False
    return not _financial_figures(outside)


#: Like `_CLAIM`, but it keeps the magnitude word attached to the currency
#: form. `_CLAIM`'s first alternative matches "$416.2" out of "$416.2 billion"
#: and stops, so `numbers_in` on that fragment yields 416.2 and never
#: 416,200,000,000 — the answer's own scale is thrown away before the
#: comparison. It is a separate pattern rather than a fix to `_CLAIM` because
#: three other call sites depend on that one's exact fragments.
_ASSERTED = re.compile(
    r"\$\s*[\d,]+(?:\.\d+)?\s*"
    r"(?:k|mm|m|bn|b|t|thousand|million|billion|trillion)?"
    r"|[\d,]+(?:\.\d+)?\s*(?:k|mm|m|bn|b|t|thousand|million|billion|trillion)\b"
    r"|[\d,]+(?:\.\d+)?\s*(?:%|percent|pp|bps)",
    re.I,
)


def _asserted_values(text: str) -> set[float]:
    """The numeric readings of the figures the answer asserts, asides excluded.

    A currency mark or a magnitude word is required, so a bare year is not
    mistaken for a claim — without that, "2025" in both the answer and the
    excerpt would bind every answer to every citation.
    """
    outside = _PAREN.sub(" ", text or "")
    out: set[float] = set()
    for m in _ASSERTED.finditer(outside):
        out |= numbers_in(m.group(0))
    return out


#: A figure stated as a RATE rather than as a level. Separated because a rate
#: is usually computed from two levels rather than quoted from a filing, so it
#: legitimately appears in no excerpt — see `_claim_is_bound`.
_RATE_TAIL = re.compile(r"(?:%|percent\w*|pp|bps)\s*$", re.I)


def _asserted_split(text: str) -> tuple[set[float], set[float]]:
    """`_asserted_values`, split into levels and rates."""
    outside = _PAREN.sub(" ", text or "")
    levels: set[float] = set()
    rates: set[float] = set()
    for m in _ASSERTED.finditer(outside):
        frag = m.group(0)
        target = rates if _RATE_TAIL.search(frag) else levels
        target |= numbers_in(frag)
    return levels, rates


def _metric_keys(text: str) -> set[str]:
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


def _metric_spans(excerpt: str, key: str) -> list[str] | None:
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
    starts = sorted({
        m.start() for _k, _l, _b, r in _METRIC_RES for m in r.finditer(excerpt)
    })
    spans = []
    for h in hits:
        nxt = next((s for s in starts if s > h.start()), len(excerpt))
        span = excerpt[h.start():nxt]
        if numbers_in(span):
            spans.append(span)
    return spans or None


def _claim_is_bound(text: str, cites: list[dict]) -> bool | None:
    """
    Whether a figure the answer asserts appears in a cited excerpt.

    `None` means the question could not be asked: no citation carried enough
    text, or the answer asserted no figure. An unanswerable question is not a
    failed one, and the caller leaves the score alone — six of seven grader
    bugs in this file came from tightening past what the data supports, and a
    citation whose excerpt happens to be a section header would be punished by
    a stricter rule for no fault of the answer.

    Deliberately lenient in two ways. It accepts a match in ANY cited excerpt
    rather than only a primary one, and it accepts any asserted reading rather
    than the headline alone — so it fires only when the figure is nowhere in
    anything the answer cited, which is the case grader bug 7 left open.

    **Per SENTENCE, not per answer (R6).** The `any` used to range over every
    figure in the reply at once, so one cited figure carried every uncited one
    beside it: "Revenue was $130,497M [1]. Data centre was $115,186M. Gaming
    was $11,350M." scored as bound on a citation supporting only the first.
    The leniencies above are unchanged — only the SCOPE of the `any` moved.

    Sentence scope is the granularity `_period_misattributed` already settled
    on for this same question, for the reason given there.

    **The word is "sentence" and not "claim", and the difference is real (T9).**
    The split below is on sentence punctuation and newlines, so three
    propositions is ONE object here: "Revenue was $130,497M [1], data centre
    was $115,186M and gaming was $11,350M" binds if any one of those figures
    appears in a cited excerpt. Genuine claim-level grounding would decompose
    that into three and require each — this does not, and the R6 improvement is
    real without being that. The function name still says `claim` because
    renaming it reaches four test modules for no behavioural gain; the name is
    the artefact that overstates, and this paragraph is the correction.

    A rate is treated as derived rather than quoted. "Revenue grew from $100B
    to $130B [1]. That is a 30% increase." states a figure that appears in no
    excerpt because it was computed, and penalising it would punish a correct
    computed answer — the over-tightening this file has already had to undo six
    times. So a rate-only claim is excused when some level claim beside it is
    bound. Standing alone with nothing else bound it must still bind on its
    own, exactly as before: the excuse is not a blanket exemption.
    """
    excerpts = [str(c.get("text") or "") for c in (cites or [])]
    excerpts = [e for e in excerpts if len(e.strip()) >= 20]
    if not excerpts:
        return None

    level_claims: list[tuple[set[float], set[str]]] = []
    rate_claims: list[tuple[set[float], set[str]]] = []
    for sentence in re.split(r"(?<=[.!?])\s+|\n", text or ""):
        levels, rates = _asserted_split(sentence)
        keys = _metric_keys(sentence)
        if levels:
            # A claim's own rates count toward binding it; a margin sentence
            # that also quotes the level it came from is bound by either.
            level_claims.append((levels | rates, keys))
        elif rates:
            rate_claims.append((rates, keys))

    # A sentence asserting no figure is not an unsupported claim — it is not a
    # claim. If none of them assert one, the question cannot be asked.
    if not level_claims and not rate_claims:
        return None

    def _binds(values: set[float], keys: set[str]) -> bool:
        for e in excerpts:
            # U3. When the excerpt speaks about the metric this claim names,
            # it binds only if it associates the claimed VALUE with that
            # metric. An excerpt saying revenue was $120 billion is evidence
            # against a claim of $130 billion, and counting it as evidence for
            # the claim is what the audit found.
            spans = [s for k in keys for s in (_metric_spans(e, k) or [])]
            if spans:
                if any(_matches(v, s) for v in values for s in spans):
                    return True
                # It states a different value for this metric. Another excerpt
                # may still bind the claim — the refusal is per-excerpt.
                continue
            if any(_matches(v, e) for v in values):
                return True
        return False

    bound_levels = [_binds(v, k) for v, k in level_claims]
    if not all(bound_levels):
        return False
    return all(_binds(r, k) or any(bound_levels) for r, k in rate_claims)


def score_answer(case: dict, answer: str, *, citations: list[dict] | None = None,
                 latency_ms: float | None = None,
                 scope_status: str = "", system: str = "") -> Scorecard:
    """
    Score one answer against one case, mechanically where possible.

    Every dimension that cannot be decided from the case data is left `None`.
    Guessing it would put a number on the scorecard that no evidence supports,
    which is the exact failure this whole effort is about.
    """
    cites = citations or []
    card = Scorecard(system=system, case_id=case.get("id", ""))
    text = answer or ""
    low = text.lower()

    # correctness ---------------------------------------------------------
    expected = case.get("expect_value")
    if case.get("expect_abstain"):
        # The failure is a figure attributed to the UNREPORTED period, not a
        # figure anywhere in the reply. An answer that declines FY2031 and then
        # cites the latest period it does have is doing the right thing; a
        # rubric that scores that zero trains the system toward abstentions
        # which cannot say what IS known, which is worse for a reader and no
        # more honest.
        declined = _declines_the_period(text, case)
        offending = _figures_attributed_to(text, case)
        ok = declined and not offending
        card.scores["correctness"] = 1.0 if ok else 0.0
        # A stated figure is the more informative diagnosis, so it is reported
        # first: "it answered the unanswerable" tells you more than "it did not
        # say no", and an answer doing the former is always also doing the latter.
        if offending:
            card.notes["correctness"] = (
                f"abstention case: figure(s) attributed to the unreported "
                f"period: {sorted(offending)}"
            )
        elif not declined:
            card.notes["correctness"] = "abstention case: the reply never declines the period"
        else:
            card.notes["correctness"] = "abstention case: declined, no figure for that period"
    elif expected is not None:
        hit = _asserts(float(expected), text)
        if hit:
            card.scores["correctness"] = 1.0
            card.notes["correctness"] = f"expected {expected}"
        else:
            # A wrong figure and an honest "I cannot compute this from the
            # evidence" are both misses, and they are NOT the same failure.
            # The roadmap asks for false-confidence and false-abstention as
            # separate metrics precisely because one puts a wrong number in
            # front of a user and the other does not.
            #
            # This distinction was added after `calc_guard` turned a fabricated
            # "revenue grew 20,160%" into "the sources do not provide FY2025
            # revenue, so the growth rate cannot be computed". Both score zero
            # on correctness; only one of them would have misled anyone.
            # "Declined" means it refused THE ASKED-FOR quantity, and an
            # explicit refusal is the evidence for that. Other figures in the
            # reply are context, not competing claims: an answer that gives
            # FY2025 revenue and says the FY2024 base is unavailable so growth
            # cannot be computed has declined, and scoring it as a confident
            # wrong answer punishes exactly the behaviour `calc_guard` was
            # added to produce.
            #
            # This deliberately does NOT reuse the abstention-case rule. There,
            # the whole question is whether any figure was offered for an
            # unreported period, so a sentence-scoped figure check is right.
            # Here the expected value is already known to be absent — that is
            # why this branch runs — so the only question left is whether the
            # system said so or guessed.
            declined = _declines_the_period(text, case)
            card.scores["correctness"] = 0.0
            card.notes["correctness"] = (
                f"expected {expected}; the answer declined rather than guessing"
                if declined else f"expected {expected}; a different figure was stated"
            )
            card.notes["failure_mode"] = (
                "false_abstention" if declined else "false_confidence"
            )
    else:
        card.scores["correctness"] = None
        card.notes["correctness"] = "no ground-truth figure recorded"

    # evidence ------------------------------------------------------------
    if case.get("expect_abstain"):
        card.scores["evidence"] = 1.0
        card.notes["evidence"] = "abstention needs no citation"
    else:
        has_marker = bool(re.search(r"\[\d+\]", text))
        classes = {str(c.get("source_class", "")) for c in cites}
        primary = _is_primary(cites)
        need_primary = bool(case.get("requires_primary", True))
        if not cites and not has_marker:
            card.scores["evidence"] = 0.0
            card.notes["evidence"] = "no citations at all"
        elif need_primary and cites and not primary:
            card.scores["evidence"] = 0.3
            card.notes["evidence"] = f"cited, but no primary source ({sorted(classes)})"
        elif cites and primary:
            # Grader bug 7. `_is_primary` is an ANY over the list, so one filing
            # among four news articles used to score the full 20 points with
            # nothing checking that the STATED FIGURE came from the filing.
            #
            # The rubric cannot prove claim-level attribution — that needs a
            # claim map, and the recorded excerpts are truncated to 220 chars.
            # So it does not invent a penalty it cannot justify; it stops paying
            # a PERFECT score for a property it never verified, and says so.
            _prim = sum(1 for c in cites if _is_primary([c]))
            # Where the excerpts allow it, the attribution is now checked
            # instead of assumed. `None` means the excerpts do not permit the
            # question, and the scores below are exactly what they were.
            _bound = _claim_is_bound(text, cites)
            if _bound is False:
                card.scores["evidence"] = 0.5
                card.notes["evidence"] = (
                    f"{_prim} of {len(cites)} citations primary, but at least "
                    "one figure the answer states appears in none of the cited "
                    "excerpts"
                )
            elif _prim == len(cites):
                card.scores["evidence"] = 1.0
                card.notes["evidence"] = (
                    "every citation is a primary source"
                    + ("; the stated figure appears in a cited excerpt"
                       if _bound else "")
                )
            else:
                card.scores["evidence"] = 0.8
                card.notes["evidence"] = (
                    f"{_prim} of {len(cites)} citations primary; the stated "
                    "figure's attribution to one of them is NOT verified"
                )
        else:
            # A citation marker with no resolvable citation object: a reference
            # to nothing reads exactly like a reference to something.
            card.scores["evidence"] = 0.5
            card.notes["evidence"] = "citation markers with no citation objects"

    # period / entity -----------------------------------------------------
    checks, hits = 0, 0
    misattached: list[str] = []
    for token in case.get("expect_period_tokens", []):
        checks += 1
        present = token.lower() in low
        if present and _period_misattributed(text, token, expected):
            # Named, but hung on a different year. Presence was never the
            # question this dimension was asking.
            present = False
            misattached.append(token)
        hits += int(present)
    misbound: list[str] = []
    unbindable: list[str] = []
    for token in case.get("expect_entity_tokens", []):
        present = token.lower() in low
        if present:
            bound = _entity_is_bound(token, cites)
            if bound is None:
                # T4. Nothing cited carries any issuer identity, so the binding
                # cannot be checked. This branch used to fall through to the
                # credit below: the helper said "cannot check" and the scorer
                # recorded "passed", which is how an answer citing identity-less
                # sources scored as well as one citing the company's own 10-K.
                #
                # Ungraded rather than failed. Punishing an unanswerable
                # question is the shape this file avoided six times over, and
                # ungraded is the discipline the module docstring already
                # states. It costs coverage, and that is the honest price.
                unbindable.append(token)
                continue
            if bound is False:
                # Named, but nothing cited belongs to that issuer. Presence in
                # prose was never the question this dimension was asking — the
                # same fix the period half already has.
                present = False
                misbound.append(token)
        # A token the reply never NAMES is a presence failure, and presence is
        # answerable without any citation, so it stays graded whatever the
        # citations carry.
        checks += 1
        hits += int(present)
    for token in case.get("forbid_tokens", []):
        checks += 1
        hits += int(token.lower() not in low)
    card.scores["period_entity"] = round(hits / checks, 4) if checks else None
    parts = []
    if misattached:
        parts.append(
            f"period token(s) {sorted(misattached)} appear in the reply but "
            "the stated figure is attached to a different period"
        )
    if misbound:
        parts.append(
            f"entity token(s) {sorted(misbound)} appear in the reply but no "
            "citation belongs to that issuer"
        )
    if unbindable:
        # An unexplained `None` is the same failure as an unexplained 1.0, one
        # step quieter, so the ungraded case has to say it was ungraded.
        parts.append(
            f"entity token(s) {sorted(unbindable)} left UNGRADED: no citation "
            "carries any issuer identity, so the binding could not be checked"
        )
    if parts:
        card.notes["period_entity"] = "; ".join(parts)
    elif not checks:
        card.notes["period_entity"] = "no period/entity tokens recorded"

    # scope ---------------------------------------------------------------
    if case.get("is_set_question"):
        hedged = any(p in low for p in (
            "at least", "partial", "were examined", "may be others",
            "not exhaustive", "not a complete"))
        # A reply that names NO members and says so is not overstating its
        # coverage — it is the strongest possible statement of limited coverage.
        # The hedge list only recognises partial answers, so a complete refusal
        # scored zero for "presenting a partial scan as complete", which is the
        # opposite of what it did.
        # Judged on the OPENING sentence. A reply that begins "The sources do
        # not identify which companies..." is refusing, whatever follows — and
        # what follows is routinely a bulleted list of the SOURCES it consulted,
        # which the member-list heuristic cannot tell from a list of companies.
        # Scanning the whole reply made a clean refusal score zero for
        # "presenting a partial scan as complete", which is the opposite of
        # what it did.
        first = re.split(r"(?<=[.!?])\s+|\n", text.strip(), maxsplit=1)[0].lower()
        refused = (any(p in first for p in _DECLINE_PHRASES)
                   and not _names_members(first))
        if scope_status == "confirmed_exhaustive":
            card.scores["scope"] = 1.0
        elif hedged or refused:
            card.scores["scope"] = 1.0
            card.notes["scope"] = ("coverage refused outright" if refused and not hedged
                                   else "partial coverage stated")
        else:
            card.scores["scope"] = 0.0
            card.notes["scope"] = "partial scan presented as complete"
    else:
        card.scores["scope"] = None
        card.notes["scope"] = "not a set question"

    # latency -------------------------------------------------------------
    if latency_ms is None:
        card.scores["latency"] = None
        card.notes["latency"] = "not measured for this system"
    else:
        # The roadmap's targets: simple 2-5s, normal 4-8s, complex 6-10s.
        budget = float(case.get("latency_budget_ms", 8000))
        card.scores["latency"] = round(
            max(0.0, min(1.0, budget / max(latency_ms, 1.0))), 4)
        card.notes["latency"] = f"{latency_ms:.0f}ms against a {budget:.0f}ms budget"

    # judgement dimensions ------------------------------------------------
    # Left ungraded on purpose. A single model-judge call at a fixed threshold
    # is a biased coin, and a fabricated 0.8 here would move the aggregate by
    # 25 points of weight on no evidence.
    card.scores["reasoning"] = None
    card.notes["reasoning"] = "requires human or multi-trial judgement; not graded"
    card.scores["clarity"] = None
    card.notes["clarity"] = "requires human or multi-trial judgement; not graded"

    return card


# ── Blinding ──────────────────────────────────────────────────────────────


def blind_pairs(pairs: list[tuple[str, str]], *, seed: str = "") -> list[dict]:
    """
    Shuffle each (system_a_answer, system_b_answer) pair behind opaque labels.

    A grader who can tell which answer is ours is not grading; the shuffle is
    seeded so a run is reproducible without being predictable per-case.
    """
    out = []
    for i, (a, b) in enumerate(pairs):
        h = hashlib.sha256(f"{seed}:{i}".encode()).hexdigest()
        rng = random.Random(h)
        flip = rng.random() < 0.5
        out.append({
            "index": i,
            "left": b if flip else a,
            "right": a if flip else b,
            # The key is kept so the run can be scored afterwards, but it is a
            # separate field a grader is not shown.
            "_left_is": "b" if flip else "a",
        })
    return out
