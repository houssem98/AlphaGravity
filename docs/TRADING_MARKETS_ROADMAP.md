# Trading Markets Hub — Roadmap

TradingView-style multi-market experience at `/trading`. Pick a market
(Crypto, US, Tunisia) → drill into its asset list → open an asset chart.

**v1 scope:** Crypto + US (indices + stocks) + Tunisian market.
**Tunisia data:** mock first, wire real BVMT source later (Phase 6).

---

## 1. What exists today (reuse, don't rebuild)

`/trading` → `apps/market-ui/src/pages/TradingAssistantPage.tsx`, a 2-state view:

```
currentView: 'markets' | 'chart'
  markets → <Markets>        crypto-only CoinMarketCap clone (the screenshot)
  chart   → <AssetInfoPanel> + <Chart> + <CommunityPanel> + tabs
```

Reusable as-is:
- `components/trading/Markets.tsx` — list, search, sort, pagination, watchlist,
  expand-row, top-movers cards. Crypto-shaped today; **generalize** it.
- `components/trading/Chart.tsx` — candles + drawing tools + indicators.
- `components/trading/AssetInfoPanel.tsx`, `Topbar`, `Sidebar`, tabs.

**Data sources already live:**
| Source | Endpoint | Covers |
|---|---|---|
| coinlore/coincap | `/api/crypto/markets` | crypto (live) |
| Yahoo Finance | `/api/quote?symbols=`, `/api/history?symbol=` | **US indices, US stocks, commodities, bonds, forex** — all of it |

Prod: market-ui (Vercel) rewrites `/api/*` → `market-server-prod.fly.dev`.
Dev: vite proxy → `localhost:3002`.

**The only real build is Tunisia** (no free API). Everything else = symbol
lists + reuse. That asymmetry shapes the plan.

---

## 2. Target architecture (the lazy, correct one)

Three primitives. No per-market forks.

### 2a. Market registry — `lib/markets.ts`
```ts
export type MarketId = 'crypto' | 'us-indices' | 'us-stocks' | 'tunisia';
export type MarketSource = 'crypto' | 'yahoo' | 'tunisia-mock';

export interface MarketDef {
  id: MarketId;
  label: string;            // "Crypto", "US Markets", "Tunisian Market"
  currency: 'USD' | 'TND';
  source: MarketSource;
  symbols?: string[];       // yahoo/tunisia lists; crypto pulls its own
  columns: ColumnId[];      // crypto shows mcap/supply; stocks show P/E etc.
}
export const MARKETS: MarketDef[] = [ /* crypto, us-indices, us-stocks, tunisia */ ];
```

### 2b. Common row shape + adapter — `services/marketData.ts`
```ts
export interface AssetRow {
  symbol: string; name: string;
  price: number; changePct24h: number;
  changePct1h?: number; changePct7d?: number;
  marketCap?: number; volume?: number; sparkline?: number[];
}
export function fetchMarket(def: MarketDef): Promise<AssetRow[]> {
  switch (def.source) {
    case 'crypto':       return fetchCrypto();           // existing /api/crypto/markets
    case 'yahoo':        return fetchYahoo(def.symbols!); // /api/quote batched
    case 'tunisia-mock': return fetchTunisiaMock();       // static JSON
  }
}
```
Normalize every source to `AssetRow`. Crypto's current fields are a superset —
make the extras optional. **Swapping mock→real TN = change one `case` line.**

### 2c. View state machine — `TradingAssistantPage`
```
currentView: 'hub' | 'markets' | 'chart'   (default 'hub')
  hub     → <MarketHub>   grid of market cards           → pick market
  markets → <Markets market={def}>   generalized list    → pick asset
  chart   → existing chart flow, data source per market
```

**Sync** = one poll cadence per active view (list already polls 10s). Centralize
`formatMoney(value, currency)` and up/down colors. No global store unless flicker
proves it needed (YAGNI).

---

## 3. Phases

### Phase 0 — Foundation + verify · ~0.5d
- Confirm `Chart` + `AssetInfoPanel` render Yahoo symbols (`^GSPC`, `AAPL`) via
  `/api/history` — `CompanyPage` already uses Yahoo, so likely yes; verify.
- Confirm `/api/quote` batches many symbols (chunk if Yahoo caps the list).
- Land `AssetRow`, `MarketDef`, `MARKETS` registry, `fetchMarket` adapter. No UI.
- **Check:** one `test_marketData` asserting each adapter returns normalized rows.

### Phase 1 — Market hub entry · ~1–1.5d
- New `components/trading/MarketHub.tsx` from the reference "Markets at a Glance"
  design (`Kimi_Agent_Add Tunisian Crypto Market/app/src/App.tsx`), **re-themed to
  app CSS vars** (`var(--surface)`, `var(--accent)` …) — not the reference hex.
- Cards: Crypto, US Markets, Tunisian Market (live-ish snapshots) + greyed
  "coming soon" Commodities / Bonds / Forex to signal ambition.
- Add `view='hub'` default; wire back-nav hub↔markets↔chart; "Markets" logo → hub.

### Phase 2 — Generalize the list · ~1.5–2d
- Refactor `Markets.tsx` to take `market: MarketDef`; derive columns + data from it.
  Crypto path unchanged (backward compat).
- US: static symbol lists — indices (~10: `^GSPC ^IXIC ^DJI ^RUT …`), S&P 500
  constituents (`lib/sp500.json`, ~500, paginated — pagination already exists).
- Watchlist keyed per market. Reuse search/sort/pagination as-is.

### Phase 3 — Tunisia (mock) · ~0.5d
- `data/tunisia.mock.json` — TUNINDEX + BIAT/BNA/ATB/CELLCOM… in TND (seed from
  reference). Wire as `source:'tunisia-mock'`. TND formatting. "Indicative data" banner.
- `// ponytail: mock TN data; swap fetchTunisiaMock→/api/tn/markets when Phase 6 lands`.

### Phase 4 — Chart / detail per market · ~1d
- Route chart + `AssetInfoPanel` data source by market (crypto path vs Yahoo vs
  mock). Currency + exchange labels. TN chart from mock series.

### Phase 5 — Polish / premium / sync · ~1d
- Consistent formatting, loading skeletons, motion, empty states.
- Optional premium touch: top ticker tape (reference `tickerItems`).
- Responsive + `prefers-reduced-motion`.

### Phase 6 — Real Tunisia + more markets · later (not v1)
- market-server `/api/tn/markets` → **daily-seeded JSON** via cron scrape of
  ilboursa / bvmt.com.tn (BVMT is low-frequency; daily is fine). Flip adapter
  `tunisia-mock`→`tunisia`. **Zero UI change** — the adapter payoff.
- Commodities / Bonds / Forex cards go live (Yahoo symbol lists only).

---

## 4. Risks

- **Yahoo is unofficial** — rate limits / blocks. Mitigate: cache + batch in
  market-server (already used in prod, acceptable).
- **TN scraping (Phase 6)** — HTML breakage / legal gray. Daily low-volume seed
  keeps it low-risk; mock ships v1 without it.
- **S&P 500 constituent drift** — static JSON, refresh occasionally. No live
  constituent fetch (YAGNI).
- `/trading` is public (no auth guard) — keep it.

## 5. Effort

v1 (Phases 0–5): **~6 working days**. Critical path = Phase 2 (list generalize).
Phase 6 is decoupled and optional.
