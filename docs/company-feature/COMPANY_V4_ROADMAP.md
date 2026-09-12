# Company Intelligence V4 — What V3 Left Open

Branch: `feat/web-research-sec-integration`, at `7419ccb` when this audit ran.
Follows V3 (10 rows, closed), V2 (8, closed), CF (23, closed).

V3's own report claimed 7.5/10 and named its unproven edges. This pass went back at
those edges with a brief to assume nothing closed. **Four of V3's ten rows turn out
to be partially closed**, and two entirely new defects were found one route over
from where V3 was looking.

Every finding below carries its evidence class. Nothing here is inferred from a
document; each was executed or read at source on this branch.

## Findings

| # | Sev | Finding | Evidence |
|---|-----|---------|----------|
| V4-1 | **P0** | Period identity is basis-blind. `_same_period` accepts a TTM figure for a fiscal year, an instant for an annual duration, and one date for a different date. | **VERIFIED** — executed |
| V4-2 | **P0** | Three unauthenticated paid-provider routes, plus a fourth. V3-8 hardened `/api/llm/health` and left `/api/firecrawl/*` and a Tavily call in `trading.ts` open. | **VERIFIED** — read at source |
| V4-3 | **P0** | A disputed figure renders as canonical. V3-3 marks `ambiguous` server-side; `DataTab` never reads it, and the client type does not declare it. | **VERIFIED** — read at source |
| V4-4 | **P0** | Devil's Advocate treats any citation as a verified filing passage. It checks neither `source_class` nor `verification_status`; the client type does not carry `source_class` at all. | **VERIFIED** — read at source |
| V4-5 | P1 | `Citation` and `SourcePassage` each declare a field twice; Pydantic silently keeps the last, so SEC semantics are overwritten by web semantics. | **VERIFIED** — AST scan |
| V4-6 | P1 | `DataTab` formats money by `m.unit === 'USD'` instead of the unified `formatFinancialValue`, so `"USD M"` and every other currency spelling misses currency formatting. | **VERIFIED** — read at source |
| — | — | **V3-10 is correct.** `market-server` deploys to Fly (`fly.toml`, `app = "market-server-prod"`, one edge proxy), so the `TRUST_PROXY_HOPS=1` default matches the real topology. | **VERIFIED** — config read |

---

### V4-1 · Period identity is basis-blind — P0

**File/symbol:** `services/gravity-api/app/core/analytics/longitudinal_tracker.py`
· `_period_key`, `_same_period`

**Root cause.** V3-4 replaced substring containment with equality on `(year,
quarter)`. That closed the `FY2024` ⊂ `FY2024 Q4` hole and left every other one
open, because a year plus an optional quarter cannot express what kind of period a
label names. Executed on this branch:

```
_period_key('FY2024')            -> (2024, None)
_period_key('TTM 2024')          -> (2024, None)
_period_key('2024-09-28')        -> (2024, None)
_period_key('2024-12-31')        -> (2024, None)
_period_key('FY2024 (53 weeks)') -> (2024, None)

_same_period('FY2024',     'TTM 2024')   -> True
_same_period('FY2024',     '2024-09-28') -> True
_same_period('2024-09-28', '2024-12-31') -> True
```

A trailing-twelve-months figure is accepted for a fiscal year. A balance-sheet
instant is accepted for an annual duration. **Two different dates match each
other** — the worst of the three, because it is not even a basis confusion, it is
a plain wrong answer.

The client already models this correctly: `apps/market-ui/src/lib/periods.ts`
carries a `PeriodBasis` of `annual | quarterly | ttm | date | unknown` and refuses
cross-basis comparison. The server does not, so the two halves of the product
disagree about what a period is.

**Required.** A structured period on the server: basis, fiscal year, quarter, and
the explicit date for an instant. Two periods are the same period only when the
basis matches and the basis-specific parts match. An unparseable label matches
nothing. Duration-vs-instant must be representable.

**Acceptance (binary).** Every pair above answers `False` except `FY2024`/`2024`.
`2024-09-28` matches only `2024-09-28`. A 53-week label is not silently equal to a
52-week one.

**Gate:** `docs/company-feature/gates/v4-1-gate.py` — behavioural, offline.

---

### V4-2 · Unauthenticated paid-provider routes — P0

**Files:** `services/market-server/src/routes/firecrawl.ts` (whole file),
`services/market-server/src/routes/trading.ts:252`,
`services/market-server/src/index.ts:139-150`

**Root cause.** V3-8 asked "can an anonymous caller make this server spend?" and
answered it for `/api/llm/health` only. The same question was never asked of the
routers next to it. Measured:

- `firecrawl.ts` contains **zero** occurrences of `authMiddleware`. It exposes
  `POST /scrape`, `POST /search` and `POST /crawl`, each reading
  `FIRECRAWL_API_KEY` from the server environment. `/crawl` takes a caller-supplied
  `url`, `limit` and `maxDepth` — the most expensive Firecrawl operation, unbounded,
  and pointed wherever the caller says.
- `trading.ts` contains **zero** occurrences of `authMiddleware` and calls
  `https://api.tavily.com/search` at line 252 on the server's key.
- `index.ts` installs **no** global auth middleware; `app.use` mounts only `cors`
  and `express.json` before the routers.

By contrast `tavily.ts`, `research.ts`, `market.ts`, `claude.ts` and `hermes.ts`
each call `Router.use(authMiddleware)`, and `/api/llm/chat` was hardened by V2-6.
The pattern exists and these routers are simply outside it.

**Required.** The same viewer + meter + ceiling the rest of the paid surface
already has. `/crawl` additionally needs a bound on `limit`/`maxDepth` that the
caller cannot raise.

**Acceptance (binary).** An unauthenticated request to each paid route is refused
before any provider call is issued. An authenticated one is metered per viewer.
`/crawl` clamps its cost parameters server-side.

**Gate:** `docs/company-feature/gates/v4-2-gate.mjs`.

---

### V4-3 · A disputed figure renders as canonical — P0

**Files:** `apps/market-ui/src/components/company/DataTab.tsx:47-53`,
`apps/market-ui/src/components/company/types.ts` · `GravityMetric`

**Root cause.** V3-3 did the server half correctly: a `(metric, period)` with two
disagreeing values comes back `ambiguous: true`, names both values in
`source_reason`, and carries no accession. The client half was never written.
`DataTab` renders `m.value` unconditionally, and `GravityMetric` declares none of
`ambiguous`, `unit_reason`, `conflicting_values` — so the fields arrive over the
wire and are invisible to TypeScript and to the reader.

What a user sees today for a disputed fact: the number, formatted normally, with
the Source column showing prose instead of a filing link. That reads as *"we could
not find the filing"*, not as *"two filings disagree about this number."* V3's own
ledger calls presenting a disputed value as canonical the thing it exists to
refuse; the value is still presented.

**Required.** Declare the fields. Mark the row as disputed where the reader looks —
at the number. Name the competing values. Never show one as the figure.

**Acceptance (binary).** With `ambiguous: true`, the value cell is visibly marked
disputed, carries a machine-readable attribute, and both values are reachable. A
non-ambiguous row is unchanged.

**Gate:** `docs/company-feature/gates/v4-3-gate.mjs` — behavioural, renders the
real component.

---

### V4-4 · Any citation counts as a filing passage — P0

**Files:** `apps/market-ui/src/components/company/DevilsAdvocate.tsx`,
`apps/market-ui/src/services/gravitySearchService.ts` · `GravityRAGResult`

**Root cause.** V3-7 bound the prompt to `citations[]` instead of the synthesised
answer, which was the right move and is a real improvement. But it treats the
existence of a citation as proof of provenance. The backend already distinguishes
them — `Citation.source_class` is `SEC_EVIDENCE | LOCAL_EVIDENCE | WEB_EVIDENCE`
and `Citation.verification_status` carries a deterministic outcome
(`services/gravity-api/app/api/schemas/search.py:75`) — and the client type does
not declare `source_class` at all, so nothing downstream can tell a 10-K passage
from a blog post.

The prompt built from those citations is headed `NUMBERED FILING PASSAGES`. A web
citation presented under that heading is the component asserting provenance the
source does not have.

**Required.** Carry `source_class` to the client. Admit a citation as filing
evidence only when it is SEC-classed and carries an accession; label anything else
as what it is; refuse when nothing qualifies.

**Acceptance (binary).** A `WEB_EVIDENCE` citation is never sent under the filing
heading. A citation with no accession is not presented as a filing. A set
containing only web citations produces the refusal, not a challenge.

**Gate:** `docs/company-feature/gates/v4-4-gate.mjs`.

---

### V4-5 · Duplicate Pydantic fields — P1

**File:** `services/gravity-api/app/api/schemas/search.py`

AST scan of the module:

```
Citation:      DUPLICATE FIELDS ['canonical_url', 'evidence_location']
SourcePassage: DUPLICATE FIELDS ['canonical_url']
```

Pydantic keeps the last declaration silently. `canonical_url` is declared first
with SEC semantics — *"The exact SEC URL a source click must open. Empty when no
verified filing provenance exists."* — and then again with web semantics,
*"Canonicalized page URL, used for deduplication."* The second wins. The field
still exists and still carries a URL, so this is a latent contract defect rather
than a live wrong answer, which is why it is P1 and not P0.

**Acceptance.** No model in the module declares a field twice; the surviving
description states which semantics the field actually has.

**Gate:** folded into `v4-1-gate.py` as an AST assertion.

---

### V4-6 · DataTab formats outside the unified formatter — P1

**File:** `apps/market-ui/src/components/company/DataTab.tsx:49`

`typeof m.value === 'number' && m.unit === 'USD'` — exact string equality against
one spelling. The server's own currency literal on the trend path is `"USD M"`
(`longitudinal_tracker.py` · `_get_metric_unit`), so a currency row spelled any
other way silently drops out of currency formatting. It is not a lie — the unit is
still printed beside the number by `unitLabel` — but V2-1 and V3-1 exist to make
one formatter own this decision, and this cell predates both.

**Acceptance.** The cell formats through `formatFinancialValue`. Percentages,
ratios, per-share and unit-less rows keep the behaviour V3-1 gave them.

---

## Not attempted, and why

The brief asks for P1 "institutional research quality" — a What Changed engine,
guidance vs actuals, estimate revisions, segment intelligence, management
commentary extraction, catalyst extraction — and P2 differentiation on top.

**These are not blocked by effort; several are blocked by data that does not exist
in this system.** Before building any of them the honest step is to establish
whether the input exists, and that check is itself the deliverable:

- **Guidance vs actuals** needs issued guidance as structured data. The XBRL
  `financials` table holds reported facts only. No guidance source was found.
- **Estimate revisions** needs a consensus feed. None is configured; the brief
  itself says "if the data source is actually available".
- **Segment intelligence** needs XBRL dimensional facts. `sec_xbrl.py` emits
  `concept/label/fy/value/unit/form/end` and drops the dimension axis — the same
  ingest gap that makes V3-3's restatement policy unimplementable.
- **Management commentary / catalysts** needs MD&A and transcript sectioning.
  Transcripts exist as `earnings_transcript` documents; whether sectioning is
  reliable was not measured here.

A "What Changed" engine *is* buildable on the exact-XBRL rows alone, and is the
single highest-value P1 item. It is specified in the loop file as the next unit of
work and deliberately not started in this pass, because **P0 financial correctness
is not yet secure and the brief forbids adding features before it is.** Building
a change-detection layer on a period engine that thinks a TTM figure is a fiscal
year would propagate that defect into every card it renders.

## Execution order

```
V4-1  period engine        (no dependencies)
V4-2  paid-route auth      (no dependencies)
V4-5  schema duplicates    (no dependencies)
      ↓
V4-3  disputed-fact UI     (needs the V3-3 server fields, which exist)
V4-4  citation contract    (needs source_class carried client-side)
V4-6  DataTab formatter    (touches the same cell as V4-3 — after it)
      ↓
FULL REGRESSION → typecheck → build → re-audit
```

Gate commands are listed per row above; all are collected in `COMPANY_V4_LOOP.md`.
