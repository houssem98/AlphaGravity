"""
A company profile for any resolvable registrant, built from what it filed.

The universality here is inherited, not invented: `EntityResolver` indexes
SEC's whole ticker file and `edgar_search` fetches any registrant's XBRL facts
at query time. What this module adds is the discipline around that — one
canonical identity, one calendar, and a rule about absence:

    A metric the filing does not report is reported as absent.

That rule is the reason this module exists. A profile builder that returns
`{"gross_profit": 0.0}` for a bank produces a chart with a real-looking zero, a
margin of 0%, and a peer average that is quietly wrong. Every metric below is
either a `reported` claim with a citation or an `absent` claim with no value,
and there is no third case.

The metric list is the specification's, and it is deliberately generic: revenue,
gross profit, operating income, net income, EPS, cash, debt, free cash flow.
Which of them a given filer reports is a property of that filer's statements —
banks do not report gross profit, REITs report funds from operations instead of
much of this — so the skill asks for all of them and reports what came back.
Nothing is company-specific, and there is no list of supported companies.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import structlog

from app.core.skills import entity as entity_layer
from app.core.skills import period as period_layer
from app.core.skills.contract import (
    ChannelReport,
    ChannelState,
    Claim,
    SkillCapability,
    SkillRequest,
    SkillResult,
    SkillStatus,
    missing,
)

logger = structlog.get_logger()

SKILL = "company"


@dataclass(frozen=True)
class Metric:
    key: str
    label: str
    #: The words that make `classify_metric` pick this concept. The query text
    #: is the interface `edgar_search` exposes; asking in its own vocabulary is
    #: what keeps this module from duplicating the XBRL tag table.
    ask: str


#: Asked for every company. Which ones come back is the filer's business.
METRICS: tuple[Metric, ...] = (
    Metric("revenue", "Revenue", "total revenue"),
    Metric("gross_profit", "Gross profit", "gross profit"),
    Metric("operating_income", "Operating income", "operating income"),
    Metric("net_income", "Net income", "net income"),
    Metric("eps", "Diluted EPS", "diluted earnings per share"),
    Metric("cash", "Cash and equivalents", "cash and cash equivalents"),
    Metric("debt", "Total debt", "total debt"),
    Metric("free_cash_flow", "Free cash flow", "free cash flow"),
)


def _fy_key(hit: dict) -> tuple[int, int]:
    m = hit.get("metadata") or {}
    try:
        fy = int(m.get("fiscal_year") or 0)
    except (TypeError, ValueError):
        fy = 0
    try:
        fq = int(m.get("fiscal_quarter") or 0)
    except (TypeError, ValueError):
        fq = 0
    return (fy, fq)


def pin_to_one_period(facts: dict) -> tuple[dict, dict]:
    """
    Keep only the facts from one fiscal period, and hand back what was dropped.

    Found live, against Copart: asking for "latest" resolved operating income
    and net income to the FY2025 10-K and revenue to a **2018** one, because
    each metric is fetched independently and each takes the best match SEC
    returns for its own concept. The profile then read

        Revenue           $1.81B      (FY2018)
        Operating income  $1.70B      (FY2025)

    which is not a profile of anything. Two figures from seven years apart,
    presented as one company's current position, is a fabricated comparison
    even though both numbers are individually real and individually cited.

    So the newest period any metric resolved to wins, and a metric that only
    exists in an older one is **not reported for this period** — it moves to
    the absent list with its period named, which is a true statement, instead
    of being silently mixed in. Facts carrying no fiscal year at all are kept:
    a missing label is not evidence of an old period, and dropping them would
    lose balance-sheet items that the XBRL channel dates differently.
    """
    dated = {k: v for k, v in facts.items() if _fy_key(v) != (0, 0)}
    if not dated:
        return facts, {}

    newest = max(_fy_key(v) for v in dated.values())
    kept, dropped = {}, {}
    for key, hit in facts.items():
        k = _fy_key(hit)
        if k == (0, 0) or k == newest:
            kept[key] = hit
        else:
            dropped[key] = hit
    if dropped:
        logger.info(
            "company_period_pinned",
            pinned=f"FY{newest[0]}" + (f"Q{newest[1]}" if newest[1] else ""),
            dropped={k: v.get("period") for k, v in dropped.items()},
        )
    return kept, dropped


async def capability(request: SkillRequest, *, resolver=None) -> SkillCapability:
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
        data_available=ent.resolved,
        source_count=0,
        freshness="latest filed XBRL facts",
        executable=ent.resolved,
        limitations=limits,
    )


async def run(
    request: SkillRequest,
    *,
    facts_search=None,
    resolver=None,
    as_of: date | None = None,
) -> SkillResult:
    """
    The profile, or an honest refusal.

    `facts_search` is injected for testing: anything with
    `.search(query, entities=..., top_k=...)` returning passages whose metadata
    carries `value`, `unit`, `accn` and the rest of the SEC provenance.
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
                "No figures are given for a period with no filed disclosure."
            ],
        )

    identity = {
        "company_id": ent.company_id,
        "ticker": ent.ticker,
        "legal_name": ent.legal_name,
        "display_name": ent.display_name,
        "cik": ent.cik,
        # Stated as empty rather than filled from a less authoritative source:
        # SEC's ticker file carries neither, and inventing them is the failure
        # mode this whole pass exists to remove.
        "exchange": ent.exchange,
        "sector": "",
        "industry": "",
    }

    facts, report = await _fetch(ent, request, verdict, facts_search)
    facts, off_period = pin_to_one_period(facts)

    claims: list[Claim] = []
    citations: list[dict] = []
    values: dict[str, dict] = {}
    absent: list[str] = []

    # The period the figures are actually FROM, which is not always the one
    # that was asked for: "latest" resolves to whatever the newest filing
    # reports, and the answer has to say which that is rather than leaving the
    # reader to assume.
    reporting_period = next(
        (f.get("period") for f in facts.values() if f.get("period")),
        verdict.period.label,
    )

    for metric in METRICS:
        hit = facts.get(metric.key)
        if hit is None:
            absent.append(metric.label)
            stale = off_period.get(metric.key)
            if stale:
                # Named rather than dropped: "we found this, but for another
                # period" is more useful and more honest than "not reported",
                # and it is still not a figure for the period asked about.
                claims.append(Claim(
                    text=(
                        f"{metric.label} is not reported for {reporting_period}. "
                        f"The nearest figure found is from {stale.get('period') or 'another period'} "
                        "and is not shown, because mixing periods in one profile "
                        "is a comparison the filings do not make."
                    ),
                    kind="absent", value=None, period=reporting_period,
                ))
            else:
                claims.append(missing(metric.label, reporting_period))
            # No entry in `values`. A caller reading `values["gross_profit"]`
            # gets a KeyError, which is recoverable; a 0.0 is not.
            continue
        idx = _cite(citations, hit, ent)
        values[metric.key] = {
            "label": metric.label,
            "value": hit["value"],
            "unit": hit.get("unit", ""),
            "period": hit.get("period", verdict.period.label),
            "form": hit.get("form", ""),
            "accession": hit.get("accn", ""),
            "citation": idx,
        }
        claims.append(Claim(
            text=f"{metric.label}: {_fmt(hit['value'], hit.get('unit', ''))}",
            citations=[idx],
            kind="derived" if hit.get("derived") else "reported",
            value=hit["value"],
            unit=hit.get("unit", ""),
            period=hit.get("period", verdict.period.label),
        ))

    limitations: list[str] = []
    if values:
        limitations.append(
            f"All figures are from {reporting_period}. Every metric is pinned to "
            "one reporting period, so a figure that exists only in an older "
            "filing is listed as not reported here rather than shown beside "
            "current ones."
        )
    if absent:
        limitations.append(
            "Not reported in the sources read: " + ", ".join(absent) +
            ". These are absent, not zero."
        )
    if off_period:
        limitations.append(
            "Found but not shown, because they belong to another period: "
            + ", ".join(
                f"{k} ({v.get('period') or 'undated'})" for k, v in off_period.items()
            )
            + "."
        )
    if report.state is ChannelState.EMPTY:
        limitations.append(
            "The SEC facts channel ran and returned nothing for this registrant "
            "and period. That is an absence of matching disclosure, not a failure."
        )
    if report.state in (ChannelState.FAILED, ChannelState.TIMEOUT, ChannelState.UNAVAILABLE):
        limitations.append(
            "The SEC facts provider did not answer. No conclusion about what "
            "this company reports can be drawn from this run."
        )

    if report.state in (ChannelState.FAILED, ChannelState.TIMEOUT, ChannelState.UNAVAILABLE):
        status = SkillStatus.ERROR
    elif not values:
        status = SkillStatus.INSUFFICIENT_DATA
    elif absent:
        status = SkillStatus.PARTIAL
    else:
        status = SkillStatus.SUCCESS

    return SkillResult(
        skill=SKILL,
        status=status,
        entities=[ent.as_dict()],
        period=verdict.period.label,
        claims=claims,
        data={
            "identity": identity,
            "financials": values,
            "not_reported": absent,
            "metrics_requested": [m.key for m in METRICS],
            # The period the figures are FROM, alongside the one that was asked
            # for. "latest" is a request, not an answer.
            "reporting_period": reporting_period,
            "off_period_excluded": {
                k: v.get("period", "") for k, v in off_period.items()
            },
        },
        citations=citations,
        verification={"period": verdict.as_dict()},
        limitations=limitations,
        channels=[report],
    )


async def _fetch(ent, request: SkillRequest, verdict, facts_search):
    """XBRL facts for this registrant, keyed by metric, with the channel state."""
    if facts_search is None:
        try:
            from app.core.retrieval.edgar_search import EdgarSearch

            facts_search = EdgarSearch()
        except Exception as e:  # noqa: BLE001
            return {}, ChannelReport("edgar", ChannelState.UNAVAILABLE,
                                     error_type=type(e).__name__)

    suffix = "" if verdict.period.latest else f" {verdict.period.label}"
    found: dict[str, dict] = {}
    state = ChannelState.EMPTY
    error_type = ""

    for metric in METRICS:
        try:
            results = await facts_search.search(
                f"{ent.ticker} {metric.ask}{suffix}",
                entities={"tickers": [ent.ticker]},
                top_k=2,
            )
        except TimeoutError as e:
            state, error_type = ChannelState.TIMEOUT, type(e).__name__
            break
        except Exception as e:  # noqa: BLE001
            # Type only. A provider exception message routinely carries the
            # DSN or the API key it failed to authenticate with, and a log line
            # is exactly as exfiltrable as a response body.
            logger.warning("company_facts_failed", ticker=ent.ticker,
                           metric=metric.key, error_type=type(e).__name__)
            state, error_type = ChannelState.FAILED, type(e).__name__
            break

        for r in results or []:
            m = getattr(r, "metadata", None) or {}
            if m.get("value") is None:
                continue
            found[metric.key] = {
                "value": m["value"],
                "unit": m.get("unit", ""),
                "period": _period_label(m),
                "form": m.get("form", ""),
                "accn": m.get("accn", ""),
                "derived": bool(m.get("derived")),
                "metadata": m,
                "title": getattr(r, "document_title", ""),
                "section": getattr(r, "section", ""),
            }
            state = ChannelState.SUCCESS
            break

    if state is ChannelState.SUCCESS or found:
        state = ChannelState.SUCCESS
    return found, ChannelReport("edgar", state, count=len(found), error_type=error_type)


def _cite(citations: list[dict], hit: dict, ent) -> int:
    """Add one citation, reusing an identical one so a filing is cited once."""
    from app.core.retrieval.citation_provenance import source_payload

    payload = source_payload(hit.get("metadata") or {}, ticker=ent.ticker)
    entry = {
        "title": hit.get("title", ""),
        "section": hit.get("section", ""),
        "source_class": payload.get("source_class", "SEC_EVIDENCE"),
        **payload,
    }
    for i, existing in enumerate(citations):
        if existing.get("accession") and existing.get("accession") == entry.get("accession") \
                and existing.get("title") == entry.get("title"):
            return i
    entry["index"] = len(citations)
    citations.append(entry)
    return entry["index"]


def _period_label(m: dict) -> str:
    fy, fq = m.get("fiscal_year"), m.get("fiscal_quarter")
    if not fy:
        return str(m.get("period_end") or "")
    return f"FY{fy}" + (f"Q{fq}" if fq else "")


def _fmt(value, unit: str) -> str:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return str(value)
    if unit and unit.upper() in ("USD/SHARES", "PURE"):
        return f"{v:,.2f}"
    prefix = "$" if unit and unit.upper().startswith("USD") else ""
    if abs(v) >= 1e9:
        return f"{prefix}{v / 1e9:,.2f}B"
    if abs(v) >= 1e6:
        return f"{prefix}{v / 1e6:,.1f}M"
    return f"{prefix}{v:,.2f}"
