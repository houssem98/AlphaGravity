"""
What the answer is obliged to do, decided before the model sees anything.

`query_plan.py` says what was ASKED. This says what the answer must DO about
it — required evidence, source priority, whether a primary filing is
mandatory, when to abstain, and what shape the reply takes. Those decisions
exist today, but they are scattered across the prompt, the generation call and
several post-hoc checks, which means they are made partly by a model and cannot
be tested.

The failure that motivates it: whether an answer needs a filing is currently
argued for inside a prompt. A prompt is a request, not a constraint. If the
model decides a news article is good enough for a 10-K question, nothing
downstream disagrees, and the citation looks fine because a citation exists.

So the contract is computed from the plan alone — deterministic, no network, no
model — and is then a thing that can be *checked against the finished answer*.
`FinalGate.check()` is the other half: it takes the contract and the produced
answer and reports which clauses were honoured. A contract nothing verifies is
just a longer prompt.

Pipeline position, from the roadmap:

    QUESTION -> PLAN -> CONTRACT -> RETRIEVE -> NORMALIZE -> COMPUTE
             -> VERIFY -> SCOPE -> GENERATE -> FINAL GATE -> ANSWER
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from app.core.finance.query_plan import (
    ComparisonKind, FinanceIntent, FinancePlan,
)

__all__ = [
    "AnswerContract", "AnswerMode", "FinalGate", "GateResult", "SourceClass",
    "build_contract",
]


class AnswerMode(str, Enum):
    """How much machinery the question earns. Quick Answer stays quick."""

    DIRECT = "direct"          # one figure, one company, one period
    COMPUTED = "computed"      # a derived number: growth, margin, CAGR, TTM
    COMPARATIVE = "comparative"  # two or more companies side by side
    SCOPED_SET = "scoped_set"  # a question over a universe
    QUALITATIVE = "qualitative"  # risks, guidance, sentiment — prose evidence
    REFUSAL = "refusal"        # the question cannot be answered as asked


class SourceClass(str, Enum):
    """Evidence classes, most authoritative first."""

    SEC_FILING = "sec_filing"
    SEC_XBRL = "sec_xbrl"
    EARNINGS_CALL = "earnings_call"
    ANALYST = "analyst"
    NEWS = "news"
    WEB = "web"


#: Classes that may CONFIRM a claim about what a company reported. The
#: distinction is the same one `skills/scope.py` makes: a news article about a
#: filing is evidence about the article.
PRIMARY = frozenset({SourceClass.SEC_FILING, SourceClass.SEC_XBRL})


@dataclass(frozen=True)
class AnswerContract:
    """The obligations for one answer. Every field is checkable after the fact."""

    mode: AnswerMode
    question_class: str = ""
    entities: tuple[str, ...] = ()
    metrics: tuple[str, ...] = ()
    period: str = "latest"
    comparison: str = "none"
    change_unit: str = ""

    #: Evidence
    requires_primary_source: bool = False
    source_priority: tuple[str, ...] = ()
    min_citations: int = 1

    #: Honesty
    must_abstain: bool = False
    abstain_reason: str = ""
    requires_scope_statement: bool = False
    requires_period_statement: bool = False

    #: Shape (roadmap #12 — top-model behaviour)
    answer_first: bool = True
    show_calculation: bool = False
    prefer_table: bool = False
    max_words: int = 0

    limitations: tuple[str, ...] = ()

    def as_dict(self) -> dict:
        return {
            "mode": self.mode.value,
            "question_class": self.question_class,
            "entities": list(self.entities),
            "metrics": list(self.metrics),
            "period": self.period,
            "comparison": self.comparison,
            "change_unit": self.change_unit,
            "requires_primary_source": self.requires_primary_source,
            "source_priority": list(self.source_priority),
            "min_citations": self.min_citations,
            "must_abstain": self.must_abstain,
            "abstain_reason": self.abstain_reason,
            "requires_scope_statement": self.requires_scope_statement,
            "requires_period_statement": self.requires_period_statement,
            "answer_first": self.answer_first,
            "show_calculation": self.show_calculation,
            "prefer_table": self.prefer_table,
            "max_words": self.max_words,
            "limitations": list(self.limitations),
        }


_QUALITATIVE = {FinanceIntent.RISK, FinanceIntent.GUIDANCE,
                FinanceIntent.SENTIMENT, FinanceIntent.FILINGS}
_COMPUTED = {FinanceIntent.GROWTH, FinanceIntent.MARGIN}

#: Question classes whose answer must rest on a filing. Taken from the existing
#: deterministic classifier rather than re-derived, so the two cannot drift.
_PRIMARY_CLASSES = frozenset({
    "EXACT_FINANCIAL_FACT", "FINANCIAL_TABLE", "FINANCIAL_CALCULATION",
    "FILING_QUALITATIVE",
})


def build_contract(plan: FinancePlan, *, must_abstain: bool = False,
                   abstain_reason: str = "") -> AnswerContract:
    """
    The contract for one plan. Pure: same plan in, same contract out.

    `must_abstain` is threaded in rather than recomputed because the period
    verdict already owns that decision (`skills/period.py`), and two modules
    deciding the same thing is how they come to disagree.
    """
    intent = plan.intent
    metrics = tuple(m.key for m in plan.metrics)

    if must_abstain:
        mode = AnswerMode.REFUSAL
    elif plan.scope.is_set_question:
        mode = AnswerMode.SCOPED_SET
    elif plan.is_multi_company:
        mode = AnswerMode.COMPARATIVE
    elif intent in _QUALITATIVE:
        mode = AnswerMode.QUALITATIVE
    elif intent in _COMPUTED or plan.comparison is not ComparisonKind.NONE or plan.ttm:
        mode = AnswerMode.COMPUTED
    else:
        mode = AnswerMode.DIRECT

    needs_primary = (
        plan.needs_primary_source
        or plan.question_class in _PRIMARY_CLASSES
        or mode in (AnswerMode.DIRECT, AnswerMode.COMPUTED, AnswerMode.COMPARATIVE)
    ) and mode is not AnswerMode.REFUSAL

    if intent is FinanceIntent.SENTIMENT:
        priority = (SourceClass.SEC_FILING.value, SourceClass.EARNINGS_CALL.value,
                    SourceClass.ANALYST.value, SourceClass.NEWS.value)
    elif intent in (FinanceIntent.RISK, FinanceIntent.GUIDANCE):
        priority = (SourceClass.SEC_FILING.value, SourceClass.EARNINGS_CALL.value,
                    SourceClass.NEWS.value)
    else:
        priority = (SourceClass.SEC_XBRL.value, SourceClass.SEC_FILING.value,
                    SourceClass.EARNINGS_CALL.value, SourceClass.NEWS.value)

    # A comparison needs one citation per company, or a reader cannot tell
    # which half of the sentence was evidenced.
    min_cites = 0 if mode is AnswerMode.REFUSAL else max(1, len(plan.companies))

    limitations: list[str] = []
    if mode is AnswerMode.SCOPED_SET:
        limitations.append(
            "State how much of the named group was examined. Never present a "
            "partial scan as a complete one."
        )
    if plan.change_unit == "pp":
        limitations.append(
            "This metric is a rate: report its change in percentage points, "
            "not as a percent change."
        )

    return AnswerContract(
        mode=mode,
        question_class=plan.question_class,
        entities=tuple(plan.companies),
        metrics=metrics,
        period=plan.period.label,
        comparison=plan.comparison.value,
        change_unit=plan.change_unit,
        requires_primary_source=needs_primary,
        source_priority=priority,
        min_citations=min_cites,
        must_abstain=must_abstain,
        abstain_reason=abstain_reason,
        requires_scope_statement=mode is AnswerMode.SCOPED_SET,
        # "latest" resolves to whatever the newest filing reports, so the answer
        # has to name which period that turned out to be.
        requires_period_statement=(plan.period.label == "latest"
                                   or mode is AnswerMode.COMPUTED),
        answer_first=True,
        show_calculation=mode is AnswerMode.COMPUTED,
        prefer_table=mode in (AnswerMode.COMPARATIVE, AnswerMode.SCOPED_SET),
        max_words=120 if mode is AnswerMode.DIRECT else 0,
        limitations=tuple(limitations),
    )


@dataclass
class GateResult:
    """Which clauses the finished answer honoured."""

    passed: bool
    violations: list[str] = field(default_factory=list)
    checked: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"passed": self.passed, "violations": self.violations,
                "checked": self.checked}


class FinalGate:
    """
    The other half of the contract: check the answer against it.

    Without this the contract is a longer prompt. The gate is deliberately
    conservative — it reports violations, it does not rewrite — because a gate
    that edits an answer to satisfy itself is grading its own work.
    """

    @staticmethod
    def check(contract: AnswerContract, *, answer: str,
              citations: list[dict] | None = None,
              scope_status: str = "") -> GateResult:
        cites = citations or []
        violations: list[str] = []
        checked: list[str] = []

        checked.append("min_citations")
        if len(cites) < contract.min_citations:
            violations.append(
                f"contract requires at least {contract.min_citations} citation(s); "
                f"the answer carries {len(cites)}"
            )

        if contract.requires_primary_source:
            checked.append("primary_source")
            classes = {str(c.get("source_class", "")) for c in cites}
            if not (classes & {c.value for c in PRIMARY}):
                violations.append(
                    "contract requires a primary filing; no citation is "
                    f"sec_filing or sec_xbrl (saw {sorted(classes) or 'none'})"
                )

        if contract.must_abstain:
            checked.append("abstention")
            if _has_figure(answer):
                violations.append(
                    "contract requires abstention; the answer states a figure"
                )

        if contract.requires_scope_statement:
            checked.append("scope_statement")
            if not scope_status:
                violations.append("set question produced no scope_status")
            elif scope_status != "confirmed_exhaustive" and not _hedged(answer):
                violations.append(
                    "partial scan is not labelled as partial in the answer"
                )

        if contract.change_unit == "pp":
            checked.append("change_unit")
            if "%" in answer and not _mentions_points(answer):
                violations.append(
                    "a rate change is reported in percent rather than "
                    "percentage points"
                )

        return GateResult(passed=not violations, violations=violations,
                          checked=checked)


def _has_figure(text: str) -> bool:
    import re
    return bool(re.search(r"\d[\d,]*\.?\d*\s*(?:%|bn|billion|million|m\b|b\b|\$)",
                          text, re.I) or re.search(r"\$\s*\d", text))


def _hedged(text: str) -> bool:
    t = text.lower()
    return any(p in t for p in ("at least", "partial", "not exhaustive",
                                "were examined", "may be others", "not a complete"))


def _mentions_points(text: str) -> bool:
    t = text.lower()
    return any(p in t for p in ("percentage point", " pp", "basis point", " bps"))
