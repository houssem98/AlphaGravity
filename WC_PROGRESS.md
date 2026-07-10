# WC loop progress — deep research measured-quality run

NEXT: W0b

## Tasks
- [x] W0a smoke + provider probe (live timed run, MEASURED numbers)
- [ ] W0b eval harness (5 queries, judge rubric, citation spot-check) + baseline
- [ ] W0c baseline analysis (5-line findings, picks W2 target)
- [ ] W1a tavily raw_content plumb (server flag + client field)
- [ ] W1b readers eat full content (6k smart cap + test)
- [ ] W1c re-run eval vs baseline (delta or honest null)
- [ ] W2a fix dominant citation-failure mode (data-chosen), re-run eval

## Ledger
(one line per task: task · commit · what changed · MEASURED vs expected effect)
- W0a · bfd5603 · DEV_AUTH_BYPASS local auth bypass + vitest smoke harness, ONE real run (deepseek-chat) · ALL MEASURED: wall 380s; 4/4 rounds ran (P0b gate legitimately extends — search=155s dominant); 155 sources; 80 readers/74 ok; 97/100 LLM calls $0.076; conf Low, density 0.70, 80/84 grounded. KEY FINDINGS: (1) anthropic+groq keys DEAD (401), gemini keyless, deepseek only live → auto model path fails (providers endpoint reports key-presence not liveness; P0d 3-cap hits 3 dead anthropic models); (2) P2a 20-reader × 4 rounds ate budget → fanout 0/11 never ran → no P1a streaming, monolith write 165s; (3) DR-loop "2-3min" claim was wrong. Server left running (task bntbl9701)
