"""
The verified-evidence gate: decides whether SEC must be called, before it is.

The retrieval orchestrator fans out to every channel in parallel, so the live
EDGAR channel fired on every financial question — including ones whose answer was
already sitting in `financials` from an earlier query. Persistence saved the
parse but not the request.

The naive fix — "a row exists, skip SEC" — is worse than the bug. `financials`
holds three populations: exact XBRL rows this channel wrote, an older
companyfacts backfill, and table-scraped rows. A row can match on ticker, metric
and period and still be the wrong fact: the consolidated total where a segment
was asked for, a superseded pre-restatement figure, a different unit, or a scrape
with no provenance at all. Bypassing SEC on any of those answers confidently and
wrongly, which is the failure this whole effort exists to remove.

So a local row may bypass SEC **only** when every identity field the question
pins is present on the row and matches, the row carries its own provenance and a
passing verification state, it is fresh, and no second row contradicts it. Rows
that cannot prove that much are not "misses" — they are `LOCAL_UNVERIFIED`, and
they route to SEC exactly like a miss.

The decision is made from a single targeted lookup, before the fan-out, and never
from fused or reranked results — RRF is a ranking mechanism and cannot answer
"is this the right fact".
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

import structlog

logger = structlog.get_logger()

# Routing states, reported in telemetry.
VERIFIED_LOCAL_HIT = "VERIFIED_LOCAL_HIT"
LOCAL_MISS = "LOCAL_MISS"
LOCAL_UNVERIFIED = "LOCAL_UNVERIFIED"
LOCAL_CONFLICT = "LOCAL_CONFLICT"

# A filed fact for a closed period does not change — until it is restated. The
# only defence against a restatement we have not seen is to stop trusting a
# cached row after a while and re-ask the filer.
DEFAULT_MAX_AGE_DAYS = 90

# Provenance lives in `source_section`, which is already the column recording
# where a row came from. The table has no columns for CIK, period start or
# verification state, and adding them is a schema migration this task is not
# authorised to make — so the identity travels as structured text in the field
# whose purpose it already is. A row without it cannot pass the gate, which is
# the conservative direction: the legacy backfill and the scraped rows carry no
# provenance and therefore never bypass SEC.
PROVENANCE_KIND = "sec_verified_v1"

_SAFE = re.compile(r"[;=]")


def encode_provenance(fields: dict) -> str:
    """`kind;k=v;k=v` — compact, and the column is free text."""
    parts = [PROVENANCE_KIND]
    for k, v in fields.items():
        if v in (None, ""):
            continue
        parts.append(f"{k}={_SAFE.sub('_', str(v))}")
    return ";".join(parts)


def decode_provenance(raw: str) -> dict | None:
    """The fields back, or `None` when this row was not written by this gate's
    contract (legacy backfill, table scrape, anything older)."""
    if not raw or not raw.startswith(PROVENANCE_KIND):
        return None
    out: dict = {}
    for chunk in raw.split(";")[1:]:
        if "=" in chunk:
            k, v = chunk.split("=", 1)
            out[k] = v
    return out


class GateDecision:
    """What the gate decided, and everything telemetry needs to say why."""

    __slots__ = ("status", "row", "reason", "conflicts", "identity")

    def __init__(self, status, row=None, reason="", conflicts=None, identity=None):
        self.status = status
        self.row = row
        self.reason = reason
        self.conflicts = conflicts or []
        self.identity = identity or {}

    @property
    def sec_invoked(self) -> bool:
        return self.status != VERIFIED_LOCAL_HIT

    @property
    def sec_skip_reason(self) -> str | None:
        return VERIFIED_LOCAL_HIT if self.status == VERIFIED_LOCAL_HIT else None

    def telemetry(self) -> dict:
        return {
            "local_evidence_status": self.status,
            "sec_invoked": self.sec_invoked,
            "sec_skip_reason": self.sec_skip_reason,
            "gate_reason": self.reason,
            "gate_conflicts": len(self.conflicts),
        }

    def __repr__(self) -> str:
        return f"<GateDecision {self.status} sec_invoked={self.sec_invoked} {self.reason}>"


def _norm(s) -> str:
    """
    Must fold `&` to `and` exactly as `sec_dimensions.select_by_query` does, or
    "Compute & Networking" normalises to "compute networking" here and
    "compute and networking" there — and the same question resolves to a
    different segment depending on whether it was answered locally or from the
    filing.
    """
    return re.sub(
        r"[^a-z0-9]+", " ", str(s or "").lower().replace("&", " and ")
    ).strip()


# Words that never name a breakdown. Used to decide whether a question asked for
# one at all — which cannot be inferred from the rows on hand, because the whole
# point is to detect a breakdown we do NOT have locally.
_NON_BREAKDOWN = frozenset("""
a an the of for in on at to is was were are be been what how much many did do does
and or vs versus report reported reports total s us their its it from by with
company companies fiscal year quarter quarterly annual full latest most recent
figure figures number numbers amount value results result during ended ending
revenue revenues sales income earnings profit loss margin assets liabilities
equity cash flow inventory cogs ebitda ebit expense expenses capex net gross
operating
""".split())

_PERIOD_TOKEN = re.compile(r"q[1-4]|fy(?:19|20)?\d{0,4}|h[12]|(?:19|20)\d{2}", re.I)


def names_a_breakdown(query: str, ticker: str = "", company_terms=None) -> bool:
    """
    Whether the question carries words beyond the company, the metric and the
    period — i.e. whether it could be asking for a segment at all.

    Deliberately independent of the local rows. Deriving intent from what happens
    to be stored would let a consolidated row answer a segment question purely
    because the segment row is missing, which is the exact failure the gate is
    for.
    """
    known: set[str] = set(_NON_BREAKDOWN)
    known.add((ticker or "").lower())
    for term in company_terms or []:
        known.update(_norm(term).split())
    residual = [
        w
        for w in _norm(query).split()
        if w not in known and not w.isdigit() and not _PERIOD_TOKEN.fullmatch(w)
    ]
    return bool(residual)


def wanted_dimension(query: str, rows: list[dict]) -> str | None:
    """
    Which breakdown the question names, judged against the breakdowns the local
    rows actually carry.

    Same evidence-driven rule the filing parser uses: do not guess which phrase
    is a segment name, ask which of the known member names the question contains.
    Longest match wins so "compute and networking" beats the "compute" inside it.
    """
    q = f" {_norm(query)} "
    best: str | None = None
    for r in rows:
        prov = decode_provenance(r.get("source_section", "")) or {}
        dim = _norm(prov.get("dim"))
        if dim and f" {dim} " in q and (best is None or len(dim) > len(best)):
            best = dim
    return best


def evaluate(
    rows: list[dict],
    *,
    query: str,
    ticker: str,
    cik: int | None,
    concept: str,
    fiscal_year: int | None,
    fiscal_quarter: int | None,
    max_age_days: int = DEFAULT_MAX_AGE_DAYS,
    company_terms=None,
    now: datetime | None = None,
) -> GateDecision:
    """
    Whether `rows` contain evidence that deterministically answers the question.

    `rows` is the candidate set from one targeted lookup — not fused results.
    Every check below must pass; the first failure routes to SEC and says why.
    """
    identity = {
        "ticker": (ticker or "").upper(),
        "cik": cik,
        "concept": concept,
        "fiscal_year": fiscal_year,
        "fiscal_quarter": fiscal_quarter,
    }
    if not rows:
        return GateDecision(LOCAL_MISS, reason="no local rows for this identity",
                            identity=identity)

    want_dim = wanted_dimension(query, rows)
    identity["dimension"] = want_dim
    now = now or datetime.now(timezone.utc)

    # Whether the question could be asking for a segment at all — decided from the
    # question, never from the rows on hand. Inferring it from storage would let a
    # consolidated row answer a segment question purely because the segment row is
    # missing, which is the failure this gate exists to prevent.
    breakdown_asked = names_a_breakdown(query, ticker, company_terms)

    # A metric is a FAMILY of tags, not one name. A filer reports whichever it
    # uses — NVIDIA and Wingstop both answer under `Revenues` while the primary
    # tag is `RevenueFromContract...`. Comparing against the single primary tag
    # meant the gate never matched the rows this channel actually wrote, so it
    # called SEC every time for exactly the filers the fallback exists for.
    from app.core.retrieval.edgar_search import concept_family

    accepted_concepts = {_norm(c) for c in concept_family(concept)}

    matches: list[dict] = []
    unverified = 0
    for r in rows:
        prov = decode_provenance(r.get("source_section", ""))
        if prov is None:
            # Legacy backfill or a table scrape — no provenance, no verification
            # state, no accession. Cannot be trusted to bypass the filer.
            unverified += 1
            continue
        if prov.get("ver") != "verified":
            unverified += 1
            continue
        # Every identity field the question pins must be on the row and equal.
        if (r.get("ticker") or "").upper() != identity["ticker"]:
            continue
        if cik is not None and str(prov.get("cik") or "") != str(cik):
            continue
        if _norm(prov.get("concept")) not in accepted_concepts:
            continue
        if fiscal_year is not None and str(prov.get("fy") or "") != str(fiscal_year):
            continue
        if str(prov.get("fq") or "") != str(fiscal_quarter or ""):
            continue
        if _norm(prov.get("dim")) != _norm(want_dim):
            continue
        if breakdown_asked and not _norm(prov.get("dim")):
            # A consolidated row cannot answer a question that names a breakdown.
            continue
        if not prov.get("start") or not prov.get("end"):
            continue
        if not prov.get("accn"):
            continue
        if not prov.get("unit") or _norm(prov.get("unit")) != _norm(r.get("unit")):
            continue
        if r.get("value_float") is None:
            continue
        matches.append({"row": r, "prov": prov})

    if not matches:
        if unverified:
            return GateDecision(
                LOCAL_UNVERIFIED,
                reason=f"{unverified} local row(s) lack provenance or a passing "
                       "verification state",
                identity=identity,
            )
        if breakdown_asked and want_dim is None:
            return GateDecision(
                LOCAL_MISS,
                reason="question names a breakdown no local row reports",
                identity=identity,
            )
        return GateDecision(LOCAL_MISS,
                            reason="no local row matches the full identity",
                            identity=identity)

    # Two rows claiming the same fact with different numbers is exactly the
    # restatement case. Never answer from either without asking the filer.
    values = {float(m["row"]["value_float"]) for m in matches}
    if len(values) > 1:
        return GateDecision(
            LOCAL_CONFLICT,
            reason=f"local rows disagree: {sorted(values)}",
            conflicts=[m["row"] for m in matches],
            identity=identity,
        )

    best = matches[0]
    created = best["row"].get("created_at") or ""
    try:
        age = now - datetime.fromisoformat(str(created).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return GateDecision(LOCAL_UNVERIFIED,
                            reason="local row has no usable timestamp",
                            identity=identity)
    if age > timedelta(days=max_age_days):
        return GateDecision(
            LOCAL_CONFLICT,
            reason=f"local row is {age.days}d old (max {max_age_days}d) — "
                   "re-validating against the filer in case of restatement",
            identity=identity,
        )

    logger.info(
        "evidence_gate_hit",
        ticker=identity["ticker"], concept=concept,
        fy=fiscal_year, fq=fiscal_quarter, dim=want_dim,
        accn=best["prov"].get("accn"), age_days=age.days,
    )
    return GateDecision(VERIFIED_LOCAL_HIT, row=best["row"],
                        reason="exact verified local evidence", identity=identity)


async def check(
    *,
    query: str,
    ticker: str,
    cik: int | None,
    concept: str,
    fiscal_year: int | None,
    fiscal_quarter: int | None,
    max_age_days: int = DEFAULT_MAX_AGE_DAYS,
    company_terms=None,
    selector=None,
) -> GateDecision:
    """
    Run the gate against `financials`.

    One narrow lookup keyed on ticker and period — cheap, and deliberately
    separate from the retrieval fan-out so the SEC decision is made before any
    expensive authoritative-source work, not after it.
    """
    from app.db import supabase_rest

    if not ticker:
        return GateDecision(LOCAL_MISS, reason="no issuer resolved")
    if selector is None:
        if not supabase_rest.configured():
            return GateDecision(LOCAL_MISS, reason="no local store configured")
        selector = supabase_rest.sb_select

    period = f"FY{fiscal_year}" + (f"Q{fiscal_quarter}" if fiscal_quarter else "")
    flt = {"ticker": f"eq.{ticker.upper()}", "id": "like.*_xbrl"}
    if fiscal_year:
        flt["period"] = f"eq.{period}"
    try:
        rows = await selector("financials", flt, limit=50)
    except Exception as e:
        logger.warning("evidence_gate_lookup_failed", error=str(e)[:160])
        return GateDecision(LOCAL_MISS, reason="local lookup failed")

    return evaluate(
        rows, query=query, ticker=ticker, cik=cik, concept=concept,
        fiscal_year=fiscal_year, fiscal_quarter=fiscal_quarter,
        max_age_days=max_age_days, company_terms=company_terms,
    )
