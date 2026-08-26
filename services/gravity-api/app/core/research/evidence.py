"""
One evidence abstraction over all three source classes, and the claim map.

Spec section 12 asks for `EvidenceSource` with `SEC_EVIDENCE`, `LOCAL_EVIDENCE`
and `WEB_EVIDENCE`. Spec section 13 calls claim-to-evidence mapping "critical"
and specifically forbids the thing every RAG system does by default: attach a
list of citations to the end of an answer and call each of them supported.

The distinction matters because those two failure modes look identical in a
response body. An answer with six citations where every claim is grounded, and
an answer with six citations where two claims are grounded and four are the
model's own inference, both render as "six sources". The claim map is what makes
them different objects.

`freshness` lives here rather than in its own module because staleness is a
property of evidence, not of a fetch: a page fetched thirty seconds ago that was
published in 2019 is fresh by retrieval and stale by content, and a "latest
news" question must reject it on the second ground.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from app.core.research.source_quality import SourceRating, Tier, rate
from app.core.research.url_safety import canonicalize, dedup_key

# The three source classes, named exactly as the specification names them.
SEC_EVIDENCE = "SEC_EVIDENCE"
LOCAL_EVIDENCE = "LOCAL_EVIDENCE"
WEB_EVIDENCE = "WEB_EVIDENCE"

# How a claim relates to the evidence under it. Spec section 22 wants the final
# answer to distinguish these three, which requires the pipeline to be able to
# represent them before the model is asked to label them.
FACT = "FACT"            # stated by an authoritative source, quotable
CONTEXT = "CONTEXT"      # stated by a source, but supporting rather than reported
INFERENCE = "INFERENCE"  # the model's own reasoning over evidence

# A "latest / today / this week" question may not be answered from evidence
# older than this. Chosen against how fast the underlying thing moves: a market
# reaction is stale in hours, a filing is not stale in years, and the class of
# question is what selects the window.
FRESHNESS_WINDOWS: dict[str, timedelta] = {
    "MARKET_NEWS": timedelta(days=3),
    "MARKET_CONTEXT": timedelta(days=14),
    "COMPANY_RESEARCH": timedelta(days=120),
    "MACRO": timedelta(days=45),
    "GENERAL_WEB_RESEARCH": timedelta(days=365),
}
DEFAULT_FRESHNESS = timedelta(days=365)

_ISO = re.compile(r"(\d{4})-(\d{2})-(\d{2})")


def parse_date(value) -> datetime | None:
    """
    A publication date out of whatever shape the source gave us.

    Providers return ISO 8601, RFC 2822, GDELT's `YYYYMMDDTHHMMSSZ`, and bare
    dates. Returns `None` rather than guessing — an unknown publication date must
    stay unknown, because inventing one is how stale evidence gets presented as
    current.
    """
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value or "").strip()
    if not text:
        return None
    # GDELT: 20260826T143000Z
    m = re.fullmatch(r"(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?Z?", text)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return datetime(y, mo, d, int(m.group(4) or 0), int(m.group(5) or 0),
                            int(m.group(6) or 0), tzinfo=timezone.utc)
        except ValueError:
            return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        pass
    m = _ISO.search(text)
    if m:
        try:
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)),
                            tzinfo=timezone.utc)
        except ValueError:
            return None
    try:
        from email.utils import parsedate_to_datetime

        parsed = parsedate_to_datetime(text)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError, IndexError):
        return None


@dataclass
class Evidence:
    """
    One passage that can support a claim, whatever it came from.

    `kind` is the discriminator. `provenance` is the canonical dict from
    `citation_provenance` for SEC evidence and the web analogue for web
    evidence — the *same* module builds both, which is what stops this being a
    second citation architecture.
    """

    kind: str
    text: str
    title: str = ""
    url: str = ""
    domain: str = ""
    source_type: str = ""
    published_at: datetime | None = None
    retrieved_at: datetime | None = None
    location: str = ""
    relevance: float = 0.0
    rating: SourceRating | None = None
    provenance: dict = field(default_factory=dict)
    injection_flags: list[str] = field(default_factory=list)
    chunk_id: str = ""
    ticker: str = ""

    def __post_init__(self):
        if self.rating is None and (self.url or self.source_type):
            self.rating = rate(self.url, document_type=self.source_type,
                               title=self.title)
        if self.rating is not None and not self.domain:
            self.domain = self.rating.domain

    @property
    def tier(self) -> Tier:
        return self.rating.tier if self.rating else Tier.TIER_4

    @property
    def category(self) -> str:
        return self.rating.category if self.rating else "web"

    @property
    def dedup_identity(self) -> str:
        """What makes two evidence objects the same source."""
        if self.kind == SEC_EVIDENCE:
            # A filing is identified by its accession and the exact fact read
            # from it, never by URL — two facts from one filing are two pieces
            # of evidence that happen to share a document.
            p = self.provenance or {}
            return "|".join(str(p.get(k, "")) for k in
                            ("accession", "xbrl_concept", "fiscal_year",
                             "fiscal_quarter", "dimension_value"))
        if self.kind == WEB_EVIDENCE:
            # The *passage* is the unit, not the page — exactly as the accession
            # branch above keys on the fact rather than on the filing. Three
            # paragraphs answering three parts of the question are three pieces
            # of evidence that happen to share a document, and keying on the URL
            # alone collapsed them to one. Observed live: a press release
            # yielding five passages contributed one.
            #
            # Source *cards* still group by page — that is the UI's job, done in
            # `by_category()` and on the frontend — so this does not reintroduce
            # the redundant citation list §17 forbids.
            return f"{dedup_key(self.url, self.title)}#{self.location}"
        return self.chunk_id or dedup_key(self.url, self.title)

    def is_fresh_for(self, question_class: str, *,
                     now: datetime | None = None) -> tuple[bool, str]:
        """
        Whether this evidence is current enough for this kind of question.

        SEC evidence is exempt: a filed figure for a closed period does not go
        stale, and the restatement case is already handled by `evidence_gate`'s
        90-day re-validation. Applying a news window to a 10-K would reject the
        authoritative source in favour of a blog post about it.
        """
        if self.kind == SEC_EVIDENCE:
            return True, ""
        window = FRESHNESS_WINDOWS.get(question_class, DEFAULT_FRESHNESS)
        now = now or datetime.now(timezone.utc)
        if self.published_at is None:
            # Unknown date. Refused only where recency is the point of the
            # question — elsewhere an undated page is usable and simply says so.
            if question_class in ("MARKET_NEWS", "MARKET_CONTEXT"):
                return False, "publication date unknown; question asks for current information"
            return True, "publication date unknown"
        age = now - self.published_at
        if age > window:
            return False, (f"published {self.published_at.date()} "
                           f"({age.days}d ago, limit {window.days}d)")
        return True, ""

    def as_source_dict(self) -> dict:
        """The wire shape for a source card. Flat, and never invents a field."""
        out = {
            "evidence_kind": self.kind,
            "category": self.category,
            "tier": int(self.tier),
            "tier_label": self.tier.label,
            "title": self.title,
            "text": self.text,
            "url": self.url,
            "canonical_url": canonicalize(self.url) if self.url else "",
            "domain": self.domain,
            "source_type": self.source_type,
            "published_at": self.published_at.isoformat() if self.published_at else "",
            "retrieved_at": self.retrieved_at.isoformat() if self.retrieved_at else "",
            "evidence_location": self.location,
            "relevance": round(float(self.relevance or 0.0), 4),
            "ticker": self.ticker,
        }
        if self.injection_flags:
            out["injection_flags"] = list(self.injection_flags)
        if self.provenance:
            out["provenance"] = dict(self.provenance)
        return {k: v for k, v in out.items() if v not in ("", [], {}, None)}


@dataclass
class Claim:
    """
    One assertion in the answer, with the evidence that supports it.

    `kind` is FACT / CONTEXT / INFERENCE. An INFERENCE claim is allowed to have
    evidence — the evidence is what it reasons *over* — but it is never
    presented as reported, which is exactly the distinction spec section 22
    asks for.
    """

    text: str
    kind: str = FACT
    evidence: list[Evidence] = field(default_factory=list)
    note: str = ""

    @property
    def supported(self) -> bool:
        """A claim is supported when evidence stands behind it. An INFERENCE is
        never 'supported' in the reported sense, however much it reasons over."""
        return self.kind in (FACT, CONTEXT) and bool(self.evidence)

    def as_dict(self) -> dict:
        return {
            "claim": self.text,
            "kind": self.kind,
            "supported": self.supported,
            "evidence": [e.dedup_identity for e in self.evidence],
            "evidence_count": len(self.evidence),
            **({"note": self.note} if self.note else {}),
        }


@dataclass
class Disagreement:
    """
    Two sources reporting different values for one fact.

    Spec section 9 and section 14: never averaged, never hidden. The SEC value
    is named as authoritative and the other is preserved so the discrepancy can
    be investigated rather than disappearing into a mean.
    """

    subject: str
    authoritative: Evidence
    conflicting: Evidence
    authoritative_value: str
    conflicting_value: str

    def as_dict(self) -> dict:
        return {
            "subject": self.subject,
            "authoritative_source": self.authoritative.domain or "SEC filing",
            "authoritative_value": self.authoritative_value,
            "conflicting_source": self.conflicting.domain,
            "conflicting_value": self.conflicting_value,
            "resolution": "SEC filing figure stands; discrepancy preserved, not averaged",
        }


class EvidenceSet:
    """
    Everything gathered for one question, deduplicated, with the claim map.

    Deliberately not a bag of passages: the ordering rule (tier first),
    the dedup rule and the freshness rule all belong to the *collection* rather
    than to any one item, and putting them here is what stops each call site
    reinventing them slightly differently.
    """

    def __init__(self, question_class: str = "GENERAL"):
        self.question_class = question_class
        self._by_identity: dict[str, Evidence] = {}
        self.claims: list[Claim] = []
        self.disagreements: list[Disagreement] = []
        self.dropped_duplicates = 0
        self.dropped_stale: list[tuple[str, str]] = []

    def add(self, ev: Evidence, *, now: datetime | None = None) -> bool:
        """
        Take one piece of evidence, or say why not.

        Returns False for a duplicate or for evidence too stale for this
        question class. Both are counted, because "we found nothing" and "we
        found four copies of one stale article" are different answers.
        """
        fresh, why = ev.is_fresh_for(self.question_class, now=now)
        if not fresh:
            self.dropped_stale.append((ev.url or ev.title, why))
            return False

        key = ev.dedup_identity
        if not key:
            return False
        existing = self._by_identity.get(key)
        if existing is not None:
            self.dropped_duplicates += 1
            # Keep whichever is the better source, then the more relevant.
            if (int(ev.tier), -ev.relevance) < (int(existing.tier), -existing.relevance):
                self._by_identity[key] = ev
            return False
        self._by_identity[key] = ev
        return True

    @property
    def evidence(self) -> list[Evidence]:
        """Best source first: tier, then relevance, then authority score."""
        from app.core.research.source_quality import rank_key

        return sorted(
            self._by_identity.values(),
            key=lambda e: rank_key(e.rating, e.relevance) if e.rating
            else (int(Tier.TIER_4), -e.relevance, 0),
        )

    def of_kind(self, kind: str) -> list[Evidence]:
        return [e for e in self.evidence if e.kind == kind]

    def by_category(self) -> dict[str, list[Evidence]]:
        """Grouped for the UI's four source sections, in display order."""
        from app.core.research.source_quality import COMPANY, NEWS, SEC_FILINGS, WEB

        buckets: dict[str, list[Evidence]] = {
            SEC_FILINGS: [], COMPANY: [], NEWS: [], WEB: []
        }
        for e in self.evidence:
            buckets.setdefault(e.category, []).append(e)
        return {k: v for k, v in buckets.items() if v}

    def add_claim(self, claim: Claim) -> Claim:
        self.claims.append(claim)
        return claim

    def note_disagreement(self, d: Disagreement) -> None:
        self.disagreements.append(d)

    def summary(self) -> dict:
        """
        The research status block spec section 25 asks to be shown to the user.

        Counts what happened rather than what was configured, so a run where the
        provider was down reports zero pages and says so, instead of reporting
        the budget it was allowed to spend.
        """
        by_kind: dict[str, int] = {}
        for e in self.evidence:
            by_kind[e.kind] = by_kind.get(e.kind, 0) + 1
        supported = sum(1 for c in self.claims if c.supported)
        inferred = sum(1 for c in self.claims if c.kind == INFERENCE)
        return {
            "evidence_total": len(self._by_identity),
            "evidence_by_kind": by_kind,
            "evidence_by_category": {k: len(v) for k, v in self.by_category().items()},
            "claims_total": len(self.claims),
            "claims_supported": supported,
            "claims_inferred": inferred,
            "claims_unsupported": len(self.claims) - supported - inferred,
            "duplicates_dropped": self.dropped_duplicates,
            "stale_dropped": len(self.dropped_stale),
            "disagreements": [d.as_dict() for d in self.disagreements],
        }


# ── Cross-source verification ────────────────────────────────────────────

_NUMBER = re.compile(
    r"(?<![\w.])(\$?\s?-?\d[\d,]*(?:\.\d+)?)\s*"
    r"(billion|bn|million|mm|m\b|thousand|k\b|trillion|t\b|%)?",
    re.I,
)

# SEC form names contain digits and are not quantities. Without this, the text
#   "[EXACT FILING FIGURE] EOG revenue for FY2025 (10-K): $22,632,000,000"
# yields 10 as its first number — the "10" of "10-K" — and every comparison
# against it is nonsense. Observed against the live filing: four fabricated
# "disagreements" between a filing and press coverage that in fact agreed.
_FORM_NUMBER = re.compile(r"\b(?:10|20|40|8|6|13|14)\s*[-–]\s*[A-Z]", re.I)

_SCALE = {
    "trillion": 1e12, "t": 1e12,
    "billion": 1e9, "bn": 1e9,
    "million": 1e6, "mm": 1e6, "m": 1e6,
    "thousand": 1e3, "k": 1e3,
}


def extract_values(text: str, limit: int = 24) -> list[float]:
    """
    The numeric magnitudes stated in a passage, scale-normalised.

    Used to compare what two sources say about the same subject. Not a parser
    for a specific metric — it deliberately over-collects, because the
    comparison below only ever asks "does the authoritative number appear
    anywhere in what the other source said", and a false *match* there is safe
    while a false miss would raise a disagreement that is not one.
    """
    body = str(text or "")
    # Blank out form names first, so their digits cannot be read as quantities.
    body = _FORM_NUMBER.sub(lambda m: " " * len(m.group(0)), body)
    out: list[float] = []
    for m in _NUMBER.finditer(body):
        raw = m.group(1).replace("$", "").replace(",", "").strip()
        try:
            value = float(raw)
        except ValueError:
            continue
        unit = (m.group(2) or "").lower().strip()
        if unit == "%":
            out.append(value)
        else:
            out.append(value * _SCALE.get(unit, 1.0))
        if len(out) >= limit:
            break
    return out


def values_agree(a: float, b: float, *, tolerance: float = 0.01) -> bool:
    """
    Whether two reported magnitudes are the same figure.

    A 1% band, because a filing says 130,497 and an article says "$130.5
    billion" and those are the same number reported to different precision.
    Wider than that starts merging genuinely different figures.
    """
    if a == 0 or b == 0:
        return a == b
    return abs(a - b) / max(abs(a), abs(b)) <= tolerance


# The words a passage uses when it is talking about a given XBRL concept. Only
# the concepts a third-party article realistically restates — nobody writes a
# news story about `IncreaseDecreaseInAccountsPayable`.
_CONCEPT_WORDS: dict[str, tuple[str, ...]] = {
    "revenue": ("revenue", "revenues", "sales", "top line"),
    "netincome": ("net income", "net earnings", "profit", "net loss"),
    "operatingincome": ("operating income", "operating profit", "operating earnings"),
    "grossprofit": ("gross profit", "gross margin"),
    "assets": ("total assets", "assets"),
    "liabilities": ("total liabilities", "liabilities"),
    "cashflow": ("cash flow", "operating cash flow", "free cash flow"),
    "eps": ("per share", "eps", "earnings per share"),
}


def _mentions_subject(text: str, subject: str, authoritative: Evidence) -> bool:
    """
    Whether this passage is talking about the same line item as the
    authoritative fact.

    Falls back to True when the concept cannot be identified: an unrecognised
    concept should not silently disable conflict detection, only an
    unambiguously different one should.
    """
    body = (text or "").lower()
    concept = str((authoritative.provenance or {}).get("xbrl_concept") or subject or "")
    key = re.sub(r"[^a-z]", "", concept.lower())
    for canonical, words in _CONCEPT_WORDS.items():
        if canonical in key:
            return any(w in body for w in words)
    # Unrecognised concept: fall back to the subject label if it is a real word.
    token = re.sub(r"[^a-z ]", " ", (subject or "").lower()).strip()
    return token in body if len(token) > 3 else True


def cross_check(
    authoritative: Evidence,
    others: list[Evidence],
    *,
    subject: str = "",
) -> tuple[list[Evidence], list[Disagreement]]:
    """
    Compare an authoritative figure against what other sources say about it.

    Returns the sources that *corroborate* (raising confidence, spec section 14)
    and the disagreements (preserved, never averaged, spec section 9).

    A source that mentions neither the same number nor a conflicting one is in
    neither list: most articles about a company do not restate its exact revenue,
    and treating silence as disagreement would flag everything.
    """
    # The authoritative magnitude, taken from provenance when it is there. The
    # SEC resolver already parsed the exact value out of XBRL; re-deriving it by
    # scanning prose is strictly worse, and was wrong in practice — a form name
    # in the passage supplied the "first number" instead of the figure.
    primary = None
    prov_value = (authoritative.provenance or {}).get("value")
    if prov_value is not None:
        try:
            primary = float(str(prov_value).replace(",", "").replace("$", ""))
        except (TypeError, ValueError):
            primary = None
    if primary is None:
        target = extract_values(authoritative.text)
        if not target:
            return [], []
        # The largest magnitude, not the first: a passage states its headline
        # figure alongside per-share amounts and percentages, and position in the
        # sentence does not rank them.
        primary = max(target, key=abs)
    if not primary:
        return [], []

    corroborating: list[Evidence] = []
    conflicts: list[Disagreement] = []
    for other in others:
        if other.kind == SEC_EVIDENCE:
            continue
        values = extract_values(other.text)
        if not values:
            continue
        # Same order of magnitude only — an article mentioning a $5M lawsuit
        # alongside $130B of revenue is not disagreeing about revenue.
        comparable = [
            v for v in values
            if v != 0 and 0.1 <= abs(v) / abs(primary) <= 10.0
        ] if primary else []
        if not comparable:
            continue
        # ...and it must be talking about the same thing. Magnitude alone is not
        # enough: a press release states operating cash flow, capex and total
        # revenue within one order of magnitude of each other, and comparing the
        # filing's revenue against whichever happened to be nearest produced
        # three confident "disagreements" between sources that agreed. Observed
        # live against EOG's Q4 release.
        #
        # A source that does not name the metric is treated as silent about it,
        # which is the conservative direction: no corroboration claimed, no
        # conflict raised.
        if not _mentions_subject(other.text, subject, authoritative):
            continue
        if any(values_agree(primary, v) for v in comparable):
            corroborating.append(other)
        else:
            closest = min(comparable, key=lambda v: abs(v - primary))
            conflicts.append(Disagreement(
                subject=subject or (authoritative.provenance or {}).get(
                    "xbrl_concept", "reported figure"),
                authoritative=authoritative,
                conflicting=other,
                authoritative_value=f"{primary:,.0f}",
                conflicting_value=f"{closest:,.0f}",
            ))
    return corroborating, conflicts
