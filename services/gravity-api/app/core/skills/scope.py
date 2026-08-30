"""
Answering "which companies did X" without lying about how many you checked.

The question class is real and common: *which S&P 500 companies mentioned
tariff risk in their 10-K?* There are two easy wrong answers and one hard right
one.

The first wrong answer is to abstain, because the system cannot read 503
10-Ks and therefore "cannot answer". That throws away a genuinely useful
result. If eleven of them demonstrably say it, in their own filings, with
accession numbers, then *at least eleven do* — and that is a true, checkable,
valuable statement.

The second wrong answer is to list the eleven and let the phrasing imply that
is all of them. Nobody says "these are the only ones", but a bare list reads
that way, and the reader walks off believing a census happened.

So an answer of this kind carries two separate facts, and the whole module
exists to keep them separate:

    scope_status      did we cover the universe the question named?
    coverage_status   for each member, how good is the evidence?

`EXHAUSTIVE` is the claim that must be earned. It requires a universe whose
size is known *and* every member examined. Absent either, the answer is
`PARTIAL` and says so in words — never `EXHAUSTIVE` with a hedge attached,
because a hedge next to a list is not read.

The evidence rule is the roadmap's: a secondary source may DISCOVER a
candidate, but it may not CONFIRM a claim about a filing's contents when the
filing itself is available. A news article reporting that Acme's 10-K warns
about tariffs is a lead. The 10-K is the answer.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

__all__ = [
    "CoverageStatus", "MemberFinding", "ScopeStatus", "ScopeReport",
    "Universe", "assess",
]


class ScopeStatus(str, Enum):
    """How much of the named universe was actually examined."""

    #: Every member of a universe of known size was examined. A census.
    EXHAUSTIVE = "confirmed_exhaustive"
    #: Some members confirmed; the rest unexamined or unresolved. Useful.
    PARTIAL = "confirmed_partial"
    #: Nothing confirmed against evidence that counts.
    INSUFFICIENT = "insufficient_evidence"


class CoverageStatus(str, Enum):
    """The evidence standing behind one member of the answer."""

    #: The primary document says it. Citable, and the claim rests on this.
    PRIMARY_CONFIRMED = "primary_confirmed"
    #: Only a secondary source says it, and no primary was reachable.
    #: A lead, reported as a lead.
    SECONDARY_CANDIDATE = "secondary_candidate"
    #: The primary was read and does not support the claim.
    PRIMARY_REFUTED = "primary_refuted"
    #: Never looked at.
    NOT_EXAMINED = "not_examined"


@dataclass(frozen=True)
class MemberFinding:
    """One company's outcome within a scoped question."""

    company_id: str
    ticker: str = ""
    status: CoverageStatus = CoverageStatus.NOT_EXAMINED
    citations: tuple[int, ...] = ()
    source_class: str = ""
    note: str = ""

    @property
    def is_confirmed(self) -> bool:
        return self.status is CoverageStatus.PRIMARY_CONFIRMED


@dataclass(frozen=True)
class Universe:
    """
    The set a question names.

    `size` of 0 means the size is not known to us, which is not a failure — it
    is the ordinary case for "companies that mentioned tariffs" with no index
    attached. It is, however, an absolute bar on claiming exhaustiveness: you
    cannot have checked all of a set whose membership you cannot enumerate.

    `enumerable` distinguishes "we know it is 503 but did not fetch the list"
    from "there is no list". Both block EXHAUSTIVE; only the first can be
    lifted by fetching.
    """

    name: str = ""
    size: int = 0
    enumerable: bool = False
    as_of: str = ""

    @property
    def is_bounded(self) -> bool:
        return self.size > 0 and self.enumerable


@dataclass
class ScopeReport:
    """The answer's shape: what was found, how much was looked at, and the words."""

    scope_status: ScopeStatus
    universe: Universe
    findings: list[MemberFinding] = field(default_factory=list)
    examined: int = 0
    limitations: list[str] = field(default_factory=list)

    @property
    def confirmed(self) -> list[MemberFinding]:
        return [f for f in self.findings if f.is_confirmed]

    @property
    def candidates(self) -> list[MemberFinding]:
        return [f for f in self.findings
                if f.status is CoverageStatus.SECONDARY_CANDIDATE]

    @property
    def refuted(self) -> list[MemberFinding]:
        return [f for f in self.findings
                if f.status is CoverageStatus.PRIMARY_REFUTED]

    @property
    def claims_exhaustive(self) -> bool:
        return self.scope_status is ScopeStatus.EXHAUSTIVE

    def headline(self) -> str:
        """
        The sentence that must not overstate.

        Note the shape of the partial case: it leads with "at least", names the
        count examined, and does not present the list as a census. That
        phrasing is asserted by tests, because it is the entire difference
        between a useful partial answer and a misleading one.
        """
        n = len(self.confirmed)
        u = self.universe.name or "the group asked about"
        if self.scope_status is ScopeStatus.EXHAUSTIVE:
            return (f"All {self.universe.size} members of {u} were checked; "
                    f"{n} match.")
        if self.scope_status is ScopeStatus.PARTIAL:
            scanned = (f" of {self.universe.size}" if self.universe.size else "")
            return (f"At least {n} match. This is a partial answer: "
                    f"{self.examined}{scanned} members of {u} were examined, so "
                    "there may be others that were not checked.")
        return (f"No member of {u} could be confirmed from primary filings, so "
                "no list is given. This is a limit of what was retrieved, not "
                "evidence that none match.")

    def as_dict(self) -> dict:
        return {
            "scope_status": self.scope_status.value,
            "universe": {
                "name": self.universe.name,
                "size": self.universe.size,
                "enumerable": self.universe.enumerable,
                "as_of": self.universe.as_of,
            },
            "examined": self.examined,
            "confirmed_count": len(self.confirmed),
            "candidate_count": len(self.candidates),
            "members": [
                {
                    "company_id": f.company_id,
                    "ticker": f.ticker,
                    "coverage_status": f.status.value,
                    "citations": list(f.citations),
                    "source_class": f.source_class,
                    "note": f.note,
                }
                for f in self.findings
            ],
            "limitations": self.limitations,
            "headline": self.headline(),
        }


#: Source classes that may CONFIRM a claim about a filing's contents.
PRIMARY_CLASSES = frozenset({"sec_filing", "edgar_text", "edgar", "xbrl"})


def classify_member(
    company_id: str,
    *,
    ticker: str = "",
    source_class: str = "",
    citations: tuple[int, ...] = (),
    supported: bool | None = None,
    primary_available: bool = True,
) -> MemberFinding:
    """
    One member's coverage status from its evidence.

    `supported=None` means the primary was never read, which is why a secondary
    hit lands as a CANDIDATE rather than a confirmation. The asymmetry is
    deliberate: a news report saying a filing contains something is evidence
    about the news report.

    `primary_available=False` is the escape hatch for claims where no primary
    exists to consult — and even then the finding stays a candidate, because
    the honest label for "the only source is secondary" does not change based
    on whether a better source could have existed.
    """
    if supported is False:
        return MemberFinding(company_id, ticker, CoverageStatus.PRIMARY_REFUTED,
                             citations, source_class,
                             note="The filing was read and does not support this.")
    if supported is True and source_class in PRIMARY_CLASSES:
        return MemberFinding(company_id, ticker, CoverageStatus.PRIMARY_CONFIRMED,
                             citations, source_class)
    if source_class and source_class not in PRIMARY_CLASSES:
        note = ("Reported by a secondary source; the filing itself was not "
                "read, so this is a lead rather than a confirmed match.")
        if not primary_available:
            note = ("Only a secondary source covers this; no primary filing was "
                    "available to check it against.")
        return MemberFinding(company_id, ticker, CoverageStatus.SECONDARY_CANDIDATE,
                             citations, source_class, note=note)
    if supported is True:
        # Claimed support, but from a class that cannot confirm. Downgrade
        # rather than trust the caller's label.
        return MemberFinding(company_id, ticker, CoverageStatus.SECONDARY_CANDIDATE,
                             citations, source_class,
                             note="Supporting evidence is not a primary filing.")
    return MemberFinding(company_id, ticker, CoverageStatus.NOT_EXAMINED,
                         citations, source_class)


def assess(
    findings: list[MemberFinding],
    universe: Universe,
    *,
    examined: int | None = None,
) -> ScopeReport:
    """
    The scope verdict, from the findings and the universe alone.

    EXHAUSTIVE is gated on two independent facts — a bounded universe and an
    examined count that reaches it — and neither can be supplied by a model's
    impression that it looked at everything.
    """
    seen = examined if examined is not None else sum(
        1 for f in findings if f.status is not CoverageStatus.NOT_EXAMINED
    )
    confirmed = [f for f in findings if f.is_confirmed]
    candidates = [f for f in findings
                  if f.status is CoverageStatus.SECONDARY_CANDIDATE]

    if universe.is_bounded and seen >= universe.size and confirmed:
        status = ScopeStatus.EXHAUSTIVE
    elif confirmed:
        status = ScopeStatus.PARTIAL
    else:
        status = ScopeStatus.INSUFFICIENT

    limitations: list[str] = []
    if status is not ScopeStatus.EXHAUSTIVE:
        if not universe.size:
            limitations.append(
                "The size of the group asked about is not known here, so no "
                "claim is made about how much of it this covers."
            )
        elif not universe.enumerable:
            limitations.append(
                f"{universe.name or 'The group'} has {universe.size} members, "
                "but the membership list was not retrieved, so coverage cannot "
                "be measured against it."
            )
        elif seen < universe.size:
            limitations.append(
                f"{seen} of {universe.size} members of "
                f"{universe.name or 'the group'} were examined. The remaining "
                f"{universe.size - seen} were not checked and may also match."
            )
    if candidates:
        limitations.append(
            f"{len(candidates)} further name(s) were mentioned by secondary "
            "sources but not confirmed against a filing. They are listed as "
            "candidates, not matches."
        )
    if universe.as_of:
        limitations.append(f"Membership is as of {universe.as_of}.")

    return ScopeReport(
        scope_status=status, universe=universe, findings=list(findings),
        examined=seen, limitations=limitations,
    )
