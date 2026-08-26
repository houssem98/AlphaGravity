"""
Which sources outrank which, and what a source is allowed to be used for.

`fusion._DOMAIN_QUALITY` already scores ~100 domains 1-10 with the ordering the
specification asks for. This module does not duplicate that table — it reads it.
What it adds is the two things a score alone cannot express:

**Named tiers.** Spec section 8 asks the ranking system to reason in TIER_1..4,
not in integers. A tier is also the right granularity for a UI label and for a
policy rule; "score 7 vs score 6" is not a distinction anyone should have to
defend.

**The financial source policy.** Spec section 9: for a *reported company
financial number*, SEC and official company releases outrank generic web,
full stop — and a disagreement between them is preserved, never averaged. That
is a rule about permitted use, not about ranking. A CNBC article reporting
NVIDIA's revenue is a perfectly good TIER_2 source for context and an
inadmissible source for the figure itself, and no amount of relevance changes
that.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum

from app.core.research.url_safety import registrable_domain


class Tier(IntEnum):
    """Source authority, ordered so that lower is better and comparison works."""

    TIER_1 = 1  # SEC, government, regulators, issuer IR, official releases
    TIER_2 = 2  # major financial publications, established research
    TIER_3 = 3  # secondary sites, aggregators, blogs
    TIER_4 = 4  # unknown / low quality

    @property
    def label(self) -> str:
        return {
            Tier.TIER_1: "Primary / official",
            Tier.TIER_2: "Established press",
            Tier.TIER_3: "Secondary",
            Tier.TIER_4: "Unknown",
        }[self]


# The four source categories the UI groups by (spec section 23). Distinct from
# tier: `COMPANY` and `WEB` can share a tier, and the user is grouping by "what
# kind of thing is this", not by "how much do we trust it".
SEC_FILINGS = "sec_filings"
COMPANY = "company"
WEB = "web"
NEWS = "news"

# Hosts that serve filings. Deliberately the same set the citation layer trusts
# for links; a divergence between "we would link to it" and "we would call it
# SEC" is a bug waiting to be found in production.
_SEC_HOSTS = frozenset({"sec.gov", "data.sec.gov", "efts.sec.gov"})

# First-party issuer communications. The `ir.`/`investor.` prefixes are already
# scored 9 by the fusion table; these are the wire services that distribute an
# issuer's own release verbatim, which is first-party content on a third-party
# host.
_ISSUER_WIRES = frozenset({
    "businesswire.com", "prnewswire.com", "globenewswire.com",
    "accesswire.com", "prweb.com",
})

_ISSUER_PREFIXES = ("ir.", "investor.", "investors.", "newsroom.", "press.")

# Domains whose content is news even when the domain scores well.
_NEWS_DOMAINS = frozenset({
    "reuters.com", "bloomberg.com", "wsj.com", "ft.com", "cnbc.com",
    "marketwatch.com", "barrons.com", "forbes.com", "fortune.com",
    "businessinsider.com", "axios.com", "apnews.com", "nytimes.com",
    "theinformation.com", "economist.com", "seekingalpha.com",
    "benzinga.com", "investing.com", "yahoo.com", "finance.yahoo.com",
})


def _score(url: str, document_type: str = "", title: str = "") -> int:
    """The existing authority score, resolved through the existing table."""
    from app.core.retrieval.fusion import get_source_quality

    return get_source_quality(
        document_type=document_type, document_title=title, source_url=url
    )


def _is_recognised(url: str, document_type: str, title: str) -> bool:
    """
    Whether anything actually recognised this source, or the score is the
    default.

    `get_source_quality()` returns 5 for a source it knows nothing about — the
    same 5 it would give a mid-tier outlet. Mapping that straight to a tier
    would file every unknown domain as TIER_3 "secondary", when spec section 8
    reserves TIER_4 for exactly the unknown case. The distinction is not
    cosmetic: `rank_key` sorts on tier first, so an unrecognised domain would
    outrank nothing and be outranked by nothing.
    """
    from app.core.retrieval.fusion import _DOMAIN_QUALITY, _SOURCE_QUALITY

    dt = (document_type or "").lower()
    if dt and any(k.lower() in dt for k in _SOURCE_QUALITY):
        return True
    u = (url or "").lower()
    if u and any(d in u for d in _DOMAIN_QUALITY):
        return True
    t = (title or "").lower()
    return bool(t) and any(k.lower() in t for k in _SOURCE_QUALITY)


def tier_for(url: str, *, document_type: str = "", title: str = "") -> Tier:
    """
    The tier of a source, derived from the score the fusion table already gives.

    The thresholds are the natural joints in that table: 9-10 is regulators and
    first-party issuer material, 6-8 is audited press and sell-side, 3-5 is
    secondary and aggregated, 1-2 is social. A source nothing recognised is
    TIER_4 regardless of the default score it was handed.
    """
    if not _is_recognised(url, document_type, title):
        return Tier.TIER_4
    s = _score(url, document_type, title)
    if s >= 9:
        return Tier.TIER_1
    if s >= 6:
        return Tier.TIER_2
    if s >= 3:
        return Tier.TIER_3
    return Tier.TIER_4


def category_for(url: str, *, document_type: str = "", title: str = "") -> str:
    """
    Which of the four UI buckets this source belongs in.

    Order matters: a filing served from sec.gov is SEC even if its title looks
    like news, and an issuer press release on businesswire is COMPANY even
    though businesswire is a wire service, because the author is the issuer.
    """
    dt = (document_type or "").lower()
    domain = registrable_domain(url)

    if domain in _SEC_HOSTS or domain.endswith(".sec.gov"):
        return SEC_FILINGS
    # A filing form name is decisive even without a URL — this is how a passage
    # from the local corpus, which has a document_type and often no URL, gets
    # categorised correctly.
    if dt in {"10-k", "10-q", "8-k", "def 14a", "s-1", "424b4", "20-f", "40-f",
              "6-k", "13f-hr", "sc 13d", "sc 13g", "4", "3", "5"}:
        return SEC_FILINGS

    if domain in _ISSUER_WIRES or any(
        domain.startswith(p) for p in _ISSUER_PREFIXES
    ):
        return COMPANY
    if dt in {"press_release", "earnings_transcript", "earnings transcript",
              "investor_presentation", "8-k_exhibit"}:
        return COMPANY

    if dt.startswith("news") or domain in _NEWS_DOMAINS:
        return NEWS

    return WEB


@dataclass(frozen=True)
class SourceRating:
    """Everything ranking, policy and the UI need about one source's origin."""

    url: str
    domain: str
    tier: Tier
    category: str
    score: int

    @property
    def is_authoritative_for_financials(self) -> bool:
        """
        Whether this source may supply a company's own reported figure.

        SEC filings and first-party issuer material only. A TIER_2 newspaper
        reporting the same number accurately is still not the filing, and the
        moment it is allowed to supply the figure there is no longer any way to
        tell which one the answer used.
        """
        return self.category in (SEC_FILINGS, COMPANY) and self.tier is Tier.TIER_1


def rate(url: str, *, document_type: str = "", title: str = "") -> SourceRating:
    """One source's origin, resolved once and carried on the evidence object."""
    return SourceRating(
        url=url or "",
        domain=registrable_domain(url),
        tier=tier_for(url, document_type=document_type, title=title),
        category=category_for(url, document_type=document_type, title=title),
        score=_score(url, document_type, title),
    )


def rank_key(rating: SourceRating, relevance: float = 0.0) -> tuple:
    """
    The sort key for candidate sources: tier first, then relevance, then score.

    Tier dominating relevance is the whole point of spec section 8 — a highly
    relevant blog post must not outrank a slightly less on-topic SEC filing.
    Negated where larger is better so a plain ascending sort gives best-first.
    """
    return (int(rating.tier), -float(relevance or 0.0), -rating.score)


def admissible_for_financial_fact(rating: SourceRating) -> tuple[bool, str]:
    """
    Whether this source may be cited for a reported financial figure, and why
    not when it may not.

    Returns the reason so the pipeline can log it and the answer can say
    "reported by CNBC but not confirmed against the filing" rather than silently
    dropping a source the user can see in the list.
    """
    if rating.is_authoritative_for_financials:
        return True, ""
    return False, (
        f"{rating.domain or 'source'} is {rating.tier.label.lower()} "
        f"({rating.category}); reported financial figures come from SEC filings"
    )
