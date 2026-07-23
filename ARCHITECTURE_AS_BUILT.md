# AlphaGravity — As-Built Architecture Document

**Method:** extracted from source in this repo (2026-07-23). Nothing inferred from intent docs unless labelled. Anything not verifiable in code/config is marked `MISSING INFORMATION`.

**Audit note for the reviewing architect:** roadmap/marketing docs in `docs/` describe *planned* topology. This document describes *shipped* topology. Where they disagree, the code wins and the gap is flagged.

---

# Project Identity

## Project Name
`alphagravity` (root `package.json`). Repo dir `antigravity`. FastAPI service self-names "Gravity Search" (`services/gravity-api/app/config.py:app_name`). Three names, one system.

## Main Objective
Financial research over primary sources: ingest SEC filings / earnings / news / market data, retrieve with hybrid RAG, generate cited answers, plus market-data screeners (US equities, crypto, Tunisian BVMT) and a spreadsheet-style research grid.

## Target Users
Not declared in code. From shipped surface: buy-side/retail research users (auth, billing tiers, org RBAC, MFA, SSO/SAML exist → B2B/prosumer SaaS). `MISSING INFORMATION` — no written ICP.

## Current Status
Mixed, per-component:

| Component | Status | Evidence |
|---|---|---|
| market-ui | **Production** (Vercel) | `vercel.json`, Vercel serverless fns in `apps/market-ui/api/` |
| gravity-api | **Production** (Fly, app `gravity-api-prod`, iad) | `services/gravity-api/fly.toml` |
| market-server | **Production** (Fly, app `market-server-prod`, `min_machines_running = 0` → cold start) | `services/market-server/fly.toml` |
| gravity-ui (Next.js) | **Orphaned but publicly live.** No deploy config or CI workflow in-repo, yet Vercel project `gravity-ui` (`prj_spU1…`) serves HTTP 200 at `gravity-ui-ashy.vercel.app` from a single production deployment dated **2026-03-26** (repo initial-commit code, never redeployed). A second Vercel project `antigravity-gravity-ui` exists with 0 deployments. | `apps/gravity-ui/`, Vercel API (verified 2026-07-23) |
| sentiment-api | CryptoBERT wrapper, containerised, no deploy config found | `services/sentiment-api/app.py` |
| `render.yaml` | Defined but appears superseded by Fly | `render.yaml` |

Feature-completeness is uneven: several core retrieval features are **coded but flag-gated OFF in production** (see §17).

---

# 1. Complete System Architecture

```
                                   USER (browser)
                                        │
        ┌───────────────────────────────┴──────────────────────────┐
        │                                                          │
  market-ui (Vite+React 19, Vercel)                    gravity-ui (Next.js 15, LOCAL ONLY)
        │                                                          │
        ├── Vercel serverless fns  apps/market-ui/api/*            └── WS + REST → gravity-api
        │     quote/news/history/financials/fundamentals/spark
        │     crypto/markets, crypto/klines, crypto/sparkline/[id]
        │     social/influencers/[asset], tn/[fn]  (TN dispatcher)
        │
        ├── Supabase (auth, Postgres REST, Storage blobs)
        │
        ├──→ market-server (Express/TS, Fly :3001)
        │        routes: research, market, social, predictions, trading,
        │                llm, tavily, firecrawl, orgs, claude, hermes
        │        ws:/ws  → Yahoo chart poll every 2s → push ticks
        │        └──→ gravityClient.ts ──→ gravity-api
        │
        └──→ gravity-api (FastAPI, Fly :8000)  ← core search + ingestion
                 │
                 ├ API: search(+WS), documents, entities, company, grid_search,
                 │      grid_schedule, analytics, auth, sso, billing, usage,
                 │      workspaces, feedback, forecast, trading, claude, hermes, health
                 ├ Pipeline: query understanding → semantic cache → parallel retrieval
                 │           → RRF fusion → rerank → LLM gen → verification → stream
                 ├ Agents: Planner→Reader→Extractor→Critic→Writer (GATED OFF)
                 ├ Ingestion: sec_edgar, sec_xbrl, earnings, news, gdelt, polygon,
                 │            refinitiv, crypto/social signals, user_upload
                 │
                 └ Stores: Qdrant (dense+sparse vectors) │ Postgres/Timescale + Supabase
                           Redis (cache/dedupe/rate-limit) │ Elasticsearch │ Neo4j
                           Kafka (optional ingest bus)
                                        │
                External: Anthropic, OpenAI, Google, DeepSeek, Groq, OpenRouter(Hermes),
                          Voyage, Cohere, Jina embeddings/rerank, SEC EDGAR, Alpha Vantage,
                          Quartr, FRED, Tavily, Firecrawl, PageIndex(VectifyAI), GDELT,
                          Yahoo Finance, Binance/OKX, BVMT, MCP data providers
```

### Component detail

**market-ui**
- Purpose: primary product UI (research, company pages, screeners, grid, billing).
- Tech: Vite 6, React 19, TypeScript, Tailwind 3, Radix UI, Zustand, react-router 7, recharts + lightweight-charts, exceljs, @react-pdf/renderer, pptxgenjs, supabase-js.
- Why chosen: `MISSING INFORMATION` (no ADR in repo).
- Input: user actions. Output: rendered research + exports (PDF/XLSX/PPTX).
- Depends on: Vercel fns, Supabase, market-server, gravity-api.

**market-server**
- Purpose: market data + deep-research API + LLM proxy + org/RBAC + WS ticks.
- Tech: Express, TypeScript, `ws`, node ≥20, Docker on Fly (1 shared CPU, 512 MB).
- Input: REST from market-ui. Output: JSON, WS `{type:'trade',...}` frames.
- Depends on: Yahoo Finance, Supabase, Tavily, Firecrawl, LLM providers, gravity-api.

**gravity-api**
- Purpose: retrieval/generation engine + ingestion + auth/billing/compliance.
- Tech: FastAPI, uvicorn 1 worker, Python 3.12-slim container, structlog, pydantic-settings, SQLAlchemy async + asyncpg, orjson. Fly VM: shared 2 CPU / 4096 MB (memory sized for 40 MB+ 10-K parse, per comment in `fly.toml`).
- Input: REST + WebSocket queries, ingestion jobs. Output: streamed `SearchEvent`s.
- Depends on: all stores + all LLM/embedding vendors.

**gravity-ui** — Next.js 15 conversational search client. Structurally orphaned (not in root `dev`/`build`, no CI, no shared-types usage) but functionally load-bearing: `src/lib/ws.ts` is the **only client of gravity-api's streaming search API in the repo**. market-ui has zero WebSocket paths to gravity-api. A stale public build serves at `gravity-ui-ashy.vercel.app`.

**sentiment-api** — FastAPI wrapper around `ElKulako/cryptobert` (HF transformers pipeline; trained on 3.2 M crypto social posts). Routes: `POST /classify` → `[[{label: Bullish|Neutral|Bearish, score}]]`, `GET /health`. No deploy config → local/optional.

---

# 2. Frontend Architecture

## market-ui (the shipped frontend)
- **Framework:** Vite + React 19 + TS.
- **Hosting:** Vercel. Build `npm -w market-ui run build` → `apps/market-ui/dist`. SPA rewrite `/(.*) → /index.html`; `/api/(.*)` served by Vercel fns. Immutable 1-year cache on `/assets/*`.
- **State:** Zustand — `stores/`: `qaStore`, `cryptoStore`, `gridRunStore`, `researchStore`, `companyBriefStore`, `backgroundStore`.
- **Auth:** Supabase (`@supabase/supabase-js`, `services/supabase.ts` 27 KB) with pages for sign-in, email verify, forgot/reset password, MFA setup (`MfaSetupPage.tsx`). gravity-api also ships its own JWT auth (`api/routes/auth.py`, `sso.py`) — **two auth systems coexist**; prod UI uses Supabase.
- **UI libs:** Radix primitives + Tailwind + `class-variance-authority`, `sonner` toasts, `cmdk`, `vaul`, `motion`/GSAP.
- **Charts:** recharts + `lightweight-charts` (TradingView lib).
- **Tables:** custom (grid engine in `services/gridResearch.ts`, `gridExcel.ts`); no table lib dependency.
- **Streaming:** gravity-api WS via `services/gravitySearchService.ts`; market-server WS `/ws` for quote ticks.
- **API communication:** `services/api.ts` + per-domain service modules (`secEdgarService`, `tavilyService`, `firecrawlService`, `fredService`, `cryptoMarketService`, `marketsHub`, `deepResearchService`).

```
apps/market-ui/src/
├── components/   ├── pages/       (19 pages: Search 113 KB, Company 39 KB,
├── contexts/     ├── sections/     TradingAssistant 35 KB, Billing/Admin, Auth…)
├── hooks/        ├── services/    (60+ modules incl. deepResearchService.ts 233 KB)
├── lib/          ├── stores/      (Zustand)
├── data/         └── utils/
apps/market-ui/api/  (Vercel serverless fns — dispatchers to dodge the Hobby 12-fn cap)
```

- **How a user requests research:** UI calls `deepResearchService` / `gravitySearchService` → either gravity-api `/v1/search` (+WS stream) or market-server `/api/research`; grid cells go through `gridResearch.ts`.
- **How results render:** streamed tokens append live; sources arrive before the answer (progressive render); citations render as source chips; structured tables arrive as a `structured_table` event; confidence/QA scores come from `reportQaGates.ts` + `gridTrust.ts` (earned A–F grades). Export paths: `pdfExport`/`pdfDesigner` (+ post-render QA), `presentationExport` (pptx), `gridExcel` (xlsx).

## gravity-ui
Next.js 15 + Turbopack, TanStack Query, Zustand, framer-motion, recharts. 25 tracked files; 6 components (SearchBar, AnswerPanel, SourcePanel, CitationLink, ConfidenceBadge, FollowUpSuggestions, StreamingIndicator). **No auth dependency** — reads `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_WS_URL` only (`CLAUDE.md`'s Clerk claim was wrong; corrected 2026-07-23).

Its `src/lib/ws.ts` speaks `/v1/search/stream` — the gravity-api WebSocket route (`search.py:177`). `CLAUDE.md` documented this as `/v1/search/ws`; wrong, corrected. Keep this app runnable: it is the only exercise of the streaming event contract.

---

# 3. Backend Architecture

## gravity-api (FastAPI, Python 3.12)
All 18 routers are mounted in `app/main.py:336-357`:

| Prefix | Routers |
|---|---|
| *(none)* | `health`, `feedback`, `grid_search`, `grid_schedule`, `analytics`, `sso` (SSO/SCIM), `auth`, `billing` |
| `/v1` | `search`, `documents`, `entities`, `usage`, `workspaces`, `claude` (Managed Agents), `hermes`, `company` |
| `/api` | `trading` |
| *(tagged Forecast/Kronos)* | `forecast` |

**Middleware** (`app/api/middleware/`): `auth.py` (FastAPI dependency, not ASGI middleware — dev mode **bypasses auth entirely**), `rate_limit.py`, `logging.py`, `pii_filter.py`. Plus CORS from `settings.cors_origins`.

**Startup lifecycle** (`lifespan` in `main.py`) — all steps non-fatal by design:
asyncpg pool → auth schema → `create_all_tables` (5 s timeout) → billing schema → connection verification → embedder+pipeline pre-warm → Qdrant `ensure_collection` → background tasks: pageindex registry, TurboQuant index load, PageIndex registry, hourly routing-override recompute, optional grid scheduler (`GRID_SCHEDULER_ENABLED`), optional EDGAR poller (`EDGAR_POLLING_ENABLED`). SPLADE warm-up opt-in (`SPLADE_WARMUP_ENABLED`) — disabled because model + deps exceed 4 GB on Fly.

**Background jobs / queues:** Kafka client + topics + producer exist (`app/ingestion/kafka_client.py`, `topics.py`, `producer.py`) with `processing_worker` / `indexing_worker`; Kafka is **not provisioned in any deploy config** → in-process `asyncio` is the live path.

```
services/gravity-api/app/
├── api/{routes,middleware,schemas}
├── core/
│   ├── search_pipeline.py      (110 KB — the orchestrator)
│   ├── agents/                 (planner, reader, extractor, critic, writer,
│   │                            verifier, llm_council, orchestrator)
│   ├── retrieval/              (dense, sparse, splade, graph, structured,
│   │                            tree_nav, page_index, turbo_quant, mcp,
│   │                            fusion, hyde, multi_query, iterative_rag,
│   │                            compressor, orchestrator, web_pdf_fetcher)
│   ├── reasoning/              (13 modules: NLI judge, logic/numeric/temporal
│   │                            verifiers, contradiction detector, rubric,
│   │                            lynx guardrail, thought buffer, prompts)
│   ├── reranking/ caching/ verification/ safety/ security/ finance/
│   ├── analytics/ feedback/ streaming/
│   ├── grid_engine.py grid_scheduler.py entity_resolver.py
│   ├── financial_calculator.py kpi_extractor.py query_understanding.py
│   └── observability.py telemetry.py source_tier.py
├── llm/         (anthropic, openai, google, deepseek, groq, hermes,
│                 managed_agent, headroom, base, router)
├── embeddings/  (voyage, cohere, gemini, jina, openai, local, splade,
│                 cached, fallback)
├── db/          (qdrant, elasticsearch, neo4j, postgres, redis,
│                 supabase_rest, models)
├── ingestion/   (sources/, processing/, indexing/, workers/, pipeline.py,
│                 parallel_ingest.py, on_demand.py, kafka_client.py)
├── knowledge_graph/  forecasting/kronos/  memory/  services/markets/
└── compliance/  (audit_log, audit_trail_check, reproducibility_check, worm_archive)
```

**Request lifecycle (fast path):**
```
POST /v1/search (or WS)
  → require_auth dependency  (DEV: bypass)
  → rate limit
  → SearchPipeline.search()  → yields SearchEvent stream
      status → sources → token* → answer → structured_table? → metadata
  → client renders progressively
```

## market-server (Express)
`src/index.ts`: CORS allow-list (env `CORS_ORIGINS`, `*.vercel.app` wildcard support), `express.json({limit:'10mb'})`, health `/api/health`, WS `/ws` with per-symbol subscription map and 2-second Yahoo Finance polling. Routers under `src/routes/` (research, market, trading, social 33 KB, predictions, llm 18 KB, tavily, firecrawl, orgs 12 KB, claude, hermes) + `src/middleware/{auth,rbac}.ts` + `src/services/` (deepResearchService 36 KB, gravityClient, cryptobert, hermesResearchService, claudeResearchService).

---

# 4. AI Model Architecture

Router: `app/llm/router.py`. Classification is **heuristic keyword matching, not an LLM call** (the LLM classifier was removed for latency + mis-rating; see in-file comment).

| Tier | Share (design) | Fallback chain (ordered) |
|---|---|---|
| SIMPLE | 70% | deepseek → gemini_flash → groq_large → groq_fast → gpt4o → claude_haiku |
| MEDIUM | 20% | deepseek → gemini_pro → gemini_flash → groq_large → gpt4o → claude_sonnet |
| COMPLEX | 8% | deepseek → gemini_pro → groq_large → gpt5 → gpt4o → claude_opus → claude_sonnet |
| MATH | 2% | deepseek → gemini_pro → groq_large → gpt5 → gpt4o → claude_opus |

Registered clients (only if the key exists):

| Key | Model ID | Provider | Notes |
|---|---|---|---|
| `deepseek` | `deepseek-chat` | DeepSeek | de-facto primary — first in every tier |
| `gemini_flash` / `gemini_pro` | `gemini-2.5-flash` / `gemini-2.5-pro` | Google | free tier, rate-limited |
| `groq_large` / `groq_fast` | `llama-3.3-70b-versatile` / `llama-3.1-8b-instant` | Groq | free TPD ~exhausted by mid-day |
| `gpt5` / `gpt4o` | `gpt-4o` / `gpt-4o-mini` | OpenAI | key names misleading — **`gpt5` maps to gpt-4o** |
| `claude_haiku`/`sonnet`/`opus` | `claude-haiku-4-5-20251001` / `claude-sonnet-4-6` / `claude-opus-4-7` | Anthropic | **gated off** (`anthropic_enabled=False`) |
| Hermes | `nousresearch/hermes-4-70b` via OpenRouter | OpenRouter | `hermes_enabled=False`, `hermes_route_percentage=0` |

Config defaults (`config.py`) name a *different* set than the router instantiates: `default_reasoning_model=claude-sonnet-4-5-20250929`, `default_fast_model=gemini-2.5-flash`, `default_math_model=gpt-5.2`, `default_validation_model=gemini-3-pro`. **`gpt-5.2` and `gemini-3-pro` are not registered anywhere in `router.py`** — stale config, flagged for the reviewer.

- **Temperature:** global default `0.1`, `max_tokens=4096`, `top_p=1.0` (`app/llm/base.py:LLMConfig`); per-call overrides exist per site.
- **Context window:** not tracked in code → `MISSING INFORMATION`.
- **Cost:** static per-query estimates only — SIMPLE $0.003 / MEDIUM $0.035 / COMPLEX $0.12 / MATH $0.07. `LLMResponse.cost_usd` field exists; population per provider not verified.
- **Latency:** measured, documented in `docs/PRODUCTION_LATENCY.md` — cold 12–32 s vs <3 s target; proven spend-gated, not code-gated.

Embedding + rerank models:
- Primary embedder `voyage-finance-2`, 1024-d, batch 128; fallbacks cohere/gemini/jina/openai/local; content-hash embedding cache (30-day TTL, 4 retries on 429).
- SPLADE encoder for learned-sparse vectors.
- Rerankers: `cohere-rerank-v3.5` (default), Voyage reranker, MMR diversity.

---

# 5. Agent System

`app/core/agents/` — "Hebbia-style" Planner → Reader → Extractor → Critic → Writer, coordinated by `AgentOrchestrator.run()`. **Gated OFF in production** (`agentic_orchestrator_enabled=False`); `docs/PRODUCTION_LATENCY.md` records the loop as ~120 s and crash-prone.

| Agent | File | Role |
|---|---|---|
| Planner | `planner_agent.py` | decompose query into `SubTask`s |
| Reader | `reader_agent.py` | read/scope passages; pins structured XBRL facts |
| Extractor | `extractor_agent.py` | pull evidence/values from read material |
| Critic | `critic_agent.py` | produce `CriticFeedback`, drive the retry loop |
| Writer | `writer_agent.py` | compose final answer (guaranteed non-empty) |
| Verifier | `verifier_agent.py` | claim verification (16 KB) |
| LLM Council | `llm_council.py` | multi-model deliberation |

Shared contract in `agent_base.py`: `AgentContext`, `BaseAgent`, `SubTask`, `TraceEntry`, `CriticFeedback`. Traces stream to the client as `agent_trace` / `agent_trace_complete` events.

- **Prompts:** centralised in `app/core/reasoning/prompts.py` (21 KB) + per-agent inline. Full text not reproduced here.
- **Tools:** retrieval channels + XBRL structured facts; MCP connectors (`retrieval/mcp_client.py`) are the external-tool path, `mcp_enabled=False`.
- **Memory:** `AgentContext` in-run; conversation memory persisted per §14.
- **Failure handling:** every agent stage is wrapped so the pipeline falls back to single-pass generation; Writer never returns empty.

Client-side agents (separate system, TypeScript): `apps/market-ui/src/services/gridResearch.ts` runs per-cell research agents with tool traces (`gridTrace.ts`) and self-verification/grading (`gridTrust.ts`, `gridTrustRunner.ts`, `gridLessons.ts`).

---

# 6. Data Sources

`app/ingestion/sources/`:

| Source | File | Method | Frequency | Format | Validation |
|---|---|---|---|---|---|
| SEC EDGAR filings | `sec_edgar.py` (21 KB) | edgartools + raw HTTP fallback | 60 s poll, **opt-in** `EDGAR_POLLING_ENABLED` (default off); forms 10-K/10-Q/8-K; optional ticker watchlist | HTML/text | Redis dedupe |
| SEC XBRL facts | `sec_xbrl.py` + `processing/xbrl_extractor.py` (31 KB) | SEC frames/companyfacts API | on ingest | JSON facts | tagged-fact exactness |
| Earnings transcripts | `earnings.py` (22 KB) | **on-demand pull**, fallback chain: EDGAR 8-K → Quartr → Alpha Vantage → Motley Fool; `fetch_transcripts_bulk` gathers in parallel | per request (no scheduler) | text, split into speaker turns + sections | source fallback only |
| News | `news.py`, `gdelt.py` | HTTP / GDELT API (no key) | per query (GDELT is a live retrieval channel) | JSON | source-tier scoring (`source_tier.py`) |
| Market data | `polygon.py`, `refinitiv.py` | vendor APIs | `MISSING INFORMATION` | JSON | — |
| Crypto / social signals | `crypto_signals.py`, `social_signals.py` | vendor/HTTP | — | JSON | — |
| User uploads | `user_upload.py` | UI upload | on demand | PDF/HTML/text | file-type check (`python-magic`) |
| On-demand ingest | `on_demand.py` | corpus-miss → index that ticker live | inside a query, 75 s budget, ≤6 filings/type, 6 retry polls | — | — |

Frontend-side (market-ui/market-server, not the RAG corpus): Yahoo Finance (quotes/charts), Binance/OKX (crypto), BVMT public REST (Tunisia), FRED, Tavily, Firecrawl, CourtListener, SEC EDGAR direct.

**Documents:** 10-K, 10-Q, 8-K, earnings transcripts, news, user uploads. Historical coverage — per project memory: S&P 500 backfill 501/503 tickers, ~1,305 filings, ~1.5 M chunks. Not asserted by code → treat as reported, not verified.

---

# 7. Data Storage Architecture

## SQL
Two-and-a-half SQL surfaces, which is itself a finding:
1. **Postgres/TimescaleDB** via SQLAlchemy async (`app/db/models.py`, `postgres.py`) — local compose image `timescale/timescaledb:latest-pg16`.
2. **Supabase Postgres** via REST (`app/db/supabase_rest.py`) + `supabase/migrations/` — the store market-ui actually reads.
3. `render.yaml` defines a managed `gravity-pg` (unused if Fly is the live path).

ORM tables (`app/db/models.py`):
```
companies(id PK, name, ticker UNIQUE, isin UNIQUE, sector, industry, country,
          market_cap, exchange, created_at, updated_at)
documents(id PK, company_id FK→companies.id, title, ticker, filing_type,
          filing_date, fiscal_year, fiscal_quarter, source_url, raw_text,
          metadata JSON, status, chunk_count, created_at)
          idx: (ticker,filing_date), (filing_type,filing_date)
chunks(id PK, document_id FK→documents.id, text, text_with_metadata,
       chunk_level(1=section|2=paragraph|3=sentence), section_name, page_number,
       token_count, position, metadata JSON, created_at)  idx:(document_id,chunk_level)
financial_statements(id PK, company_id FK, ticker, metric_name, value,
       currency DEFAULT 'USD', fiscal_year, fiscal_quarter, filing_date,
       source_document_id, created_at)   [TimescaleDB hypertable]
       idx:(ticker,metric_name),(ticker,filing_date)
consensus_estimates(id PK, company_id FK, ticker, metric_name, estimate_value,
       actual_value, period, analyst_count, estimate_date, source, created_at)
price_data(id PK, ticker, date, open, high, low, close, volume, market_cap)
       [TimescaleDB hypertable]  UNIQUE(ticker,date)
workspaces(...)  — saved search results
```
Note: `chunks.page_number` **does** exist, so page-level citation is schema-supported even though it is not surfaced (§11). `financial_statements.currency` exists with a `USD` default — storage supports multi-currency, the reasoning layer does not normalise it (§10).
Supabase migrations: `0001_qa_history`, `0002_financials`, `0003_chunks_fts` (Postgres FTS + GIN), `0004_doc_trees`, `0005_grid_schedules`, `20260316000001_initial_schema`, `20260316000002_influencer_tracker`, `20260418000001_grid_runs`, `20260430_rbac`. Note: prod grid table is `lib_grid_runs` while the migration says `grid_runs` — schema drift.

**Source of truth:** not declared anywhere. De-facto: SEC filings/XBRL for financial facts; Supabase for app state; Qdrant is derived. `MISSING INFORMATION` — no written SoT policy.

## Vector
- **Qdrant** (`app/db/qdrant.py`), collection `gravity_chunks`, named vectors `dense` + `sparse`, 1024 dims (`voyage-finance-2`). Optional per-org collections `{org_id}_gravity_chunks` when `multi_tenant_qdrant=True` (default False).
- Client falls back to a **mock that returns empty results when Qdrant is down** — silent degradation, flagged for the reviewer.
- Chunking: section ≤2048 tok, paragraph ≤512 tok with 20% overlap, sentence ≤150 tok.
- Metadata prefixed into chunk text before embedding (ticker, company, filing type, date, section) per `CLAUDE.md`.
- Filtering: ticker/filing_type/date filters via payload. Reranking: Cohere v3.5 on top-30 (`rerank_top_k=30`), then ≤15 passages to the LLM (`max_context_passages`).

## Other stores
Elasticsearch (`gravity_chunks` index, BM25 + SPLADE), Neo4j (knowledge graph), Redis (semantic cache TTL 3600 / threshold 0.95, dedupe, rate limits, API keys). **ES and Neo4j have no secrets in the prod deploy** → those channels are dead in production (§17).

---

# 8. Document Processing Pipeline

```
raw filing/upload
  → document_processor.py     (format detect, extract text)
  → sec_form_parsers.py       (10-K/10-Q/8-K form-specific parsing)
  → section_detector.py       (Item 1A, MD&A, statements…)
  → table_parser.py           (13 KB) / xbrl_extractor.py (31 KB)
  → chunker.py                (section/paragraph/sentence, 20% overlap)
  → contextual_retrieval.py + proposition_extractor.py (context prefixes, propositions)
  → metadata_extractor.py + entity_extractor.py
  → embeddings (voyage, cached by content hash)
  → indexing/  vector_indexer │ keyword_indexer │ graph_indexer │ structured_indexer
               page_indexer │ page_index_indexer │ raptor_indexer │ tree_builder
               table_indexer (WRITE DISABLED per project memory)
  → retrieval
```

Tools: PDF via `pdfplumber`/`pdfminer.six` + PyMuPDF (poppler-utils in the image); `python-magic` for type sniffing; **OCR: none found → `MISSING INFORMATION`** (scanned filings are unhandled).

**Tables:** two paths — (a) `table_parser.py` → `table_indexer.py`, whose writes are off because column-alignment errors mis-read footnote refs as figures; (b) `xbrl_extractor.py` → Supabase `financials` rows prefixed `xbrl:*`, which are the only exact ones. Per `config.py`, the structured-facts channel is **off**: enabling the noisy table path regressed FinanceBench 40% → 20%.

RAPTOR summary trees: `raptor_enabled=True`, cluster threshold 0.85, summary ≤256 tokens.

---

# 9. RAG Architecture

```
query
 → query_understanding.py  (intent, entities, complexity; + hyde.py, multi_query.py)
 → semantic_cache (Redis, cosine ≥0.95, TTL 1h)
 → RetrievalOrchestrator.asyncio.gather() across registered channels
 → authority_aware_rrf (fusion.py, k=60) + source_tier weighting
 → rerank (Cohere v3.5 top-30 → ≤15 passages) + MMR
 → LLM generation (router-selected model, streamed)
 → verification stack (§10/§12)
 → SearchEvent stream: status│sources│token│answer│structured_table│metadata│error
```

Channels declared in `retrieval/orchestrator.py` with per-channel latency targets: dense (Qdrant ~30 ms), bm25 (ES ~30 ms), splade (~30 ms), graph (Neo4j ~40 ms), structured (PG ~20 ms), tree_nav (GravityIndex), page_index (VectifyAI ~variable), turbo_quant (in-mem ~10 ms), gdelt (~500 ms), mcp (~2–10 s). Channels register only when their backend is configured — graceful degradation, and metadata reports only channels that returned data.

Advanced modules present: `iterative_rag.py`, `compressor.py`, `hyde.py`, `multi_query.py` (replaces dense for MEDIUM/COMPLEX), `headroom.py` (context compression library, integration inert).

Search modes: `fast` (linear single-pass, <200 ms design target), `agentic` (orchestrator, gated off), `auto`. Self-consistency (3-run majority vote) is **coded but disabled** — with DeepSeek's ~15 s/call it timed out 23/150 FinanceBench questions.

---

# 10. Financial Accuracy System

| Risk | Control in code |
|---|---|
| Wrong numbers | `reasoning/numeric_verifier.py` + `numeric_state.py`; `finance/ratio_engine.py` (48 KB) deterministic computation; XBRL exact facts |
| Wrong fiscal year | `temporal_verifier.py`; tree-nav/PageIndex paradigm exists precisely for period navigation |
| Wrong company | `core/entity_resolver.py` (22 KB); ticker-scoped retrieval filters |
| Wrong currency | no dedicated module found → `MISSING INFORMATION` |
| GAAP vs non-GAAP | no dedicated module found → `MISSING INFORMATION` |
| Wrong calculations | `financial_calculator.py`, `ratio_engine.py`, `financial_skills.py`, `logic_verifier.py` (24 KB) |
| Outdated information | `tests/test_freshness_lag.py`, EDGAR polling (off by default), on-demand ingest |

- Financial facts database — **YES** (Supabase `financials`, `xbrl:*` rows exact; ~310 K junk rows from older populations remain per project memory).
- Citation system — **YES** (§11).
- Claim verification — **YES** (`validator.py`, `nli_verifier.py`, `nli_judge.py`, `finbert_nli.py`, `verifier_agent.py`, `lynx_guardrail.py`, `propensity_checker.py`).
- Calculation engine — **YES** (`ratio_engine.py`, `financial_calculator.py`).

Reality check: `docs/ROADMAP_TO_98.md` records a probed prod failure — Apple FY23 revenue returned **$313.7 B** vs actual **$383.3 B**, "confident, cited, wrong." The controls above exist; several sit behind flags.

---

# 11. Citation System

- **Generation:** the LLM is prompted to cite `[Source N]` against the reranked passage list; `CitationValidator.verify()` (`reasoning/validator.py`) re-checks each claim against passages using a validator model (designed for Gemini 3 Pro — not registered in the router, see §4) and returns:
```
{ claims: [{claim_text, verification: "VERIFIED"|"UNVERIFIED", ...}],
  overall_accuracy: 0.0-1.0, unsupported_claims: [...],
  numerical_errors: [...], corrected_answer: str|null }
```
- **Stored:** answers + citations in Supabase `qa_history` (migration `0001`); compliance copies in `compliance/audit_log.py` + `worm_archive.py` (write-once archive).
- **Rendered:** source chips with document title/section/URL; grid cells carry per-cell traces + trust grades.
- Per-claim page numbers: `chunks.page_number` is stored but is not surfaced in the citation payload → citations resolve to document + section, not page.

---

# 12. Auto Audit System

| Capability | Implementation |
|---|---|
| Source verification | `source_tier.py` authority tiers; authority-aware RRF |
| Claim verification | `validator.py`, `nli_judge.py`, `nli_verifier.py`, `finbert_nli.py` |
| Fact checking | XBRL exact-fact pinning; `verifier_agent.py` |
| Calculation checking | `numeric_verifier.py` + `format_mismatch_report` |
| Contradiction detection | `reasoning/contradiction_detector.py` |
| Confidence scoring | `financial_rubric.py` (23 KB); UI-side `reportQaGates.ts` (37 KB), `gridTrust.ts` earned A–F grades |
| Compliance audit | `compliance/audit_trail_check.py`, `reproducibility_check.py`, `worm_archive.py` |
| Safety | `safety/propensity_checker.py`, `security/mnpi.py` (material non-public info), `middleware/pii_filter.py` |

Sample audit output shape: `MISSING INFORMATION` — no committed golden audit artifact was located (structure is inferable from `validator.py`'s return contract above).

---

# 13. Evaluation System

**Python (`services/gravity-api/eval/`):**
- `financebench_grader.py` (20 KB) — FinanceBench
- `finqa_runner.py` (22 KB) — FinQA
- `alce_runner.py` (14 KB) — ALCE citation quality
- `vals_finance_agent_runner.py` (23 KB) — Vals finance-agent benchmark
- `cohen_kappa.py` — inter-rater agreement
- `tests/` — 25 pytest files + `golden_eval.json`; `scripts/reliability_battery.py` (20-question regression battery with a `--max-latency` SLA gate)

**TypeScript (`apps/market-ui/`):** `eval/` harness, `npm run eval` / `eval:synthetic` / `eval:loop`, `evalRunner.ts`, `evalRubric.ts`, `evaluation.ts` (22 KB), `selfImprovementHarness.ts`, `reportQaGates.test.ts` (31 KB), Playwright e2e (`npm run e2e`), numeric probe (`scripts/grid-numeric-probe.mjs`).

**Metrics tracked:** accuracy (FinanceBench/FinQA), citation accuracy (ALCE), evidence recall (`test_evidence_recall.py`), numeric scoring (`test_numeric_scorer.py`), freshness lag, latency (reliability battery), Cohen's κ.

**Numbers:** last recorded FinanceBench prod baseline **16%** (51% empty answers) with a documented climb plan (35 → 80 → 85 → 95 → 98%); reliability battery 20/20 green on correctness. Both from project docs/memory, not from a committed results file in this read → verify before quoting externally.

---

# 14. Memory System

- **Conversation memory:** `SearchPipeline._get_conversation_context()` / `_save_conversation_turn()`, keyed by `conversation_id`; `core/memory_context.py`; Supabase `qa_history`; UI `qaStore` + `companyBriefStore` (sessions survive navigation).
- **User memory:** workspaces (`api/routes/workspaces.py`) + org settings. No per-user preference/learning store found → `MISSING INFORMATION`.
- **Research memory:** grid runs persisted (`lib_grid_runs`), grid lessons (`gridLessons.ts`) feed later runs; routing feedback loop (`feedback/routing_feedback.py`) recomputes routing overrides hourly.
- **Document memory:** the corpus itself (Qdrant + Supabase + doc_trees).
- **Semantic memory (optional):** MemPalace (`app/memory/mempalace_client.py`) — import-guarded, no-op if the package is absent.
- **Retrieval:** by conversation id, ticker scope, or embedding similarity depending on store.

---

# 15. Security

- **Authentication:** two systems. (1) gravity-api self-hosted: `auth.py` (19 KB) + `security/auth_store.py`, `auth_tokens.py`, `password_policy.py`, `session_security.py`, SAML SSO (`sso.py`, 16 KB). (2) Supabase auth for market-ui (the prod path), incl. MFA. Search WS expects a Supabase JWT; gravity-api-issued tokens are rejected (1008) — documented drift.
- **Authorization:** `security/entitlements.py`; market-server `middleware/rbac.ts` + `routes/orgs.ts`; Supabase RLS (migration `20260430_rbac`). Note: anon RLS blocks `chunks`/`financials` — those are server-side-only reads.
- **API security:** `X-API-Key` (Redis-stored) or Bearer JWT, per-route dependency; `rate_limit.py` + `security/auth_rate_limit.py`; CORS allow-lists both sides.
  - ⚠️ **`require_auth` returns an unlimited `dev_user` whenever `APP_ENV != production`.** Any deploy that forgets `APP_ENV=production` is fully open. Fly sets it in `fly.toml`; anything else is unguarded.
- **Secrets:** env-only (`.env`, Fly secrets, Vercel env, `render.yaml` `sync:false`). Envelope-encrypted BYOK key store (`security/key_store.py`, `key_store_byok.py`) with `KEY_ENCRYPTION_KEY_V1`.
  - `.env`, `.env.local`, `.env.*.local`, `.env.production` are git-ignored (`.gitignore:16-18,57`) — verified. Live key files exist in the working tree; rotate anything that predates those rules.
- **Database security:** Supabase RLS; non-root container user; Fly private networking; local compose runs ES with `xpack.security.enabled=false` (dev only).
- **Prompt-injection protection:** `reasoning/lynx_guardrail.py` + `safety/propensity_checker.py`. No dedicated retrieved-content injection sanitiser found → partial; `MISSING INFORMATION` on coverage.
- **Data-poisoning protection:** source-tier authority + news whitelists (UI side) + Redis dedupe. No signed-provenance or ingest quarantine → `MISSING INFORMATION`.
- **Compliance:** MNPI detection (`security/mnpi.py`), PII filter middleware, WORM archive, audit trail + reproducibility checks.

---

# 16. Deployment

| Item | Reality |
|---|---|
| Cloud | Fly.io (2 apps, region `iad`) + Vercel (market-ui) + Supabase (managed PG/auth/storage) + Qdrant Cloud (`QDRANT_API_KEY` supported) |
| Containers | `services/gravity-api/Dockerfile` (python:3.12-slim, non-root `gravity`, HEALTHCHECK, `uvicorn --workers 1`), `services/market-server/Dockerfile`, `services/sentiment-api/Dockerfile` |
| Local infra | `infra/docker-compose.yml`: TimescaleDB pg16, Redis 7 (256 MB, allkeys-lru), Qdrant, Elasticsearch 8.14 (512 MB heap), Neo4j |
| Scaling | gravity-api: `min_machines_running=1`, `auto_stop=off`, shared-2× / 4 GB, single uvicorn worker. market-server: `min_machines_running=0` → cold start ~5 s (comment in `fly.toml`). **No horizontal scaling configured.** |
| CI/CD | `.github/workflows/`: `deploy-gravity-api.yml` (push to `main` touching `services/gravity-api/**` → `flyctl deploy --remote-only`), `deploy-market-ui.yml` (push touching `apps/market-ui/**`, `api/**`, `vercel.json` → Vercel production), `eval-scheduled.yml` (daily 06:00 UTC eval suite), `deepeval.yml`, `qdrant-keepalive.yml` (daily 03:00 UTC ping so the free Qdrant cluster is not suspended). **`ci.yml` and `fly-deploy.yml` are `.disabled`** → no test/lint/typecheck gate runs before deploy. |
| Monitoring | health checks on both Fly apps (`/health`, `/api/health`); Langfuse tracer (`core/observability.py`, fire-and-forget, no-ops without `LANGFUSE_*` keys); Sentry wired in `main.py` + `telemetry.py`, gated on `SENTRY_DSN`. Whether those keys are set in the Fly prod env: `MISSING INFORMATION` (not visible from the repo). |
| Logging | `structlog` JSON + `middleware/logging.py`; `llm_context_dump` log shows what reached the LLM |
| Alternate config | `render.yaml` (full stack incl. managed PG + Redis) — appears superseded |

---

# 17. Current Problems

**A. Shipped-but-off.** These are coded, tested, and disabled by default in `config.py`:
`structured_facts_enabled=False` (noisy table extraction regressed FinanceBench 40%→20%), `agentic_orchestrator_enabled=False` (~120 s, crash-prone), `tree_nav_enabled=False` (trees not built), `pageindex_enabled=False`, `turbo_quant_enabled=False`, `mcp_enabled=False`, `anthropic_enabled=False` (dead key), `hermes_enabled=False`, `edgar_polling_enabled=False`, `multi_tenant_qdrant=False`, self-consistency voting disabled, `table_indexer` writes off, SPLADE warm-up off (4 GB ceiling).

**B. Accuracy.** FinanceBench baseline 16% (51% empty). Documented wrong-number failures on flagship tickers (AAPL FY23 revenue $313.7 B vs $383.3 B; MSFT FY23 op income $83.4 B vs $88.5 B) — cited and confident, which is the worst failure mode. Root cause per `docs/ROADMAP_TO_98.md`: dense-only retrieval ranks the wrong fiscal-period chunk.

**C. Dead channels vs. the diagram.** Production has no `ELASTICSEARCH_URL` / `NEO4J_*` secrets → bm25, SPLADE, graph, and structured channels are inert. The 5-channel architecture in `CLAUDE.md` describes ~1.5 live channels in prod. `docs/TARGET_ARCHITECTURE.md` already decided to collapse to Qdrant + Supabase (FTS migration `0003` pending backfill), but `CLAUDE.md` and the orchestrator still advertise the old set.

**D. Latency.** Cold 12–32 s vs <3 s target. Measured as spend-gated: DeepSeek TTFT + one shared-CPU Fly machine. Four free code levers tried and measured; none moved it.

**E. Cost / provider fragility.** Only DeepSeek (+ Firecrawl) reliably funded as of the last recorded check; Anthropic 401, Groq daily-capped, Gemini free-tier limited, Cohere trial exhausted, Voyage 3 RPM free. Reranking quality is therefore blocked on a paid key.

*Not code-fixable — reviewed 2026-07-23 and confirmed as spend.* The router already prefers the fast models and falls through automatically the moment they are funded (`router.py` `_routing_table`), and `llm_router_init` logs exactly which clients registered at boot, so the degradation is visible. What money buys, in order of impact:

| Spend | Effect | Blocks today |
|---|---|---|
| Groq dev tier (~$0–20/mo, same key) | `groq_large` stops 429ing → SIMPLE tier answers in 1–3 s instead of 12–32 s | latency SLA |
| Cohere production rerank key | real cross-encoder reranking on top-30 | retrieval precision, hence answer accuracy |
| OpenAI credit on the existing key | funded `gpt-4o-mini` fast path as a second option | single-provider risk (DeepSeek is a SPOF today) |
| Anthropic billing | unlocks `claude_*` for COMPLEX/MATH + the Lynx guardrail's default client | contradiction/thesis quality |

Until at least one of the first two lands, latency and rerank quality cannot be moved by code — four free levers were already tried and measured (`docs/PRODUCTION_LATENCY.md`).

**F. Silent degradation.** Qdrant client mocks to empty results when down; nearly every startup step is `try/except → warning`. The system prefers answering wrong over failing loud.

**G. Duplication / drift.** Two auth systems; two SQL surfaces (SQLAlchemy/Timescale vs Supabase REST); two deploy definitions (Fly vs Render); stale model IDs in `config.py`; `grid_runs` vs `lib_grid_runs`; ~310 K junk rows in `financials`; Kafka code with no Kafka.

**G2. Untracked live surface — RESOLVED 2026-07-23.** Vercel project `gravity-ui` was serving a public, unauthenticated, 4-month-stale Next.js build (2026-03-26) that no repo config, workflow, or `vercel.json` knew about. Both it and the empty `antigravity-gravity-ui` project were deleted on owner instruction; `gravity-ui-ashy.vercel.app` now returns 404. `apps/gravity-ui` stays in the repo as the streaming-API reference client and still runs locally.

Remaining Vercel projects under `houssem98s-projects`: `market-ui` (the product), `gravity-api`, `antigravity`, `dashboard`, `xbow-pen-tester2`, `marketintelligence-waitlist`. The `gravity-api` project's URL 404s (dormant, backend actually runs on Fly); the others were not audited here. **Nobody tracks this list in the repo — it is worth one pass by the owner.**

**H. Scale.** One uvicorn worker on one shared-CPU VM; saturation 503s observed at concurrency 3; market-server scales to zero.

**I. No pre-deploy gate.** `ci.yml` (8 KB of lint/typecheck/test) is `.disabled`, while `deploy-gravity-api.yml` and `deploy-market-ui.yml` push straight to production on any `main` commit touching their paths. Nothing runs the 25 pytest files or the TS typecheck before prod.

**J. Repo hygiene.** Root holds ~20 loop shell scripts, ~11 `gemini-code-*.md` dumps, vendored third-party trees (`AionUi/`, `TradingAgents-main/`, `FinceptTerminal-main/`, `financial-services-main/`), and uvicorn log files inside `services/gravity-api/`. Noise for any reviewer or new engineer.

**K. Missing.** OCR for scanned documents; currency and GAAP/non-GAAP normalisation in the reasoning layer (the column exists, the logic does not); declared source-of-truth policy; page-level citations (data present, not surfaced).

---

# 18. Final Architecture Summary

## Honest topology (what actually runs in production)
```
Browser
  → market-ui (Vercel, React 19)
      ├→ Vercel fns (quote/news/history/crypto/tn/social)   → Yahoo, Binance/OKX, BVMT, CG
      ├→ Supabase (auth + Postgres REST + Storage blobs)
      ├→ market-server (Fly, scale-to-zero)  → Yahoo WS ticks, Tavily, Firecrawl, LLMs
      └→ gravity-api (Fly, 1 machine, 1 worker)
            query understanding → Redis semantic cache
            → retrieval: dense (Qdrant)  [+ gdelt when enabled]
              ✗ bm25/ES  ✗ splade  ✗ graph/Neo4j  ✗ structured  ✗ tree_nav  ✗ pageindex
            → RRF fusion → rerank (rate-limited key) → DeepSeek generation
            → numeric/temporal/NLI verification → streamed answer + citations
            → qa_history (Supabase) + audit log
```

## Technology stack
Python 3.12 / FastAPI / uvicorn · TypeScript / Express · React 19 / Vite / Tailwind / Radix / Zustand · Next.js 15 (unshipped) · Qdrant · Supabase Postgres (+FTS) · TimescaleDB · Redis · Elasticsearch · Neo4j · Kafka (unprovisioned) · Docker · Fly.io · Vercel · DeepSeek/Gemini/Groq/OpenAI/Anthropic/OpenRouter · Voyage/Cohere/Jina/SPLADE embeddings · Cohere/Voyage rerank.

## Data flow
`source → pipeline.py → processing (parse/section/table/XBRL/chunk/metadata/entity) → embed (cached) → index (vector│keyword│graph│structured│tree) → retrieve → fuse → rerank → generate → verify → stream → persist (qa_history + audit)`

## AI flow
`heuristic complexity classify → fallback chain (DeepSeek-first) → generation (temp 0.1, 4096 max tokens) → citation validator → numeric/temporal/NLI/contradiction verifiers → confidence rubric → stream`

## Weaknesses (ranked for the reviewer)
1. Confidently wrong numbers — the one failure a financial research tool cannot ship with.
2. Advertised architecture ≠ running architecture (dead channels, stale docs, stale model IDs).
3. Silent failure everywhere (mock Qdrant, blanket try/except) hides #1 and #2.
4. ~~Auto-deploy to production with no checks~~ — **fixed**: both deploy workflows now gate on a verified-green check job.
5. ~~`require_auth` dev-bypass keyed on a single env var~~ — **fixed**: settings default is now `PRODUCTION`, so an unset `APP_ENV` fails closed and the bypass logs loudly.
6. ~~An unauthenticated public deployment nobody tracks~~ — **fixed**: both stale Vercel projects deleted (§17 G2).
7. Single-machine, single-worker, no horizontal scale; latency 4–10× target.
8. Provider-funding fragility: one funded LLM, exhausted rerank keys. **Spend-gated, not code-gated** — see §17 E for the funding table.
9. Duplicated auth / SQL / deploy stacks.

On #1, only the narrow slice is fixed: temporal mismatches now cap confidence and caveat the answer, which closes the *wrong-period* variant. The broad fix (exact XBRL facts + tree-nav retrieval, `docs/ROADMAP_TO_98.md` phases 1–3) is a program of work, not a patch, and is untouched.

## Unknown parts (needs a human answer)
Target users & ICP · Render vs Fly (is `render.yaml` dead?) · what to do with the stale public `gravity-ui` deployment · declared source-of-truth policy · whether Langfuse/Sentry keys are set in the Fly prod env · polygon/refinitiv ingest cadence + validation · committed benchmark result artifacts (FinanceBench 16% and battery 20/20 are quoted from docs, not from a results file in-repo) · per-model context windows and real cost accounting · OCR strategy · currency + GAAP/non-GAAP normalisation policy.

## Corrections applied to the repo during this extraction (2026-07-23)
| File | Was | Now |
|---|---|---|
| `CLAUDE.md` | WS endpoint `/v1/search/ws` | `/v1/search/stream` (matches `search.py:177`) |
| `CLAUDE.md` | `src/stores/searchStore.ts`, `uiStore` | `src/store/searchStore.ts`; no `uiStore` exists |
| `CLAUDE.md` | `CLERK_SECRET_KEY` (for gravity-ui auth) | gravity-ui has no auth dependency |
| `packages/shared-types/src/index.ts` | "shared between market-ui, market-server, and gravity-ui" | gravity-ui does not consume it |
| `scripts/derive-prod-env.ps1` | Vercel project `alphagravity-gravity-ui` (does not exist) → fed a bogus domain into prod `CORS_ORIGINS` | `gravity-ui` / `gravity-ui-ashy.vercel.app` |
| `app/config.py` | `app_env` defaulted to `DEVELOPMENT` → an unset `APP_ENV` made `require_auth` bypass auth on every route (§18 W5) | defaults to `PRODUCTION`; fails closed. Every repo `.env` sets `development` explicitly, so local dev is unchanged |
| `app/api/middleware/auth.py` | dev bypass was silent | logs `auth_bypassed_development_mode` with the path |
| `.github/workflows/deploy-*.yml` | deployed to prod with zero checks (§18 W4) | each deploy job now `needs: gate` — market-ui runs `npm -w market-ui run typecheck`, gravity-api runs `compileall` + `ruff --select E9,F63,F7,F82`. Both verified green locally before wiring |
| `app/core/search_pipeline.py` | `verify_temporal_consistency` result was log-only — a wrong-period answer still shipped as HIGH confidence (§18 W1) | mismatches now cap confidence `HIGH → MEDIUM` and append a caveat naming the conflicting periods |
| `tests/test_search_pipeline.py` | 5 tests asserted agentic routing while the orchestrator gate forces `False` → red since the flag was disabled | autouse fixture enables the flag so the tests cover routing rules, not the gate. 9/9 green |

Outside the repo, on owner instruction: Vercel projects `gravity-ui` and `antigravity-gravity-ui` deleted (§17 G2). `apps/gravity-ui` source kept — it is the only streaming-API client.

### Why the CI gate is not `pytest`
The full suite is not green. `pytest tests/` currently surfaces failures unrelated to any single change, and several tests require live backends. Gating deploys on it today would block every deploy. The gate ships as the strongest *deterministic* check that passes now (syntax + undefined names + TS types); promoting it to full `pytest` needs someone to green the suite first.

---

# 19. Completeness Check (per `ARCHITECTURE_DISCOVERY_LOOP.md`)

| Category | Weight | Score | Gap left |
|---|---|---|---|
| Frontend | 10% | 10 | — |
| Backend | 10% | 10 | — |
| AI layer | 15% | 13 | context windows, real per-call cost accounting |
| Agents | 15% | 14 | prompt texts not reproduced (referenced by file) |
| Data sources | 10% | 9 | polygon/refinitiv cadence + validation |
| Database | 10% | 10 | — (source-of-truth policy is a decision, not a fact) |
| RAG | 10% | 10 | — |
| Accuracy system | 10% | 9 | currency + GAAP normalisation absent by design gap |
| Security | 5% | 5 | — |
| Deployment | 5% | 4.5 | prod observability env not visible from repo |
| **Total** | **100%** | **94.5%** | |

**94.5% < 95% → loop continues.** Every remaining gap is a question only a human (or prod env access) can answer; nothing further is extractable from this repo. The targeted questions are listed in "Unknown parts" above — answer them and the score closes to 100%.

END DOCUMENT
