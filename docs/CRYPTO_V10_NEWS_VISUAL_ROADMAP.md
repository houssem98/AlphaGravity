# Crypto V10 — NEWS VISUAL (CMC-style hero + headline list, our design, all 200 coins)

Spec source: user screenshot (CMC Bitcoin News page) — hero article with big
thumbnail left, headline list right (source + time ago), Top/Latest toggle.
Rebuilt with OUR design tokens (dark theme vars, existing typography), for the
News tab of every coin page, all 200 curated coins.

## Rectified spec (CMC vs what ships)

| CMC element | Verdict |
|---|---|
| Hero thumbnail article | SHIP — images from outlet RSS media tags. CCData/CryptoCompare news API is DEAD keyless (401 since CoinDesk acquisition — curl-verified 2026-07-15). Instead merge outlet RSS feeds that carry media:content/enclosure: Cointelegraph, Decrypt, Bitcoinist, NewsBTC, BeInCrypto (all 5 curl-verified). CoinDesk redirects, CryptoSlate is Cloudflare-walled, u.today imageless — excluded. |
| Headline list right column | SHIP — remaining items, source + timeAgo, our list styling. |
| Top / Latest toggle | SHIP client-side — Latest = pure chronological (server order); Top = items WITH image + tier-1 sources first, then rest by recency. No extra fetch. |
| "Summarize with CMC AI", CMC Daily Analysis | SKIP — out of scope. |
| Thumbnails on every row | Hero only + small thumbs where image exists; rows without image render text-only (honest — no placeholder stock art). |

## Doctrine (hard rules — V8/V9 carry-over)

- TRUTH intact: 7-day horizon, newest-first, strict per-coin title match, and
  40-outlet whitelist ALL STAY. Outlet-feed items pass the SAME match/horizon
  filters. Honest empty stays. NO fake/placeholder images.
- NO new serverless files — server edits in api/news.ts only. No new npm deps.
  No page scraping — RSS feeds + their embedded media URLs only.
- Outlet feeds fetched in PARALLEL with the Google RSS fetch, per-feed 6s
  timeout + partial-tolerant (a dead feed never 500s the route); s-maxage=900
  edge cache absorbs the fan-out cost.
- Dedupe merged items by normalized title (lowercase, strip non-alnum).
- TN news path byte-identical (no outlet merge, no images, plain header).
  Legacy /api/news?q= (no params) unchanged.
- UI: OUR design tokens only (--bg/--surface/--line/--text*/--accent), no
  CMC colors. Images lazy-loaded, object-cover, fixed aspect; onError hides
  the img (no broken-image icons).
- Verify per task: typecheck 0 + vercel --prod (repo root) + prod curl real
  numbers + TN regression + audit (spot 200/200 MISMATCH 0) + leak spot-check
  (GRAM zero cross-asset titles). Flip [x], one Progress-log line, commit on
  roadmap/world-class (-F file if quotes).

## Ledger

- [x] V10-1 **Outlet RSS merge + images (server)**: api/news.ts — when
  wl=crypto, fetch 5 outlet feeds (Cointelegraph, Decrypt, Bitcoinist,
  NewsBTC, BeInCrypto) in parallel with Google RSS (Promise.allSettled,
  6s AbortSignal.timeout each); parse media:content url= / enclosure url=
  per item into new `image` field (Google items: image=''); merge, dedupe
  by normalized title, then existing pipeline (whitelist bypassed for the
  5 named feeds — they ARE the source; strict match + days horizon + sort
  desc apply to ALL). Verify: prod curl BTC — ≥3 items carry image URLs
  from ≥2 outlets, all ≤7d, newest-first, zero unmatched titles; GRAM zero
  leaks; VELO honest empty; TN + legacy responses byte-identical.
- [ ] V10-2 **CMC-style layout (UI)**: NewsTab.tsx — crypto 'ready' state
  becomes two-zone layout under the N-2 terminal header: LEFT hero = newest
  item WITH image (large img aspect-video object-cover rounded, headline
  text-lg below, source + timeAgo row); RIGHT column = remaining items
  (headline + source + timeAgo, small thumb if image). Top/Latest segmented
  toggle (styling of existing PRICE/MCAP segment): Latest = server order,
  Top = has-image + tier-1 (coindesk/cointelegraph/bloomberg/reuters/cnbc/
  forbes/decrypt) first. Mobile (<md) stacks hero above list. No items with
  image → plain list (current look). TN untouched. Verify: typecheck 0,
  prod chunk carries new markup, /trading paint <1s.
- [ ] V10-3 **Sweep**: prod pass BTC/ETH/GRAM/HYPE/PEPE/VELO — images
  present for majors (BTC/ETH hero exists), ≤7d, newest-first, zero leaks,
  honest empty where uncovered; dedupe works (no double titles); TN news/
  board/intraday 200s; audit spot 200/200 MISMATCH 0; ledger + memory;
  final commit.

## Progress log

(append one line per completed task, real numbers only)

- **V10-1 live** (2026-07-15): 5 outlet feeds (Cointelegraph/Decrypt/Bitcoinist/NewsBTC/BeInCrypto) fetched parallel w/ Google RSS, Promise.allSettled + 6s timeout each; media:content/enclosure → image field; dedupe by normalized title; prod BTC 10/24 items carry image URLs (Decrypt/BeInCrypto/ctmedia); GRAM zero cross-asset leaks; legacy /api/news?q= + TN byte-identical (image key stripped when wl!=crypto); typecheck 0
