# LOOP TASK — Deep Research feature → world-class (fast + streaming + verified)

> Standing instructions for the `/loop` run. **Read this + `DR_PROGRESS.md` first every iteration.**
> Loop prompt is a one-liner pointing here so each fire stays small/cache-cheap.

## Per-iteration cycle (one task, then end so the loop re-fires)
1. Read `DR_PROGRESS.md`. Pick the single highest-priority UNCHECKED task (P0 before P1…). Skip BLOCKED.
2. Implement ONLY that one task. Smallest shippable diff (ponytail rules apply).
3. Verify: `npm -w market-ui run typecheck` + `npx vitest run src/services/deepResearchService.phase1.test.ts src/services/deepResearchService.phase2.test.ts` (from apps/market-ui). Server changes: `npm -w market-server run build` if build script exists, else typecheck.
4. Commit on branch `roadmap/world-class` (one commit per task). Don't push unless told.
5. Update `DR_PROGRESS.md` (check task, append one ledger line: what changed + measured/expected effect, set NEXT). End iteration.
6. EXIT loop (ScheduleWakeup stop) only when all P0–P2 done (P3 optional — stop there unless told otherwise).

## Guardrails
- Ask before destructive/irreversible. Never break the existing test suites.
- Never repeat a checked task. Blocked → log blocker, mark BLOCKED, move on.
- Honest ledger — measured numbers when possible, "expected" clearly labeled otherwise.
- Latency changes are hard to measure without live keys locally — reason about hop counts (sequential LLM round-trips on critical path) and record before→after hop math in the ledger.

## Repo facts
- Engine: `apps/market-ui/src/services/deepResearchService.ts` (4,700 lines). Orchestrator `performDeepResearch` ~L4029. Search loop `iterativeSearch` ~L1705 (maxRounds=4). Readers capped at 12 in `extractRoundIntelligence` ~L1668. Section fanout `synthesizeReportBySections` ~L2651 (CONCURRENCY=3, premium model). Contextualize serial batch loop ~L2497. LLM client chain `callLLM` ~L1094 (walks full provider×model fallback chain on any error).
- Server proxy: `services/market-server/src/routes/llm.ts` — POST `/api/llm/chat`, stateless, NO concurrency limit, NO 429 backoff. Anthropic path returns cacheStats.
- Progress UI: `apps/market-ui/src/components/research/ResearchProgress.tsx`, report pane `ResearchReport.tsx`, store `researchStore.ts`, page `SearchPage.tsx`.
- Tests: `deepResearchService.phase1.test.ts`, `phase2.test.ts` (vitest). Pure functions exported for tests — keep that pattern for new logic.
- Deploy UI: `vercel --prod --yes` from repo root (project market-ui). market-server deploys to Fly (user deploys; don't).

## Latency model (baseline, from code analysis 2026-07-09)
Critical path ≈ 25–30 sequential LLM hops: blueprint(1, premium) → 4×search-rounds(≈4 hops each: adaptive-queries + reader-wave + extractor + coverage-eval) → contextualize(3–5 serial lite batches) → analyzeSources(1) → adversarial(1 wave, premium) → section fanout(6–9 sections / conc 3 ≈ 3 premium waves) → revise(1, premium) → claim-audit(1). Premium hop 4–8s, std/lite 1–4s → 5–8 min real. Hidden multiplier: parallel bursts hit providers with no limiter → 429 → full fallback-chain walk per call.

## Plan (highest ROI first)

### P0 — Speed (~2× faster, no quality loss)
- **P0a** Proxy limiter + backoff: in `services/market-server/src/routes/llm.ts` add per-provider concurrency limit (p-limit or tiny inline semaphore, ~5 anthropic / 8 gemini / 8 deepseek / 8 groq) + honor 429/`retry-after` with 1 retry before failing. Kills the fallback-chain storm. Keep it small — inline semaphore fine, no new dep if avoidable.
- **P0b** Adaptive rounds: `iterativeSearch` default maxRounds 4→2; run round 3–4 only if `evaluateCoverage` reports insufficient AND round added ≥N new sources. Saves ~8 hops on typical queries. Keep param overridable.
- **P0c** Tier-down: section writers (`synthesizeReportBySections`) + `reviseReport` use `standard` tier instead of premium; keep premium for blueprint + adversarial only. Verify pickDriver call sites.
- **P0d** Client fallback-chain cap: in `callLLM`, cap fallback attempts (e.g. 3 models max) and don't retry on AbortError/budget errors. Currently one provider outage = N×timeout per call.

### P1 — Perceived speed
- **P1a** Stream sections: fanout already emits `onSectionDone` — pipe finished section bodies through onProgress (new optional field, e.g. `partialSections`) into `researchStore` so `ResearchReport`/progress pane renders sections as they land instead of waiting for 100%.
- **P1b** Fix reader-count display: progress message at iterativeSearch ~L1760 says `${fresh.length} parallel Readers` but only 12 fire — use `Math.min(fresh.length, 12)`.
- **P1c** Parallelize contextualize batches: serial `for` loop over batches → bounded `Promise.all` (respect budget guard semantics).

### P2 — Quality ceiling
- **P2a** Raise reader cap 12→20 (safe once P0a limiter exists).
- **P2b** Overlap the tail: fire `contextualizeSources` and `analyzeSources` concurrently where data-independent (analyze uses knowledgeBase, not enriched contexts — check then overlap), and adversarial right after analyze resolves.
- **P2c** Rerank sources before readers: score/slice top sources by `scoreSource` + section keywords BEFORE reader wave so 20 readers see the best 20, not first 20.

### P3 — Optional polish (do only if told)
- **P3a** Prompt-cache reuse of static blocks across premium calls (Anthropic cache_control on shared prefix via proxy).
- **P3b** Latency telemetry: per-stage wall-time in report metadata (`stageTimings`), surfaced in methodology footer.

## Benchmark targets
Typical query wall-time <2 min (from 5–8); first visible section <45s; zero test regressions; report quality metrics (citation density, grounding rate) not degraded.
