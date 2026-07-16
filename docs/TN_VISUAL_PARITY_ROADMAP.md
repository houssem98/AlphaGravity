# TN World-Class Parity — bring every crypto roadmap win to the Tunisian market

The crypto side shipped a long arc of roadmaps (V3 truth → V4 universe → V5 one-tick
→ V6 top-200 → V7 coin-page truth → V8 news truth → V9 news terminal → V10 news
visual → COLHEAD → logo fix). The TN company pages are at **data-truth** parity
already (roadmap T9–T23 + company ledger C1–C8 all DONE) but lag on the **UX /
polish** wins from that arc. This roadmap closes the honest subset — the parts
that don't need data the Tunis exchange doesn't publish.

## Full parity matrix (every crypto roadmap → TN status)

| Crypto roadmap | What it shipped | TN status |
|---|---|---|
| V1 screener (CS-1..8) | Market-data cols, drill-in **grouped `+` column chooser** (CS-4), technicals cols, derivatives | ❌ chooser → **TNV-7** (grouped, searchable, TN's honest 4 groups); technicals-as-cols ✅ covered by engine score/factors; derivatives ⛔ N/A (no TN derivs market) |
| V2 screener (CX-1..8) | Open/High/Low/Chg-from-open **list cols** (CX-3), technicals v2, meta/TVL, derivatives v2 | ❌ O/H/L + valuation cols → **TNV-7** groups (intraday + fundamentals have the data); meta/TVL ⛔ N/A (stocks); derivatives ⛔ N/A |
| V3 truth (CT-1..6) | Verified-pair gate, honest-null states, OKX fallback, coverage audit | ✅ have — TN embodies the truth doctrine (T-series honest states + own audit) |
| Company Intelligence | AI brief, peer compare, fundamentals, SEC filings, DevilsAdvocate | ✅ mostly — TN brief (`/api/tn/brief`) + TnComparator + fundamentals (T21); SEC filings ⛔ N/A (BVMT has no EDGAR equivalent) |
| V4 world-class | Curated universe, no-fake fields, ruthless audit | ✅ have — TN universe (~78 BVMT tickers) + T-series audit |
| V4 CW-3 | Fresh prices (live-feel blob) | ✅ have — TN blob SWR + gated price |
| V5 one-tick (CV-1..6) | Shared client store, Binance/OKX **WS live tick**, list==panel same ms | ⚠️ partial — TN has no public WS (session exchange); one-**source** applies → verify list==panel in sweep (TNV-6) |
| V6 top-200 (CU-1..4) | Universe scale to 200 | ⛔ N/A — TN universe is a fixed listed set, not mcap-ranked scale |
| V7 coin-page (CP-1) | About tab live | ✅ have — `TnAbout` (ref + markets) |
| V7 (CP-2) | Markets tab (where it trades) | ⛔ N/A — BVMT-only; tab hidden for TN (T11) |
| V7 (CP-3) | Yield live + Holders honest | ⚠️ partial — Holders hidden (T11); dividend yield thin → audit TNV-6 |
| V7 (CP-4) | Chart candle truth (venue-true) | ✅ have — `TnChart` intraday + daily (T13/T14) |
| V7 (CP-5) | **Chart indicators (SMA/EMA/RSI/MACD) + MCAP toggle** | ❌ gap → TNV-5 (`TnChart` is candles+volume only; crypto `Chart` has the overlay stack) |
| V7 (CP-6) | News whitelist / view cleansing | ✅ have — TN news is region=tn Google edition (correct source) |
| V8 news truth (NT-1) | **7-day horizon + newest-first** | ❌ gap → TNV-4 (TN news sends no `days=`, no sort) |
| V8 (NT-2) | **Strict per-entity title match** | ❌ gap → TNV-4 (TN news has no match filter) |
| V9 news terminal (N-1) | 40-outlet source expansion | ⛔ N/A — French Google edition, not whitelisted |
| V9 (N-2) | **Terminal report header** (price/24h/count/window) | ❌ gap → TNV-2 |
| V10 news visual | Hero image + thumbnail list | ⛔ can't — BVMT issuers publish no RSS media (honest plain list) |
| COLHEAD (CH-1..4) | **Per-column header menu** (sort/move/hide + registry) | ❌ gap → TNV-3 (TN list has basic sort only) |
| logo fix (2026-07-16) | **Real logo in detail header** | ❌ gap → TNV-1 |
| Grok banner art | AI hero art | ⛔ deferred — blocked on xAI credits |

Net honest gaps → **TNV-1 logos, TNV-2 news header, TNV-3 COLHEAD menu, TNV-4
news truth, TNV-5 chart indicators, TNV-6 sweep, TNV-7 grouped column chooser**.

## Doctrine (hard rules)

- TRUTH intact: no fake data, no placeholder logos/stock art, no invented
  numbers. Unmapped ticker OR a favicon that 404s → honest 2-letter initials
  (`onError`). Honest-empty news stays. A TN feature that needs data the exchange
  doesn't publish is SKIPPED and documented, never faked.
- NO new serverless files — reuse `/api/tn/[fn]` + shared `/api/news`
  (`region=tn`). No new npm deps. No page scraping. Logos come ONLY from the
  keyless DuckDuckGo favicon service via the existing `TN_DOMAINS` map.
- TN news stays region=tn plain list — NO outlet merge, NO images, NO hero.
  Header + horizon/sort/match may change; the list stays plain. Legacy
  `/api/news?q=` (no params) untouched.
- Crypto path byte-identical: every change is TN-only (`isTN` guard). The crypto
  logo (shipped), news terminal header, COLHEAD menu, and chart must not regress.
- UI: OUR design tokens only (`--bg/--surface/--line/--text*/--accent`). Favicons
  on a white chip, rounded, `object-contain`, fixed size, `onError` → initials,
  no layout shift. Chart indicators reuse the crypto `utils/indicators` math.
- Verify per task: market-ui typecheck 0 + `vercel --prod` (repo root) + prod
  curl real numbers + TN regression (BIAT board + intraday + news 200s) + crypto
  regression (a crypto coin e.g. TRX still shows its logo; audit spot 200/200
  MISMATCH 0) + flip `[x]`, one Progress-log line (real numbers), commit on
  `roadmap/world-class` (`-F` file if the message has quotes — rtk mangles them).

## Ledger

- [x] TNV-1 **Logos in TN detail views**: wire the existing `TN_DOMAINS` favicon
  into (a) the AssetInfoPanel detail header ([AssetInfoPanel.tsx:795](../apps/market-ui/src/components/trading/AssetInfoPanel.tsx#L795)) and (b) the
  TnAbout header ([AboutTab.tsx:85](../apps/market-ui/src/components/trading/tabs/AboutTab.tsx#L85)), rendered over the existing circle with
  `onError` hiding the img so initials show behind (mirror the crypto fix).
  Favicon on white chip, `object-contain`. Verify: typecheck 0; prod — mapped
  tickers with a DDG-cached favicon show the logo, unmapped/uncached show honest
  initials; a crypto coin (TRX) still shows its logo; TN board/intraday 200s.
- [x] TNV-2 **TN News terminal header (V9 N-2 parity)**: NewsTab.tsx TN branch —
  replace the plain `{name} News` header ([NewsTab.tsx:56](../apps/market-ui/src/components/trading/tabs/NewsTab.tsx#L56)) with a terminal block
  matching the crypto one's structure but TN-sourced: `COMPANY (SYMBOL) —
  ACTUALITÉS`, then a mono strip with last price (from `/api/tn/board` or the
  price the panel already holds), day change %, article count, and session date.
  Partial-tolerant (`--` when price unavailable, never blocks the list). List
  below unchanged (plain, no images). Verify: typecheck 0; prod — BIAT news
  header shows real last price + change + count; crypto news header unchanged;
  legacy `/api/news?q=` byte-identical.
- [x] TNV-3 **COLHEAD per-column menu (TN list)**: MarketList.tsx — port the
  crypto `menuTh` popover ([Markets.tsx:548](../apps/market-ui/src/components/trading/Markets.tsx#L548)): click a column header → Sort asc /
  Sort desc / Move left / Move right / Move to start / Move to end / Hide column,
  reusing the crypto markup + our tokens. Columns: name, price, changePct,
  volume, marketCap. Column order + hidden set persist to localStorage (key
  `tn-cols`). Hidden column drops from header + rows; at least one column always
  stays (guard). (The grouped `+` chooser that un-hides / adds columns is its own
  task — TNV-7.) Verify: typecheck 0; prod — menu opens, sort both directions,
  move + hide persist across reload; crypto Markets menu unchanged; TN
  board/intraday 200s.
- [x] TNV-4 **TN news truth (V8 NT-1/NT-2 parity)**: NewsTab.tsx TN branch +
  the shared `/api/news` call — add `days=14` (TN news is lower-volume than
  crypto, 7d too tight) so the server applies horizon + newest-first sort (logic
  already exists, just unused by TN), and pass a light `match=` of the company
  short-name so obviously-unrelated Google items drop. Keep region=tn, keep the
  plain list. Honest-empty stays. TN companies' French names are distinctive, so
  match is a precision bump, not a coverage cut — verify coverage doesn't
  collapse. Verify: typecheck 0; prod — BIAT/SFBT news ≤14d, newest-first, still
  ≥1 item for active names, honest empty for quiet ones; crypto news params
  unchanged; legacy `/api/news?q=` byte-identical.
- [x] TNV-5 **TN chart indicators + MCAP toggle (V7 CP-4/CP-5 parity)**:
  TnChart.tsx — add the crypto overlay stack using the existing
  `utils/indicators` (`calculateSMA/EMA/RSI`): SMA 20 / SMA 50 line overlays on
  the price pane (default on, toggle), RSI in a sub-pane (toggle). If per-share
  count is in `/api/tn/ref`, add a PRICE/MCAP toggle (mcap = close × shares) like
  crypto CP-5; if shares are missing for a ticker, hide the toggle (honest, no
  fake mcap). Reuse `lightweight-charts` (already a TnChart dep). Verify:
  typecheck 0; prod — BIAT chart shows SMA overlays + RSI toggle over real
  candles; MCAP toggle present only where shares exist; crypto Chart unchanged;
  TN intraday/history 200s.
- [ ] TNV-6 **Sweep**: prod pass BIAT/SFBT/PGH/TAIR/an-unmapped-ticker — logos
  present for covered, honest initials for uncovered, no layout shift; news
  header real numbers + list ≤14d newest-first + honest-empty; COLHEAD
  sort/move/hide persists; chart indicators render; one-source price verified
  (list cell == panel price, no rogue fetch — V5 CV-6 parity); `key={asset}`
  remount confirmed (BIAT→SFBT, no stale price/news/chart); TN board/intraday/
  news 200s; crypto regression (TRX logo + audit spot 200/200 MISMATCH 0);
  ledger + memory; final commit.
- [ ] TNV-7 **Grouped column chooser (V1 CS-4 / V2 CX-3 parity)**: MarketList.tsx
  — port the crypto grouped `+` popover (the screenshot: searchable list of
  column GROUPS with per-group counts, click to add/remove columns). TN's HONEST
  groups only — no fake/empty groups, no Derivatives (TN has no derivs market):
  - **Company** (3): Sector, ISIN, Shares outstanding — from `/api/tn/ref` + board
  - **Market data** (9): Price, Change % today, Change 7d, Volume, Turnover TND,
    Market cap, Open, High, Low — from `/api/tn/board` + `/api/tn/intraday`
  - **Valuation** (6): PER, EPS, P/B, Net income, Equity, Div yield — from
    `/api/tn/fundamentals` (39-co coverage; uncovered cell shows honest `—`)
  - **Signal** (6): Engine score, Label, Momentum, Volume, News, Liquidity/Trend
    factors — from `/api/tn/engine`
  Default view stays lean (name/price/chg%/volume/mcap shown; the rest opt-in via
  the chooser). Search filters columns by label. Selection persists to
  localStorage (`tn-cols`, shared with TNV-3). A column with no data for a ticker
  renders `—`, never a fake number (truth doctrine). NO Derivatives/Technicals-
  Oscillators groups — TN lacks that data; omitting them is honest, not a gap.
  Verify: typecheck 0; prod — chooser opens with the 4 real groups + true counts,
  search works, adding Valuation cols shows real PER/EPS for a covered co (BIAT)
  and `—` for an uncovered one, selection persists across reload; crypto Markets
  chooser unchanged; TN board/intraday/fundamentals/engine 200s.

## Progress log

(append one line per completed task, real numbers only)

- **TNV-1 live** (2026-07-16): `TN_DOMAINS` favicon wired into AssetInfoPanel
  detail header + TnAbout header (white chip, object-contain, onError→initials).
  Deployed vercel --prod 1m, typecheck 0. Favicon coverage partial by source:
  PGH/TAIR/onetech DDG-cached (200), BIAT/SFBT/BT/STB not cached (404 → honest
  initials, matches list-row behavior). TN board+intraday+news all 200; crypto
  TRX logo unregressed. Google-s2 rejected (uniform ~330b globe placeholder).
- **TNV-2 live** (2026-07-16): NewsTab TN branch → terminal header `COMPANY (SYM)
  — ACTUALITÉS` + mono strip (last price TND | day change % colored | N ARTICLES
  | fr-FR session date). Price/change from `/api/tn/board` (isTN-only fetch,
  partial-tolerant `--`, never blocks list). Prod BIAT: 171.000 TND, +0.58%, 75
  board rows. typecheck 0, vercel --prod 1m. Bundle TradingAssistantPage-fFPqOrRE:
  ACTUALITÉS present; crypto NETWORK NEWS + 7D WINDOW unchanged; tn/board wired.
  TN intraday+news 200; crypto news TRX 200; legacy `/api/news?q=` 200; diff scope
  = NewsTab.tsx only (crypto path byte-identical via isTN guard).
- **TNV-3 live** (2026-07-16): MarketList data columns registry-driven (ColKey +
  COLMETA + DEFAULT_ORDER); TN-only per-column header menu (menuTh: Sort asc/desc,
  Move left/right/start/end, Hide) gated by `market.id==='tunisia'`. Non-TN uses
  DEFAULT_ORDER + nothing hidden → byte-identical (same th/td output, toggleSort
  kept). Order+hidden persist to `tn-cols`; hide guarded (≥1 visible column).
  Movable set = name/price/changePct/volume/marketCap. typecheck 0, vercel --prod
  2m. Bundle TradingAssistantPage-CDgsRQrW: `tn-cols` + `Hide column` present;
  TNV-2 ACTUALITÉS intact. TN board+intraday 200. Crypto regress: audit spot
  200/200 OK MISMATCH 0 (tech 197/200, deriv 177/200, meta 121/200 — unchanged);
  crypto Markets.tsx untouched. Note: 7d% shifts to after marketCap in TN default
  (movable block contiguous) — honest reorder, same data.
- **TNV-4 live** (2026-07-16): TN news call gains `&days=14` → server horizon +
  newest-first sort (NT-1). typecheck 0, vercel --prod 1m. Prod: BIAT 2 items ≤14d
  newest-first (Jul 03 → Jul 02 descending); SFBT + AeTech honest-empty (SFBT's
  latest real news is May 2026 >14d — days=14 correctly drops the 2012–2024 junk
  the un-windowed query returned). Bundle TradingAssistantPage-CqXFkM1q: TN
  `days=14` present; crypto `wl=crypto` + `days=7` intact. Diff = NewsTab.tsx only
  (api/news.ts untouched → legacy `/api/news?q=` byte-identical). **NT-2 match=
  OMITTED, evidence-backed**: TN symbol defs carry FULL LEGAL names and the French
  press uses varied common names (TAIR→"Tunisair", PGH→"Poulina"), so any symbol/
  legal-name title match collapses coverage — prod `sym=TAIR` → 0 items. Omitting
  it is the truth doctrine's "don't cut coverage", not a gap. Follow-up idea (own
  task): the legal-name Google query underperforms the short-symbol query for some
  names (SFBT legal→6 stale vs `SFBT`→24 recent) — a query-term tune could lift
  coverage, but trades disambiguation for 2-letter tickers (AB/AL/CC).
- **TNV-5 live** (2026-07-16): TnChart gains SMA 20 (#2962FF) + SMA 50 (#FF6D00)
  price-pane overlays (default on, MA toggle) via existing `utils/indicators`
  calculateSMA; RSI 14 (#E040FB) on the left price scale (default off, RSI toggle);
  PRICE/MCAP toggle (mcap = close × shares from `/api/tn/ref`, custom compact axis
  formatter) shown only when shares exist. typecheck 0, vercel --prod 1m. Prod:
  BIAT intraday+history 200; `/api/tn/ref` BIAT shares=40,800,000 → MCAP toggle
  present. Bundle TradingAssistantPage-Co5Ggqev: `Relative Strength Index (14)` +
  `MCAP` present. Diff = TnChart.tsx only → crypto Chart.tsx byte-identical. Crypto
  regress: audit spot 200/200 OK MISMATCH 0 (tech 197/deriv 177/meta 121 unchanged).
