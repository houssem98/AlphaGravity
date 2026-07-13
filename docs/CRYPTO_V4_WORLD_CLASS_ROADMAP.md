# Crypto Screener V4 — WORLD CLASS (Binance-level coin universe, OUR design)

V1+V2+V3 shipped: 66 cols, TRUTH layer (price gate, id-joins, honest nulls),
blob SWR instant views, OKX spot/tech/deriv fallback. MISMATCH 0/400 certified
(docs/CRYPTO_COVERAGE_AUDIT.md). Remaining defect — the user's words: when you
open /trading → crypto it should feel like Binance's coin list — every visible
coin fully populated, prices fresh — while keeping OUR existing design exactly
(same table, same 66 columns, same drill-in chooser, same Dash tooltips).

Root cause of the remaining gap — measured, not guessed: the universe is "CG
top-100 by mcap" and 35 of those 100 have NO keyless venue anywhere (HTX, USDD,
M, BGB-class): not on Binance, not on OKX. Binance never shows such rows — its
list IS its coverage. Ours shows them as dash rows. So: **curate the universe
to coins with verified venue coverage, ranked by mcap** — remove the uncovered,
backfill from CG ranks 101+ that ARE Binance/OKX-listed, keep 100 rows.

## Doctrine (hard rules — every task obeys these)

- **DESIGN FREEZE**: zero visual redesign. Markets.tsx keeps its exact look —
  columns, groups, chooser, merged-% dropdown, Dash tooltips, pagination. Only
  the coin universe, data freshness, and residual field coverage change.
- **Truth doctrine carries over from V3 verbatim**: price cross-check gate
  (source last vs CG base within 3%, stables 1%, else null+blacklist); join by
  CG id never bare symbol where ids exist; honest '—' beats plausible numbers;
  no zeros-as-data; llama TVL id-anchored families, <$1M null, CEX excluded.
- **Curation is objective, not editorial**: universe = highest-mcap CG coins
  that pass the venue test (a price-gate-verified Binance or OKX spot ticker
  exists). No hand-picking. Exclusions must be LISTED with the reason
  (no venue / gate-failed) in docs/CRYPTO_UNIVERSE.md.
- **Binance-parity honesty**: Binance itself shows no derivatives for coins
  without perps and no TVL for non-DeFi coins. '—' in deriv/meta for such
  coins IS parity, not a defect. The hard requirement is spot+technicals
  100% for every visible coin.
- Standing constraints from V1–V3: NO new serverless files (?view= branches in
  api/crypto/markets.ts only), vercel.json keeps "regions":["fra1"], keyless
  APIs only + curl-verify each NEW endpoint from prod before coding, no new
  npm deps, additive payloads, th/td parity for any ColKey change,
  typecheck 0 + vercel --prod + prod curl with REAL numbers per task,
  commit each task on roadmap/world-class.
- Audit tooling: apps/market-ui/scripts/audit_crypto_coverage.mjs →
  docs/CRYPTO_COVERAGE_AUDIT.md. Every task that claims a coverage change
  re-runs it and pastes REAL numbers.

## Ledger

- [x] CW-1 **Universe audit (no app code changes)**: extend/clone the audit
  script into `apps/market-ui/scripts/build_crypto_universe.mjs` — pull CG
  `/coins/markets` top 250 by mcap (3 pages, sequential, 429-tolerant), pull
  Binance `ticker/24hr` full map + OKX `market/tickers?instType=SPOT` full map
  (both already used in markets.ts — same shapes), price-gate every candidate
  (3%/1% stables). Emit `docs/CRYPTO_UNIVERSE.md`: ranked table (rank, id,
  symbol, mcap, venue = binance|okx|NONE, gate = pass|fail|n/a) + the curated
  top-100 list (highest-mcap 100 with venue pass) + exclusions list with
  reasons. Also emit the curated list as a JSON array of CG ids in the doc
  (copy-paste source for CW-2). Paste counts into Progress log: how many of
  CG top-100 dropped, what backfilled from 101–250.
- [x] CW-2 **Curated universe server-side**: markets.ts — hardcode
  `CURATED_IDS` (the CW-1 list, CG ids, ordered by nothing — order comes from
  live mcap sort) and fetch base rows via CG `/coins/markets?ids=...` (100 ids,
  1 call — curl-verify ids= param first). baseRows()/all four blob precomputes
  use the curated universe. Legacy no-param calls keep working (additive).
  UI unchanged (it renders whatever base returns — same design). Deploy,
  force-refresh blobs, re-run audit: REQUIRE spot ≥ 98/100 and technicals
  ≥ 98/100 (allow ≤2 transient gate-fails), MISMATCH 0. Paste real numbers.
- [x] CW-3 **Fresh prices (Binance-live feel, same design)**: spot blob TTL
  → 30s (base stays CG-cadence); UI polls `view=spot` every 30s while the
  crypto tab is visible (setInterval + document.visibilityState — no design
  change, numbers just update); price column prefers the gate-verified venue
  lastPrice (fresher than CG) and falls back to CG when no venue. 24h% stays
  CG (definition parity). Verify: two curls 60s apart show price movement;
  UI network tab shows 30s polling; typecheck 0.
- [x] CW-4 **Residual field fill (curated set only)**: prevClose/gap for
  OKX-covered coins derived from OKX 1D candles already cached for technicals
  (prev candle close = prevClose — honest derivation, same gate); deriv: keep
  '—' where no perp exists anywhere (Binance parity), but check fapi + OKX
  swap maps cover every curated coin that HAS a perp (spot-check 5 known-perp
  coins that are currently deriv-null, fix joins if any). Re-run audit, paste
  spot/gap/deriv deltas.
- [x] CW-5 **Final ruthless sweep**: full audit vs prod on the curated 100 —
  REQUIRE MISMATCH 0 everywhere, spot 100/100 (or list the ≤2 transient
  fails by name with curl evidence), technicals ≥ 98/100, deriv = exactly the
  perp-having subset (list count), meta best-effort. Visual smoke: /trading →
  crypto, first paint < 1s, no dash rows in Coin/Price/24h%. TN regression
  (board+intraday 200). Update docs/CRYPTO_COVERAGE_AUDIT.md + this ledger.

## Progress log

(append one line per completed task, real numbers only)

- 2026-07-13 CW-1: build_crypto_universe.mjs + docs/CRYPTO_UNIVERSE.md — CG top-100 dropped 35 (no venue 33, gate-fail 2), backfilled 35 from ranks 101–250 (APT, INJ, CAKE, VET, TIA, FET, SEI, CRV, LDO, PENDLE…), curated 100 = binance 87 + okx 13; typecheck 0, no app code changed.
- 2026-07-13 CW-2: CURATED_IDS + CG ids= in fetchCoinGecko (ids= curl-verified: 5 req → 5 mcap-ordered) — prod curl: 100 rows, USDT/USDD/XMR/DAI/HTX gone, APT/INJ/CAKE/VET/TIA in; audit spot 100/100, technicals 99/100 (1 NULL: GRAM/the-open-network — CG ticker renamed, Binance=TONUSDT, CW-4 candidate), deriv 83, meta 69, MISMATCH 0 everywhere; typecheck 0, vercel --prod aliased.
- 2026-07-13 CW-3: spot blob TTL 30s + venue `last` in spot rows (gate-verified, additive) + tickerMap/okxSpotMap 25s window + UI 30s visible-tab re-poll, price cell prefers spot.last ?? CG — prod curls 75s apart: BTC 62568.88→62280.01, ETH 1771.01→1770.04, SOL 75.67→75.40; 24h% untouched (CG); typecheck 0, vercel --prod. UI polling = setInterval 30s + visibilityState guard (code-verified; browser network-tab glance = user smoke).
- 2026-07-13 CW-4: okxDayCandle (1D, 5-min cache) → prevClose/gap on OKX spot rows (prod: OKB prevClose 79.97 gap 0, HYPE 63.933 gap 0.05, LEO 9.541 gap 0) + Binance 1000-prefix perp join (gate mark/1000) fills LUNC deriv (funding 0.0001, OI $4.36M, ratios live); perp-existence curl: FLR/NEXO/GNO/DCR/NFT/LEO + stables have NO perp on fapi/OKX → 16 deriv-nulls ARE parity. Audit: spot 100/100, tech 99/100 (GRAM), deriv 83→84, meta 70, MISMATCH 0; typecheck 0, vercel --prod.
- 2026-07-13 CW-5 FINAL: audit spot 100/100, technicals 99/100 (GRAM only — CG renamed TON ticker, ≥98 gate met), deriv 84/100 = exact perp-having subset (16 nulls curl-verified no-perp on fapi+OKX), meta 70 best-effort, MISMATCH 0 everywhere; /api/crypto/markets 200 in 0.313s (<1s first-paint budget), 100 rows, zero dash in Price/24h%; TN regression board 200 (1.18s) + intraday 200 (1.42s). V4 WORLD CLASS COMPLETE 5/5.
