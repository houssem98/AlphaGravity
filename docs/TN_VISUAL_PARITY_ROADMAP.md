# TN Visual Parity — bring the crypto V8–V10 polish to the Tunisian market

The crypto coin pages got, in order: real logos in the header (fix), a News-tab
terminal header (V9 N-2: price + 24h + article count + window), and a CMC-style
news layout (V10: hero image + headline list). The TN company pages are at data
**truth** parity already (roadmap T9–T23 + company ledger C1–C8 all DONE) but
lag on the recent **visual** wins. This roadmap closes the honest subset of that
gap — the parts that don't require data TN doesn't have.

## Rectified spec (crypto win vs what TN can honestly ship)

| Crypto win | TN verdict |
|---|---|
| Real logo in detail header | SHIP — `TN_DOMAINS` favicon map already exists ([MarketList.tsx:63](../apps/market-ui/src/components/trading/MarketList.tsx#L63)), only wired into list rows. Wire it into the AssetInfoPanel detail header + the TnAbout header. Letter fallback stays for unmapped tickers / failed loads (honest). |
| News terminal header (V9 N-2) | SHIP — TN has live price (`/api/tn/board`, `/api/tn/intraday`). Give the TN NewsTab an equivalent terminal block: last price + day change + article count + session date. French-appropriate, our tokens. |
| News hero + thumbnails (V10) | SKIP — BVMT companies publish no RSS with media tags; there are no honest images to show. TN news stays a plain chronological list. Documented, not a gap to paper over. |
| Grok AI hero-banner art | DEFER — blocked on xAI credits (crypto side too). Not in this roadmap. |

## Doctrine (hard rules)

- TRUTH intact: no fake data, no placeholder logos, no stock art. Unmapped
  ticker → honest 2-letter initials (current behavior). Failed favicon load →
  same fallback via `onError`. Honest-empty news stays.
- NO new serverless files — reuse `/api/tn/[fn]` and the shared `/api/news`
  (`region=tn`). No new npm deps. No page scraping. Logos come from the
  existing DuckDuckGo favicon service (keyless) only.
- TN news stays region=tn plain list — NO outlet merge, NO images, NO hero.
  Only the HEADER changes. Legacy `/api/news?q=` (no params) untouched.
- Crypto path byte-identical: the logo wiring is TN-only (`isTN` guard); the
  crypto header logo (just shipped) must not regress. `market !== 'tunisia'`
  branches unchanged.
- UI: OUR design tokens only (`--bg/--surface/--line/--text*/--accent`). Logos
  render on a white chip (favicons need it), rounded, `object-contain`, fixed
  size; `onError` → initials. No layout shift.
- Verify per task: market-ui typecheck 0 + `vercel --prod` (repo root) + prod
  curl real numbers + TN regression (BIAT board + intraday + news 200s) +
  crypto regression (a crypto coin still shows its logo; audit spot 200/200
  MISMATCH 0) + flip `[x]`, one Progress-log line (real numbers), commit on
  `roadmap/world-class` (`-F` file if the message has quotes — rtk mangles them).

## Ledger

- [ ] TNV-1 **Logos in TN detail views**: wire the existing `TN_DOMAINS`
  favicon into (a) the AssetInfoPanel detail header — currently `asset.charAt(0)`
  for TN ([AssetInfoPanel.tsx:795](../apps/market-ui/src/components/trading/AssetInfoPanel.tsx#L795)); the crypto `logoUrl` is already there, add a TN branch:
  `isTN && TN_DOMAINS[sym] ? https://icons.duckduckgo.com/ip3/{domain}.ico`
  — and (b) the TnAbout header — currently `asset.charAt(0)`
  ([AboutTab.tsx:41](../apps/market-ui/src/components/trading/tabs/AboutTab.tsx#L41)). Both render the img over the existing
  circle with `onError` hiding it so the initials show behind (mirror the crypto
  fix). Export/import `TN_DOMAINS` (already exported from MarketList). Verify:
  typecheck 0; prod — BIAT/SFBT/PGH headers show a real favicon; an unmapped
  ticker still shows initials; a crypto coin (TRX) still shows its logo (no
  regression); TN board/intraday 200s.
- [ ] TNV-2 **TN News terminal header (V9 N-2 parity)**: NewsTab.tsx TN branch —
  replace the plain `{name} News` header ([NewsTab.tsx:56](../apps/market-ui/src/components/trading/tabs/NewsTab.tsx#L56)) with a terminal block
  matching the crypto one's structure but TN-sourced: company name + `(SYMBOL)`
  + `— ACTUALITÉS`, then a mono strip with last price (from `/api/tn/board`
  or the cryptoStore-equivalent TN price the panel already holds), day change %,
  article count, and the session date. Reuse the crypto header's markup/tokens;
  no new fetch if the price is already in props/context — otherwise a single
  `/api/tn/board` read, partial-tolerant (missing price → `--`, never blocks the
  list). TN list rendering below unchanged (plain, no images). Verify: typecheck
  0; prod — BIAT news header shows real last price + change + count; honest `--`
  when price unavailable; crypto news header unchanged; legacy `/api/news?q=`
  byte-identical.
- [ ] TNV-3 **Sweep**: prod pass BIAT/SFBT/PGH/TAIR/an-unmapped-ticker — logos
  present for mapped, honest initials for unmapped, no layout shift; TN news
  header shows real numbers, list still chronological + honest-empty where
  uncovered; TN board/intraday/news 200s; crypto regression (TRX logo + audit
  spot 200/200 MISMATCH 0); ledger + memory; final commit.

## Progress log

(append one line per completed task, real numbers only)
