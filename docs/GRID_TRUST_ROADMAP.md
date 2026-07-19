# GRID_TRUST_ROADMAP.md — Multi-Round Self-Hardening Research Grid

Goal: the Research Grid stops being a one-shot LLM table and becomes a **self-verifying instrument**: every cell earns a trust grade, low-trust cells are automatically re-researched with adversarial verification prompts, figures must survive cross-round consensus, and disagreements surface as flagged contradictions instead of silent guesses. World-class = a grid you can forward to a PM without re-checking it.

## 0. Doctrine (hard rules — every task obeys these)

- **TRUTH over polish.** A cell that says "sources don't contain this" with grade honesty beats a fluent guess. Never soften an honest-empty into prose.
- **No invented data.** Verification rounds may only cite what retrieval returns. A figure that appears in no citation is UNVERIFIED forever — no threshold, prompt, or merge step may launder it.
- **Grades are earned, not assigned.** LLM-only answers (no RAG grounding) cap at grade C no matter how confident the prose. Grade A requires: RAG-grounded + ≥1 resolving citation + figures stable across ≥2 rounds.
- **Determinism where possible.** Trust scoring, figure extraction, consensus checks = pure exported functions with unit tests. LLM calls only where judgment is genuinely needed (verification prompts, contradiction adjudication).
- **Reuse the existing plumbing.** `runGridCell` deps injection is the seam — verification rounds are new *prompts + orchestration* over the SAME runner, not a parallel pipeline. `extractFigures`/`figuresChanged` are the consensus primitives. `reportQaGates.ts` is the house style for gates (pure fn + regression test).
- **Cost discipline.** Only re-run cells below threshold, never the whole grid. Max 3 rounds. DeepSeek for verification (parallel-safe, conc 6); never burn Gemini's 20/day on rounds.
- **Additive persistence.** Trust/round data rides inside the existing `cells` JSONB in `lib_grid_runs` — new optional fields on `GridCell`, no migration, old rows stay loadable.

## 1. Codebase anchors (verified 2026-07-19)

- Engine: `apps/market-ui/src/services/gridResearch.ts` (~600 lines) — `runGrid` L474, `runGridCell` L290 (deps-injected: `callLLM`, `searchGravity`), `extractFigures` L106, `figuresChanged` L113, `aggregateCitations` L22, `splitAnswerSources` L128, `findUnmappedCites` L122, `GridCell`/`GridState` L155/167, `SEED_GRID_PROMPTS` L540.
- UI: `apps/market-ui/src/components/grid/GridView.tsx` — run state now in `apps/market-ui/src/stores/gridRunStore.ts` (survives mode switches); `changedCells` change-alerts already rendered; RAG badge + source viewer modal exist.
- Persistence: `apps/market-ui/src/services/gridStore.ts` — `lib_grid_runs` (name per memory: NOT `grid_runs`), cells stored as JSONB.
- Gate house-style: `apps/market-ui/src/services/reportQaGates.ts` + its 18-test regression file.
- Live probe precedent: `apps/market-ui/scripts/grid-numeric-probe.mjs` (known-XBRL-figure assertions vs live API; kept OUT of unit suite).
- Loop-harness precedent: `apps/market-ui/src/services/selfImprovementHarness.ts` + `eval/loopSelfImprove.test.ts`.

## 2. Environment constraints (from repo memory, 2026-07-19)

- Live LLMs: **DeepSeek only** (Gemini 20/day quota — UI-user only; Anthropic/Groq 401; Tavily 432-dead). Verification rounds run on DeepSeek.
- Anon RLS blocks direct `financials`/`chunks` reads → numeric cross-checks go through `searchGravity` (the RAG), NOT Supabase client queries.
- `financials.filing_date` holds the period END, not the SEC filed date — never treat it as a filed date (see EdgarLink notes in GridView).
- Unit tests + frozen fixtures are the verification path; live grid runs are manual/probe-only. `npx vitest run <file>` + `npx tsc --noEmit -p tsconfig.app.json` (run from `apps/market-ui/`) must be green per task.
- Deploy: `vercel --prod` from repo root only when UI changed (memory: direct-to-prod, no previews).

## 3. Architecture (target)

```
runGridRounds(def, deps, opts)                     [gridTrustRunner.ts — orchestration]
  round 1: runGrid(...)            → cells
  score:   scoreCellTrust(cell)    → TrustScore per cell   [gridTrust.ts — pure]
  while (round < maxRounds && any cell below threshold && budget):
      verifyPrompt(cell)           → adversarial re-ask of ONLY low-trust cells
      runGridCell(...)             → verification answer (same runner, same deps)
      consensus(cellR1, cellR2)    → figures agree → trust up; disagree → contradiction flag
  final: GridState with per-cell trust + rounds + contradictions
UI: grade chip per cell, "Harden" button, contradiction badge, round count in header
```

`TrustScore = { grade: 'A'|'B'|'C'|'D'|'F', score: 0-100, reasons: string[] }`
New optional `GridCell` fields: `trust?: TrustScore`, `rounds?: number`, `contradictions?: string[]`, `roundHistory?: { answer: string; figures: string[] }[]` (bounded: keep ≤3, answers truncated to 2k chars so JSONB rows stay small).

## 4. Regression table (tests are derived from these numbered rows)

| # | Requirement | Fails when |
|---|---|---|
| 1 | LLM-only cell (ragUsed falsy or 0 citations) caps at grade C | such a cell scores A/B |
| 2 | Honest-empty answer ("sources do not contain…") scores grade **B-honest**, never F | honesty punished below C or ranked under a confident guess |
| 3 | Grade A requires RAG + resolving citations + ≥2-round figure stability | A assigned on round 1, or with unresolved [N] markers |
| 4 | `consensusFigures`: identical figure sets → `agree`; differing figure present in both → `conflict` with both values captured | conflict silently resolved or dropped |
| 5 | Consensus never adopts a round-2 figure absent from round-2 citations text | unverified figure survives merge |
| 6 | Verification prompt contains the round-1 figures and instructs to independently re-derive + cite, NOT to confirm | prompt leaks "confirm the following" phrasing (sycophancy invite) |
| 7 | Only cells below threshold re-run; A/B cells untouched byte-identical | hardening mutates a passing cell |
| 8 | Round loop terminates: maxRounds respected AND no-progress round (same failing set, same figures) stops early | infinite/wasteful loop |
| 9 | Contradiction → cell grade capped at D + `contradictions[]` populated with both values | conflicting cell presents one value with no flag |
| 10 | Cancelled/error verification round leaves round-1 cell intact (no partial overwrite) | abort corrupts a done cell |
| 11 | Old saved runs (cells without `trust`) load and render without crash; scoring is lazy | history load throws on missing fields |
| 12 | Trust chip renders grade + tooltip reasons; F/D red, C amber, A/B green; honest-empty shows "honest" styling not failure styling | UI shows raw numbers or nothing |
| 13 | `runGridRounds` with `maxRounds:1` ≡ current `runGrid` + scoring (backwards-compatible default path) | single-round behavior differs from today's grid |
| 14 | Synthesis/comparison cells re-synthesize AFTER hardening (they consume hardened per-ticker answers), never get verification-prompted themselves | synthesis runs on stale round-1 answers or gets adversarially re-asked |

## 5. Verification prompt doctrine (GT-3 implements; test 6 enforces)

The round-2 prompt must be **adversarial, independent, and citation-forcing**:
- Do NOT show the model its own round-1 prose (anchoring). Show only the extracted FIGURES as claims-under-test.
- Phrase as: "Independently determine X for {ticker} from the provided sources. Then state whether each of these previously reported figures is SUPPORTED, CONTRADICTED, or NOT FOUND in your sources: {figures}. Cite [N] for every verdict."
- RAG query for the verification round uses a *reworded* form of the prompt (metric-forward, e.g. "{ticker} {metric keywords} exact figure") so retrieval isn't a byte-identical replay of round 1.

## 6. TASK LEDGER (execution state — GRID_LOOP works top-to-bottom)

One task per loop iteration. A task flips `[x]` only when its **Verify** passes and a Progress-log line with real numbers is appended to Section 7.

- [x] **GT-1 (foundation)** `apps/market-ui/src/services/gridTrust.ts` — pure scoring: `scoreCellTrust(cell: GridCell): TrustScore` (inputs: `ragUsed`, `citations.length`, `findUnmappedCites` resolution, `extractFigures` count vs figures-with-adjacent-[N]-marker count, honest-empty detection via "do not contain/only annual/not provided" patterns); `TrustScore` type; grade table from Section 4 rows 1–2 (A/B unreachable in round 1 — stability requirement makes B the round-1 ceiling for grounded cells, C for LLM-only). Export `TRUST_THRESHOLD` (re-run trigger = grade D or F). **Verify:** new `gridTrust.test.ts` covering regression rows 1, 2 (+ scoring monotonicity: adding a resolving citation never lowers score); tsc 0.
- [x] **GT-2 (consensus)** In gridTrust.ts: `consensusFigures(r1: string[], r2: string[], r2AnswerText: string): { agree: string[]; conflict: Array<{ r1: string; r2: string }>; unverified: string[] }` — normalized figure compare (reuse `extractFigures` normalization; treat $97,690M / $97.69B as equal — write the unit normalizer), row-5 guard (r2 figure must appear in r2 text/citations). And `mergeRounds(r1Cell, r2Cell): GridCell` implementing rows 3, 5, 9, 10 (grade A on stability, D-cap on conflict, r1 preserved on r2 error/cancel, roundHistory appended bounded). **Verify:** tests for rows 3, 4, 5, 9, 10; tsc 0.
- [x] **GT-3 (verification round)** `apps/market-ui/src/services/gridTrustRunner.ts` — `buildVerificationPrompt(cell, prompt)` per Section 5 doctrine; `runGridRounds(def, deps, opts: { maxRounds?: number; onCellUpdate?; signal? })`: round 1 delegates to existing `runGrid` untouched; subsequent rounds select `grade ∈ {D,F}` non-synthesis cells only, run them via `runGridCell` with the verification prompt + reworded RAG query, merge via GT-2, re-score; early-stop on no-progress (row 8); synthesis cells re-run LAST once per hardening pass iff any of their input cells changed (row 14). **Verify:** tests for rows 6, 7, 8, 13, 14 with mocked deps (no network); tsc 0.
- [x] **GT-4 (UI: trust chips + harden)** GridView: grade chip in each done cell (row 12 styling; tooltip = `trust.reasons`); header "Harden" button (visible when a run is done and any cell < B) → calls `runGridRounds` continuation rounds through the existing gridRunStore state + abort plumbing; round count + "hardened" indicator near the DONE counter; contradiction badge on conflicted cells opening the existing cell modal with both values listed. **Verify:** row 12 chip logic as a pure `chipPropsFor(trust)` fn with unit test; manual smoke in dev; tsc 0; `vercel --prod` after visual check.
- [ ] **GT-5 (persistence + history)** Trust fields ride through `saveGridRun`/`loadGridRun` untouched (JSONB — verify serialization drops nothing); history slide-over shows the grade distribution (e.g. "A×3 B×8 C×2 ⚠1") per saved run derived lazily from cells (row 11: missing trust → compute on render, never throw). **Verify:** row 11 test (fixture row without trust fields loads + scores); round-trip test cell→JSON→cell preserves trust/roundHistory; tsc 0.
- [ ] **GT-6 (self-improvement memory)** Per-run learning without a backend: after each hardened run, `deriveLessons(state): GridLesson[]` — patterns like "prompt X on ticker Y needed 3 rounds", "metric Z chronically unverified" → stored in `localStorage` (`grid_lessons_v1`, capped 100, LRU) and surfaced as (a) a "chronic offender" hint icon on prompts whose historical conflict rate >30%, (b) automatic RAG-query rewording preference for chronically-NOT-FOUND metrics (prepend the metric keywords that historically resolved). Pure derivation + storage adapter, injectable for tests. **Verify:** deriveLessons unit tests (chronic detection from 3-run fixture, LRU cap); tsc 0.
- [ ] **GT-7 (live probe extension)** Extend `scripts/grid-numeric-probe.mjs`: after each probe answer, run `scoreCellTrust` + assert known-good XBRL-backed answers score ≥ B-equivalent and a deliberately-wrong figure planted in a fixture cell is caught by `consensusFigures` as conflict. Stays OUT of unit suite (live probe). **Verify:** `npm run probe` output pasted into Progress log with real per-probe grades; unit-testable helpers extracted where feasible; tsc 0.
- [ ] **GT-8 (docs + export honesty)** Memo/CSV/XLSX exports include the trust grade column + contradiction footnotes (`buildMemo` gains a Trust section; CSV gains `trust` column; XLSX Sources sheet lists conflicts). A hardened grid exported anywhere carries its verification status — no silent-confidence exports. **Verify:** buildMemo/toCSV unit tests updated (existing `gridResearch.sources.test.ts` stays green); tsc 0; `vercel --prod`.

## 7. PROGRESS LOG (one line per completed task — real numbers only)

<!-- GRID_LOOP appends here. Format: GT-n DONE YYYY-MM-DD — <tests green count>, <tsc 0>, <key real numbers>. -->
GT-4 DONE 2026-07-19 — chipPropsFor pure fn + 2 row-12 tests (suites 41/41), tsc 0, sources 28/28, vercel --prod deployed (market-ui-self.vercel.app). GridView: TrustChip (green/amber/red/honest-cyan tones) in cell cards + modal footer, lazy scoreCellTrust on render (synthesis never graded), Harden button (visible when done run has any cell <B; runGridRounds maxRounds 3 resumeState via existing gridAbort), header ⛨ HARDENED R{n} + ⚠ conflict counters, per-cell ⚠ conflict badge + R{n}, modal red conflict panel listing both values.
GT-3 DONE 2026-07-19 — gridTrustRunner.ts (buildVerificationPrompt + runGridRounds, MAX_ROUNDS_CAP 3, resumeState seam for GT-4); 9 new tests (rows 6,7,8,13,14), suites 39/39 (24+9+3+3), sources 28/28, tsc 0. Verification via same runGridCell seam (vDef prompt swap → RAG query = ticker + adversarial prompt); no-progress fingerprint = failing keys + grade + answer figures; synthesis re-ran only when a merge changed a cell (object identity).
GT-2 DONE 2026-07-19 — 13 new tests (rows 3,4,5,9,10 + normalizer), gridTrust.test.ts 24/24, grid suites 30/30, sources script 28/28, tsc 0. normalizeFigure: $97,690M≡$97.69B; extractFigures drops '%' ('46%'→'46' — fixtures use real tokens); mergeRounds: A on stability (base B + agree≥1), D-cap on conflict (score min 45), r1 intact on r2 error/cancel, roundHistory ≤3 × ≤2000 chars. GridCell +4 optional fields (trust/rounds/contradictions/roundHistory).
GT-1 DONE 2026-07-19 — gridTrust.test.ts 10/10 green (17/17 incl. gridRunStore 3 + EdgarLink 4), gridResearch.sources.test.ts 28/28, tsc 0 errors. Scoring bands: B≥70/C≥50/D≥30/F<30; grounded round-1 max 80 (B), honest-empty fixed 75 (B, honest flag), LLM-only clamped ≤C, TRUST_THRESHOLD={D,F}.
