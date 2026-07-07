# Company Intelligence — World-Class Roadmap

**Goal:** take `/companies` (now also the **Company** tab inside `/search`) from a broken stat-card page to the caliber of AlphaSense company tearsheets, LinqAlpha primers, Rogo company analysis, and Hebbia Matrix output.

**Date:** 2026-07-07 · **Status:** Phase 0 shipped, Phases 1–5 planned

---

## 1. Current state (audited 2026-07-07, prod probes)

The page renders 4 tabs (Overview / Filings / Metrics / Sentiment) fed by 7 parallel calls. **Every single data panel was broken in prod:**

| Panel | Call | Prod result | Root cause |
|---|---|---|---|
| Overview stats | `apiGetOverview` → Alpha Vantage | mostly empty | free key = 25 req/day; returns `"None"` strings rendered literally |
| Quote | `apiGetQuote` → Alpha Vantage | mostly empty | same rate limit |
| Filings | `GET /v1/documents?ticker=` | **HTTP 500** | endpoint depends on SQLAlchemy/asyncpg `get_db` — asyncpg path is dead in prod |
| Metrics | `POST /v1/search/structured` | **401**, then **"SQL generation failed"** with auth | UI sent no auth header; server-side NL→SQL LLM call returns non-JSON |
| Sentiment | `GET /v1/analytics/sentiment/{ticker}` | **422** | route requires `document_id`+`period`; UI sends neither — API contract mismatch |
| Sentiment delta | `…/delta` | same | same |
| Longitudinal | `…/longitudinal/{ticker}` | untested | same auth/contract family |
| **All Gravity calls** | any | never reached API | page used `VITE_GRAVITY_URL` (unset) instead of `VITE_GRAVITY_API_URL` → fetched `localhost:8000` from prod browser |

### Phase 0 — plumbing fixes (SHIPPED with this commit)
- ✅ **Company tab** added to `/search` mode toggle, next to Research Grid (`?mode=company` deep-linkable); CompanyPage now embeddable (local ticker state, no route hop)
- ✅ env var fixed → `VITE_GRAVITY_API_URL`
- ✅ Supabase Bearer token attached to `/v1/documents` and `/v1/search/structured`
- ✅ non-OK responses → `null` (page no longer parses error HTML as JSON); `Array.isArray` guards; shape checks on sentiment payloads
- ✅ `"None"` / non-numeric Alpha Vantage fields render as `—`
- ✅ `/search?q=` links now work from inside the page (param effect is reactive, not mount-only)

---

## 2. What "world-class" means (benchmark, researched 2026-07-07)

**AlphaSense company tearsheet + Smart Summaries** — market cap/revenue/fundamentals & estimates header; then AI **Company Insights** in three cited sections: *Earnings* (call highlights ±, outlook, analyst Q&A, street beats/misses/bull/bear), *Research* (upgrades/downgrades, SWOT, competitive landscape), *Expert Calls* (SWOT from expert interviews). Every sentence has a citation link to the underlying document. Industry-level roll-ups aggregate across companies.

**LinqAlpha** — agentic workflows per company: screening, **primer/initiation-report generation in minutes**, **catalyst mapping** from earnings calls + sentiment, and **Devil's Advocate** (an agent that pressure-tests your thesis). Configurable to the fund's own strategy.

**Rogo** — company analysis that terminates in **work products**: investment memos, CIMs, pitch decks with live data, financial modeling support, plus audit trail/access controls.

**Hebbia Matrix** — grid of documents × questions with **sentence-level citations**, full audit trail, multi-modal ingestion (PDFs, spreadsheets, nested tables), template-able repeat workflows.

**Distilled bar for our page:** every number exact + cited; an AI-written brief (not raw metric rows); earnings-call intelligence; peer comparison; and one-click export to a memo. Sources: [AlphaSense Smart Summaries for Companies](https://www.alpha-sense.com/blog/product/smart-summaries-for-companies/), [LinqAlpha](https://linqalpha.com/), [LinqAlpha Series A coverage](https://techstartups.com/2026/07/02/linqalpha-raises-22m-series-a-to-build-ai-agents-for-institutional-investors-and-public-market-research/), [Rogo product](https://rogo.ai/product), [Hebbia](https://www.hebbia.com/), [Hebbia ISD/Matrix overview](https://medium.com/@takafumi.endo/hebbias-edge-building-a-system-of-record-for-enterprise-reasoning-1264ab76ec6b).

---

## 3. The unfair advantage: compose what's already built

We do **not** need new infrastructure. World-class output here is a composition layer over assets that already exist in this repo:

| Existing asset | Reuse as |
|---|---|
| Research Grid prompts (THESIS, MOAT, GROWTH DRIVERS, RISKS, FINANCIALS, LATEST QUARTER) | the AI tearsheet **is** a 1-ticker grid run — cited cells, already battle-tested |
| Gravity QA pipeline (5-channel retrieval, citations, XBRL-exact numbers) | every tearsheet claim cited + verified |
| `financials` table `xbrl:*` rows (exact, 501 S&P tickers, 1,305 filings) | Metrics tab: exact reported figures instead of broken NL→SQL |
| Supabase (documents/chunks registry; market-ui already has the client) | Filings tab: query Supabase directly, bypass the dead asyncpg endpoint |
| Investment-committee workflow (bull/bear/risk/PM chain, V3.1) | Devil's Advocate equivalent — pressure-test button on the tearsheet |
| Grid memo/Excel exporters | one-click Company Memo export |
| Deep Research pipeline | "Generate full primer" escalation path |

---

## 4. Roadmap

### Phase 1 — Reliable data spine (fix the backend, ~1 day)
The page must never show an empty panel for an S&P 500 ticker.

1. **Filings list**: replace `GET /v1/documents` call with a direct Supabase query from the frontend (`documents` table by ticker, RLS-permitting) **or** fix the endpoint by porting it off asyncpg to the Supabase client like other live routes. Acceptance: AAPL shows its 10-K/10-Qs.
2. **Metrics**: stop calling NL→SQL `/v1/search/structured`. Add/reuse a thin `GET financials?ticker=` path that returns `xbrl:*` rows only (exact population per the financials-table audit). Acceptance: revenue/net income/EPS per quarter, exact, with filing provenance.
3. **Quote/overview**: Alpha Vantage free tier is structurally dead (25/day). Reuse the existing quote fallback stack from the trading hub (sina/OKX fallback pattern) or Yahoo-style endpoint already used elsewhere in market-ui (`api/quote.ts`, `api/spark.ts`). Acceptance: price + change always render.
4. **Sentiment**: UI already degrades gracefully; either add a ticker-aggregate wrapper in `analytics.py` or hide the tab until real. Don't fake it.

### Phase 2 — AI Company Brief (the visible leap, ~2 days)
AlphaSense-style tearsheet, built from the Research Grid engine:

- On ticker load, run the standard analyst prompts (Thesis / Moat / Growth drivers / Risks / Latest quarter) as a single-ticker grid run, streamed into an **Overview brief** with inline citation badges (reuse `AnswerText` + `CitationPanel` from SearchPage).
- Cache per ticker+day (grid runs already persist in `lib_grid_runs`).
- Add "Regenerate" + model picker (DeepSeek default, per grid).
- Acceptance: open NVDA → within seconds a cited brief covering thesis, moat, drivers, risks, last quarter — every claim clickable to the filing passage.

### Phase 3 — Earnings intelligence (~2 days)
- **Latest-quarter card**: actual vs prior quarter from `xbrl:*` rows (beat/miss framing needs estimates — see stretch).
- **Transcript smart summary** when a transcript is indexed: highlights ±, outlook, Q&A extraction (one QA-pipeline call with a fixed prompt).
- **Guidance tracker**: `/v1/analytics/longitudinal/{ticker}/guidance` route exists — wire it, verify contract first.
- **Catalyst list** (LinqAlpha-style): prompt over recent 8-Ks + latest call: "next 3 catalysts with dates."

### Phase 4 — Comparison & monitoring (~2 days)
- **Peer strip**: sector peers (GICS from overview or a static map), 1-click "compare" → prefills the Research Grid comparison prompt with peer tickers (grid already supports multi-ticker + comparator column).
- **Devil's Advocate button**: run the investment-committee chain (V3.1) on the brief; render bull/bear/risk/PM verdict.
- **Watchlist + alerts**: reuse trading-hub alerts pattern for filings ("new 8-K for NVDA") via the EDGAR daily-fresh poller.

### Phase 5 — Work products (~1 day)
- **Export Company Memo** (PDF/Markdown): brief + metrics + filings list through the existing grid memo exporter.
- **Send to Deep Research**: prefill a full primer request ("Initiation report on {name}: business, segments, financials, valuation, risks, catalysts").

### Stretch (needs new data, defer until asked)
- Street estimates/consensus (needs a paid provider) — blocks true "beat/miss vs consensus"
- Expert-call content (AlphaSense's moat; no free equivalent)
- Segment-level revenue breakdowns (parseable from XBRL segments; nontrivial)

---

## 5. KPIs

- **Zero empty panels** for any S&P 500 ticker (Phase 1)
- Brief generation < 30 s cold, < 1 s cached; **100 % of claims cited** (Phase 2)
- Every number traceable to a filing passage or `xbrl:*` row — no LLM-generated figures (all phases)
- Ticker → exported memo in < 2 minutes (Phase 5)

---

## 6. Progress ledger (loop-driven — one item per iteration, mark ✅ date + evidence, ⛔ reason if blocked)

**Shipped: 63% (10/16 ✅) · Resolved: 75% (12/16, +2 ⛔) — `████████████░░░░░░░░`**

Blocked (⛔): 3.3 guidance (no guidance data in corpus), 3.4 catalysts (retrieval falls back to structured channel) — both need server-side ingestion/filter work, documented inline.

| Phase | ✅ | ⛔ | Total |
|---|---|---|---|
| 1 · Data spine | 4 | 0 | 4 ✅ |
| 2 · AI brief | 3 | 0 | 3 ✅ |
| 3 · Earnings intel | 2 | 2 | 4 (resolved) |
| 4 · Comparison & monitoring | 1 | 0 | 3 |
| 5 · Work products | 0 | 0 | 2 |

### Phase 1 — data spine
- [x] 1.1 ✅ 2026-07-07 — new `GET /v1/company/{ticker}/filings` (Supabase-REST over `chunks`, dupe-ingest collapse, no asyncpg); prod probe: AAPL returns 10-Q/8-K/transcripts newest-first; UI wired + deployed. Note: anon RLS blocks frontend-direct Supabase reads → server-side route is the pattern for 1.2
- [x] 1.2 ✅ 2026-07-07 — `GET /v1/company/{ticker}/financials` (financials table, `document_id like xbrl:*`, metric+period dedupe newest-restatement-wins); prod probe: AAPL exact balance-sheet/P&L rows with filing provenance; Metrics tab wired, USD compacted ($82.70B)
- [x] 1.3 ✅ 2026-07-07 — quote now via `/api/quote` Yahoo→sina fallback (keyless, always up; probe: TSLA $419.77 +6.69%); Alpha Vantage kept only as opportunistic overview enrichment. Note: `/api/fundamentals` (Yahoo v10 quoteSummary) is dead — needs crumb auth; don't build on it
- [x] 1.4 ✅ 2026-07-07 — Sentiment tab now renders only when the backend returns a real score (auto-lights-up when a ticker aggregate ships). Engine is per-document LLM scoring with no corpus batch run → aggregate deferred to Phase 3 transcript work; no fake data shown

### Phase 2 — AI company brief
- [x] 2.1 ✅ 2026-07-07 — `CompanyBrief.tsx`: one-ticker `runGrid` over `SEED_GRID_PROMPTS` (Thesis/Moat/Growth/Risks/Financials/Latest-Q), each section a cited RAG answer with clickable [N] badges → passage. Prod probe: NVDA thesis 200, real cited answer + unverified-figure guard, 26.8s/cell warm (< 45s client timeout). Renders atop Overview tab. LLM proxy is fallback-only (RAG answers direct)
- [x] 2.2 ✅ 2026-07-07 — `loadTodaysRunByName` (lib_grid_runs, name+created_at≥today, per-user); brief loads cache on open (instant, "cached today" pill), saves completed run, Regenerate forces fresh. Prod probe: filter accepted (structural [] — columns valid)
- [x] 2.3 ✅ 2026-07-07 — DeepSeek/Claude/Gemini segmented picker (DeepSeek default), disabled mid-run, applies on Regenerate (not mid-display). Regenerate/Stop already shipped in 2.1. Prod probe: LLM proxy `/api/llm/chat` 200 (DeepSeek 1.4s). Model is fallback-only — RAG answers direct

### Phase 3 — earnings intelligence
- [x] 3.1 ✅ 2026-07-07 — `LatestQuarterCard` on Overview: headline P&L (Revenue/Gross/Operating/Net/Diluted-EPS) newest period vs prior with Δ%, from exact XBRL rows (client-derived, no new fetch; fetch bumped to limit=80). `computeQuarterRows` pure + self-check (4 asserts pass: AAPL FY2025 $416.16B rev +4.0%). Prod probe confirmed 2 periods per ticker (FY2026 10-Q / FY2025 10-K)
- [x] 3.2 ✅ 2026-07-07 (ships dormant) — `TranscriptSummary`: mounts only when a transcript filing exists, one fixed-prompt RAG call (Highlights/Watch-outs/Outlook), `isTranscriptDisclaimer` guard (self-checked) HIDES the card when RAG returns a financials-fallback disclaimer instead of call content. ⚠️ Prod finding: `document_types:['earnings_transcript']` is NOT enforced on the structured channel → thin transcripts fall back to 10-K figures → card correctly hides today. Auto-activates when server enforces the filter or transcripts re-index thicker. No misleading UI shipped
- [⛔] 3.3 BLOCKED 2026-07-07 — endpoint live (`?metric=&periods=`, 200) but returns `guidance_value:null, actual_value:null, beat_miss:""` for all tickers: corpus has no extracted management guidance. Won't ship an always-empty card. Upgrade: add a guidance-extraction ingestion step (parse forward-looking numeric targets from transcripts/8-Ks into the tracker store), then wire the card
- [⛔] 3.4 BLOCKED 2026-07-07 — same root cause as 3.2: catalyst query over 8-K+transcript returns `available:null`, structured channel only, disclaimer ("sources contain only historical revenue… no upcoming catalysts"). Won't ship a second self-hiding card. Working substitute already live: the AI brief's **Growth Drivers** section surfaces forward-looking initiatives from MD&A (returns real cited answers). Upgrade: enforce document_types on the structured channel server-side

### Phase 4 — comparison & monitoring
- [x] 4.1 ✅ 2026-07-07 — peer strip on company header (curated `peersFor` static map, 15 sector groups; self-checked) + "Compare in grid" → `/search?mode=grid&tickers=SELF,peers`; GridView reads `?tickers=` prefill (no auto-run). Peer chips open that company. Prod probe: grid deep-link 200. Unknown tickers → strip hidden (no fake peers)
- [ ] 4.2 Devil's Advocate button: investment-committee chain on the brief
- [ ] 4.3 Filing alerts: "new 8-K for {ticker}" via EDGAR daily-fresh poller

### Phase 5 — work products
- [ ] 5.1 Export Company Memo (PDF/Markdown) through grid memo exporter
- [ ] 5.2 "Send to Deep Research" primer prefill
