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


def numbers_in(text: str, *, signed: bool = True) -> set[float]:
    """
    Every number in the text, normalised to base units.

    When `signed`, a leading minus and nearby decline vocabulary both produce
    the negative reading — alongside the positive one, never instead of it, so
    a genuinely positive figure elsewhere in the same sentence is not flipped.
    """
    out: set[float] = set()
    t = text or ""
    for m in _NUM.finditer(t):
        raw, suffix = m.group(1), m.group(2)
        try:
            v = float(raw.replace(",", ""))
        except ValueError:
            continue
        scaled = v * _SCALE.get((suffix or "").lower(), 1.0)
        out.add(scaled)
        out.add(v)          # keep the bare reading: "416,161" in millions
        if not signed:
            continue
        lead = t[max(0, m.start() - 2):m.start()]
        window = t[max(0, m.start() - 60):m.start()]
        if any(c in lead for c in "-−–") or _NEGATIVE_CUE.search(window):
            out.add(-scaled)
            out.add(-v)
    return out


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


def _period_misattributed(text: str, token: str) -> bool:
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
    for sentence in claims:
        if tok in sentence.lower():
            return False      # attached to the expected period somewhere
        if not yearish.search(sentence):
            return False      # names no competing period; do not guess
    return True


#: What the pipeline actually calls its evidence classes. The rubric was
#: written against the names in `answer_contract.SourceClass` and the pipeline
#: emits `app/core/research/evidence`'s names, so every real SEC citation was
#: being scored as non-primary — the grader reporting a fault in the system
#: that was a fault in the grader. Both vocabularies are accepted, and the
#: accession is honoured as the last word: a citation carrying a real accession
#: number came from a filing whatever anyone labelled it.
_PRIMARY_CLASS_NAMES = frozenset({
    "sec_filing", "sec_xbrl", "edgar", "edgar_text", "structured",
    "sec_evidence", "local_evidence",
})


def _is_primary(cites: list[dict]) -> bool:
    for c in cites:
        cls = str(c.get("source_class", "")).strip().lower()
        if cls in _PRIMARY_CLASS_NAMES:
            return True
        if c.get("accession") or c.get("accession_number"):
            return True
        url = str(c.get("view_filing_url") or c.get("url") or "")
        if "sec.gov/Archives" in url:
            return True
    return False


def _matches(expected: float, text: str, tol: float = 0.01) -> bool:
    for got in numbers_in(text):
        if expected == 0:
            if got == 0:
                return True
            continue
        if abs(got - expected) / abs(expected) <= tol:
            return True
        # A figure quoted in millions against an expected in base units.
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
            if _prim == len(cites):
                card.scores["evidence"] = 1.0
                card.notes["evidence"] = "every citation is a primary source"
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
        if present and _period_misattributed(text, token):
            # Named, but hung on a different year. Presence was never the
            # question this dimension was asking.
            present = False
            misattached.append(token)
        hits += int(present)
    for token in case.get("expect_entity_tokens", []):
        checks += 1
        hits += int(token.lower() in low)
    for token in case.get("forbid_tokens", []):
        checks += 1
        hits += int(token.lower() not in low)
    card.scores["period_entity"] = round(hits / checks, 4) if checks else None
    if not checks:
        card.notes["period_entity"] = "no period/entity tokens recorded"
    elif misattached:
        card.notes["period_entity"] = (
            f"period token(s) {sorted(misattached)} appear in the reply but the "
            "stated figure is attached to a different period"
        )

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
