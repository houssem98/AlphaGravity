# Crypto Screener V6 — TOP 200 (double the universe, same truth, same live tick)

V5 shipped: curated 100 venue-verified coins, WS live ticks (87 binance /
13 okx), one-source list/panel/cards via livePrice(). User ask: **add the
next 100 venue-verified coins → 200 rows**, each with the exact same
treatment — gated spot, technicals, deriv-where-perp-exists, live WS price,
identical everywhere on the page.

## Reality checks baked into this roadmap

- The next 100 coins come from CG ranks ~135–500 (venue coverage thins with
  rank; CW-1 needed top 250 to find 100 passes — 200 passes needs ~top 500).
- CG `/coins/markets?ids=` with 200 ids = one call, but URL is ~4KB and the
  response 200 rows — **curl-verify from prod before coding** (CU-2).
- markets.ts has hardcoded 100-caps sprinkled around (symbols slice, blob
  usable() row threshold, precompute slices) — every one must move to 200 or
  the new rows silently vanish.
- techAll/derivAll blob refresh does per-coin fetches (pool 8). 200 coins
  may exceed the serverless window — if refresh starts timing out, split the
  pass (precompute halves, still ONE blob file per view) rather than raising
  concurrency into 429 land.
- Binance combined WS allows 1024 streams/conn — ~180 binance-venue streams
  still = ONE socket. OKX subscribe list grows, still one msg. No change to
  the client architecture.
- Deep-rank coins legitimately lack perps/TVL — more '—' in deriv/meta IS
  Binance parity (doctrine). The hard bar stays spot+technicals.

## Doctrine (hard rules — verbatim from V3/V4/V5)

- **DESIGN FREEZE**: zero visual redesign. Same table, same 66 columns, same
  cards, same panel. Row count is data, not design (header "CRYPTOS 200" and
  pagination adapt on their own).
- **Truth rules**: price gate (venue vs CG 3%, stables 1%), CG-id joins,
  honest '—', no zeros-as-data, llama TVL id-anchored <$1M null CEX excluded.
- **ONE SOURCE RULE**: every rendered crypto price goes through
  livePrice(row, spotRow). New coins inherit it automatically — do not add
  a second path.
- **Curation objective**: top-200 = highest-mcap CG coins passing the venue
  test. Exclusions listed with reasons in docs/CRYPTO_UNIVERSE.md.
- Standing constraints: NO new serverless files (?view= branches in
  api/crypto/markets.ts only), vercel.json "regions":["fra1"], keyless APIs
  only + curl-verify each new endpoint/param shape from prod before coding,
  no new npm deps, additive payloads, typecheck 0 + vercel --prod (repo
  root) + prod curl with REAL numbers per task, commit on roadmap/world-class.
- Audit: apps/market-ui/scripts/audit_crypto_coverage.mjs after every task,
  REAL numbers in the Progress log.

## Ledger

- [x] CU-1 **Universe 200 (script only)**: build_crypto_universe.mjs — pull
  CG top 500 (5 pages, sequential, 2.5s spacing, 429 backoff), venue-test
  everything, emit curated **top-200** + full exclusions + JSON ids into
  docs/CRYPTO_UNIVERSE.md. Paste: deepest CG rank needed, venue split
  (binance/okx), how many of ranks 101–500 dropped and why. No app code.
- [x] CU-2 **Server to 200**: curl-verify CG `ids=` with the full 200-id list
  from prod (row count + mcap order). Then markets.ts: CURATED_IDS → 200;
  hunt every 100-cap (symbols `.slice(0, 100)`, manyRows/usable threshold,
  any precompute slice) → 200; verify blob refresh completes for all four
  views (time the spotAll/techAll passes; if techAll/derivAll exceed the
  function window, compute in two halves inside the same pass — one blob per
  view unchanged). Force-refresh blobs. Prod curl: base = 200 rows, spot
  blob = 200 rows, venue split printed. Audit (still at 100-coin scope) must
  stay green.
- [x] CU-3 **Client to 200**: loadSpot covers 200 (chunk symbols/px into
  2×100 calls if the URL nears limits — still owned by the store feed);
  Binance WS stream list = all venue=binance syms (one socket); OKX WS = all
  venue=okx syms; pagination/rows-per-page untouched (design freeze).
  Browser-visible check: page 2+ rows show live prices and populated
  technicals when toggled. Typecheck 0, deploy.
- [x] CU-4 **Audit to 200 + final sweep**: audit_crypto_coverage.mjs → 200
  coins (batches stay ≤25 for technicals/deriv). REQUIRE: spot ≥ 196/200,
  technicals ≥ 190/200 (list every NULL by name+reason), MISMATCH 0
  everywhere, deriv = exact perp-having subset (count it), meta best-effort.
  First paint < 1.5s (base blob doubles — measure real). TN regression
  (board+intraday 200 OK). Update docs/CRYPTO_COVERAGE_AUDIT.md, memory,
  this ledger.

## Progress log

(append one line per completed task, real numbers only)

- 2026-07-13 CU-1: build_crypto_universe.mjs → CG top 500 scan, curated 200 = binance 176 + okx 24, deepest CG rank 426; CG top-200 dropped 79 (stables/no-venue/XMR-class), backfilled 79 from ranks 201–500 (THETA, RUNE, MANA, NEO, SAND, DYDX, 1INCH, GALA, EGLD, YFI…); NEW: symbol-collision rule (venue maps symbol-keyed — higher-mcap id owns ticker), 1 excluded: safecoin vs safe (both "SAFE" on OKX); 200 unique ids verified; typecheck 0, no app code.
- 2026-07-13 CU-2: CG ids= curl-verified with 200 ids (URL 2211 chars, 200 rows, mcap-ordered, per_page=250 — was silently truncating at 100); CURATED_IDS → 200; symbols caps 100→200 on spot+meta views (tech/deriv stay 25 page-lazy); prod after blob refresh: base 200 rows (binance 176/okx 24, last=HOME), spot blob 200 rows, 178 with venue last (rest warmup); audit (100-scope until CU-4): spot 100/100 tech 99 deriv 84 meta 69 MISMATCH 0; typecheck 0, vercel --prod.
- 2026-07-13 CU-3: loadSpot 200 coins via 2×100-symbol chunks (URL safe, same blob); WS lists were already uncapped venue-filters over base → 176 binance streams on one socket + 24 okx auto-subscribed; pagination untouched; prod technicals for backfill coins verified: THETA rsi 48.0, MANA 48.7, GALA 31.6, NEO 34.9, YFI 54.5 (all rated); audit spot 100/100 tech 99 deriv 84 meta 69 MISMATCH 0; typecheck 0, vercel --prod.
- 2026-07-13 CU-4 FINAL: audit → 200 coins. spot **200/200**, technicals 197/200 (≥190 ✓; NULLs: GRAM/the-open-network CG-rename, DATA/story-2 Binance-Streamr collision gate-blocked, RE/re — all honest gate-protected misses), deriv 177/200 = perp-having subset (23 nulls: stables + LEO/NEXO/FLR/GNO/NFT/DCR/TFUEL/BABYDOGE class), meta 124/200 best-effort, **MISMATCH 0 everywhere**; /trading 200 in 0.348s (<1.5s bar), base blob 127KB, 200 rows 0 dash Price/24h%; TN regression board 200 0.73s + intraday 200 1.85s. V6 TOP 200 COMPLETE 4/4.
