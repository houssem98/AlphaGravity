# Crypto Screener V5 — ONE TICK (list and coin panel identical at the same millisecond)

V4 shipped the curated venue-verified universe with 30s-fresh list prices.
Remaining defect — the user's screenshots: click a coin and the panel shows a
DIFFERENT price (list BTC $62,191.27 vs panel $62,200.03) and a different %.

## Root cause — measured, not guessed (AssetInfoPanel.tsx:632-651)

The coin panel bypasses the entire truth layer the list uses:

1. **Two pipelines, two clocks.** List renders the server spot blob
   (gate-verified venue `last`, 30s cadence). Panel does its own browser
   fetches on a 12s timer: `api.binance.com/ticker/24hr?symbol={SYM}USDT`
   direct. Different fetch times → prices can never match at the click moment.
2. **Ungated bare-symbol joins in the panel.** Panel's Binance call is the
   exact hallucination class V3 killed server-side (no price cross-check, no
   CG-id join). And mcap/supply come from **coinlore** — the deprecated V1
   fallback.
3. **Different % definitions.** List % column = merged-% dropdown timeframe
   (1h/24h/7d/14d/30d/1y, CG definition). Panel = Binance's own rolling 24h%
   (different definition AND different source). +4.00% vs ▼3.02% is not one
   number disagreeing — it is two different metrics.
4. **Wrong volume in panel.** $1.26B = Binance BTCUSDT single-pair quote
   volume. List shows CG global 24h volume. Pair ≠ global.
5. **13 OKX-venue coins (OKB/HYPE/LEO…) have no `{SYM}USDT` on Binance** —
   panel's fetch fails silently for them; hardcoded CRYPTO_ASSETS/ASSET_META
   lists in constants/tradingAssets.ts predate the curated universe.

"Same exact millisecond" is achievable only one way: **both components render
from the same client-side store, fed by one live feed**. Not two fetches that
happen to be close.

## Doctrine (hard rules — carried from V3/V4 + new)

- **DESIGN FREEZE**: zero visual redesign. Markets.tsx table and
  AssetInfoPanel keep their exact look — only the numbers' source changes.
- **Truth rules verbatim from V3/V4**: price gate (venue vs CG base 3%,
  stables 1%), CG-id joins where ids exist, honest '—', no zeros-as-data.
- **ONE SOURCE RULE (new)**: a crypto number rendered in two places must be
  read from the same client store field. Never two fetches for one fact.
- Standing constraints: NO new serverless files (?view= branches in
  api/crypto/markets.ts only), vercel.json "regions":["fra1"], keyless APIs
  only (public WebSocket streams are keyless), no new npm deps (native
  WebSocket), additive payloads, typecheck 0 + vercel --prod + prod
  verification per task, commit each task on roadmap/world-class.
- Audit: scripts/audit_crypto_coverage.mjs must stay green (spot 100/100,
  MISMATCH 0) after every task.

## Ledger

- [ ] CV-1 **Venue in the base payload (server, additive)**: markets.ts base
  rows gain `venue: 'binance' | 'okx' | null` (the same gate verdict spotAll
  uses — compute once, reuse). Curl prod: BTC→binance, OKB→okx, and count
  (expect 87/13/0 ±transients). No UI change yet. Audit stays green.
- [ ] CV-2 **Shared crypto store (client)**: one module store (plain
  subscribable map or existing state lib — no new deps) holding base rows +
  spot rows, owned by the existing Markets fetch + 30s re-poll (CW-3 code
  moves in, not duplicated). Markets.tsx reads the store (rendered output
  identical). Typecheck 0, visual smoke: list unchanged.
- [ ] CV-3 **Panel reads the store — kill rogue fetches**: AssetInfoPanel
  crypto branch drops its direct Binance REST + coinlore calls and the 12s
  timer; price/Δ/24h%/mcap/volume/supply/high/low all come from the store row
  (CG base + venue spot — global volume, CG 24h% definition, gated venue
  last). OKX-venue coins now populate too. Verify: open BTC + OKB panels,
  every number equals the list cell at the same instant; label/layout pixels
  unchanged.
- [ ] CV-4 **Binance WS live tick (browser)**: native WebSocket to
  `wss://stream.binance.com:9443/stream?streams=<sym>usdt@miniTicker/...`
  for venue=binance coins (combined stream, chunk ≤100 streams); each tick
  updates store `last` after the client-side gate (|tick/CG−1| ≤ 3%, stables
  1% — same rule, same constants). Reconnect w/ backoff; disconnect on hidden
  tab (visibilitychange), resume on visible. 30s REST re-poll stays as
  fallback + CG-base refresher. Verify: list price cells tick sub-second in
  browser; audit MISMATCH 0.
- [ ] CV-5 **OKX WS live tick**: same store, `wss://ws.okx.com:8443/ws/v5/
  public` tickers channel for venue=okx coins (13). Same gate, same
  reconnect/visibility rules. Verify OKB/HYPE/LEO tick live.
- [ ] CV-6 **One-tick proof + sweep**: list cell and panel price render from
  the identical store value by construction — add a dev-only console.assert
  (or unit test) that both read the same field; screenshot-level check: click
  BTC/OKB/LUNC, panel price == row price char-for-char at the same moment;
  % chips: panel 24h% == list 24h option value. Full audit rerun (spot
  100/100, MISMATCH 0), TN regression (board+intraday 200), first paint <1s.
  Retire dead panel code paths + hardcoded CRYPTO_ASSETS crypto-detection
  where the store now answers (`isCryptoAsset` → store membership, fallback
  to old heuristic for non-universe symbols).

## Progress log

(append one line per completed task, real numbers only)
