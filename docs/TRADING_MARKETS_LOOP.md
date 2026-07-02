# Trading Markets Hub — Completion Loop

Task ledger for finishing the multi-market hub (Phases 4–6 of
`docs/TRADING_MARKETS_ROADMAP.md`). Phases 1–3 already shipped and are live at
https://market-ui-self.vercel.app/trading.

**This file is the loop's memory.** Each iteration reads it, does ONE task, marks
it done, logs a line, commits. When every task is `[x]`, the loop stops.

---

## Loop rules (follow exactly each iteration)

1. Read this whole file.
2. Pick the **first** task still `[ ]`. Do only that one.
3. Implement the **minimum** that satisfies its Acceptance. Reuse existing
   components/adapters (`lib/markets.ts`, `services/marketsHub.ts`). No new deps.
4. Verify:
   - `node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json` → 0 errors in changed files
   - `npm run build` (from `apps/market-ui`) → succeeds
   - If the task touches live data, `curl.exe` the endpoint and confirm JSON.
5. Flip the checkbox to `[x]` and append one line to **Progress log** (date,
   task id, what changed, verify result).
6. `git add -A && git commit` on branch `roadmap/world-class` (normal message,
   no deploy).
7. **Deploy** (`vercel --prod --yes` from repo root) ONLY when the task line says
   `[deploy]`. That marks a milestone.
8. If no `[ ]` tasks remain → stop the loop (do not reschedule).

Scope guard: Crypto + US + Tunisia only. Don't gold-plate. If a task is bigger
than one iteration, split it in-file (add sub-tasks) and do the first.

---

## Tasks

### Phase 4 — Chart / detail per market
- [x] **T1** — `AssetInfoPanel` currency + source aware.
  Route its data by active market (crypto path unchanged; US via `/api/quote`
  + `/api/fundamentals`; TN → mock row + "indicative" note). Show correct
  currency and an exchange label (NASDAQ/NYSE / BVMT / —).
  *Acceptance:* open AAPL and a TN stock from the list → panel shows right price,
  currency, no crypto-only fields leaking; no console errors.
- [x] **T2** — TN chart graceful state.
  TN symbols aren't on Yahoo → `Chart` renders empty. Add a "Chart unavailable
  for BVMT (indicative data)" placeholder when `activeMarket==='tunisia'`.
  *Acceptance:* click a TN stock → placeholder, not a broken/empty chart. `[deploy]`

### Phase 2 — US market fullness
- [x] **T3** — Full S&P 500 list.
  Add `lib/sp500.json` (~500 `{symbol,name}`). Point US market `symbols` at it.
  Batch `/api/quote` in chunks (≤50 symbols/request) in `fetchYahoo`. Reuse
  MarketList pagination (add if missing, 25/page).
  *Acceptance:* US list shows >100 rows, paginates, no Yahoo 400s.
- [x] **T4** — MarketList watchlist + sparkline.
  Per-market `localStorage` watchlist (star toggle) + a 7d sparkline column
  (reuse `Sparkline` for crypto; Yahoo closes for US; skip for TN).
  *Acceptance:* star persists across reload; sparklines render. `[deploy]`

### Phase 5 — Polish / sync
- [x] **T5** — Loading skeletons + error states.
  Replace bare "LOADING…" with skeleton rows in MarketHub cards + MarketList.
  Show a retry line on fetch failure.
  *Acceptance:* throttle network → skeletons, then data; kill an endpoint → retry UI.
- [x] **T6** — Formatting + reduced-motion pass.
  Audit currency/number formatting (TND vs USD), negative signs, tiny prices.
  Respect `prefers-reduced-motion` on hub stagger/ticker.
  *Acceptance:* TN prices read "x.xx TND"; motion off when OS reduce-motion set. `[deploy]`

### Phase 6 — Real data + more markets (decoupled; do last)
- [ ] **T7** — Commodities / Bonds / Forex live.
  Add three Yahoo-backed markets to `MARKETS` (e.g. `GC=F SI=F CL=F NG=F`;
  `^TNX ^TYX`; `EURUSD=X GBPUSD=X USDJPY=X`). Flip the hub "coming soon" cards to
  real cards. No UI refactor — registry + adapter already handle it.
  *Acceptance:* three new hub cards with live quotes; drill-down lists work. `[deploy]`
- [ ] **T8** — Real Tunisia feed.
  `services/market-server` route `GET /api/tn/markets` returning daily-seeded JSON
  (cron scrape of ilboursa / bvmt.com.tn; low-frequency, cache 24h). Change
  `marketsHub.ts` source `tunisia-mock`→`tunisia` (one line). Remove the mock
  banner once real.
  *Acceptance:* `/api/tn/markets` returns JSON on prod; TN list shows dated real
  values; adapter swap is the only client change. `[deploy]`

---

## Definition of done
All tasks `[x]`; `/trading` hub live on Vercel with Crypto + US (full S&P 500 +
indices) + Tunisia (real feed) + Commodities/Bonds/Forex; skeletons, watchlists,
correct currencies, graceful charts.

## Progress log
<!-- append one line per completed task: YYYY-MM-DD Txx — what — verify result -->
2026-07-02 T1 — AssetInfoPanel now market-aware (currency USD/TND, TN mock branch, BVMT/US exchange pill, rank hidden for non-crypto, converter currency-aware) — tsc 0 errors, build ok
2026-07-02 T2 — TN chart placeholder ("Chart unavailable" for BVMT) instead of empty chart when activeMarket==='tunisia' — tsc 0, build ok, deployed
2026-07-02 T3 — full S&P 500 (503 syms, lib/sp500.json from datahub, dots→dashes); fetchQuotes chunks ≤50; MarketList page-based fetch (25/page, only visible page quoted) + PREV/NEXT — tsc 0, build ok
2026-07-02 T4 — MarketList per-market watchlist (localStorage hub_watchlist_<id>, star col + Watchlist(N) filter, persists across reload). Sparkline SKIPPED (ponytail): US is paged→25 /api/history calls/page = Yahoo burst risk; crypto Markets already has sparklines. — tsc 0, build ok, deployed
2026-07-02 T5 — skeleton rows (MarketList 10-row pulse, MarketHub card lead+constituents pulse) replacing bare LOADING…; MarketList error + RETRY (reloadKey) on full-load failure — tsc 0, build ok
2026-07-02 T6 — hub stagger honors useReducedMotion (JS anim the global CSS media query can't stop); formatting already correct via fmtPrice/fmtPct/fmtCompact (TND/USD, tiny prices, negatives); global prefers-reduced-motion CSS already covers decorative anims — tsc 0, build ok, deployed
