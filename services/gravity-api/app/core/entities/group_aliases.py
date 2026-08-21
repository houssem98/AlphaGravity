"""
Deterministic company-group → ticker expansion.

"Compare FAANG operating margins" used to resolve to whatever the LLM classifier
happened to remember that request: sometimes five tickers, sometimes one,
sometimes none. Nothing in the codebase mapped a named group to its constituents
— entity extraction's only worked example is a single company — so a group query
was unengineered by construction, and the downstream comparison was built on
whichever subset came back.

This is a lookup table, not a taxonomy. Four groups, deliberately small and
trivial to extend: add a line to GROUPS and a name to _TICKER_NAMES. Membership
is the conventional public definition of each grouping, not an index we maintain
and not a claim about market cap on any particular date.
"""

import re

# Group key -> (matching patterns, constituent tickers in the group's usual order)
#
# FAANG is the original Facebook/Amazon/Apple/Netflix/Google acronym; the two
# renamed members resolve to their current tickers (META, GOOGL). The Magnificent
# Seven is the conventional 2023- grouping. "Mega-cap tech" has no fixed
# definition anywhere — treated here as the Magnificent Seven minus Tesla, which
# is the common usage when someone contrasts "big tech" with autos. Major banks
# is the US money-center/bulge-bracket six.
GROUPS: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "faang": (
        (r"faang",),
        ("META", "AMZN", "AAPL", "NFLX", "GOOGL"),
    ),
    "magnificent_seven": (
        (r"magnificent\s*(?:seven|7)", r"\bmag\s*7\b", r"\bmag7\b"),
        ("AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"),
    ),
    "megacap_tech": (
        (r"mega[\s-]?cap\s+tech(?:nology)?", r"\bbig\s+tech\b"),
        ("AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META"),
    ),
    "major_us_banks": (
        (r"major\s+(?:us\s+|u\.s\.\s+)?banks", r"\bbig\s+banks\b",
         r"large\s+(?:us\s+|u\.s\.\s+)?banks", r"money[\s-]?cent(?:er|re)\s+banks",
         r"bulge[\s-]?bracket"),
        ("JPM", "BAC", "WFC", "C", "GS", "MS"),
    ),
}

# Display names for the tickers the table can emit. Entity dicts elsewhere in the
# pipeline carry {"name": ..., "ticker": ...}; downstream readers use `name` for
# prose and `ticker` for retrieval, so both have to be present.
_TICKER_NAMES: dict[str, str] = {
    "AAPL": "Apple Inc.",
    "AMZN": "Amazon.com, Inc.",
    "BAC": "Bank of America Corporation",
    "C": "Citigroup Inc.",
    "GOOGL": "Alphabet Inc.",
    "GS": "The Goldman Sachs Group, Inc.",
    "JPM": "JPMorgan Chase & Co.",
    "META": "Meta Platforms, Inc.",
    "MS": "Morgan Stanley",
    "MSFT": "Microsoft Corporation",
    "NFLX": "Netflix, Inc.",
    "NVDA": "NVIDIA Corporation",
    "TSLA": "Tesla, Inc.",
    "WFC": "Wells Fargo & Company",
}

_COMPILED: list[tuple[str, re.Pattern[str]]] = [
    (key, re.compile(pattern, re.I))
    for key, (patterns, _tickers) in GROUPS.items()
    for pattern in patterns
]


def detect_groups(query: str) -> list[str]:
    """Group keys named in the query, in table order, deduplicated."""
    if not query:
        return []
    found: list[str] = []
    for key, rx in _COMPILED:
        if key not in found and rx.search(query):
            found.append(key)
    return found


def expand_groups(query: str) -> list[str]:
    """Constituent tickers for every group named in the query."""
    out: list[str] = []
    for key in detect_groups(query):
        for ticker in GROUPS[key][1]:
            if ticker not in out:
                out.append(ticker)
    return out


def ticker_name(ticker: str) -> str:
    return _TICKER_NAMES.get(ticker.upper(), ticker.upper())


def merge_group_companies(plan: dict, query: str) -> dict:
    """
    Merge group constituents into plan["entities"]["companies"], in place.

    MERGE, never replace: whatever the classifier extracted is authoritative and
    is kept first, including its resolved CIK and canonical name. A group only
    ADDS the members it names that are not already present. That ordering matters
    because "FAANG plus Microsoft" has to keep MSFT, and because a classifier that
    already resolved META to a CIK should not lose it to a bare table entry.

    Safe to call on the timeout-fallback plan too, where `companies` is empty:
    the group expansion is the only entity information available on that path, so
    a group query still reaches retrieval with its tickers instead of nothing.
    """
    tickers = expand_groups(query)
    if not tickers:
        return plan

    entities = plan.setdefault("entities", {})
    companies = entities.setdefault("companies", [])
    if not isinstance(companies, list):
        return plan

    seen = {
        str(c.get("ticker", "")).upper()
        for c in companies
        if isinstance(c, dict) and c.get("ticker")
    }
    for ticker in tickers:
        if ticker in seen:
            continue
        companies.append({
            "name": ticker_name(ticker),
            "ticker": ticker,
            "source": "group_alias",
        })
        seen.add(ticker)
    return plan
