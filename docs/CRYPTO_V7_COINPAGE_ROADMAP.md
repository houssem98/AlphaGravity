# Crypto V7 — COIN PAGE TRUTH (kill every fake tab, venue-true chart)

Spec source: gemini-code-1784030699121.md, rectified against our stack
(keyless APIs, Vercel fra1, blob SWR, truth layer V3–V6). The spec's core
complaint is real and verified in code: the coin detail page leaks Bitcoin
data under every asset.

## Verified defects (recon 2026-07-14)

- `tabs/AboutTab.tsx` — `ASSET_INFO[asset] || ASSET_INFO.BTC`: every coin
  except BTC/ETH/SOL shows Satoshi's bio, 21M supply, "$1.2T" hardcoded.
- `tabs/HoldersTab.tsx` — 5 hardcoded BTC addresses render for EVERY asset.
- `tabs/YieldTab.tsx` — static CeFi APY table, same rows for every asset,
  numbers invented.
- `tabs/MarketsTab.tsx` — rides `/api/trading/markets/ws` (market-server),
  dead/mock in prod.
- `Chart.tsx` — already lightweight-charts + Binance klines + kline WS +
  Yahoo fallback (spec item 1 is 80% built). BUT it joins by bare
  `{asset}USDT` — the symbol-collision class V3 killed in the table lives
  on in the chart (GRAM/LIT/DATA candles can be a different coin), and the
  24 OKX-venue coins get no Binance candles → silent wrong/empty chart.
- `tabs/NewsTab.tsx` — already real (Google News RSS via api/news.ts);
  only needs a source whitelist for crypto.

## Rectified spec (what gemini asked vs what ships)

| Spec item | Verdict |
|---|---|
| Charting engine (TradingView LW Charts) | ALREADY BUILT — do not rebuild. Fix truth + add MCAP/indicators. |
| Drawing tools state matrix (measure/magnet/lock) | Chart.tsx already has drawing code (priceToCoordinate, markers). AUDIT ONLY — wire dead buttons if cheap, no new drawing engine. |
| About tab live metadata | SHIP — CG `/coins/{id}` profile. |
| Markets tab live exchange rows | SHIP — CG `/coins/{id}/tickers` (trust_score, spread, depth, volume). Not the spec's per-exchange WS grid — CG tickers IS what CMC/CG render. |
| News whitelist | SHIP — domain whitelist filter on existing api/news.ts path for crypto assets. |
| Yield tab (DefiLlama Yields) | SHIP — `yields.llama.fi/pools` keyless. |
| Holders multi-chain indexer (Etherscan/Solscan) | CUT — keyed APIs only. Honest replacement: delete fake table, render explicit "needs an on-chain indexer" empty state + real explorer links from CG profile. Spec's own guardrail (never fake) decides this. |
| Zero fallback data / instant view cleansing | SHIP — doctrine below + CP-6. |

## Doctrine (hard rules)

- **TRUTH**: honest '—'/empty-state beats plausible numbers. NEVER render
  another asset's data. Every fetch keyed by CG id (base rows carry `id` +
  `venue` — pass them down, never join by bare symbol). Empty state text
  pattern: "Data temporarily unavailable for {name}" + retry button.
- **DESIGN FREEZE**: keep every tab's existing layout, tokens, table
  markup, skeleton/empty patterns — swap the DATA source, don't redesign.
  New empty states reuse existing empty-state styling (see NewsTab).
- **ONE SOURCE RULE**: any price shown on the coin page goes through
  `livePrice(row, spotRow)` from cryptoStore. Chart last-candle live tick
  is the one exception (kline close), already gated by CP-4.
- **NO new serverless files** — new data = `?view=` branches in
  api/crypto/markets.ts (profile/tickers/mcapchart). Existing files
  (news.ts, klines.ts) may be edited. Hobby 12-function cap is real.
- **Keyless APIs only** + curl-verify each new endpoint shape FROM PROD
  (fra1) before writing code:
  - `api.coingecko.com/api/v3/coins/{id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`
  - `api.coingecko.com/api/v3/coins/{id}/tickers?depth=true`
  - `api.coingecko.com/api/v3/coins/{id}/market_chart?vs_currency=usd&days=365&interval=daily` (market_caps = REAL historical mcap)
  - `yields.llama.fi/pools` (ALL pools one JSON — build symbol→pools map, cache 1h, V2 /protocols precedent)
- **CG free tier 429s on bursts**: per-coin blobs via existing cachedBlob
  (profile 24h, tickers 15min, mcap chart 1h), fetch LAZY on tab open
  only, NEVER prefetch profiles for 200 coins, stale-serve always.
- **OKX candles are newest-first — reverse before use** (V3 gotcha).
- **No new npm deps** (lightweight-charts already in). vercel.json keeps
  `"regions":["fra1"]`.
- Verify per task: market-ui typecheck 0 + `vercel --prod` (repo root —
  apps/market-ui path breaks project link) + prod curl real numbers +
  audit green (spot 200/200, MISMATCH 0) + **GRAM spot-check** (poster
  child: its About/Holders/Markets/chart must never show BTC/other-coin
  data). Flip ledger [x], one Progress-log line real numbers, commit on
  roadmap/world-class (git commit -F file if quotes — rtk mangles them).

## Ledger

- [ ] CP-1 **About tab live**: `?view=profile&id={cgId}` branch in
  markets.ts → CG /coins/{id} slim params → {description(en), links
  (homepage/whitepaper/repos/twitter/explorers), genesis_date,
  hashing_algorithm, categories(3), supply trio, max_supply null→'—',
  rank, image} — blob crypto_profile_{id}.json TTL 24h. AboutTab crypto
  branch: delete ASSET_INFO + BTC fallback entirely, fetch profile by id
  (wire id from cryptoStore base row by symbol), same layout/cards,
  loading skeleton, honest empty+retry on miss. Market cap card = live
  from base row, not string. Verify: prod curl profile for bitcoin +
  gram-2 (GRAM) show different real data; GRAM page shows Telegram/TON
  Gram info or honest empty, zero Satoshi.
- [ ] CP-2 **Markets tab live**: `?view=tickers&id={cgId}` branch → CG
  tickers?depth=true → top ~20 rows {exchange name, pair, price(usd),
  volume, depth ±2%, spread %, trust_score} sorted by volume,
  trust_score green/yellow only — blob crypto_tickers_{id}.json TTL 15m.
  MarketsTab: drop the dead `/api/trading/markets/ws` path for crypto,
  render CG rows in the existing grid markup (ExchangeLogo stays),
  honest empty+retry. Verify: BTC shows Binance/Coinbase/OKX real rows,
  GRAM shows its real (small) venue list, prices within gate of
  livePrice.
- [ ] CP-3 **Yield live + Holders honest**: yields — `?view=yield&sym=`
  branch → yields.llama.fi/pools symbol→pools map (cache map 1h blob),
  filter exact symbol match, top 15 by tvlUsd, {project, chain, symbol,
  apy, tvlUsd, stablecoin flag} → YieldTab renders real rows in existing
  table (DeFi rows now real; delete YIELD_DATA), empty state "No
  verified decentralized yield pools found for {name}." Holders — delete
  HOLDERS_DATA + stats header math, render honest state: "On-chain
  holder data requires an indexer key — not wired." + explorer links
  from CP-1 profile blob (blockchain_site), keep tab visible.
  Verify: ETH yield shows lido/aave-class pools real APY; BTC yield
  likely thin = honest; Holders shows zero fake addresses anywhere.
- [ ] CP-4 **Chart candle truth**: Chart.tsx crypto path joins by
  venue+id, not bare symbol — read venue from cryptoStore base row:
  binance → existing klines path unchanged; okx → OKX /market/candles
  (proxy branch in klines.ts or ?view=candles — reversed!) mapped to
  same format; no venue → honest empty chart state ("No verified candle
  source for {name}") not Yahoo-guess. Collision gate: after load,
  compare last close vs livePrice — >3% (stables 1%) → wipe series, show
  honest empty (kills GRAM-class wrong-coin candles). Kline WS only for
  venue=binance; okx venue gets 10s REST refresh of last candle. Wipe
  series data + drawings on asset switch before first new candle paints
  (spec "instant view cleansing" for the canvas). Verify: GRAM chart =
  OKX Gram candles or honest empty (never Binance GRAM-collision), HYPE/
  OKB/LEO charts fill from OKX, BTC unchanged, last close ≈ table price.
- [ ] CP-5 **MCAP toggle + indicator overlays**: PRICE/MCAP toggle wired
  — MCAP = CG market_chart market_caps (REAL historical mcap, daily) as
  line series via `?view=mcapchart&id=` blob TTL 1h; candles hidden,
  line shown, axis reformats ($B). Indicators: EMA20/50/200, SMA, RSI,
  MACD computed client-side from loaded candles (no new calls), rendered
  as lightweight-charts overlay/pane line series, toggle list in the
  existing toolbar (reuse its dropdown styling). Toolbar audit: buttons
  that are dead and not cheap to wire → remove nothing, leave as-is,
  note in Progress log which are inert. Verify: BTC MCAP line ≈ $2.2T
  scale real numbers, RSI pane matches table technicals ±1 for same
  timeframe.
- [ ] CP-6 **View cleansing + news whitelist**: every tab component
  remounts on asset switch (`key={asset}` at MarketsTabs render or reset
  effect) — no stale data flash from the previous coin, skeletons render
  first frame. News: crypto assets query by coin NAME + symbol, add
  whitelist filter in api/news.ts (param `wl=crypto`) — allow coindesk,
  cointelegraph, theblock, decrypt, bloomberg, reuters, cnbc, forbes,
  wsj, ft, businessinsider, coingecko, binance blog; filtered-to-zero →
  honest empty. Verify: switching BTC→GRAM never flashes BTC data in any
  tab (screenshot-poll two switches), news rows all whitelisted sources.
- [ ] CP-7 **Sweep**: full prod pass — for BTC, ETH, GRAM, HYPE (okx
  venue), PEPE: all 5 tabs + chart honest-or-real; audit rerun green
  (spot 200/200 MISMATCH 0); TN regression (board+intraday 200s, TN tabs
  untouched by key={asset} change — TnAbout still fine); /trading paint
  budget unchanged; ledger+memory update; final commit.

## Progress log

(append one line per completed task, real numbers only)
