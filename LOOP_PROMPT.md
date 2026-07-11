# Self-Improvement Loop Prompt Structure

When the harness re-runs a query after a judge-scored iteration, it appends feedback to the original query. This document specifies what feedback is included.

## Iteration 1 (baseline)

Query passed as-is to performDeepResearch.

```
[user query]
```

Example:
```
Nvidia data center revenue growth and key risks FY2026
```

---

## Iteration 2+ (with feedback)

If iteration N scored min < 7.0, the query for iteration N+1 becomes:

```
[original query]

--- FEEDBACK FROM PRIOR ITERATIONS ---
[feedback block from iterations 1..N]
```

Each prior iteration contributes:

```
Iteration [i] (avg=[X.XX], min=[Y.Y]):
  - comprehensiveness: [rationale]
  - insight: [rationale]
  - instruction_following: [rationale]
  - readability: [rationale]
  [if dubious citations detected]: ⚠ [count] dubious citations detected — prioritize peer-reviewed and institutional sources.
```

Example iteration 2 query:

```
Nvidia data center revenue growth and key risks FY2026

--- FEEDBACK FROM PRIOR ITERATIONS ---
Iteration 1 (avg=6.75, min=6.0):
  - comprehensiveness: Missing forward guidance and capex implications
  - insight: Competitive benchmarking vs AMD lacking; no margin bridge analysis
  - instruction_following: Focused on FY2026 but lacks multi-year context
  - readability: Well-structured but tables truncated
  ⚠ 3 dubious citations detected — prioritize peer-reviewed and institutional sources.
```

---

## Pass Condition

Loop terminates when:
1. **All judge scores >= 7.0** — min(comprehensiveness, insight, instruction_following, readability) >= 7.0
2. **OR max iterations reached** — default 3 iterations, $0.40 budget exhausted

The harness selects the winner as the iteration with the highest average score across all 4 dimensions.

---

## Judge Prompt (instruction to deepseek-chat)

See `apps/market-ui/eval/rubric.ts::buildJudgePrompt()` for the exact grading rubric. Summary:

- **Comprehensiveness (1-10):** Major angles (financials, competition, risks, catalysts, quantified). Typical competent: 5-7. Exceptional/publishable: 9-10.
- **Insight (1-10):** Non-obvious analysis beyond summarizing sources; mispricings, second-order effects, contrarian checks.
- **Instruction-following (1-10):** Answers the specific request (entities, timeframe, focus) vs. generic report.
- **Readability (1-10):** Structure, tables, no filler, scannable.

---

## Citation Spot-Check (Title-Level Plausibility)

Harness samples up to 10 cited sentences and prompts the judge:

```
For each claim, judge whether the cited source(s) plausibly SUPPORT it based on title/domain:
- "plausible" (source type matches claim)
- "dubious" (source unlikely to contain this)
- "unresolved" (no source given)
```

If > 2 dubious verdicts in iteration N, feedback for iteration N+1 includes the warning.

---

## Telemetry Logged

Each iteration writes:
- **ok** — performDeepResearch completed without error
- **wallMs** — end-to-end wall time
- **judge** — all 4 scores + rationales (if judge succeeded)
- **citationSpot** — verdicts array (if citation check ran)
- **report** — full ResearchReport markdown + citations

Loop summary includes:
- **passedOnIter** — iteration number when min score >= 7, or undefined
- **bestAvgScore** — highest avg across all iterations
- **reason** — human-readable pass/fail reason
- **totalWallMs** — sum of all iteration wall times
- **totalCost** — estimated USD ($0.08 per performDeepResearch + $0.02 per judge call)

---

## Output Files

Harness writes to `loop-out/YYYYMMDD-HHMMSS.json`:

```json
{
  "query": "...",
  "model": "deepseek-chat",
  "iterations": [ /* IterationResult[] */ ],
  "winner": { /* best iteration */ },
  "summary": {
    "passedOnIter": 2,
    "bestAvgScore": 8.25,
    "reason": "Passed on iteration 2",
    "totalWallMs": 45000,
    "totalCost": 0.20
  }
}
```

If winner exists, also writes `loop-winner-TIMESTAMP.md` with the winning report.

---

## Tuning

Environment variables:

```bash
LOOP_QUERY="..."           # Required
LOOP_MODEL="deepseek-chat" # Default; see RESEARCH_MODELS for options
LOOP_MAX_ITER=3            # Default; cost = iter × $0.10
LOOP_MIN_SCORE=7.0         # Default; adjust for desired quality bar
VITE_API_URL=...           # market-server endpoint (default http://localhost:3002)
```

Example:

```bash
# Run until all scores >= 8, max 4 iterations
LOOP_QUERY="AMD vs Intel data center" LOOP_MAX_ITER=4 LOOP_MIN_SCORE=8.0 bash LOOP_SELF_IMPROVE.sh
```
