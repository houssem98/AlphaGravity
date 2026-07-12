# Crypto Screener V2 — Roadmap (rectified from gemini-code-update.md)

V1 (docs/CRYPTO_SCREENER_ROADMAP.md, COMPLETE 8/8 2026-07-12) shipped 30 cols in
6 groups. V2 adds what the updated gemini blueprint lists AND is actually
buildable keyless. Target: ~60 columns, still one file pair
(`apps/market-ui/src/components/trading/Markets.tsx` + `api/crypto/markets.ts`).

## Delta triage (new doc vs shipped v1)

| Gemini group | New items | Verdict | Source |
|---|---|---|---|
| Coin info | category, ecosystems | KEEP (tag chips) | CG `/coins/markets?category=X` reverse-map, ~8 categories, 1h cache |
| Coin info | TVL | KEEP | DeFiLlama `api.llama.fi` (protocols by symbol + chains by name), keyless, 1h cache |
| Coin info | consensus algos | ⛔ CUT | manual data, rots |
| Market data | open/high/low, change-from-open %, gap %, volatility %, 24h abs Δ | KEEP | Binance spot `/api/v3/ticker/24hr` — ONE call all symbols, 5-min cache map |
| Market data | volume change % | KEEP | 1d klines vol[-1] vs vol[-2], piggyback technicals fetch |
| Technicals | Stoch %K/%D, StochRSI, Williams %R, CCI (20), ADX(+DI/−DI), ROC, Momentum, Awesome Osc, PSAR, Aroon up/down, ATR %, Donchian U/L, Keltner U/L, HMA, Ichimoku conv/base, Bull-Bear Power, Pivot Classic P/R1/S1, Pivot Fib R1/S1, MAs rating, Oscillators rating, candle pattern (doji/hammer/engulfing) | KEEP ALL | pure math on klines ALREADY fetched in v1 — zero new API calls |
| Valuation | mcap/TVL | KEEP | derived from llama TVL |
| Valuation | NVT, velocity | ⛔ CUT | need on-chain tx USD, no keyless source |
| Derivatives | OI change % | KEEP | fapi `/futures/data/openInterestHist?period=1d` |
| Derivatives | long/short ratio | KEEP | fapi `/futures/data/globalLongShortAccountRatio` (keyless!) |
| Derivatives | taker buy/sell ratio | KEEP | fapi `/futures/data/takerlongshortRatio` |
| Derivatives | liquidations (3 cols) | ⛔ CUT | Binance liq REST removed; Coinglass needs key |
| Holders (3) / Transactions (6) | all | ⛔ CUT (again) | no keyless on-chain indexer |
| Sentiment (12) | all except trending | ⛔ CUT | LunarCrush/Santiment keyed |
| Sentiment | trending rank | KEEP (badge col) | CG `/search/trending`, 1 call |

UI extras (own additions): merged-% dropdown gains 14d/30d/1y options; technicals
columns client-sortable; "Reset columns" button in the `+` menu.

## Hard rules (v1 rules still apply + these)

- NO new serverless files — everything via new `?view=` branches in
  `api/crypto/markets.ts`. Views: `spot` (ticker map), `technicals` (extended),
  `derivatives` (extended), `meta` (TVL + categories + trending).
- Keyless only; fns stay pinned `"regions": ["fra1"]` (Binance 451-blocks US) —
  never remove that line from vercel.json.
- Big-payload caution: llama `/protocols` is multi-MB — parse once, keep only
  `{symbol → tvl}` map, 1h module cache. CG category calls ≤8, 1h cache.
- Technicals v2 = extend the SAME klines fetch — do NOT add a second klines call
  per symbol. All indicator math hand-rolled, no deps.
- Additive payloads; v1 fields and coingecko→coinlore→okx chain untouched.
- th/td parity: every new ColKey gets exactly one th and one td (CS-8 audit
  script pattern); colCount stays `4 + toggled`.
- Verify per task: typecheck 0 + `vercel --prod` + prod curl w/ real numbers in
  Progress log; commit each task on roadmap/world-class.

## Ledger

- [x] CX-1 **Audit**: curl-verify every NEW source w/ real output logged:
  Binance `/api/v3/ticker/24hr` (no symbol param = all, note payload size),
  fapi `/futures/data/openInterestHist?symbol=BTCUSDT&period=1d&limit=2`,
  `/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1d&limit=1`,
  `/futures/data/takerlongshortRatio?symbol=BTCUSDT&period=1d&limit=1`,
  llama `api.llama.fi/protocols` (size + symbol/tvl fields) + `/v2/chains`,
  CG `/coins/markets?category=layer-1&per_page=100` + `/search/trending`.
  NO code changes.
- [x] CX-2 **Server spot view**: `?view=spot&symbols=` — module-cached (5-min)
  full ticker-24hr map → per symbol: open, high, low, prevClose, priceChangeAbs.
  Derived server-side: changeFromOpenPct, gapPct, volatilityPct ((h−l)/l·100).
- [x] CX-3 **UI Market data v2**: 8 new cols (Open, High, Low, Chg from Open %,
  Gap %, Volatility %, 24h Δ $, Vol Δ %) wired to view=spot (page-only lazy,
  same pattern as tech); merged-% dropdown gains 14d/30d/1y options (data
  already in rows from v1 CS-2).
- [x] CX-4 **Server technicals v2**: extend techFor() same-klines math —
  stochK/stochD, stochRsi, willR, cci20, adx/diPlus/diMinus, roc12, mom10,
  ao, psar, aroonUp/aroonDown, atrPct, donchU/donchL (20), keltU/keltL,
  hma20, ichiConv/ichiBase, bbp, pivP/pivR1/pivS1 (classic), fibR1/fibS1,
  maRating, oscRating, candle (doji|hammer|engulfing|null), volChangePct.
  Curl prod: BTC values sane (stoch 0-100, adx 0-100, pivots near price).
- [x] CX-5 **UI Technicals v2**: new cols in Technicals group (split menu into
  "Technicals — Trend" and "Technicals — Oscillators" groups if one list >15);
  MAs/Osc rating pills like Tech Rating; candle pattern text col; tech columns
  client-sortable (sort merged view on tech values when a tech sort active);
  "Reset columns" button in `+` menu (restores DEFAULT_COLS).
- [x] CX-6 **Coin info + meta**: `?view=meta` — llama TVL map + CG category
  reverse-map (~8 cats: layer-1, layer-2, defi, stablecoins, meme, ai, gaming,
  exchange-token) + trending set, 1h cache, one response for all 100 syms.
  UI: Category chips col, TVL col, Mcap/TVL col (Valuation), Trending badge
  (🔥 rank) col.
- [x] CX-7 **Derivatives v2**: server — oiChangePct (openInterestHist d/d),
  longShortRatio, takerRatio added to view=derivatives (per-symbol, cached,
  skip when no perp). UI: 3 new cols in Derivatives group.
- [x] CX-8 **QA sweep**: prod curl all views (spot/technicals/derivatives/meta)
  w/ real numbers; th/td parity script over ALL ColKeys; toggle-all sanity;
  TN regression (board+intraday 200); ledger flip + final log.

## Progress log

(loop appends one line per completed task — real numbers only)

- 2026-07-12 CX-8 QA: all 4 views prod-green in one sweep — base 100 rows src=coingecko BTC 64121; spot BTC h 64463.83 vola 1.29%; technicals BTC rsi 53.6 stochK 92.2 adx 24.5 maR Sell, ETH candle Bull Engulfing; derivatives BTC oiΔ -2.97% ls 1.2573; meta ETH tvl 40.5B trend #6 UNI #3. Parity audit: 66 ColKeys — 66/66 have exactly 1 th + 1 td (change col = dropdown-th regex blind spot, manually verified). TN regression board+intraday 200. ROADMAP V2 COMPLETE 8/8 — screener now ~66 columns across 8 menu groups, all keyless.
- 2026-07-12 CX-7: server derivExtras (oiHist d/d on sumOpenInterestValue, globalLongShortAccountRatio, takerlongshortRatio — 3 parallel fapi calls per perp, 5-min cache) folded into view=derivatives; UI 3 cols (OI Δ % ±colored, Long/Short ≥1 up, Taker B/S). Prod: BTC oiΔ -2.97% ls 1.2573 taker 0.8899; SOL ls 2.2648; USDT all nulls ✓. typecheck 0.
- 2026-07-12 CX-6: server ?view=meta (llama chains-then-protocols TVL map, CG trending, 8 category reverse-maps sequential + 429-tolerant, 1h cache; 7/8 slugs curl-verified, AI slug rate-limited twice but tolerated); UI 4 cols — Category chips (2+n), Trending 🔥#n accent, TVL $, Mcap/TVL. Prod: ETH tvl 40.47B cats [Layer 1] trend #7; AAVE 13.73B; UNI trend #3; USDT nulls ✓ (cats partial on cold hour — refreshes). typecheck 0.
- 2026-07-12 CX-5 UI: +21 tech cols; menu split → Technicals—Trend (18) + Technicals—Oscillators (15); MAs/Osc rating pills; candle badge (bull/bear colored); stacked pair cells (Stoch, Aroon ↑/↓, ADX±DI, Ichimoku, Donchian, Keltner, Pivot P·R1·S1, Fib); tech cols client-sortable (techSort on tech map, -Infinity for unfetched, regular sort click clears); Reset-columns button. 1 TS error fixed (pair() f param narrowing). typecheck 0, deployed.
- 2026-07-12 CX-4 server: +25 indicator fields in techFor (same klines, 0 new calls) — stochK/D, stochRsi, willR, cci20, adx/±DI, roc12, mom10, AO, PSAR, aroonUp/Down, atrPct, donchU/L, keltU/L, hma20, ichiConv/Base, BBP, classic+fib pivots (from last COMPLETED candle), maRating/oscRating (scoreLabel), candle pattern (doji/hammer/engulfing), volChangePct (completed d/d). Prod BTC: stochK 91.8 willR -8.2 adx 24.5 psar 60928 pivP 64047 maR Sell oscR Neutral volD -48.0%; ETH candle=Bull Engulfing ✓.
- 2026-07-12 CX-3 UI: 8 Market-data cols (Open/High/Low $, Chg-Open %, Gap %, Volatility %, 24h Δ$ ±colored, Vol Δ% reading tech.volChangePct — lights up at CX-4); spot page-only lazy fetch (SPOT_KEYS gate); merged-% dropdown now 6 timeframes (1h/24h/7d/14d/30d/1y via TF_KEY map, persisted). typecheck 0, deployed.
- 2026-07-12 CX-2 server: ?view=spot&symbols= (≤100) — 5-min cached full ticker24hr USDT map → open/high/low/prevClose/chgAbs + derived changeFromOpenPct/gapPct/volatilityPct. Prod: BTC o 64223.99 h 64463.83 l 63640.83 vola 1.29%; DOGE cfo -2.036% vola 4.55%; FAKECOIN nulls ✓.
- 2026-07-12 CX-1 audit: ALL 7 new sources live. ticker24hr all-symbols 3638 rows 1.8MB (BTCUSDT open 64192.64 high 64463.83 low 63640.83 prevClose 64192.63 chgAbs -39.23); oiHist has sumOpenInterestValue USD directly (6.665B→6.467B d/d = -2.97% BTC) — no mark-price multiply needed; globalLongShortAccountRatio BTC 1.2573; takerlongshortRatio 0.8899; llama protocols 7827 rows 7.9MB (AAVE tvl 13.2B — map-only cache mandatory), v2/chains 456 w/ tokenSymbol (ETH 40.4B, SOL 4.9B); CG category layer-1 100 coins; CG trending 15 (UNI#3, ETH#7). No code changes.
