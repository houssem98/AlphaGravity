# DR loop progress — deep research world-class run

NEXT: P0c

## Tasks
- [x] P0a proxy limiter + 429 backoff (market-server llm.ts)
- [x] P0b adaptive rounds 4→2 + gap-gated extension
- [ ] P0c tier-down section writers + revisor to standard
- [ ] P0d client fallback-chain cap in callLLM
- [ ] P1a stream sections to UI as they finish
- [ ] P1b fix reader-count display (min(fresh,12))
- [ ] P1c parallelize contextualize batches
- [ ] P2a reader cap 12→20
- [ ] P2b overlap contextualize/analyze/adversarial tail
- [ ] P2c rerank sources before reader wave

## Ledger
(append one line per completed task: task · what changed · before→after effect)
- P0a · 9be8009 · Semaphore(5 anthropic/8 others) around provider dispatch + Retry-After honored in backoff + 503 unmasked · before: unbounded parallel burst → 429 → client walks full fallback chain per call; after: bounded in-flight FIFO, provider-suggested waits honored (expected — removes hidden latency multiplier on reader/section waves)
- P0b · d553a28 · shouldExtendSearch gate: rounds 1-2 always, 3-4 need gaps.length>0 AND fresh≥3 (parse-failed eval no longer buys rounds) · hop math: typical 4 rounds ≈16 hops → 2 rounds ≈9 hops on critical path; 5-test vitest suite added. Note: phase1/phase2 "test" files are tsx smoke scripts, broken pre-existing (supabase env at import) — verified identical failure on stashed baseline
