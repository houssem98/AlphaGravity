# Crypto Screener V3 — TRUTH roadmap (no hallucination, ruthless coverage)

V1+V2 shipped 66 cols (docs/CRYPTO_SCREENER_ROADMAP.md, docs/CRYPTO_SCREENER_V2_ROADMAP.md,
both COMPLETE 2026-07-12). User-observed defects: (a) some coins show NO data in
technicals/derivatives/spot/meta groups, (b) some coins show WRONG data
(another asset's numbers). Root causes — known, verified in code, not guesses:

1. **Symbol-keyed joins.** Every view resolves `SYMBOL + "USDT"` on Binance and
   `symbol.toUpperCase()` in llama/trending maps. Coin not listed → nulls.
   Symbol collision (two assets, same ticker) → ANOTHER COIN'S DATA. That is the
   hallucination.
2. **Fake zeros.** CS-2 server maps missing CG fields with `?? 0` → UI renders
   "+0.00%" for data that does not exist (1y % on new coins, coinlore fallback).
3. **TVL symbol map.** llama /protocols has thousands of tickers; tiny protocol
   sharing a big coin's ticker pollutes the TVL sum.

## Doctrine (hard rules — every task obeys these)

- **Price cross-check gate**: before serving ANY per-coin data from a matched
  pair (Binance spot/fapi, OKX), compare that source's last price to the CG/base
  price for the coin. Disagreement > 3% (stables: > 1%) ⇒ mapping is WRONG ⇒
  serve nulls and cache the blacklist. Never show an unverified match.
- **Join by CG id, not symbol, wherever the source provides ids** (CG categories,
  CG trending both return coin ids — rows already carry `id`).
- **Honest nulls beat plausible numbers.** '—' is correct output for a coin with
  no source. No zeros-as-data anywhere: missing numeric ⇒ null ⇒ '—'.
- llama TVL: chains map (tokenSymbol) stays; protocols only count when
  protocol.mcap and CG mcap agree within 0.3×–3× (llama rows carry mcap) —
  else drop.
- Existing constraints from V1/V2 stay: no new serverless files (?view= branches
  in api/crypto/markets.ts only), fra1 pinned in vercel.json, keyless APIs only,
  curl-verify before coding, no new deps, additive payloads, th/td parity,
  typecheck 0 + vercel --prod + prod curl w/ REAL numbers per task, commit each
  task on roadmap/world-class.
- Audit artifacts live in repo: `apps/market-ui/scripts/audit_crypto_coverage.mjs`
  writes `docs/CRYPTO_COVERAGE_AUDIT.md`. Re-runnable anytime.

## Ledger

- [x] CT-1 **Ground-truth audit (no code changes to app)**: write
  `apps/market-ui/scripts/audit_crypto_coverage.mjs` — pulls prod
  `/api/crypto/markets` (100 coins, id+symbol+price), then `view=spot`,
  `view=technicals`, `view=derivatives`, `view=meta` for ALL 100 (batched ≤25).
  Per coin per group emit: OK (data present) / NULL (all fields null) /
  **MISMATCH** (spot lastPrice-derived `open..high..low` bracket or technicals
  price-scale fields — ema20 etc. — differ from base price by >3× or <⅓ ⇒ wrong
  asset). Write docs/CRYPTO_COVERAGE_AUDIT.md (table + totals). Paste totals
  into Progress log. This is the ruthless baseline.
- [x] CT-2 **Verified-pair gate (server)**: in markets.ts add `verifiedPair(sym,
  cgPrice)` — Binance ticker24hr map lookup + price cross-check per doctrine;
  cache verdict (5-min). technicals/spot/derivatives branches accept
  `&px=sym:price,...` hints from the UI (rows already hold priceUsd) and return
  nulls for unverified pairs. UI sends px hints. Deploy; curl a known-collision
  symbol and confirm nulls; re-run audit → MISMATCH count must drop to 0 for
  Binance-backed groups.
- [x] CT-3 **Meta truth**: categories + trending joined by CG id (`view=meta&ids=`
  additive param; UI passes ids). TVL: protocols filtered by the mcap-agreement
  rule; chains map unchanged; TVL < $1M ⇒ null (dust, not signal). Trending only
  by id. Re-run audit meta column; paste before/after TVL coverage.
- [ ] CT-4 **OKX klines fallback for non-Binance coins**: curl-verify OKX
  `/api/v5/market/candles?instId=BTC-USDT&bar=1D&limit=250` from prod fra1 first
  (OKX taker of last resort — same price cross-check gate). techFor(): if no
  verified Binance pair, try verified OKX pair; parse OKX candle shape
  (ts,o,h,l,c,vol — REVERSED order, newest first). Technicals coverage must
  rise (HYPE/LEO/OKB-class coins) — paste before/after counts.
- [ ] CT-5 **Honest UI states**: server sends null (not '0') for missing CG
  fields (changePercent14d/30d/1y, ath, fdv — additive: empty string/null safe
  for old UI '0' paths); UI PctVal/cells render '—' for null/''/absent; kill
  every "+0.00%" that isn't a real 0 (real zero from source stays); `title`
  tooltip on '—' cells: "no verified source for this coin". Cells with
  sub-$1M TVL, 0-supply, 0-ath ⇒ '—'.
- [ ] CT-6 **Final ruthless sweep**: re-run audit_crypto_coverage.mjs against
  prod → REQUIRE: MISMATCH = 0 across all 100 coins × all groups; every group
  either OK or honest-null; paste final coverage table totals (e.g. spot X/100,
  tech Y/100, deriv Z/100, tvl W/100, cats V/100) into Progress log + commit
  docs/CRYPTO_COVERAGE_AUDIT.md. TN regression (board+intraday 200). Ledger
  complete.

## Progress log

- 2026-07-12 CT-1 baseline (CORRECTED in CT-2 — original run hit localhost Express, wrong target; script rewritten against real prod w/ symbols= batching + px hints): spot 57/100 OK 1 MISMATCH, technicals 55/100 OK 1 MISMATCH, derivatives 54/100 OK 0, meta 60/100 OK 0. The MISMATCH = LIT (CG Lighter $2.66 wearing Binance Litentry $0.71 candles) — the hallucination, reproduced and pinned.
- 2026-07-12 CT-3 meta truth: llama mcap NULL on all 7,830 /protocols rows (curl-proven) — mcap-agreement rule unenforceable as written; replaced with a STRONGER exact id-join: families (parentProtocol|slug) attributed only via gecko_id on a member row or the parent entry (/lite/protocols2 curl-verified: 414/773 parents carry gecko_id), CEX rows excluded (exchange reserves ≠ TVL), chains map untouched, TVL <$1M → null. Cats/trending joined by CG id via positional ids= (UI + audit send it); trending id-only; legacy no-ids callers: chain TVL + symbol cats, no protocol sums. TVL sim old-symbol-rule 55/100 → id-rule 45/100 (the 10 lost were pollution: PAXG 1.84B symbol-noise, OKB 22B OKX reserves, DOT dust…; recovered real: UNI 3.06B, AAVE 13.77B family, MORPHO 7.21B, ENA 4.68B, SKY 6.17B, LIT 523M = actual Lighter). Prod: ETH 40.46B trend #12, LIT trend #9, OKB null ✓, legacy AAVE null ✓. Audit: MISMATCH 0 all views; spot 67/100, tech 67/100, deriv 63/100, meta 50/100 (meta 60→50 = honest-null contraction; earlier spot/tech/deriv lows were cold-cache runs). typecheck 0.
- 2026-07-12 CT-2 verified-pair gate: parsePx + verifiedPair (3%/1% stables, 5-min verdict cache) gating spot/technicals/derivatives; UI sends px hints (pxOf, page rows' priceUsd). Prod-curled: LIT+hint → all nulls, BTC+hint → open 64387.5 / rsi 53.73 / oi 6.48B pass. Audit after: MISMATCH 0/100 on ALL views (was 1+1); gate also caught XMR (CG 330.73 vs stale delisted-Binance 113.3 — under the 3× audit radar, killed by the 3% gate) and DAI (Binance lastPrice 0, fake-zero row → nulls). Coverage now honest: spot 55/100, tech 54/100, deriv 52/100, meta 60/100. typecheck 0. NOTE: found prod clobbered by a 20:16 auto-deploy of main (old markets.ts, no views, iad1) — redeployed roadmap/world-class; any main push re-clobbers market-ui prod.
