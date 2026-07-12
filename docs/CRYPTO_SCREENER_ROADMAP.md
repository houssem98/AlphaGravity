# Crypto Screener Columns — Roadmap (rectified from gemini-code-1783869914211.md)

Goal: TradingView/CMC-style grouped column chooser in the `/trading` crypto tab
(`apps/market-ui/src/components/trading/Markets.tsx`) — drill-in submenu
(groups list → `< Group` back-header → per-group search → checkbox items),
project design tokens, real data only.

## Rectified schema (vs the gemini spec)

The gemini doc assumes paid infra (Santiment, LunarCrush, IntoTheBlock, node
indexers, exchange websockets). We have: keyless public REST only. Verdicts:

| Gemini group | Verdict | Our source | Columns we ship |
|---|---|---|---|
| 1. Coin info (7) | KEEP (trimmed) | CoinGecko `/coins/markets` | rank, logo (API image), name/symbol (fixed) |
| 2. Market data (13) | KEEP (trimmed) | CoinGecko same call (`price_change_percentage=1h,24h,7d,14d,30d,1y`) | price, perf 1h/24h/7d (exists), perf 14d/30d/1y, ATH, ATH % |
| 3. Technicals (35) | KEEP (12 of 35) | Binance spot `/api/v3/klines` 1d + hand-rolled math (NO ta-lib dep) | RSI14, EMA20/50/200, SMA20/50/200, MACD, BB upper/lower, ATR14, Tech Rating (compound Buy/Neutral/Sell) |
| 4. Valuation (7) | DONE mostly | already shipped 2026-07-12 | mcap, FDV, vol/mcap, total supply, max supply — regroup only |
| 5. Derivatives (7) | KEEP (3 of 7) | Binance fapi `/fapi/v1/premiumIndex` (ALL symbols, 1 call, keyless) + `/fapi/v1/openInterest` per visible symbol | funding rate, open interest USD, OI/vol24h |
| 6. Holders (3) | ⛔ CUT | needs IntoTheBlock/indexer, no free API | — |
| 7. Transactions (6) | ⛔ CUT | needs node scrapers, no free API | — |
| 8. Sentiment (12) | ⛔ CUT per-coin | global Fear&Greed already in top bar (alternative.me) | — |

Final groups in the `+` menu: **Coin info (1) · Market data (6) · Technicals (12) · Valuation (5) · Derivatives (3) · Chart (1)** ≈ 28 columns.

## Hard rules

- **No new serverless files.** Vercel Hobby 12-fn cap is nearly full. New server
  data = query params on existing fns: `api/crypto/markets.ts?view=technicals|derivatives`
  (or `klines.ts`). Static fns override the Fly rewrite; dynamic `[fn].ts` under
  `/api/crypto/` would be SHADOWED by `vercel.json` rewrite — do not create one.
- **Keyless APIs only**: CoinGecko free, Binance public spot/fapi, coinlore/OKX
  fallbacks stay. Curl-verify every endpoint returns real data BEFORE coding against it.
- **No new npm deps.** RSI/EMA/MACD/BB/ATR are ~60 lines of arithmetic.
- **Keep fallback chain**: coingecko → coinlore → okx. Payload shape stays
  backward-compatible (existing `MarketData` fields untouched, only additive).
- **Design**: project tokens only (`--surface`, `--line`, `--accent`, `label`,
  `text-data`…). Match existing popover style already in Markets.tsx.
- Verify each UI task: `npm run typecheck` (market-ui) 0 errors + `vercel --prod` +
  curl the prod endpoint. Paste REAL numbers into Progress log.
- Commit each task on `roadmap/world-class` (`git commit -F` if message has quotes).

## Ledger

- [x] CS-1 **Audit**: count deployed Vercel fns (must stay ≤12); curl prod
  `/api/crypto/markets` + CoinGecko `/coins/markets?vs_currency=usd&per_page=100&price_change_percentage=1h,24h,7d,14d,30d,1y`
  + Binance `/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=200` + fapi
  `/fapi/v1/premiumIndex` — log status codes, row counts, and which fields are
  actually present. Read `api/crypto/klines.ts`. NO code changes.
- [x] CS-2 **Server market data**: markets.ts → CoinGecko primary (adds
  `image`, `ath`, `athChangePct`, `changePercent14d/30d/1y`, exact fdv/supplies),
  coinlore fallback unchanged shape, okx last. Module-level 5-min cache. Curl prod after deploy.
- [x] CS-3 **UI market data + coin info**: extend `MarketData` iface + both
  normalizers; new cols perf 14d/30d/1y, ATH, ATH % (off by default); logo =
  API image w/ coincap fallback; regroup existing valuation cols under the
  rectified groups.
- [ ] CS-4 **UI drill-in menu**: two-level `+` popover — level 1: groups w/
  icon + count; level 2: `< Group` header + search + checkbox list (screenshots
  in chat 2026-07-12). Persist `cols` + `changeTf` to localStorage
  (`nexus_crypto_cols`). Global search still filters across groups.
- [ ] CS-5 **Server technicals**: `markets.ts?view=technicals&symbols=BTC,ETH,…`
  (≤25 per call) → Binance 1d klines (parallel), compute RSI14, EMA/SMA 20/50/200,
  MACD line/signal, BB up/low, ATR14, rating (MA consensus + RSI zones →
  Strong Buy…Strong Sell). 5-min cache keyed by symbol. Non-Binance symbols → nulls.
- [ ] CS-6 **UI technicals**: fetch `view=technicals` for visible page only,
  merge into rows, 12 cols off by default; rating = colored pill (`up`/`down`/
  neutral token colors). No fetch when whole group hidden.
- [ ] CS-7 **Derivatives**: server `?view=derivatives` — premiumIndex once
  (all funding rates) + OI for requested symbols; UI group w/ funding %, OI USD,
  OI/vol24. Off by default, page-only fetch, nulls for spot-only coins.
- [ ] CS-8 **QA sweep**: prod curl all 3 views; toggle every group live;
  35-col table renders w/o horizontal-scroll jank (overflow-x already present);
  lighthouse-level sanity (no layout shift on toggle); ledger flip + final log.

## Progress log

(loop appends one line per completed task — real numbers only)

- 2026-07-12 CS-3 UI: MarketData +7 optional fields; 5 new cols p14d/p30d/p1y/ATH/ATH% (off by default, sortable, PctVal '—' on fallback sources); FDV cell prefers exact fdvUsd; logos = CoinGecko image w/ coincap fallback (row+expanded+highlight); groups regrouped → Coin info(1)/Market data(7)/Valuation(6)/Chart(1). typecheck 0, deployed market-ui-self.vercel.app.
- 2026-07-12 CS-2 server: markets.ts → CoinGecko primary + 5-min module cache, coinlore/okx fallbacks untouched. Prod curl: 100 rows src=coingecko, BTC price 64100, p14d 6.845, p30d 1.577, p1y -45.44, ath 126080 (athPct -49.16), fdv 1.2856T, image URL ✓. typecheck 0, deploy market-fte8y1k08.
- 2026-07-12 CS-1 audit: 11/12 Vercel fns deployed (1 slot free, rule stays no-new-files). prod /api/crypto/markets HTTP 200, 100 rows, src=coinlore, BTC $64,208. CoinGecko coins/markets HTTP 200, 100 rows, ALL needed fields present (p1h 0.115/p24h -0.025/p7d 2.17/p14d 6.84/p30d 1.57/p1y -45.4, ath 126080, athPct -49.16, fdv 1.286T, image ✓). Binance spot klines BTCUSDT 1d HTTP 200, 200 candles, close 64117.98. fapi premiumIndex HTTP 200, 835 symbols, BTCUSDT funding 0.00007763; openInterest BTCUSDT 101232.36 HTTP 200. klines.ts = thin Binance proxy, ?view= extendable. All CS-2..CS-7 sources confirmed live.
