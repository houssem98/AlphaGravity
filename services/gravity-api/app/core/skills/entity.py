"""
One entity layer, three honest states.

`EntityResolver` already resolves every registrant in SEC's ticker file, which
is roughly ten thousand companies — the universality the specification asks for
was never missing at this layer. What was missing is the middle state. The
resolver returns its best fuzzy match and a list of `alternatives`, and callers
took the match: "Apple" and "Apple Hospitality REIT" both resolve, and the
caller that ignores the alternatives silently picks one.

So this module adds the state that lets a caller refuse:

    RESOLVED    one registrant, and the runner-up is materially worse
    AMBIGUOUS   several registrants fit; the caller must not choose for the user
    UNKNOWN     nothing fits

Ambiguity is decided on the *margin*, not the absolute score. Two candidates at
0.95 and 0.94 are a coin flip however confident either looks; one at 0.95 with
a runner-up at 0.55 is a resolution. An exact ticker match is never ambiguous —
a ticker is a unique key on an exchange, which is the whole point of one.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from enum import Enum

import structlog

logger = structlog.get_logger()


class EntityStatus(str, Enum):
    RESOLVED = "resolved"
    AMBIGUOUS = "ambiguous"
    UNKNOWN = "unknown"


#: Below this, the best candidate is not good enough to be anyone.
ACCEPT_SCORE = 0.5
#: A runner-up within this of the winner makes the pair a coin flip.
AMBIGUITY_MARGIN = 0.08


@dataclass
class Candidate:
    ticker: str = ""
    name: str = ""
    cik: str = ""
    score: float = 0.0

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass
class Entity:
    """
    Canonical identity, with every field the specification names that the
    underlying source actually supplies. A field SEC does not publish in the
    ticker file is left empty rather than filled from somewhere less
    authoritative — `former_names` and `exchange` arrive only when the caller
    enriches, and an empty string says so.
    """

    status: EntityStatus
    mention: str = ""
    ticker: str = ""
    legal_name: str = ""
    display_name: str = ""
    cik: str = ""
    exchange: str = ""
    aliases: list[str] = field(default_factory=list)
    former_names: list[str] = field(default_factory=list)
    country: str = ""
    fiscal_year_end: str = ""
    confidence: float = 0.0
    match_type: str = ""
    candidates: list[Candidate] = field(default_factory=list)

    @property
    def resolved(self) -> bool:
        return self.status is EntityStatus.RESOLVED

    @property
    def company_id(self) -> str:
        """A stable key across tickers and renames. CIK never changes; a
        ticker does, and a company can have several."""
        return f"cik:{int(self.cik)}" if str(self.cik).strip().isdigit() else ""

    def as_dict(self) -> dict:
        d = asdict(self)
        d["status"] = self.status.value
        d["company_id"] = self.company_id
        d["candidates"] = [c.as_dict() for c in self.candidates]
        return d


UNKNOWN = Entity(status=EntityStatus.UNKNOWN)


def classify(
    best_score: float,
    alternatives: list[dict],
    match_type: str,
    *,
    margin: float = AMBIGUITY_MARGIN,
) -> EntityStatus:
    """
    The state a resolver answer deserves, from its score and its runner-up.

    Pure, so the rule is testable without a network or a ticker file.
    """
    if match_type in ("exact_ticker", "exact_cik"):
        return EntityStatus.RESOLVED
    if best_score < ACCEPT_SCORE:
        return EntityStatus.UNKNOWN
    runner_up = max((float(a.get("score") or 0.0) for a in alternatives), default=0.0)
    # Rounded before comparison: scores carry three decimals at most, and an
    # unrounded subtraction puts a gap of exactly `margin` on the wrong side of
    # the test by 4e-17. A verdict that depends on binary floating point is not
    # a verdict.
    if runner_up >= ACCEPT_SCORE and round(best_score - runner_up, 6) < round(margin, 6):
        return EntityStatus.AMBIGUOUS
    return EntityStatus.RESOLVED


async def resolve(mention: str, resolver=None) -> Entity:
    """
    One mention to one canonical entity, or to an honest refusal.

    Accepts a ticker, a company name, a legal name, an alias or a former name —
    whatever the underlying SEC ticker file and alias table between them index.
    It does not accept guessing: a materially ambiguous mention comes back
    `AMBIGUOUS` with its candidates, and the caller asks the user.
    """
    m = (mention or "").strip()
    if not m:
        return Entity(status=EntityStatus.UNKNOWN, mention="")

    if resolver is None:
        from app.core.entity_resolver import EntityResolver

        resolver = await EntityResolver.build()

    try:
        r = await resolver.resolve(m)
    except Exception as e:  # noqa: BLE001 — a resolver outage is UNKNOWN, not a crash
        logger.warning("entity_resolve_failed", mention=m[:64], error=str(e)[:160])
        return Entity(status=EntityStatus.UNKNOWN, mention=m)

    if not r or not getattr(r, "ticker", ""):
        return Entity(status=EntityStatus.UNKNOWN, mention=m)

    alts = list(getattr(r, "alternatives", None) or [])
    status = classify(float(r.confidence), alts, r.match_type)
    candidates = [
        Candidate(
            ticker=str(a.get("ticker", "")),
            name=str(a.get("name", "")),
            cik=str(a.get("cik", "")),
            score=float(a.get("score") or 0.0),
        )
        for a in alts
    ]
    if status is EntityStatus.AMBIGUOUS:
        # The winner is one of the candidates the caller must choose between,
        # so it is listed rather than being silently promoted.
        candidates.insert(0, Candidate(
            ticker=r.ticker, name=r.name, cik=str(r.cik), score=float(r.confidence),
        ))
        logger.info("entity_ambiguous", mention=m[:64],
                    candidates=[c.ticker for c in candidates[:4]])
        return Entity(
            status=status, mention=m, confidence=float(r.confidence),
            match_type=r.match_type, candidates=candidates,
        )

    return Entity(
        status=status,
        mention=m,
        ticker=r.ticker,
        legal_name=r.name,
        display_name=r.name,
        cik=str(r.cik),
        aliases=[],
        former_names=list(getattr(r, "former_names", None) or []),
        confidence=float(r.confidence),
        match_type=r.match_type,
        candidates=candidates,
    )


async def resolve_many(mentions: list[str], resolver=None) -> list[Entity]:
    """
    Several mentions, resolved against the one shared layer.

    Sequential on purpose: the resolver is an in-memory index after its first
    load, so concurrency buys nothing and a shared first-load race costs a
    duplicate download of SEC's ticker file.
    """
    out: list[Entity] = []
    for m in mentions or []:
        out.append(await resolve(m, resolver=resolver))
    return out
