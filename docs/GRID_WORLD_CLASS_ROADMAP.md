# Research Grid → World-Class Roadmap

Target: reach Hebbia Matrix / AlphaSense Generative Grid capability level with the
existing stack (gravity-api + market-ui + Supabase/Qdrant). Grounded in the
competitive teardown (2026-07-03): Hebbia = retrieval architecture + eval
discipline; AlphaSense = standing grids + content breadth; Rogo = model-ops
economics. Ordering is by dependency, then ROI. Nothing here requires new
infrastructure — every phase builds on code that already exists in this repo.

Already differentiated (keep, don't touch): figure-diff CHANGED badges,
salient-term outlier flags (LAWSUIT/DILUTION/…) — neither incumbent has these.

---

## P0 — Foundation repair (unblocks everything) · ~1 week

The teardown's unanimous lesson: retrieval quality IS the product. Ours is
currently degraded — dense channel down, campaign chunks unvectorized.

| # | Task | Where | Acceptance |
|---|------|-------|------------|
| 0.1 | **Embedder key decision + fund** (OpenAI ~$5 recommended; Voyage alt) | Fly secrets | `get_embedder()` probe embeds successfully on prod |
| 0.2 | **Re-embed campaign chunks** Supabase→Qdrant (~220K chunks, ~$2-3, ~2h). Read `chunks` via REST (SQLAlchemy stub is dead — do NOT use reembed_from_db.py as-is), embed, upsert with vector_indexer payload shape | new script `scripts/reembed_from_supabase.py` | per-ticker Qdrant count ≈ Supabase count for all 219 campaign tickers |
| 0.3 | **Redis cleanup** (Upstash at 268MB cap again — emb:* cache refilled it) | `scripts/redis_cleanup.py` | usage < 200MB; no cache_get_error in logs |
| 0.4 | **Ticker-scope leak fix**: AFL-filtered query returned International Paper chunks. Audit `companies` filter enforcement in every retrieval channel (dense, FTS RPC `tickers` array, structured, tree-nav) | `app/core/retrieval/*` | scoped query for 20 random tickers returns 0 foreign-ticker chunks |
| 0.5 | **Deploy rephrased grid prompts** (filing-oriented; already edited + typechecked) | `gridResearch.ts` → vercel --prod | grid run: 0 "no consensus data" declines on Thesis/Risks/Financials columns |
| 0.6 | **Staleness audit of pre-campaign 284**: find tickers whose newest 10-K < 2024 (AFL pattern), refresh via download+index | one-off script reusing campaign pipeline | every S&P ticker has a ≥2024 10-K and latest 10-Q indexed |

## P1 — Retrieval quality: our answer to Hebbia ISD · ~2-3 weeks

Hebbia's ISD kills chunk-embedding failures with LLM-as-retriever. We don't
need to clone it — tree-nav (GravityIndex, already live behind TREE_NAV_ENABLED)
is the same idea: navigate the filing outline instead of cosine-matching chunks.
The gap is navigation quality, not architecture.

| # | Task | Where | Acceptance |
|---|------|-------|------------|
| 1.1 | **Section-aware routing**: "risk factors" queries → Item 1A nodes; "MD&A growth" → Item 7. Query-intent → section mapping in tree_nav channel | `app/core/retrieval/tree_nav*` | AFL "top disclosed risks" answers from Item 1A with citations |
| 1.2 | **Backfill doc_trees for campaign filings** (tree_builder over the 1,305 new docs) | `scripts/build_trees.py` | doc_trees rows ≈ indexed filings count |
| 1.3 | **Eval gate (Hebbia recipe)**: deterministic per-cell checks (citations resolve, ≥1 figure where expected, non-empty, ticker-scope purity) + atomic binary rubrics graded by cheap LLM (DeepSeek). Run as regression battery per deploy | extend `scripts/reliability_battery.py`; new `tests/eval/grid_battery.py` | battery runs in CI/pre-deploy; score tracked run-over-run; deploy blocked on regression >5% |
| 1.4 | **Chunk-level highlight**: reverse-map answer sentences → exact source spans (Hebbia stage 4). We have char offsets in source viewer — surface per-sentence | search_pipeline citation validator + SourceViewer | clicking a citation highlights the exact supporting span |

## P2 — Standing grids: AlphaSense's flagship, nearly free for us · ~2 weeks

We already own both halves: `lib_grid_schedules` (0005 migration + grid_scheduler.py)
and the 5-minute EDGAR poller. Join them.

| # | Task | Where | Acceptance |
|---|------|-------|------------|
| 2.1 | **Doc-triggered re-runs**: poller ingests new filing for ticker T → find saved grids containing T → re-run T's row → figure-diff → CHANGED badges | `app/core/grid_scheduler.py` + poller hook | new 10-Q lands → grid row updates within 10 min, changed figures flagged |
| 2.2 | **Notification on change**: email/webhook when a standing grid flags CHANGED cells | grid_scheduler + Supabase edge fn or Resend | user gets "NVDA Risks changed after 10-Q" mail |
| 2.3 | **Template library**: named, saved, org-shareable column sets (extend gridStore + gridShare; presets: Earnings Comps, Credit Terms, Deal Screen) | `gridStore.ts`, `gridShare.ts`, GridView UI | create/save/load/share named templates; 3 shipped presets |
| 2.4 | **Grid history diffing UI**: run-over-run view of a cell's answer evolution (data exists in lib_grid_runs) | HistoryPage / GridView | cell click → timeline of past answers with figure diffs |

## P3 — Content breadth: close the "filings-only" gap · ~3 weeks

Filings structurally cannot answer consensus/catalyst/valuation prompts. This is
a content problem, not a retrieval problem.

| # | Task | Where | Acceptance |
|---|------|-------|------------|
| 3.1 | **Earnings transcripts ingestion** (endpoint `/v1/transcripts/ingest` + `backfill_transcripts.py` exist, unused). Source decision: free (Motley Fool/SA scrape = fragile) vs API (FMP ~$14/mo has transcripts) | `app/ingestion/sources/earnings.py` | S&P-100 last-4-quarters transcripts indexed; Catalysts column answers from mgmt guidance |
| 3.2 | **XBRL-as-grid-columns**: structured columns typed as METRIC (Revenue, GM%, FCF) pulling exact figures from `financials` table instead of RAG — numbers become deterministic, instant, always-right | gridResearch cell runner + `/v1/documents/kpis/{ticker}` | metric column = exact XBRL values with filing citations, <1s per cell |
| 3.3 | **News channel for grid** (news.py source exists) | ingestion + retrieval filter by recency | "recent developments" column answers from last-30-day news |
| 3.4 | **Estimates/consensus data** (optional, paid): FMP/Finnhub consensus endpoints → `consensus_estimates` table (schema exists in initial migration) | market-server or gravity-api | Next Print column answers with real consensus figures |

## P4 — Agentic deliverables + model economics · ~4 weeks

The 2025-26 incumbent evolution: grid extractions feed long-form deliverables.

| # | Task | Where | Acceptance |
|---|------|-------|------------|
| 4.1 | **Orchestrator hardening (Hebbia Agent 2.0 pattern)**: central orchestrator never calls tools — dispatches typed objectives to Planner/Reader/Extractor/Critic/Writer (all exist in `app/core/agents/`) | `orchestrator.py` | complex grid queries route agentic; trace visible in UI |
| 4.2 | **Deliverable generation**: grid → investment memo / diligence profile / slide outline (buildMemo exists; make it multi-step agentic w/ Writer agent) | deepResearchService + writer_agent | one-click "Generate memo" from any completed grid, cited |
| 4.3 | **Model layering economics (Rogo pattern)**: cheap model contextualizes/structures at ingest; frontier only for synthesis + evals; log per-cell cost | `app/llm/router.py` + ingestion | per-cell cost tracked; ≥50% cost cut on grid runs at equal battery score |
| 4.4 | **Synthetic eval data**: frontier model generates eval Q/A from indexed filings, expert-style; feeds P1.3 battery growth | `tests/eval/` | battery grows to 200+ cases without manual authoring |

---

## Sequencing summary

```
Week 1      P0 all (0.1 key decision is the only human blocker)
Weeks 2-4   P1.1-1.4  +  P2.1-2.2 in parallel (different layers)
Weeks 4-6   P2.3-2.4  +  P3.1-3.2
Weeks 6-9   P3.3-3.4  +  P4.1-4.2
Weeks 9-12  P4.3-4.4  + hardening
```

Recurring costs at full build-out: embedder ~$5-10/mo, transcripts API ~$14/mo,
optional consensus data ~$15-30/mo. Everything else = existing infra.

## What we explicitly do NOT chase

- Hebbia's "infinite context" marketing — tree-nav + XBRL exact-facts is our
  equivalent; benchmark scores decide, not architecture aesthetics.
- AlphaSense's premium content moat (broker research, expert calls) — not
  buyable at this stage; filings + transcripts + news covers the grid use case.
- Patent-risk cloning of Matrix UI specifics — our grid predates awareness,
  interface patterns (rows×prompts) are widespread; keep our own UX identity
  (badges, outliers, diffing) front and center.
