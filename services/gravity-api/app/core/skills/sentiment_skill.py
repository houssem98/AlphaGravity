"""
Sentiment for any resolvable registrant, from evidence, with the window stated.

What this replaces. `/sentiment <ticker>` called
`GET /v1/analytics/sentiment/{ticker}`, which reads a cache keyed by a
`document_id` the caller had to already possess, and answered 404 otherwise.
There was no company allowlist — there was no path at all. Every ticker got the
same refusal, so the surface was uniformly dead rather than unevenly alive.

The universal path exists because `edgar_text_search` reads any registrant's
latest filing at query time. Management's own words in MD&A are a real,
citable, per-company sentiment source that needs no ingestion, no vendor and no
allowlist.

Three rules the specification names, enforced here:

**Price is not sentiment.** No market data reaches this module. A stock that
fell 8% while management wrote an upbeat MD&A is a divergence worth seeing, and
collapsing the two into one number destroys exactly that.

**Sources stay apart.** Every piece of evidence carries the class it came from
(`sec_filing` today; `news` and `earnings_call` when their channels report).
The output states the mix rather than averaging classes into a single figure
whose provenance cannot be recovered.

**Insufficient means insufficient.** Below a floor of scored sentences the
result is `insufficient_data`, not a confident zero. A neutral score computed
from four sentences is not neutrality, it is noise.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

import structlog

from app.core.skills import entity as entity_layer
from app.core.skills import period as period_layer
from app.core.skills.contract import (
    ChannelReport,
    ChannelState,
    Claim,
    SkillRequest,
    SkillResult,
    SkillStatus,
)

logger = structlog.get_logger()

SKILL = "sentiment"

#: Below this many scored sentences there is not enough text to characterise.
MIN_SENTENCES = 12
#: A sentence must carry at least this much signal to be quoted as evidence.
MIN_EVIDENCE_MAGNITUDE = 0.25
#: Positive and negative shares this close, with both substantial, is a
#: genuinely mixed document — reported as conflict rather than averaged to zero.
CONFLICT_MARGIN = 0.10
CONFLICT_FLOOR = 0.30
#: How many quotes to carry per polarity. Enough to show the basis, few enough
#: to read.
MAX_QUOTES = 5


@dataclass
class Evidence:
    text: str
    label: str
    score: float
    source_class: str
    citation: int
    section: str = ""

    def as_dict(self) -> dict:
        return {
            "text": self.text, "label": self.label, "score": round(self.score, 3),
            "source_class": self.source_class, "citation": self.citation,
            "section": self.section,
        }


@dataclass
class Window:
    """The span the evidence actually covers — stated, never implied."""

    start: str = ""
    end: str = ""
    basis: str = ""
    filings: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"start": self.start, "end": self.end, "basis": self.basis,
                "filings": self.filings}


def _label(score: float) -> str:
    if score >= 0.15:
        return "positive"
    if score <= -0.15:
        return "negative"
    return "neutral"


def classify_mix(positive: int, negative: int, neutral: int) -> tuple[str, bool]:
    """
    The overall reading, and whether the sources genuinely conflict.

    Pure so the rule is testable on its own. A document whose positive and
    negative shares are both substantial and within `CONFLICT_MARGIN` is
    *conflicting*, which is a finding. Averaging it to "neutral" reports the
    arithmetic mean of two disagreements as agreement.
    """
    total = positive + negative + neutral
    if total <= 0:
        return "neutral", False
    p, n = positive / total, negative / total
    conflict = p >= CONFLICT_FLOOR and n >= CONFLICT_FLOOR and abs(p - n) < CONFLICT_MARGIN
    if conflict:
        return "mixed", True
    if p - n >= 0.10:
        return "positive", False
    if n - p >= 0.10:
        return "negative", False
    return "neutral", False


async def capability(request: SkillRequest, *, resolver=None):
    """Whether sentiment can run for this request, decided before it runs."""
    from app.core.skills.contract import SkillCapability

    mentions = request.entities or ([request.query] if request.query else [])
    ent = await entity_layer.resolve(mentions[0] if mentions else "", resolver=resolver)
    limits: list[str] = []
    if ent.status is entity_layer.EntityStatus.AMBIGUOUS:
        limits.append("the company mention matches several registrants")
    elif ent.status is entity_layer.EntityStatus.UNKNOWN:
        limits.append("the company mention resolves to no SEC registrant")
    return SkillCapability(
        skill=SKILL,
        entity_status=ent.status.value,
        # SEC prose is fetched at query time, so availability is not a property
        # of what happens to be indexed locally.
        data_available=ent.resolved,
        source_count=0,
        freshness="latest filed 10-K/10-Q",
        executable=ent.resolved,
        limitations=limits,
    )


async def run(
    request: SkillRequest,
    *,
    text_search=None,
    engine=None,
    resolver=None,
    as_of: date | None = None,
) -> SkillResult:
    """
    Sentiment for one registrant over a stated window, or an honest refusal.

    `text_search` and `engine` are injected so the whole skill is testable
    without a network: the first is anything with `.search(query, entities=...)`
    returning passages, the second anything with `.score_sentence_sync(text)`.
    """
    mentions = request.entities or ([request.query] if request.query else [])
    ent = await entity_layer.resolve(mentions[0] if mentions else "", resolver=resolver)

    if ent.status is entity_layer.EntityStatus.AMBIGUOUS:
        return SkillResult(
            skill=SKILL, status=SkillStatus.AMBIGUOUS_ENTITY,
            entities=[ent.as_dict()],
            limitations=[
                "The company named matches more than one SEC registrant. "
                "Name the ticker to choose."
            ],
        )
    if not ent.resolved:
        return SkillResult(
            skill=SKILL, status=SkillStatus.INSUFFICIENT_DATA,
            entities=[ent.as_dict()],
            limitations=["The company named does not resolve to an SEC registrant."],
        )

    verdict = period_layer.evaluate(request.period or "latest", as_of=as_of)
    if verdict.must_abstain:
        return SkillResult(
            skill=SKILL, status=SkillStatus.INSUFFICIENT_DATA,
            entities=[ent.as_dict()], period=verdict.period.label,
            verification={"period": verdict.as_dict()},
            limitations=[
                f"{verdict.period.label} is not reported yet — {verdict.reason}. "
                "No sentiment is computed for a period with no filed disclosure."
            ],
        )

    passages, report = await _fetch(ent, request, text_search)
    if report.state in (ChannelState.FAILED, ChannelState.TIMEOUT, ChannelState.UNAVAILABLE):
        # A provider failure is never rendered as "this company discloses
        # nothing" — the two are different claims and only one is about the
        # company.
        return SkillResult(
            skill=SKILL, status=SkillStatus.ERROR,
            entities=[ent.as_dict()], period=verdict.period.label,
            channels=[report],
            limitations=[
                "The filing text provider did not answer, so no evidence was "
                "retrieved. This is a retrieval failure, not an absence of "
                "disclosure."
            ],
        )

    if engine is None:
        from app.core.analytics.sentiment_engine import SentimentEngine

        engine = SentimentEngine()

    scored, citations, window = _score(passages, engine, ent)

    if len(scored) < MIN_SENTENCES:
        return SkillResult(
            skill=SKILL, status=SkillStatus.INSUFFICIENT_DATA,
            entities=[ent.as_dict()], period=verdict.period.label,
            citations=citations, channels=[report],
            data={"scored_sentences": len(scored), "window": window.as_dict()},
            limitations=[
                f"Only {len(scored)} scorable sentences were retrieved, below the "
                f"{MIN_SENTENCES} needed to characterise sentiment. No overall "
                "reading is given."
            ],
        )

    pos = [e for e in scored if e.label == "positive"]
    neg = [e for e in scored if e.label == "negative"]
    neu = [e for e in scored if e.label == "neutral"]
    overall, conflicted = classify_mix(len(pos), len(neg), len(neu))
    mean = sum(e.score for e in scored) / len(scored)

    strongest = lambda xs, rev: sorted(  # noqa: E731 — a sort key, not a function
        xs, key=lambda e: e.score, reverse=rev
    )[:MAX_QUOTES]
    positive_evidence = strongest([e for e in pos if abs(e.score) >= MIN_EVIDENCE_MAGNITUDE], True)
    negative_evidence = strongest([e for e in neg if abs(e.score) >= MIN_EVIDENCE_MAGNITUDE], False)

    source_mix: dict[str, int] = {}
    for e in scored:
        source_mix[e.source_class] = source_mix.get(e.source_class, 0) + 1

    claims = [
        Claim(
            text=(
                f"{ent.display_name or ent.ticker}'s disclosure language over "
                f"{window.basis} reads {overall}."
            ),
            citations=sorted({e.citation for e in (positive_evidence + negative_evidence)}),
            kind="derived",
            value=round(mean, 3),
            period=verdict.period.label,
        )
    ]

    limitations = [
        "Sentiment is measured on the language of the filings listed, not on "
        "price, volume or any market signal.",
        "Scoring is lexicon-based over financial-disclosure vocabulary; it "
        "measures tone, not accuracy or outcome.",
    ]
    if set(source_mix) == {"sec_filing"}:
        limitations.append(
            "Only SEC filing language was available. No earnings-call, news or "
            "analyst sentiment is included, so this is not a market-wide reading."
        )
    if not positive_evidence:
        limitations.append("No positively-toned passage cleared the evidence threshold.")
    if not negative_evidence:
        limitations.append("No negatively-toned passage cleared the evidence threshold.")

    status = SkillStatus.CONFLICTING_EVIDENCE if conflicted else SkillStatus.SUCCESS
    if conflicted:
        limitations.insert(
            0,
            "Positive and negative language are present in comparable measure; "
            "the filing does not support a single directional reading.",
        )

    return SkillResult(
        skill=SKILL,
        status=status,
        entities=[ent.as_dict()],
        period=verdict.period.label,
        claims=claims,
        data={
            "overall": overall,
            "overall_score": round(mean, 3),
            "conflicting": conflicted,
            "counts": {"positive": len(pos), "negative": len(neg), "neutral": len(neu)},
            "scored_sentences": len(scored),
            "positive_evidence": [e.as_dict() for e in positive_evidence],
            "negative_evidence": [e.as_dict() for e in negative_evidence],
            "neutral_evidence": [e.as_dict() for e in neu[:MAX_QUOTES]],
            "source_mix": source_mix,
            "window": window.as_dict(),
            # Reported so a caller can chart a trend, and named as absent so
            # nobody reads its absence as "no change".
            "trend": None,
            "trend_note": (
                "No prior-period comparison: a second filing would have to be "
                "read and scored on the same basis."
            ),
        },
        citations=citations,
        verification={
            "period": verdict.as_dict(),
            "method": "lexicon_sentence_scoring",
            "evidence_threshold": MIN_EVIDENCE_MAGNITUDE,
            "min_sentences": MIN_SENTENCES,
        },
        limitations=limitations,
        channels=[report],
    )


async def _fetch(ent, request: SkillRequest, text_search):
    """Filing prose for this registrant, with the channel's own outcome."""
    if text_search is None:
        try:
            from app.core.retrieval.edgar_search import EdgarSearch
            from app.core.retrieval.edgar_text_search import EdgarTextSearch

            text_search = EdgarTextSearch(EdgarSearch())
        except Exception as e:  # noqa: BLE001
            return [], ChannelReport("edgar_text", ChannelState.UNAVAILABLE,
                                     error_type=type(e).__name__)

    query = (
        request.query
        or f"{ent.display_name or ent.ticker} management discussion outlook results"
    )
    try:
        passages = await text_search.search(
            query, entities={"tickers": [ent.ticker]}, top_k=12
        )
    except TimeoutError as e:
        return [], ChannelReport("edgar_text", ChannelState.TIMEOUT,
                                 error_type=type(e).__name__)
    except Exception as e:  # noqa: BLE001
        # Type only — a provider exception message routinely carries the DSN or
        # the key it failed to authenticate with.
        logger.warning("sentiment_fetch_failed", ticker=ent.ticker,
                       error_type=type(e).__name__)
        return [], ChannelReport("edgar_text", ChannelState.FAILED,
                                 error_type=type(e).__name__)

    passages = list(passages or [])
    state = ChannelState.SUCCESS if passages else ChannelState.EMPTY
    return passages, ChannelReport("edgar_text", state, count=len(passages))


def _score(passages, engine, ent) -> tuple[list[Evidence], list[dict], Window]:
    """Sentence-level scores, the citations they point at, and the window."""
    from app.core.retrieval.citation_provenance import source_payload

    citations: list[dict] = []
    evidence: list[Evidence] = []
    filings: list[str] = []
    ends: list[str] = []

    for p in passages:
        meta = getattr(p, "metadata", None) or {}
        payload = source_payload(meta, ticker=ent.ticker)
        idx = len(citations)
        citations.append({
            "index": idx,
            "title": getattr(p, "document_title", "") or "",
            "section": getattr(p, "section", "") or "",
            "source_class": payload.get("source_class", "SEC_EVIDENCE"),
            **payload,
        })
        form = str(meta.get("form") or "")
        accn = str(meta.get("accn") or "")
        if accn and accn not in filings:
            filings.append(f"{form} {accn}".strip())
        for key in ("period_of_report", "period_end", "filed"):
            if meta.get(key):
                ends.append(str(meta[key]))
                break

        for sentence in _sentences(getattr(p, "text", "") or ""):
            s = engine.score_sentence_sync(sentence)
            if not getattr(s, "label", ""):
                continue
            evidence.append(Evidence(
                text=sentence.strip()[:400],
                label=_label(float(s.score)),
                score=float(s.score),
                source_class="sec_filing",
                citation=idx,
                section=getattr(p, "section", "") or "",
            ))

    ends.sort()
    window = Window(
        start=ends[0] if ends else "",
        end=ends[-1] if ends else "",
        basis=("the filings listed" if filings else "no filing"),
        filings=filings,
    )
    return evidence, citations, window


def _sentences(text: str) -> list[str]:
    """Sentence split, kept local so the skill does not depend on the engine's."""
    import re

    parts = re.split(r"(?<=[.!?])\s+", text or "")
    return [p for p in (s.strip() for s in parts) if 40 <= len(p) <= 600]
