# WC loop progress — deep research measured-quality run

NEXT: W1b

## Tasks
- [x] W0a smoke + provider probe (live timed run, MEASURED numbers)
- [x] W0b eval harness (5 queries, judge rubric, citation spot-check) + baseline (3/5; 2 reproducible failures = data)
- [x] W0d fix macro/thematic failure mode: undici 600s timeouts + budget 100→160; full 5/5 baseline v2
- [x] W0c baseline analysis (findings below, W2 target picked)

## W0c findings (from judge rationales + spot-reads, baseline v2)
1. DOMINANT DEFECT — scope drift: 4/5 reports "expand beyond the mandate" / "don't center the asked question" (macro-fed-nim worst: broad sector review, IF 5/10). Cause hypothesis: fixed institutional templates + per-section writers with no restated query focus → sections answer the template, not the question.
2. Insight = weakest dim (avg 6.6): "derivative of cited sources", "doesn't challenge assumptions" — synthesis summarizes, rarely contrarian. Harder fix (model capability + adversarial depth), not first target.
3. Attribution: only nvda bad (6/10 dubious); others 0-2/10 → not systemic, W2 de-prioritized vs scope drift.
4. Fanout tradeoff measured: v2 fanout reports scored LOWER on IF than v1 monoliths (7.0 vs 9.3 avg) — sectioning amplifies drift. Confirms defect #1.
5. W2a TARGET (data-chosen): query-centering in section writers — inject the original query + "answer THE question" directive into buildSectionWriterPrompt, and let the blueprint drop/adapt template sections irrelevant to the query. Re-eval must show IF gain without comprehensiveness loss.
- [x] W1a tavily raw_content plumb (server flag + client field)
- [ ] W1b readers eat full content (6k smart cap + test)
- [ ] W1c re-run eval vs baseline (delta or honest null)
- [ ] W2a fix dominant citation-failure mode (data-chosen), re-run eval

## Ledger
(one line per task: task · commit · what changed · MEASURED vs expected effect)
- W0a · bfd5603 · DEV_AUTH_BYPASS local auth bypass + vitest smoke harness, ONE real run (deepseek-chat) · ALL MEASURED: wall 380s; 4/4 rounds ran (P0b gate legitimately extends — search=155s dominant); 155 sources; 80 readers/74 ok; 97/100 LLM calls $0.076; conf Low, density 0.70, 80/84 grounded. KEY FINDINGS: (1) anthropic+groq keys DEAD (401), gemini keyless, deepseek only live → auto model path fails (providers endpoint reports key-presence not liveness; P0d 3-cap hits 3 dead anthropic models); (2) P2a 20-reader × 4 rounds ate budget → fanout 0/11 never ran → no P1a streaming, monolith write 165s; (3) DR-loop "2-3min" claim was wrong. Server left running (task bntbl9701)
- W0b · b57e4d9+827879b · rubric race-lite-v1 + 5-query harness + EVAL_ONLY merge · MEASURED baseline (3/5 ok, $0.20): avgWall 350s; judge avg 8.33/7.33/9.33/8.0 (deepseek judging deepseek — bias noted); entailment 0.98; density 0.53–0.91 (high variance); spot-check dubious 4–7/10 (weak attribution = W2 candidate); fanout ran only 1/3. FAILURES = data: macro+thematic died BOTH runs at ~325s with undici "terminated" — hypothesis: budget-starved monolith → single >300s deepseek call → undici bodyTimeout kill → W0d
- W0d · ce4aa2a+5512e51 · undici Agent 600s timeouts (npm-fetch pairing bug found live: node fetch rejects foreign dispatcher) + DEFAULT_BUDGET 100→160 · MEASURED baseline v2 (5/5 ok, $0.365): fanout 5/5 (was 1/3), macro+thematic now complete; avgWall 435s (up from 350s — fanout adds ~8 calls + richer 46-57K reports); judge 8.2/6.6/7.0/8.0 — instruction-following DROPPED vs monolith reports (macro 5/10): sectioned reports drift from the asked question; insight weakest dim 6.6; nvda attribution 6/10 dubious persists
- W0c · (docs) · judge-rationale synthesis across 5 v2 reports · W2 target = scope drift (4/5 reports, worst IF 5/10, fanout amplifies it); insight 6.6 noted but deferred; attribution non-systemic
- W1a · 2ea2a91 · include_raw_content flag server→client→deep-research opt-in · MEASURED live: 26-48K chars full text vs 1.5-2K snippets (20-30×); default false for other callers
