# Company Intelligence V3 — Provenance Is Not A Label

Branch: `feat/web-research-sec-integration`. Follows COMPANY_V2_ROADMAP.md (8 rows,
closed) and COMPANY_FIX_ROADMAP.md (23 rows, closed). The source audit this ledger
was built from is preserved verbatim at `COMPANY_V3_SOURCE_AUDIT.md`.

**Every row below was re-verified against the source on this branch before it was
written down.** The audit was right on all nine. One more is mine: V3-10, promoted
out of the audit's "Unverified" list once the evidence was actually gathered.

Ordering principle, unchanged from V2: **fix what makes the feature lie before what
makes it slow, and before what makes it richer.** A wrong number with a confident
unit is worse than a missing one. New in V3: *a right number attributed to the wrong
filing is worse than a number with no filing at all* — the second is honest.

The central promise this ledger defends:

> This number is the exact figure, for this period, from this filing.

Every P0 below is a path where that sentence is currently not mechanically true.

## Phase A — P0, correctness and provenance

| # | Task | Gate (binary) | Status |
|---|------|---------------|--------|
| V3-1 | A margin is never labelled as a profit, nor drawn in dollars | `LatestQuarterCard.tsx:14` matches `/^Gross Profit\|Gross margin/i` under the label `Gross Profit`, and `:57` sends every non-EPS value through `money()`, `:61` stamping `unit: 'USD'`. A filer reporting `Gross margin 45 %` renders **`Gross Profit  $45`**. Gate: feed `computeQuarterRows()` two `{metric:"Gross margin",value:45,unit:"%"}` rows; the output contains no row labelled `Gross Profit`, and any percent row carries `unit:'%'` and renders `45.0%`. The row's unit comes from the metric row, never from its position in `HEADLINE`. | OPEN |
| V3-2 | A fact with no unit stays unit-unknown | `company.py:169` does `"unit": r.get("unit") or "USD"`. A NULL unit becomes a currency claim the filing never made. Gate: a `financials` row with `unit=None` comes back from `/company/{t}/financials` as `unit: null` with a stated `unit_reason`; the client renders the null marker for the unit and does **not** prefix `$`. Asserted both ends — route fixture and `formatFinancialValue`. | OPEN |
| V3-3 | Two disagreeing values for one (metric, period) are never silently reduced to one | The dedupe key is `(metric_name, period)` and keeps the first row seen (`company.py:161-166`). The ordering's last tiebreak is `id.asc` — ingest order, which has nothing to do with which filing restated what. `sec_xbrl.py` drops companyfacts' `accn` at ingest, so the row cannot name its own observation. MMM holds 376 rows over 366 pairs: duplicates are real, not hypothetical. Gate: a fixture with two rows sharing ticker/metric/period but carrying different `value_float` returns the fact marked `ambiguous: true` with both values named in `source_reason`, and **no** `accession`. Identical values still collapse to one row. | OPEN |
| V3-4 | SEC fallback matches a period, not a substring of one | `longitudinal_tracker.py:887` accepts when `period in got or got in period`. `FY2024` is a substring of `FY2024 Q4`, so a quarter is returned under an annual label. A result with no period at all (`got == ""`) skips the check entirely and is accepted. Gate: request `FY2024`; a result with `period="FY2024 Q4"` is rejected, one with `period=""`/absent is rejected, one with `period="FY2024"` (and `fy=2024`) is accepted. Comparison is on normalised tokens, not `in`. | OPEN |

## Phase B — P1, failure states and spend boundaries

| # | Task | Gate (binary) | Status |
|---|------|---------------|--------|
| V3-5 | A failed trend is a failure, not an empty chart | `useCompanyData.ts:103-108` names four surfaces in `failures`; `lon` is in the same `Promise.allSettled` and is not one of them. Gate: with `/trend` answering 503 and the other four succeeding, `failedSurfaces` contains a `Revenue trend` entry carrying the status. | OPEN |
| V3-6 | A resolver that cannot run does not become permission to navigate | `TickerEntry.tsx:50-53` catches the resolver failure and calls `onOpen(q.toUpperCase())`. A network fault opens an unverified page — the exact state CF-24 exists to prevent. The `status !== 'resolved'` branch already renders "Open X anyway"; the catch branch skips the human. Gate: a rejected resolve renders an error state naming the fault, performs no navigation, and offers the same explicit "Open X anyway" escape. | OPEN |
| V3-7 | Devil's Advocate cites evidence it was actually given | `DevilsAdvocate.tsx:60` sets `facts = rag.answer` — a synthesised paragraph. The prompt calls it `VERIFIED DATA` and demands `[1]` markers, so every `[N]` the model emits indexes a list that was never sent. `GravityRAGResult` already carries `citations[]` (`id`, `source`, `text`, `url`) and `sources[]`. Gate: a RAG result with `available:true`, a non-empty `answer` and **zero** citations produces the unavailable state and issues no LLM call; a result with citations sends a numbered evidence block whose `[N]` are those `citation.id`s, and the rendered `[N]` resolve to a visible source list. | OPEN |
| V3-8 | An unauthenticated caller cannot make this server spend provider credits | `GET /api/llm/health` has no auth, and `refresh=1` bypasses the 5-minute cache to call DeepSeek, Anthropic and Gemini live — three billable calls per request, repeatable at will. Gate: `?refresh=1` from an unauthenticated caller triggers no provider call; a cold cache probes at most once regardless of how many requests arrive concurrently; the response still states each provider's health. | OPEN |
| V3-9 | One axis carries one unit | `CompanyPage.tsx:65-67` takes the first eight numeric metrics irrespective of unit, keyed on `m.period`, and `OverviewTab.tsx:89-106` plots them as one bar series on one Y axis. Revenue in dollars, EPS per share and a percent margin land on the same scale, and same-period metrics collapse onto one X label. Gate: a fixture of `{revenue $100B, EPS $5, gross_margin 45%}` in one period never produces a single series mixing units; the chart states which unit it is drawing, and the X axis identifies the metric. | OPEN |
| V3-10 | The anonymous meter keys on something the caller cannot choose | *Promoted from the audit's Unverified list — evidence now gathered.* `gravity.ts:58-61` derives the rate-limit key from the first `x-forwarded-for` value, and `index.ts` never calls `app.set('trust proxy', …)`, so Express's default is `false` and nothing validates that header. A caller sending a fresh random `X-Forwarded-For` per request gets a fresh bucket every time: `GRAVITY_ANON_PER_MIN`/`_PER_HOUR` bound nobody. Gate: with trust-proxy configured, two requests differing only in a forged `X-Forwarded-For` share one bucket; a request arriving through the real proxy is still keyed to the client, not to the proxy. | OPEN |

## Closed — do not reopen without regression evidence

`CF-1 … CF-28` (23 rows) and `V2-1 … V2-8` (8 rows) are closed. V2-8 delivered figure→filing
resolution as a capability; **V3-3 is a different defect** — the resolved filing can be the
wrong one when the underlying fact was restated, because the XBRL row retains no filing
identity of its own.

## Resolved from the audit's Unverified list

| Item | Verdict | Evidence |
|------|---------|----------|
| `GravityMetric` vs `DataTab` provenance fields | **Not a defect.** | `types.ts:48-71` declares `filing_type`, `period_end`, `filed`, `accession`, `primary_document`, `cik`, `source_reason`. Settled by `npm run typecheck`. |
| `x-forwarded-for` spoofable in the deployed topology | **Defect — V3-10.** | No `app.set('trust proxy')` in `services/market-server/src/index.ts`; `clientKey()` reads the raw header. |
| Devil's Advocate `[N]` mapped to sources elsewhere | **Defect — V3-7.** | `gravitySearchService.ts:58-70` proves `citations[]` exists and is never passed; nothing downstream of `DevilsAdvocate.tsx:71` maps `[N]`. |
| `Gross margin` reaching `LatestQuarterCard` for a live ticker | **Gated at source, not claimed live.** | V3-1's gate is a fixture against `computeQuarterRows`. No live-dataset claim is made. |

## Escalations

**E-1 · restatement policy (V3-3) — resolved by data constraint, owner may override.**
The three options were: keep the original observation, keep the latest authoritative one,
or refuse to attach one filing. The first two need companyfacts' `accn` per observation,
which `sec_xbrl.py` discards at ingest — so they are not implementable without an ingest
change and a backfill of 150,596 rows. **Chosen: refuse.** Conflicting values are surfaced
as ambiguous rather than silently reduced. If the owner wants original-or-latest instead,
that is an ingest ticket, not a route change.

**E-2 · Devil's Advocate scope (V3-7) — narrowed, not removed. Owner decision still open.**
Binding the prompt to `citations[]` is strictly an improvement and removes no capability:
the component refuses only when there is *no* evidence at all. Whether the **PM Verdict**
section — a Buy/Hold/Avoid call, which is not a filing-derived claim — should exist at all
remains the owner's call. It is left in place.

**E-3 · `/api/llm/health` access policy (V3-8) — spend fixed, access unchanged.**
Locking the route behind auth changes who may inspect provider availability, which is a
product decision. The billable-path fix (drop the caller-controlled `refresh`, coalesce
concurrent cold probes) closes the spend exposure without touching who can read it. If the
owner wants the route authenticated as well, that is a one-line addition on top.

## Not in scope for V3

The P1/P2 product table in `COMPANY_V3_SOURCE_AUDIT.md` (What Changed, guidance-vs-actual,
estimate revisions, segments, catalysts, valuation-vs-history, the research agent) is the
direction, recorded so it is not rediscovered. None of it is a defect, and none of it is
gated here. **A feature added on top of a path that misattributes a figure inherits the
misattribution** — which is the whole reason Phase A runs first.
