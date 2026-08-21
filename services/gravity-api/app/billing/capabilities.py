"""
The matrix, as data (docs/PLANS_WORLD_CLASS_ROADMAP.md §4).

The plan config could only say `features: list[str]` — three independent bullet
lists sitting side by side, with no row that exists in every column and therefore
nothing to compare or grey out (§1a). A TradingView-shaped table is not a restyle of
that; it is a different data shape, and this is it.

Every capability declares four things, and two of them are what make this file more
than a nicer constant:

  * **`source`** — the file that implements it. `R6` checks the path resolves, which
    is §3 rule 6 made mechanical: a row nobody can point at gets deleted rather than
    sold. §2's inventory proved these files exist; `PL-12` still has to prove they run.
  * **`enforcement`** — `server` or `client`. A limit the browser owns is not a
    paywall, it is a suggestion. Watchlist size lives in `localStorage` under
    `hub_watchlist_<market>`, so a user changes it with devtools and no server round
    trip happens at all. Marking that honestly here stops the pricing table implying
    a ceiling that does not exist, and gives PL-6/PL-7 the list of rows that need
    moving server-side before they can be charged for.

Values are `int`, `bool`, `UNLIMITED`, or a short string for the rows that are
genuinely categorical ("7 days", "headlines"). Every capability must define all four
sold tiers — `R7` fails the build on a hole.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Union

# `source` paths are repo-relative because that is what a reader and the probe both
# want to see. Resolving them against cwd would make them true only when something
# happens to run from the repo root — the API runs from services/gravity-api. Anchor
# to this file's location instead: app/billing/capabilities.py -> four parents up.
REPO_ROOT = Path(__file__).resolve().parents[4]

UNLIMITED = "unlimited"

CapValue = Union[int, bool, str]

RESEARCH = "research"
TERMINAL = "terminal"

SERVER = "server"
CLIENT = "client"


@dataclass(frozen=True)
class Capability:
    key: str
    label: str            # must match the §4 row label
    group: str            # RESEARCH | TERMINAL
    source: str           # repo-relative path to the implementation — R6 resolves it
    enforcement: str      # SERVER | CLIENT
    free: CapValue
    analyst: CapValue
    professional: CapValue
    institutional: CapValue

    def source_path(self) -> Path:
        """Absolute path to the implementing file, independent of cwd."""
        return REPO_ROOT / self.source

    def source_exists(self) -> bool:
        return self.source_path().exists()

    def for_tier(self, tier_id: str) -> CapValue:
        # `unlimited` (dev bypass + internal service keys, tiers.py) has no column
        # of its own; it reads the top sold tier so it is never more restricted.
        if tier_id == "unlimited":
            tier_id = "institutional"
        try:
            return getattr(self, tier_id)
        except AttributeError as e:
            raise KeyError(f"capability {self.key!r} has no value for tier {tier_id!r}") from e


_C = Capability

CAPABILITIES: tuple[Capability, ...] = (
    # ── Research — the /search surface ───────────────────────────────────────
    _C("qa_searches_per_day", "QA searches / day", RESEARCH,
       "services/gravity-api/app/api/routes/search.py", SERVER,
       10, 500, 2_000, UNLIMITED),
    # `company_profiles` was struck by PL-12's sweep. It read ✓ in all four columns,
    # so it differentiated nothing, and no test referenced it — the only server row
    # in that state. A row identical across every tier is marketing copy, not a
    # pricing row, and §3 rule 6 says sell only what can be demonstrated.
    _C("requests_per_minute", "requests / minute", RESEARCH,
       "services/gravity-api/app/api/middleware/rate_limit.py", SERVER,
       10, 60, 120, 600),
    _C("grid_runs_per_day", "Research Grid runs / day", RESEARCH,
       "services/gravity-api/app/api/routes/grid_search.py", SERVER,
       2, 50, 250, UNLIMITED),
    # Moved CLIENT -> SERVER: the question list arrives in the request body, so the
    # ceiling is checked where the work is paid for rather than trusted from the UI.
    # A size ceiling, not a quota — see enforce_size().
    _C("grid_columns_per_run", "Grid columns per run", RESEARCH,
       "services/gravity-api/app/api/routes/grid_search.py", SERVER,
       5, 20, 50, UNLIMITED),
    _C("scheduled_grids", "Scheduled grids", RESEARCH,
       "services/gravity-api/app/api/routes/grid_schedule.py", SERVER,
       False, 3, 25, UNLIMITED),
    _C("deep_research_per_day", "Deep Research runs / day", RESEARCH,
       "apps/market-ui/src/services/deepResearchService.ts", CLIENT,
       False, 10, 50, 250),
    _C("document_uploads_per_month", "Document uploads / mo", RESEARCH,
       "services/gravity-api/app/api/routes/documents.py", SERVER,
       5, 200, 2_000, UNLIMITED),
    _C("history_retention", "History retention", RESEARCH,
       "apps/market-ui/src/pages/HistoryPage.tsx", SERVER,
       "7 days", "1 year", UNLIMITED, UNLIMITED),
    _C("report_export", "Report export (memo / PDF)", RESEARCH,
       "apps/market-ui/src/pages/ReportViewerPage.tsx", CLIENT,
       False, True, True, True),
    _C("api_keys", "API keys", RESEARCH,
       "apps/market-ui/src/services/apiKeys.ts", SERVER,
       False, 1, 5, 25),
    _C("audit_log", "Audit log", RESEARCH,
       "apps/market-ui/src/services/auditClient.ts", SERVER,
       False, False, True, True),
    _C("sso_saml", "SSO (SAML)", RESEARCH,
       "services/gravity-api/app/api/routes/sso.py", SERVER,
       False, False, False, True),

    # ── Terminal — the /trading surface ──────────────────────────────────────
    _C("markets", "Markets", TERMINAL,
       "apps/market-ui/src/lib/markets.ts", CLIENT,
       "1 (crypto)", "all 6", "all 6", "all 6"),
    # localStorage-backed (`hub_watchlist_<market>`), so this ceiling is advisory
    # until the list moves server-side. Flagged, not quietly sold as enforced.
    _C("watchlist_symbols", "Watchlist symbols", TERMINAL,
       "apps/market-ui/src/components/trading/MarketList.tsx", CLIENT,
       10, 100, 500, UNLIMITED),
    _C("chart_indicators", "Chart indicators", TERMINAL,
       "apps/market-ui/src/components/trading/Chart.tsx", CLIENT,
       3, 10, 25, 50),
    _C("screener_columns", "Screener columns", TERMINAL,
       "apps/market-ui/src/components/trading/MarketList.tsx", CLIENT,
       8, 30, UNLIMITED, UNLIMITED),
    _C("order_book", "Order book / depth", TERMINAL,
       "apps/market-ui/src/components/trading/OrderBook.tsx", CLIENT,
       False, True, True, True),
    _C("news_terminal", "News terminal", TERMINAL,
       "apps/market-ui/src/components/trading/tabs/NewsTab.tsx", CLIENT,
       "headlines", "full", "full", "full"),
    _C("portfolio", "Portfolio tracking", TERMINAL,
       "apps/market-ui/src/components/trading/PortfolioPanel.tsx", CLIENT,
       False, True, True, True),
    _C("comparator", "Comparator", TERMINAL,
       "apps/market-ui/src/components/trading/TnComparator.tsx", CLIENT,
       False, True, True, True),
    _C("hermes_asks_per_day", "Ask Hermes / day", TERMINAL,
       "services/gravity-api/app/api/routes/trading.py", SERVER,
       5, 100, 500, UNLIMITED),
    _C("dexter_runs_per_day", "Dexter agent runs / day", TERMINAL,
       "apps/market-ui/src/services/dexterGraph.ts", CLIENT,
       False, 10, 100, UNLIMITED),
    _C("dexter_debate", "Dexter debate + risk trio", TERMINAL,
       "apps/market-ui/src/services/dexterDebate.ts", CLIENT,
       False, False, True, True),
    _C("dexter_journal", "Decision journal + replay", TERMINAL,
       "apps/market-ui/src/services/dexterJournal.ts", CLIENT,
       False, False, True, True),
)

BY_KEY: dict[str, Capability] = {c.key: c for c in CAPABILITIES}

SOLD_TIER_IDS = ("free", "analyst", "professional", "institutional")


def capability(key: str) -> Capability:
    """Look up a capability, refusing unknown keys rather than defaulting."""
    try:
        return BY_KEY[key]
    except KeyError as e:
        raise KeyError(f"unknown capability {key!r}; known: {sorted(BY_KEY)}") from e


def value_for(key: str, tier_id: str) -> CapValue:
    """What `tier_id` is entitled to for `key`."""
    return capability(key).for_tier(tier_id)


def allows(key: str, tier_id: str) -> bool:
    """Whether the tier has this capability at all (a 0 or False limit means no)."""
    v = value_for(key, tier_id)
    if isinstance(v, bool):
        return v
    if isinstance(v, int):
        return v > 0
    return bool(v)


def limit_for(key: str, tier_id: str) -> int | None:
    """
    Numeric ceiling for a countable capability. None means unlimited.

    Raises for capabilities that are not countable — a caller asking for the numeric
    limit of a categorical row has a bug, and silently returning None would hand it
    an unlimited quota.
    """
    v = value_for(key, tier_id)
    if v == UNLIMITED:
        return None
    if isinstance(v, bool):
        raise TypeError(f"capability {key!r} is a flag, not a quota")
    if isinstance(v, int):
        return v
    raise TypeError(f"capability {key!r} is categorical ({v!r}), not a quota")


def matrix() -> dict[str, dict[str, CapValue]]:
    """The whole table as `{tier_id: {capability_key: value}}` for the API."""
    return {t: {c.key: c.for_tier(t) for c in CAPABILITIES} for t in SOLD_TIER_IDS}


def validate() -> list[str]:
    """
    Problems with the matrix, as a list of strings. Empty means healthy.

    Used by the admin PUT so a bad override is rejected at the boundary rather than
    discovered by a customer looking at a column with a hole in it.
    """
    problems: list[str] = []
    seen: set[str] = set()
    for c in CAPABILITIES:
        if c.key in seen:
            problems.append(f"duplicate capability key {c.key!r}")
        seen.add(c.key)
        if c.group not in (RESEARCH, TERMINAL):
            problems.append(f"{c.key}: unknown group {c.group!r}")
        if c.enforcement not in (SERVER, CLIENT):
            problems.append(f"{c.key}: unknown enforcement {c.enforcement!r}")
        for t in SOLD_TIER_IDS:
            if getattr(c, t, None) is None:
                problems.append(f"{c.key}: no value for tier {t!r}")
    return problems


def validate_override(payload: object) -> list[str]:
    """
    Problems with an admin-supplied capability override. Empty means acceptable.

    An admin may retune numbers; they may not invent a capability the code cannot
    enforce, and they may not leave a tier out. A column with a hole in it is
    discovered by a customer, so it is rejected at the boundary instead.
    """
    problems: list[str] = []
    if not isinstance(payload, dict):
        return [f"capabilities override must be an object, got {type(payload).__name__}"]
    for key, per_tier in payload.items():
        if key not in BY_KEY:
            problems.append(f"unknown capability {key!r}")
            continue
        if not isinstance(per_tier, dict):
            problems.append(f"{key}: expected an object of tier -> value")
            continue
        for tier in SOLD_TIER_IDS:
            if tier not in per_tier:
                problems.append(f"{key}: missing tier {tier!r}")
        for tier in per_tier:
            if tier not in SOLD_TIER_IDS:
                problems.append(f"{key}: unknown tier {tier!r}")
    return problems


def client_enforced() -> tuple[Capability, ...]:
    """The rows a determined user can currently help themselves to. Not a secret."""
    return tuple(c for c in CAPABILITIES if c.enforcement == CLIENT)
