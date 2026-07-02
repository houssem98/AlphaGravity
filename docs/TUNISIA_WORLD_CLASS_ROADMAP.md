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
- [ ] **T15** — Live TUNINDEX. **Blocked**: no public BVMT index endpoint
  (`market/indices` → Tomcat 500, all guesses 404). Options: compute a
  turnover-weighted proxy from constituents, or scrape. Stays indicative for now.

> Infra note: all `tn/*` endpoints are ONE Vercel function `api/tn/[fn].ts`
> (Hobby caps at 12 functions). The `/api/*`→Fly rewrite had to exclude `/api/tn/`
> — Vercel serves static function files before rewrites but NOT dynamic `[fn]`
> routes, so the dynamic one was being proxied to Fly (404) until excluded.

### Phase 9 — Terminal features (match finansya)
- [ ] **T16** — Screener. Filter/sort the 75 listings by change%, volume,
  turnover, price (client-side over `/api/tn/markets`). Saved views in localStorage.
  *Acceptance:* "top gainers today", "most traded" work. `[deploy]`
- [ ] **T17** — Comparator. Side-by-side 2–4 TN stocks: price, change, turnover,
  (later) ratios. Reuse existing grid components.
  *Acceptance:* compare AB vs BIAT vs ATTIJARI in one view.
- [ ] **T18** — 52-week-high / breakout monitor (needs T13 history). Flag stocks
  at/near session or N-day highs from `tn_daily`.
  *Acceptance:* list of stocks at new highs, updates post-session.
- [ ] **T19** — Price alerts. Per-stock threshold in localStorage; browser
  notification when `/api/tn/markets` crosses it. (No backend push needed.)
  *Acceptance:* set alert on AB, fires on cross. `[deploy]`

### Phase 10 — Fundamentals (the moat)
- [ ] **T20** — Fundamentals ingestion. Pull BVMT quarterly indicator bulletins /
  ilboursa into Supabase `tn_fundamentals` (PER, BPA/EPS, dividend, yield, book
  value). Start with the ~30 most-traded.
  *Acceptance:* AB shows a real PER + last dividend sourced + dated.
- [ ] **T21** — Fundamentals UI. New `FundamentalsTab` (TN) + ratio row in
  `AssetInfoPanel`; feed the comparator (T17) and screener (T16).
  *Acceptance:* ratios visible, comparator ranks by PER/yield. `[deploy]`

### Phase 11 — AI engine (our "Finansya Engine")
- [ ] **T22** — TN analysis via gravity-api. Wire `Assistant` / a new
  `TnEnginePanel` to call gravity-api with BVMT quote + intraday + news +
  fundamentals as context; return a structured multi-factor read (trend, volume,
  news tone, valuation) in French.
  *Acceptance:* "Analyse AB" → grounded, cited, French synthesis.
- [ ] **T23** — Multi-factor score. Deterministic 0–100 from
  momentum + volume + news sentiment + (T20) valuation; badge on list + panel.
  *Acceptance:* score reproducible, explained by factor breakdown. `[deploy]`

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
