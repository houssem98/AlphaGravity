# Firecrawl News Enrichment — Roadmap

**Goal:** upgrade TN news sentiment from *headline-keyword* scoring to *full-article*
scoring by scraping article bodies with [Firecrawl](https://github.com/firecrawl/firecrawl).
Everything is gated behind `FIRECRAWL_API_KEY` — **inert when the key is unset**, so
each phase ships safely and lights up the moment the key is added.

## Why
The engine's `news` factor and the Hermes daily brief currently score **Google News
RSS titles** with a FR/EN lexicon. Titles are thin and often neutral. Firecrawl turns
each article URL into clean main-content markdown, so the same lexicon (and later an
LLM) scores the *real text* — a much stronger, less noisy signal.

## Scope (in) / Non-scope (out)
- **In:** engine `news()` factor, Hermes daily brief, optional LLM sentiment, deep-research web sourcing.
- **Out:** SEC ingestion (edgartools already), BVMT/TN quotes (Grafana already), logos (favicon services), TN fundamentals (source PDFs, not HTML).

## Deployment
Hosted API only (`api.firecrawl.dev`, one key, pay-per-page). **No self-host** — the
Docker stack (Redis + workers + Playwright) is too heavy for the Hermes box. Add
`FIRECRAWL_API_KEY` to the market-ui Vercel project (Phases 1/4) and the Hermes box
(Phase 2).

---

## Phases

### Phase 0 — Client + flag  ✅ SHIPPED
- `firecrawlScrape(url)` helper in `apps/market-ui/api/tn/[fn].ts`: POST `/v1/scrape`,
  `onlyMainContent`, bounded `AbortSignal.timeout`. Returns `null` without a key or on
  any failure (best-effort, never throws).
- `toneSign(text)` extracted from the inline lexicon loop for reuse.
- **Acceptance:** unset key → helper returns null, engine unchanged.

### Phase 1 — Engine `news()` full-text  ✅ SHIPPED
- Parse `<link>` alongside `<title>` from the RSS items.
- Scrape the top **4** article bodies in parallel (bounded); score body text when we
  got it, else fall back to the title. Detail string reports `N full-text`.
- Inert without a key (all bodies null → identical to today's title scoring).
- **Acceptance:** with key, `/api/tn/engine?symbol=BIAT` `factors.news.detail` shows
  `… full-text`; without key, byte-identical to before.

### Phase 2 — Hermes daily brief  ⬜ TODO
- Mirror the enrichment in `agents/hermes/scripts/tn_daily_brief.py` (Python): scrape
  the day's top movers' articles, score bodies, cite the strongest source in the brief.
- Same `FIRECRAWL_API_KEY` gate; inert without it.
- **User deploys** (no repo/box creds here). Ship code in-repo, hand off.
- **Acceptance:** brief JSON carries a `sources` array with real article URLs.

### Phase 3 — LLM sentiment over scraped text  ⬜ TODO
- Replace the lexicon with a DeepSeek call (key already live) that reads the scraped
  body → `{tone: -1..1, reason}`. Keep lexicon as the no-key / no-LLM fallback.
- **Acceptance:** `factors.news.detail` cites a one-line LLM rationale.

### Phase 4 — Deep-research web sourcing  ⬜ TODO
- `apps/market-ui/src/services/deepResearchService.ts`: add a Firecrawl `/search` +
  `/scrape` step so research pulls live web context alongside the SEC corpus.
- **Acceptance:** a research run lists ≥1 Firecrawl-sourced web citation.

---

## Ledger
| Phase | State | Deploys me? |
|-------|-------|-------------|
| 0 Client+flag | ✅ | yes (inert) |
| 1 Engine news | ✅ | yes (inert) |
| 2 Hermes brief | ⬜ | code only, user deploys |
| 3 LLM sentiment | ⬜ | yes (DeepSeek key live) |
| 4 Deep research | ⬜ | yes |

**Flip switch:** add `FIRECRAWL_API_KEY` to Vercel `market-ui` → Phases 1/3/4 activate.
