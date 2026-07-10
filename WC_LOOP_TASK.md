# LOOP TASK — Deep Research → measured world-class (evidence, not vibes)

> Standing instructions for the `/loop` run. **Read this + `WC_PROGRESS.md` first every iteration.**
> Successor to DR_LOOP_TASK.md (P0–P2 latency work, complete). This loop is about QUALITY, measured.

## GOAL (the only definition of done)
A deep-research run whose quality is **measured, not asserted**:
1. Eval harness exists and runs the REAL pipeline (live keys, live search) on 5 fixed queries; every report scored by (a) deterministic metrics from report metadata, (b) LLM-judge rubric (RACE-lite), (c) citation spot-check (sampled cited sentences vs actual source text).
2. Baseline recorded BEFORE any quality change. Every subsequent change ships with before→after eval delta. A change with no delta is reported as no delta.
3. Readers see full page content (Tavily raw_content, smart-capped), not 1,200-char snippets.
4. One live timed wall-clock run recorded (latency claims from DR loop finally verified or corrected).
EXIT when W0–W2 done + all deltas recorded. W3 is out of scope (listed for the human).

## Honesty rules (override everything)
- NEVER fabricate a score, latency, or delta. Judge scores come only from a real judge call over a real report.
- Eval path uses the real pipeline — no mocked LLMs inside an eval run.
- "expected" vs "measured" labeled explicitly in every ledger line.
- A blocked task (dead key, auth wall) = mark BLOCKED with the exact error, move on. Don't code around it silently.
- Costs are real money: eval run = 5 full pipeline runs + judge calls. Estimate & record cost per eval from BudgetTracker metadata. If a single eval run exceeds ~$5 estimated, stop and ask.

## Per-iteration cycle (one task, then end so the loop re-fires)
1. Read `WC_PROGRESS.md`. Pick single highest-priority UNCHECKED task. Skip BLOCKED.
2. Implement ONLY that task, smallest correct diff (ponytail rules).
3. Verify: typecheck (`npx tsc --noEmit -p tsconfig.app.json` in apps/market-ui) + `rtk proxy npx vitest run src/services/deepResearchService.p0b.test.ts` + any new checks. Server: tsc clean on touched files.
4. Commit on `roadmap/world-class` (one commit per task). Don't push unless told.
5. Update `WC_PROGRESS.md` (check task, ledger line with measured/expected labels, set NEXT). End iteration.
6. EXIT loop (ScheduleWakeup stop) when W0–W2 complete.

## Repo facts (verified 2026-07-10)
- Engine: `apps/market-ui/src/services/deepResearchService.ts`. Reader input: `sanitizeAndTrack(source.content).substring(0, 1200)` in buildReaderPrompt (~L1533). READER_WAVE_SIZE=20. Monolith-extractor fallback caps 700 chars.
- Tavily: browser → market-server `/api/tavily/search` (authMiddleware!) → api.tavily.com with `include_raw_content: false` hardcoded (`services/market-server/src/routes/tavily.ts`). Client types in `apps/market-ui/src/services/tavilyService.ts` (TavilySearchResult has no rawContent field yet).
- LLM: browser → market-server `/api/llm/chat` (NO auth middleware) + `/api/llm/providers` (GET, lists live-key providers). Per-provider semaphore + retry live (P0a).
- Keys (market-server/.env, presence only): ANTHROPIC(108ch), DEEPSEEK(35ch), GROQ(56ch), TAVILY(58ch) non-empty; GEMINI empty. LIVENESS UNKNOWN until probed — do not assume.
- Pipeline imports fine under vitest (p0b suite proves it). Standalone tsx does NOT (supabase import.meta env crash). So harness = vitest-gated file (`describe.skipIf(!process.env.RUN_DR_EVAL)`) or vite-node.
- market-server dev: `npm -w market-server run dev` (tsx watch, port 3001). VITE_API_URL default in client code = http://localhost:3001.
- market-ui has VITE_DEV_AUTH_BYPASS env name — tavily route sits behind authMiddleware; check `services/market-server/src/middleware/auth.ts` for a dev bypass before inventing one.
- Reranker upgrade (Cohere/Voyage) BLOCKED-BY-KEY: prod Cohere trial exhausted, Voyage free tier 3RPM (memory). Do not attempt.
- DR loop (P0–P2) shipped: adaptive rounds, tier enforcement, fallback cap, section streaming, contextualize overlap, keyword rerank. All hop-math only — never live-verified. W0a fixes that.

## Plan

### W0 — Truth infrastructure FIRST
- **W0a Smoke + probe (no new features):** start market-server locally (background). GET `/api/llm/providers` → record which providers are actually live. Then ONE minimal live `performDeepResearch` run from a vitest-gated script (tiny budget: maxLLMCalls ~15, maxRounds via default), wall-clock timed. Record: success/fail, providers used, wall-time, LLM calls, est cost, report word count, sources found. Any auth/env wall hit → document exactly, fix minimally (e.g. auth bypass flag if one exists), re-run. This validates every unverified claim from the DR loop. Deliverable: `apps/market-ui/eval/out/w0a-smoke.json` + ledger line with MEASURED numbers.
- **W0b Eval harness:** `apps/market-ui/eval/drEval.test.ts` (vitest, env-gated `RUN_DR_EVAL=1`) + `eval/rubric.ts`. 5 fixed queries (2 company, 1 comparative, 1 macro, 1 thematic — pin them in rubric.ts). For each: run real pipeline → persist report md+metadata to `eval/out/` → score:
  (a) deterministic: from report.metadata (citation density, numeric grounding rate, entailment rate, limitations count, sources, wall-time, est cost);
  (b) LLM-judge: fixed versioned prompt, strongest LIVE provider, dims comprehensiveness/insight/instruction-following/readability 1–10 + one-line rationale each;
  (c) citation spot-check: sample up to 10 cited sentences, judge says supported/partial/unsupported given the cited source's text (only web sources whose content we hold).
  Output one summary JSON + printed table. Run it once → this IS the baseline. Ledger: baseline numbers, cost of the eval itself.
- **W0c Baseline analysis:** read the 5 reports (spot-read, not vibes: worst dimension per rubric), write 5-line findings in WC_PROGRESS.md. This picks W2's target honestly.

### W1 — Full-content sources (the big quality lever)
- **W1a Server:** tavily route accepts `include_raw_content` from request body (default false), passes through. Client `searchWeb` requests it for deep-research calls; `TavilySearchResult` += `rawContent?: string`; map from Tavily response (`raw_content` field).
- **W1b Readers eat full content:** buildReaderPrompt uses `rawContent ?? content`, smart-capped ~6,000 chars at a paragraph boundary (helper + unit test). Monolith fallback cap 700→2,000 similarly. Check KB distill thresholds still sane (reader OUTPUT is still 3–6 bullets, so KB pressure mostly unchanged).
- **W1c Re-run eval:** full harness vs baseline. Ledger the delta per dimension, honest sign. If quality flat/down → investigate before proceeding (raw_content may be noisy boilerplate; consider readability extraction only if data says so).

### W2 — Citation correctness (density ≠ truth)
- **W2a:** from W0b/W1c spot-check results, identify the dominant citation-failure mode (wrong-source attribution vs unsupported claim vs stale number). Fix THAT (data chooses the fix, not the plan). Re-run eval, ledger delta.

### W3 — OUT OF SCOPE for this loop (for the human)
Server-side durable orchestrator (runs survive tab close, SSE streaming), native provider web-search/thinking tools, paid reranker key. Each is architecture-scale; don't start them inside a loop iteration.

## Benchmark targets (honest, contingent)
Smoke run completes; baseline exists; W1 shows measurable citation/depth gain or a documented null result; total loop LLM spend ≤ ~$15 estimated; zero fabricated numbers.
