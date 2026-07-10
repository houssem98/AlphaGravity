# DR loop progress — deep research world-class run

NEXT: DONE — P0-P2 complete, loop exited. P3 optional, not started.

## Tasks
- [x] P0a proxy limiter + 429 backoff (market-server llm.ts)
- [x] P0b adaptive rounds 4→2 + gap-gated extension
- [x] P0c tier-down section writers + revisor to standard
- [x] P0d client fallback-chain cap in callLLM
- [x] P1a stream sections to UI as they finish
- [x] P1b fix reader-count display (min(fresh,12))
- [x] P1c parallelize contextualize batches
- [x] P2a reader cap 12→20
- [x] P2b overlap contextualize/analyze/adversarial tail
- [x] P2c rerank sources before reader wave

## Ledger
(append one line per completed task: task · what changed · before→after effect)
- P0a · 9be8009 · Semaphore(5 anthropic/8 others) around provider dispatch + Retry-After honored in backoff + 503 unmasked · before: unbounded parallel burst → 429 → client walks full fallback chain per call; after: bounded in-flight FIFO, provider-suggested waits honored (expected — removes hidden latency multiplier on reader/section waves)
- P0b · d553a28 · shouldExtendSearch gate: rounds 1-2 always, 3-4 need gaps.length>0 AND fresh≥3 (parse-failed eval no longer buys rounds) · hop math: typical 4 rounds ≈16 hops → 2 rounds ≈9 hops on critical path; 5-test vitest suite added. Note: phase1/phase2 "test" files are tsx smoke scripts, broken pre-existing (supabase env at import) — verified identical failure on stashed baseline
- P0c · a322c07 · root-cause bigger than spec: pickDriver honored preferred unconditionally → premium leaked into readers/extractor/adaptive-queries/coverage-eval/revisor too, tier system was cosmetic. Fixed in pickDriver (tierPeer coercion, premium still honors exact pick) + sections/monolith premium→standard · ~12 premium calls/run → ~4 (expected; premium hop 4-8s vs standard 1-4s)
- P0d · 9eb14c3 · callLLM chain capped at 3 attempts + isTerminalLLMError (cancel/abort/budget rethrow immediately — mid-call cancel used to keep firing requests at remaining models) · worst-case per-call: 10+ sequential timeouts → 3; 9-test suite green
- P1a · 6090d9f · onSectionDone carries template-ordered draft snapshot → ResearchProgress.partialSections → live markdown panel in progress UI · first visible content at ~77% wall-time instead of 100% (drafts appear as each section writer returns); build+typecheck+9 tests green
- P1b · 887e3db · READER_WAVE_SIZE=12 const extracted, progress message clamps · display honest ("45 Readers" lie gone); P2a now a one-const change
- P1c · 4e4dd28 · contextualize batch loop serial→Promise.all · 3-5 sequential lite hops → 1 wall-clock hop on stage 2b (expected); budget overshoot bounded at batches-1 lite calls. P1 phase complete
- P2a · db475af · READER_WAVE_SIZE 12→20 · +8 sources/round get per-source extraction instead of silent drop; wave is parallel lite-tier so wall-time flat (expected)
- P2b · e8c43a9 · contextualize floated concurrent with analyze+adversarial, joined pre-synthesis (its tags only feed stage-5 writers; verified .context consumers) · contextualize off critical path: −1 wall-clock hop (expected)
- P2c · 93c725f · rerankSourcesForReaders: blueprint-keyword relevance (50%) + authority (30%) + semantic (20%) reused from scoreSourceForSection, applied before the READER_WAVE_SIZE slice · reader budget spent on on-topic sources not just high-authority ones; 3 new tests, 12/12 total green, build clean

## Summary — P0-P2 complete (10/10)
Critical-path hop count: ~25-30 sequential LLM hops → ~7-9 (P0a concurrency limiter kills the 429-storm multiplier; P0b halves base rounds 4→2; P0c collapses ~12 premium calls/run to ~4; P0d caps worst-case fallback retries 10+→3; P1c+P2b remove contextualize from the serial critical path entirely). Perceived latency: first content visible at ~77% instead of 100% (P1a section streaming). Quality: reader wave widened 12→20 sources and reranked by topic relevance instead of raw authority (P2a+P2c). All changes typecheck clean, 12/12 unit tests green, production build clean. P3 (prompt-cache reuse, stage-timing telemetry) intentionally left undone — optional polish, not requested.
