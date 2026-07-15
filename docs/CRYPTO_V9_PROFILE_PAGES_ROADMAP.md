# Crypto V9 — NEWS TAB TERMINAL (rich sources + terminal report header, all 200 coins)

Spec source: gemini-code-1784130016527.md (terminal report structure) + user
screenshot (CMC-style coin news page) + user directive: "for news tab, merge
all other links for information not only coindesk". Applies to the News tab
of every coin page, all 200 curated coins.

## Problem (verified V8 state)

- CRYPTO_WL whitelist too thin → BTC news = CoinDesk monoculture (8/10 items),
  HYPE/VELO filtered to zero. Reputable crypto outlets (CoinPedia, BSC News,
  U.Today, CryptoSlate, Bitcoinist, Blockworks, DL News...) all discarded.
- News tab is a plain list — spec wants a terminal report: coin header +
  micro-status block (price | 24h% | article count) above the feed.

## Doctrine (hard rules — V7/V8 carry-over)

- TRUTH intact: NT-1 horizon (days=7, newest-first) and NT-2 strict per-coin
  title match STAY — widening sources must NOT reintroduce cross-contamination
  or stale news. Honest empty stays for genuinely uncovered coins.
- Whitelist widens to a CURATED crypto-media list (named outlets only), never
  removed entirely — random SEO spam blogs stay out.
- NO new serverless files (12-fn cap) — server edits in api/news.ts only.
  No new npm deps. Google RSS has no thumbnails — no images, no scraping.
- TN news path byte-identical. Legacy /api/news?q= unchanged.
- Verify per task: typecheck 0 + vercel --prod (repo root) + prod curl real
  numbers + TN regression + audit (spot 200/200 MISMATCH 0). Flip [x], one
  Progress-log line, commit on roadmap/world-class (-F file if quotes).

## Ledger

- [ ] N-1 **Source expansion (server)**: api/news.ts — widen CRYPTO_WL to
  ~30 named crypto/finance outlets (add: coinpedia, bsc news, u.today,
  cryptoslate, bitcoinist, newsbtc, beincrypto, ambcrypto, cryptopotato,
  crypto.news, the defiant, blockworks, dl news, watcher.guru, cryptobriefing,
  dailycoin, crypto adventure, benzinga, yahoo finance, investing.com,
  coinspeaker, finbold, tronweekly). Keep strict match + horizon. Verify:
  prod curl BTC — sources now ≥4 distinct outlets in top 10 (not CoinDesk
  monoculture); HYPE and VELO recover ≥1 item each OR stay honest empty;
  GRAM zero cross-asset leaks (strict match still holds).
- [ ] N-2 **Terminal report header (UI)**: NewsTab.tsx — above the feed add
  terminal-style report block per gemini spec: "{NAME} ({SYM}) — NETWORK
  NEWS" title row + monospace micro-status line (live price | 24h% | N
  articles | 7d window) pulled from cryptoStore livePrice (same one-source
  rule as V5 — no new fetch). Separator lines, existing dark theme tokens,
  monospace font for the status line only. List rows unchanged (design
  freeze below header). TN News tab: keep current plain header (no terminal
  block). Verify: typecheck 0, prod ETH News tab shows header w/ live price
  matching topbar, article count == rendered rows.
- [ ] N-3 **Sweep**: prod pass BTC/ETH/GRAM/HYPE/PEPE/VELO — source diversity
  (BTC ≥4 outlets), ≤7d, newest-first, zero title leaks, honest empty only
  where truly uncovered; TN news/board/intraday 200s; audit spot 200/200
  MISMATCH 0; ledger + memory; final commit.

## Progress log

(append one line per completed task, real numbers only)
