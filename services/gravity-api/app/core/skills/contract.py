"""
The one shape every Quick Answer skill speaks.

The failure this replaces is not a bug in any single skill; it is that each
skill answered in its own vocabulary, so the only way to express "I have no
data for this company" was to look like "I do not support this company". Those
are different claims. The first is about a corpus and changes hourly; the
second is about a product and was never true — the entity layer resolves every
SEC registrant, and the SEC channels read any registrant's filings at query
time.

So the statuses below are deliberately not a success/failure pair. Six of the
seven are ways of being *correct* about a limitation:

    success               the skill answered from evidence
    partial               some requested parts answered, others named as missing
    insufficient_data     the company resolved; the evidence does not exist
    ambiguous_entity      the mention matches several registrants; not guessed
    unsupported_operation the skill cannot do this KIND of thing, for anyone
    conflicting_evidence  sources disagree and the disagreement is the answer
    error                 the skill itself failed

`unsupported_operation` is the only one that is about capability, and it is
about the operation, never about the company. A skill that returns it for
"NVDA" must return it for every ticker; a skill that would answer for NVDA and
not for a smaller registrant has an evidence problem and must say
`insufficient_data`.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from enum import Enum


class SkillStatus(str, Enum):
    SUCCESS = "success"
    PARTIAL = "partial"
    INSUFFICIENT_DATA = "insufficient_data"
    AMBIGUOUS_ENTITY = "ambiguous_entity"
    UNSUPPORTED_OPERATION = "unsupported_operation"
    CONFLICTING_EVIDENCE = "conflicting_evidence"
    ERROR = "error"


#: Statuses that must never carry a generated confident answer.
ABSTAINING = frozenset({
    SkillStatus.INSUFFICIENT_DATA,
    SkillStatus.AMBIGUOUS_ENTITY,
    SkillStatus.UNSUPPORTED_OPERATION,
    SkillStatus.ERROR,
})


class ChannelState(str, Enum):
    """
    What happened to one evidence channel — the distinction the specification's
    Phase 13 exists to preserve.

    `EMPTY` and `FAILED` are the pair that matters. A provider that timed out
    returned no evidence, and so did a provider that ran fine and found
    nothing, but only the second is a fact about the world. Collapsing them
    lets an outage render as "this company has no filings".
    """

    SUCCESS = "success"
    EMPTY = "empty"
    FAILED = "failed"
    TIMEOUT = "timeout"
    UNAVAILABLE = "unavailable"


#: A channel in one of these states produced no evidence for reasons that are
#: about the system, not about the company.
DEGRADED = frozenset({ChannelState.FAILED, ChannelState.TIMEOUT, ChannelState.UNAVAILABLE})


@dataclass
class ChannelReport:
    channel: str
    state: ChannelState
    count: int = 0
    #: Exception type only. A message can carry a DSN or an API key.
    error_type: str = ""

    def as_dict(self) -> dict:
        d = asdict(self)
        d["state"] = self.state.value
        return d


@dataclass
class SkillRequest:
    skill: str
    #: Raw mentions as the user wrote them. Resolution happens in the skill,
    #: against the one canonical entity layer, so every skill resolves alike.
    entities: list[str] = field(default_factory=list)
    period: str = ""
    filters: dict = field(default_factory=dict)
    output_mode: str = "prose"
    query: str = ""

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass
class SkillCapability:
    """
    Whether this skill can run for this request, decided before it runs.

    `executable` is allowed to be True while `source_count` is 0: an SEC channel
    reads the filing at query time, so "no rows in the local corpus" is not
    evidence of anything. What makes it False is a resolved-entity failure, an
    operation the skill does not perform, or a period that cannot have been
    reported yet.
    """

    skill: str
    entity_status: str
    data_available: bool = False
    source_count: int = 0
    freshness: str = ""
    executable: bool = False
    limitations: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass
class Claim:
    """One statement the skill makes, and what supports it."""

    text: str
    #: Indexes into `SkillResult.citations`. An empty list is allowed only for
    #: a claim the skill labels as absent — "the filing does not disclose X".
    citations: list[int] = field(default_factory=list)
    #: `reported` | `derived` | `absent`
    kind: str = "reported"
    value: object = None
    unit: str = ""
    period: str = ""

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass
class SkillResult:
    skill: str
    status: SkillStatus
    entities: list[dict] = field(default_factory=list)
    period: str = ""
    claims: list[Claim] = field(default_factory=list)
    data: dict = field(default_factory=dict)
    citations: list[dict] = field(default_factory=list)
    verification: dict = field(default_factory=dict)
    limitations: list[str] = field(default_factory=list)
    channels: list[ChannelReport] = field(default_factory=list)

    @property
    def abstained(self) -> bool:
        return self.status in ABSTAINING

    @property
    def degraded_channels(self) -> list[ChannelReport]:
        """Channels that failed rather than legitimately finding nothing."""
        return [c for c in self.channels if c.state in DEGRADED]

    def as_dict(self) -> dict:
        return {
            "skill": self.skill,
            "status": self.status.value,
            "entities": self.entities,
            "period": self.period,
            "claims": [c.as_dict() for c in self.claims],
            "data": self.data,
            "citations": self.citations,
            "verification": self.verification,
            "limitations": self.limitations,
            "channels": [c.as_dict() for c in self.channels],
        }


def missing(metric: str, period: str = "") -> Claim:
    """
    A metric the source does not report.

    The one construction the specification insists on: a missing number stays
    missing. Returning 0.0 for "the filing does not break this out" is the
    difference between a gap and a lie, and every downstream average, ratio and
    chart treats the zero as real.
    """
    where = f" for {period}" if period else ""
    return Claim(
        text=f"{metric} is not reported{where} in the available sources.",
        kind="absent",
        value=None,
        period=period,
    )
