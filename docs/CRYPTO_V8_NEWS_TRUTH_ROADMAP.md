# Crypto V8 — NEWS TRUTH (7-day horizon, newest-first, per-coin strict match)

Spec source: gemini-code-1784062868552.md ("Phase 2.5: Chronological News
Sorting & Strict Horizon Enforcement"), rectified against our stack. Spec
assumes CCData/CryptoCompare with entity tags; we run Google News RSS via
api/news.ts (V7 CP-6 added the wl=crypto source whitelist). Applies to ALL
200 coins in the curated universe, every coin page News tab.

## Rectified spec (what gemini asked vs what ships)

| Spec item | Verdict |
|---|---|
| 7-day horizon filter in ingest loop | SHIP — parse pubDate server-side, drop >7d. Also append `when:7d` to the Google query (fetch-boundary constraint, the RSS equivalent of the spec's sort/order params). |
| UI fallback "No recent news articles found for [Asset] within the last week." | SHIP — NewsTab empty-state copy, existing empty-state styling. |
| `sort=news_newest` / `order=descending` aggregator params | RECTIFY — Google RSS has no sort param; server sorts by pubDate desc after filtering (RSS order is approximate, not guaranteed). |
| Strict matching matrix vs entity tags array | RECTIFY — RSS carries no entity tags; match against the TITLE: coin NAME (case-insensitive word match) OR SYMBOL as standalone ALL-CAPS token. Generic/common-word symbols (GAS, SUN, RE, IO, FOUR, HOME, USA, CHIP, TURBO, GRASS, VELO-class) never match by symbol case-insensitively — the all-caps token rule handles this structurally ("US Gas Prices" has "Gas", not "GAS"). |
| Discard BTC macro articles from other tokens' panels | SHIP — the title-match filter does exactly this; a Bitcoin article shows under VELO only if the title names VELO/Velo explicitly. |

## Doctrine (hard rules — V7 carry-over)

- **TRUTH**: honest empty beats stale/cross-contaminated news. NEVER show
  another asset's articles. Filtered-to-zero → honest empty with the spec's
  copy, existing empty-state styling (DESIGN FREEZE).
- **NO new serverless files** — all server work is edits to api/news.ts
  (Hobby 12-function cap). No new npm deps. vercel.json keeps fra1.
- Params additive-only: bare /api/news?q= keeps legacy behavior; TN path
  (region=tn) must be COMPLETELY untouched by horizon/match/sort changes —
  TN news is French, low-volume, 7-day cut would empty it.
- Keyless only; curl-verify `when:7d` query behavior from prod before coding.
- Verify per task: market-ui typecheck 0 + `vercel --prod` (repo root) +
  prod curl real numbers + audit green (spot 200/200, MISMATCH 0) + TN news
  regression (BIAT still serves Ilboursa-class sources) + cross-contamination
  spot-check (VELO news panel contains zero generic-Bitcoin titles; GRAM
  panel zero BTC). Flip ledger [x], one Progress-log line real numbers,
  commit on roadmap/world-class (git commit -F file if quotes).

## Ledger

- [x] NT-1 **Horizon + newest-first (server)**: api/news.ts — new param
  `days=N` (crypto callers pass 7): append `when:{N}d` to the Google query,
  parse each item's pubDate, DROP anything older than N days (belt +
  suspenders vs Google's approximation), then sort remaining items by
  pubDate desc before slicing to 24. Invalid/missing pubDate under days= →
  drop (unverifiable age = out). Legacy callers (no days=) and TN path
  byte-identical behavior. Verify: prod curl BTC with days=7 — every
  pubDate within 7 days AND strictly newest-first; TN BIAT query unchanged
  (no days= sent).
- [x] NT-2 **Strict per-coin match (server) + UI copy**: api/news.ts — new
  param `match=` (crypto callers pass the coin name, symbol already in q):
  keep an item only if title contains the coin name (case-insensitive,
  full-name match) OR the symbol as a standalone ALL-CAPS token (regex
  word-boundary, exact case, len>=2). NewsTab: crypto fetch adds
  &days=7&match={name}; empty-state copy becomes "No recent news articles
  found for {name} within the last week." (existing styling). TN fetch
  untouched. Verify: prod curl VELO (spec's example) and GRAM — zero titles
  without the coin's name/symbol; BTC panel still rich; a generic "crypto
  market" title absent from both.
- [ ] NT-3 **Sweep**: prod pass for BTC, ETH, GRAM, HYPE, PEPE, VELO — News
  tab ≤7d, newest-first, whitelisted sources, zero cross-asset titles,
  honest empty where filtered to zero; TN regression (BIAT news + board +
  intraday 200s); audit rerun green (spot 200/200 MISMATCH 0); ledger +
  memory update; final commit.

## Progress log

(append one line per completed task, real numbers only)

- **NT-1 live** (2026-07-14): days= param — when:Nd at fetch boundary + server drop >N days (invalid pubDate = out) + sort desc; curl-verified when:7d works AND raw RSS order is non-chronological (Jul 9 before Jul 14 in raw feed); prod BTC days=7 now strictly Jul 14 11:15 → Jul 10, all ≤7d; TN BIAT byte-identical (Ilboursa/African Manager/Tustex)
- **NT-2 live** (2026-07-14): match=+sym= — clean-name word match (paren segment stripped: "Gram (prev. Toncoin)"→"Gram") OR all-caps symbol token exact-case; NewsTab passes days=7&match&sym for crypto, spec empty copy in; prod: VELO=0 rows honest empty (no generic-BTC backfill), GRAM 100% Gram-titled zero BTC, BTC rich (4/4 titles name bitcoin/BTC); TN untouched; audit spot 200/200 MISMATCH 0
