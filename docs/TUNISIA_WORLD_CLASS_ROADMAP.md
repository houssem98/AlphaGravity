# Tunisian Market → World-Class Roadmap

Goal: make the BVMT (Bourse de Tunis) experience in `/trading` a genuine
technico-fundamental terminal — the local equal of [finansya.tn](https://finansya.tn)
("Terminal d'analyse pour les Actions de la BVMT") — using **real data, no fake
fields**. This file is a loop ledger: one task per iteration, same rules as
`TRADING_MARKETS_LOOP.md` (tsc + build + curl-verify, commit on
`roadmap/world-class`, deploy only on `[deploy]`).

Live today: https://market-ui-self.vercel.app/trading

---

## 1. Where we are (grounded audit, 2026-07-02)

**Live & real (BVMT public REST, no scraping):**
- Stock list — `/api/tn/markets` → `bvmt.com.tn/rest_api/rest/market/groups/...`
  (75 listings; `last/open/high/low/close/volume/change%`, `caps`=turnover, ISIN).
- Intraday chart — `/api/tn/intraday` buckets the tick feed
  (`/rest/intraday/{isin}`) into **OHLC candles** (1/5/15m) + volume. `TnChart.tsx`.
- News — `/api/news` (Google News RSS, `fr/TN`) → real Tunisian press.
- Social sentiment — `TnSocialView` scores those headlines (FR+EN lexicon) into a
  bull/bear gauge.

**Broken for TN — still rendering CRYPTO data (the embarrassing gap):**
| Surface | What a TN stock shows now | Should show |
|---|---|---|
| `AssetInfoPanel` | price/change only; marketCap, volume, supply = `null` | BVMT stats: turnover, free float, 52w range, PER, div yield |
| `AboutTab` | **falls back to `ASSET_INFO.BTC`** → Bitcoin blurb | company profile (sector, activity, HQ, ISIN, listing date) |
| `HoldersTab` | **hardcoded Bitcoin whale wallets** | major shareholders / capital structure |
| `MarketsTab` | crypto exchanges (Binance…) | — hide, or "listed on BVMT" |
| `YieldTab` | crypto staking APR | dividend history / yield |
| TUNINDEX | indicative **mock** (9847.32) | live index value |

**No public BVMT endpoint for:** daily OHLC history, fundamentals (PER/EPS/
dividends), sector map, live index value. These need our own data layer.

---

## 2. The bar — what finansya.tn ships (benchmark)

- **Finansya Engine™** — quant + AI: multi-factor analytic score per stock,
  breakout configurations, supply/demand zones, fund-flow / volume distribution.
- **Screener** — rank/filter BVMT companies by quarterly indicators.
- **Comparateur** — compare listed companies on quarterly indicators, price vs
  fundamentals.
- **Portefeuille** — portfolio tracking.
- **Alertes** — price/level alerts.
- **Moniteur de sommets** — 52-week-high / breakout monitor.
- **Fundamental + technical terminals** — ratios (PER, BPA/EPS, dividende,
  rendement), structured over rumor-free data.
- Tiers: Gratuit / Découverte / Investisseur Pro / Elite.

We already beat them on: live candlesticks in-app, integrated news, AI chat
(gravity-api). We trail on: fundamentals, daily history, screener, scoring.

---

## 3. Data feasibility matrix (what powers each feature)

| Data | Source | Effort | Notes |
|---|---|---|---|
| Live quotes | BVMT `market/groups` | ✅ done | already cached 15m |
| Intraday OHLC | BVMT `intraday/{isin}` | ✅ done | tick-bucketed |
| **Top-of-book depth** | BVMT groups `limit{bid,ask,bidQty,askQty}` | 🟢 low | **already in the payload** — unused |
| Daily OHLC history | our cron → Supabase snapshot | 🟡 med | accumulate 1 bar/session; real candles grow over time |
| TUNINDEX live | BVMT `market/indices` (param TBD) / derive / scrape | 🟡 med | Tomcat 500 blind-probing; needs discovery |
| Sector map | static (BVMT `valGroup`) + curation | 🟢 low | 6 groups → sector labels |
| Fundamentals / ratios | BVMT quarterly bulletins (PDF) via gravity ingestion, or ilboursa | 🔴 high | the finansya moat; PER/EPS/div |
| Dividends | ilboursa / BVMT filings | 🟡 med | annual history |
| Shareholders | company filings / African Markets | 🟡 med | for HoldersTab |
| AI analysis | gravity-api LLM router + above | 🟡 med | reuse existing engine |

---

## 4. Roadmap (task ledger — continues T-numbering from T8)

### Phase 7 — Stop showing crypto data for TN stocks (correctness first) ✅ DONE
- [x] **T9** — TN-aware `AboutTab`. Company profile from registry + BVMT row
  (name, ISIN, sector, exchange=BVMT, currency=TND, fiche-valeur link). No BTC
  fallback for `market==='tunisia'`.
- [x] **T10** — TN L1 depth. **Folded into T12** (the `OrderBook` panel is dead
  code — not rendered anywhere — so reviving it was gold-plating). Instead the
  live `limit{bid,ask,bidQty,askQty}` from `market/groups` surfaces as Bid/Ask +
  Spread in the stats panel. Route `/api/tn/markets` now returns depth + OHLC.
- [x] **T11** — Crypto-only tabs (`Markets`, `Yield`, `Holders`) hidden for TN in
  `Topbar` (TN sees Chart/News/About); page snaps activeTab→Chart on switch.
- [x] **T12** — `AssetInfoPanel` TN stats block: day range, prev close, volume,
  turnover, Bid/Ask (L1), spread, ISIN — all from the enriched BVMT row.

### Phase 8 — Historical data engine (unlocks daily candles + index)
- [x] **T13** — Daily snapshot cron. `/api/tn/snapshot` writes each session's
  OHLCV per ISIN to **Supabase Storage** (JSON blob `market-data/tn_daily.json`)
  — no table/DDL needed (the `sb_secret` key can't DDL; Storage sidesteps it).
  Vercel Cron `0 14 * * *`, weekend-guarded, `CRON_SECRET` auth, idempotent per
  (isin, date). Open = prev-close proxy (BVMT `open` is always 0); H/L/C/V real.
- [x] **T14** — Daily candlestick source. `/api/tn/history` reads the blob;
  `TnChart` has an **Intraday / Daily** toggle. History grows from launch
  forward (seeded 2026-07-02: 75 stocks, 1 bar each).
- [x] **T15** — Live TUNINDEX. **Solved.** The old `bvmt.com.tn` REST has no
  index endpoint, but the exchange's *new* official site
  (`tunis-stockexchange.com`) serves its public dashboards from an anonymous
  Grafana over Postgres (`market_watch_db`, uid `ef4kunff033eoe`). `/api/tn/index`
  reads `indice_live` (latest batch) → TUNINDEX + TUNINDEX20 + 12 sector indices,
  real level / day% / yearly%. Replaces the mock in `marketsHub.fetchHeadline`;
  banner copy updated. Read-only, cached 120s — same numbers the site publishes.

> Infra note: all `tn/*` endpoints are ONE Vercel function `api/tn/[fn].ts`
> (Hobby caps at 12 functions). The `/api/*`→Fly rewrite had to exclude `/api/tn/`
> — Vercel serves static function files before rewrites but NOT dynamic `[fn]`
> routes, so the dynamic one was being proxied to Fly (404) until excluded.

### Phase 9 — Terminal features (match finansya)
- [x] **T16** — Screener. **Already in `MarketList`**: sortable columns (name,
  price, change%, volume), TOP GAINERS / TOP LOSERS / MOST ACTIVE cards, watchlist
  filter, search — all client-side over the board. Not adding a turnover column
  (marginal; would need turnover threaded through `AssetRow`).
- [x] **T17** — Comparator. `TnComparator` modal: pick up to 4 stocks (searchable),
  compare price, change%, day range, prev close, volume, turnover, spread, ISIN;
  best-per-metric highlighted; click a column → open that asset. "Compare" button
  in the TN `MarketList`.
- [x] **T18** — Breakout monitor. **Unblocked** — the exchange `raw_market`
  has ~5 months of intraday snapshots, so `/api/tn/highs` gives each stock's
  period high/low/last (≥20 trading days). "NEAR HIGHS" card on the TN board
  flags stocks within 2% of their period high. (Window ~5 months, not a full
  52 weeks yet — grows as the feed extends.)
- [x] **T19** — Price alerts. Bell in `TnChart` toolbar → threshold (above/below)
  in localStorage; fires a browser `Notification` when the live price crosses
  while the chart is open. (Client-only: no server push — fires while tab open.)

### Phase 10 — Fundamentals (the moat)
- [~] **T20** — Reference fundamentals (partial). The exchange Grafana DB
  (`raw_referentiels`, equity "Ligne Mère" per issuer) gives real **sector**,
  **shares outstanding**, nominal, and listing date → real **market cap**
  (price × shares). `/api/tn/ref` (cached 1d) surfaces them in `AssetInfoPanel`
  (Sector + Market cap) and `AboutTab` (sector, shares, listed-since). Also
  **free float %** + TUNINDEX/20 membership (from `raw_composition_indices`) →
  Free-float row + index badge in `AssetInfoPanel`. PER / EPS / dividend / yield
  are NOT in this DB (only publication *links* in `raw_publications`) — those need
  financial-statement ingestion (PDF).
- [ ] **T21** — Earnings ratios (PER/EPS/dividend/yield). **Genuinely blocked** on
  a data source: not in the exchange DB, not in any BVMT REST endpoint. ilboursa
  renders them in fragile JS charts (rejected as non-production). Real path =
  parse BVMT financial-statement / quarterly-indicator PDFs through the gravity
  ingestion pipeline. Needs a source decision before building.

### Phase 11 — AI engine (our "Finansya Engine")
- [x] **T22** — TN-aware Assistant. The existing Gemini function-calling
  Assistant (not gravity-api — it's the tool already wired into the trading UI)
  now has TN branches: `getChartData` → `/api/tn/history` + 15m intraday,
  `getFundamentalData` → live BVMT row + Engine score/factors (honest note: no
  P/E yet), `getFinancialStatements` → honest unavailable + fiche-valeur pointer.
  System prompt carries BVMT/TND context + answer-in-French hint; chat re-inits
  on market switch.
- [x] **T23** — Multi-factor score. `/api/tn/engine?symbol=` — deterministic
  0–100: momentum 35% (±3% day move), volume 25% (turnover percentile on board),
  news 25% (FR/EN lexicon over 7d Tunisian press), liquidity 15% (L1 spread).
  Every factor returns its `detail` (traceable). `EngineCard` gauge + expandable
  factor bars at the top of the TN right rail (`TnSocialView`).

---

## 5. Sequencing rationale

1. **Phase 7 first** — we currently show Bitcoin whales on Tunisian bank pages.
   Correctness before features; all low-effort, high-credibility.
2. **Phase 8** — the daily-history cron is time-gated (value compounds), so start
   it early even though the UI payoff lags.
3. **Phases 9–11** layer the terminal, then the fundamentals moat, then AI on top
   of a real data base — not before it.

## 6. Definition of done (world-class)
- No crypto data ever appears on a TN surface.
- Every TN stock: live candles (intraday + daily), L1 order book, company profile,
  key ratios, dividend history, news, sentiment, AI score.
- Screener + comparator + alerts + 52w monitor live.
- TUNINDEX live, not indicative.
- Every number traceable to a source (BVMT / filing / dated ingestion).

## 7. Progress log
- 2026-07-02 T9 — AboutTab TN branch: real company profile (name, ISIN via
  /api/tn/markets, sector map, BVMT exchange, TND, fiche-valeur + news links).
  Killed the `|| ASSET_INFO.BTC` fallback for TN. tsc 0, build ok.
- 2026-07-02 T10+T12 — enriched /api/tn/markets with open/high/low/close/turnover
  (caps) + L1 bid/ask/qty from `limit`. AssetInfoPanel TN stats block: day range,
  prev close, volume, turnover, Bid/Ask, spread, ISIN. OrderBook panel left dead
  (unrendered) — depth shown in stats instead. tsc 0, build ok.
- 2026-07-02 T11 — Topbar hides Markets/Yield/Holders for TN (Chart/News/About
  only); page effect snaps activeTab→Chart on market switch; removed Topbar
  console.logs. tsc 0, build ok, deployed.
- 2026-07-02 T13+T14 — Daily-history engine on Supabase Storage (no DDL): bucket
  `market-data`, blob `tn_daily.json`. /api/tn/snapshot (cron 14:00 UTC,
  weekend-guarded, CRON_SECRET) + /api/tn/history + TnChart Intraday/Daily toggle.
  Consolidated all tn routes into api/tn/[fn].ts (Hobby 12-fn cap) + excluded
  /api/tn/ from the Fly rewrite (dynamic routes lose the fn-vs-rewrite race).
  Seeded 2026-07-02: 75 stocks. Verified: AB daily bar O84.49 H87.49 L84.18 C86.9
  V32509. tsc 0, build ok, deployed. Env added to Vercel: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET.
- 2026-07-02 T15 — deferred: no public BVMT index endpoint (all probes 404/500).
- 2026-07-02 T16/T17/T19 — Phase 9. T16 screener already in MarketList (sort +
  gainers/losers/most-active + watchlist). T17 TnComparator modal (≤4 stocks,
  8 metrics, best-per-metric highlight, Compare button in TN MarketList). T19
  price alerts in TnChart (localStorage threshold, browser Notification on cross
  while chart open). T18 (52w monitor) deferred — needs accumulated daily history.
  tsc 0, build ok, deployed.
- 2026-07-02 T22/T23 — Phase 11. /api/tn/engine: deterministic 4-factor score
  (momentum 35% / volume-percentile 25% / news-lexicon 25% / spread-liquidity 15%),
  every factor traceable via `detail`. EngineCard gauge + factor bars atop the TN
  right rail. Assistant TN-aware: getChartData→tn/history+intraday,
  getFundamentalData→BVMT row+engine, getFinancialStatements→honest unavailable;
  BVMT/TND system context + French hint; chat re-inits on market change.
  tsc 0, build ok, deployed.
- 2026-07-02 T15 — Live TUNINDEX SOLVED. Found the exchange's new site
  (tunis-stockexchange.com) serving public dashboards from an anonymous Grafana
  Postgres proxy. /api/tn/index reads indice_live → TUNINDEX 19841.33 +0.15% +
  13 more indices, real levels. Wired into marketsHub headline (mock 9847.32
  retired). Read-only, cached 120s. tsc 0, build ok, deployed.
- 2026-07-02 T20 (partial) — /api/tn/ref from Grafana raw_referentiels (Ligne
  Mère per issuer): real sector + shares outstanding + listing date → real market
  cap. Wired into AssetInfoPanel (Sector, Market cap) + AboutTab (sector, shares,
  listed-since). PER/EPS/dividends still absent from this DB (publication links
  only) → need statement ingestion. tsc 0, build ok, deployed.
- 2026-07-02 Market overview — /api/tn/index now also returns market breadth
  (total cap, advancers/decliners, trades) from raw_market_statistics.
  TnMarketOverview strip atop the TN board: TUNINDEX + TUNINDEX20 (level/day%/1Y),
  breadth line, and all 12 sector indices as live chips. tsc 0, build ok, deployed.
- 2026-07-02 Real daily history + T18. /api/tn/history now aggregates raw_market
  (~81 sessions, Feb-Jul 2026) into real daily OHLC (AB 59.5→86.9). /api/tn/highs
  = per-stock period high/low/last (≥20d). "NEAR HIGHS" breakout card on the TN
  board (within 2% of period high). tsc 0, build ok, deployed.
- 2026-07-02 Deploy fix — root .vercelignore (anchored patterns; bare `services`
  had matched src/services and broke the remote build; uploads were 280MB+ of
  monorepo and dying on flaky net → now seconds). T18 verified on prod: 80 stocks
  ≥20d, 17 near highs. All 6 tn endpoints 200.
- 2026-07-03 Free float — /api/tn/ref joins raw_composition_indices →
  flottantArrondiDixPourcent (free-float %) + TUNINDEX/20 membership. AssetInfoPanel
  shows Free float + TUNINDEX20 badge. AB=30%, 75/77 covered. Exhausted the exchange
  DB for structured fundamentals — PER/EPS/dividends confirmed absent (earnings →
  PDF only). tsc 0, build ok, deployed.
