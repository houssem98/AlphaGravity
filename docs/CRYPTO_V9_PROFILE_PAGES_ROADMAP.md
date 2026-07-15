# Crypto V9 — PROFILE PAGES (terminal-style, extreme-contrast, all 200 coins)

Spec source: gemini-code-1784130016527.md ("hardened technical profile pages").
All 200 coins in curated universe → individual profile cards (terminal aesthetic: dark bg,
bright monospace text, grid borders, micro-status blocks).

## Stack (reuse only)

- V7 CP-1 profile blobs (name/links/genesis/categories/supply)
- V8 NT news (days=7, match=, strict per-coin)
- Market rows (price, volume, mcap, 24h% from spot blob)
- NO new API files, NO new npm deps, NO new DB queries

## Doctrine (hard rules)

- **Terminal aesthetic**: CSS class `.terminal-profile` with dark background (#0a0e27),
  bright text (#00ff88 primary, #0088ff accent), monospace font, grid borders (1px
  solid rgba(0,255,136,0.2)). Extreme contrast = high readability in low light.
- **Micro-status blocks**: one-liner code blocks (`<pre>` / monospace) showing:
  price | volume | mcap | 24h% | supply. No charts, no fancy UI.
- **News feed snippet**: show newest 1-2 titles from V8 news (clip to 60 chars), link to full.
- **Per-coin profile**: name, ticker, genesis date, categories, description (first 120 chars),
  links (explorer, website, Twitter), status block, news snippet.
- **NO new serverless files** — all UI edits in apps/market-ui/src/pages/ or components/.
  Profile data pulled from existing blob APIs (markets.ts, news.ts, existing cached calls).
- **Keyless**, curl-verify profile shape before coding.
- Verify per task: market-ui typecheck 0 + vercel --prod + prod curl /api/crypto/markets
  returns profile blobs + audit green (spot 200/200 MISMATCH 0) + TN board/intraday 200s.
  Flip ledger [x], one Progress-log line real numbers, commit on roadmap/world-class.

## Ledger

- [ ] **P-1 ProfileCard component**: apps/market-ui/src/components/trading/ProfileCard.tsx —
  terminal-styled card layout. Props: symbol, name, profile (blob: description/links/
  genesis/categories), market (row: price/vol/mcap), news (1-2 top items). Render:
  <name> (<ticker>) block, monospace status (price|vol|mcap|chg|supply), link row
  (explorer|website|twitter), news snippet (newest title clipped 60ch, link). CSS:
  .terminal-profile dark/bright grid, <pre> for status, truncate text. No image, no
  fallback image — honest empty if any blob missing (price null = show "--").
  Verify: curl markets + profile blobs for BTC/ETH/GRAM — ProfileCard renders on
  component isolation (Storybook or manual import test).
- [ ] **P-2 Terminal theme CSS + ProfileGallery page**: apps/market-ui/src/pages/
  CryptoProfileGallery.tsx — full page showing 200 coins as ProfileCard grid (4-col
  responsive, 2-col mobile). Fetches /api/crypto/markets, maps to ProfileCard array,
  lazy-loads profile/news on scroll (IntersectionObserver, one coin at a time).
  CSS: .terminal-profile + .terminal-gallery (grid layout, gap 12px, dark page bg,
  grid border separators between cards). Route: /trading/profiles or /crypto/profiles.
  Verify: page load <500ms cold, render 4 cards, scroll down → load 4 more (no lag).
  TypeScript zero errors. Scroll to end (200 coins) → verify no missing cards.
- [ ] **P-3 Sweep**: prod pass for all 200 coins. Pick 10 random (BTC, ETH, GRAM, HYPE,
  PEPE, VELO + 4 random from bottom 100 by mcap). Verify each ProfileCard: (1) name/
  ticker render, (2) status block shows price/vol/mcap/24h%/supply (no NaN/null/
  undefined), (3) news snippet shows newest title or honest empty ("No recent news..."),
  (4) links render (explorer/website/twitter or empty if absent). CSS renders
  (grid border visible, text color bright, monospace font applied). Performance:
  full gallery (200) paint <2s cold, <500ms after cache. TN board/intraday 200s
  unchanged. Audit: spot 200/200 MISMATCH 0. Ledger + memory update. Final commit.

## Progress log

(append one line per completed task, real numbers only)
