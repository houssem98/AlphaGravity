# GRID_AGENT_CELL_ROADMAP.md — Agentic Cells with Transparent Tool Traces

Goal: every Research Grid cell stops being a single opaque RAG call and becomes a **mini-agent with a visible work log** — "Thought for 4.2s · called 5 tools", per-step timings with ✓/✗, source chips per tool — like an MCP assistant pane, but inside each cell. A PM reading a cell sees exactly which tools ran, how long each took, which failed, and which source backs every figure. World-class = the cell IS the audit trail.

## 0. Doctrine (hard rules — every task obeys these)

- **The trace is a RECORD, never a performance.** A step appears in the trace iff that call actually executed. No decorative steps, no invented timings, no "Searching the web" when no web search ran. A skipped tool is absent; a failed tool shows ✗ with its real error.
- **Tool failures are honest, not fatal.** One dead tool never kills the cell — the cell completes from the sources that succeeded, and the analyze step may only consume data that successful steps returned (no laundering).
- **Reuse the seam.** `runGridCell` deps injection is still the only pipeline. Tools are OPTIONAL new members of `CellRunnerDeps`; when absent, behavior is byte-identical to today (the trust layer, hardening rounds, and exports all keep working unchanged).
- **Additive persistence.** `steps?: CellStep[]` rides inside the existing `cells` JSONB of `lib_grid_runs` — bounded (≤12 steps, meta ≤500 chars each), old rows load unchanged, no migration.
- **Trust grades stay earned.** Multi-tool corroboration may ADD `trust.reasons` lines; it never raises a grade above the bands gridTrust already enforces. A figure from a market tool needs a citation entry like any RAG figure.
- **Cost discipline.** Tool fetches are free/cheap proxied endpoints (market-server, gravity) and run in parallel; exactly ONE DeepSeek analyze call per cell, only when there is tool data beyond a grounded RAG answer. RAG-grounded-only cells keep costing zero LLM calls.
- **Verify before wiring.** Every endpoint a tool uses must be probed live (curl) before the tool ships. A dead endpoint gets a ledger note, not a mock in prod code.

## 1. Codebase anchors (verified 2026-07-19)

- Engine: `apps/market-ui/src/services/gridResearch.ts` — `runGridCell` L~300 (deps seam: `callLLM`, `searchWeb?`, `searchGravity?`), `GridCell` (now carries `trust/rounds/contradictions/roundHistory` from GT-2), `extractFigures`, `splitAnswerSources`.
- Trust layer (complete 8/8): `gridTrust.ts` (`scoreCellTrust`, `withTrust`), `gridTrustRunner.ts` (`runGridRounds` — hardening must keep working over agentic cells), `gridLessons.ts`.
- UI: `apps/market-ui/src/components/grid/GridView.tsx` — `CellContent` card (badges row: RAG/FLAG + TrustChip + ⚠ + R{n}), cell modal (answer, conflict panel, sources, footer), `SkeletonCard` for running cells, `gridRunStore` for cross-mount run state.
- Persistence: `gridStore.ts` — cells JSONB passthrough (GT-5 proved trust fields ride free; steps will too).
- Probe: `scripts/grid-numeric-probe.mjs` (tsx, imports TS helpers, 31/31 baseline).
- **Real tool endpoints** (grep-verified in `services/market-server/src/routes/`, live-probe before use — AC-3):
  - `trading.ts`: GET `/quote`, `/fundamentals`, `/financials`, `/history` (mount prefix: check `index.ts`)
  - `firecrawl.ts`: POST `/search`, `/scrape` (Firecrawl key alive per 2026-07-10 memory — re-verify)
  - LLM proxy: POST `/api/llm/chat` (DeepSeek — the only live LLM)
  - gravity-api: POST `/v1/search` (SEC RAG — already wired as `searchGravity`)

## 2. Environment constraints (from repo memory, 2026-07-19)

- DeepSeek is the only live LLM (Gemini 20/day UI-only; Anthropic/Groq 401; Tavily 432-dead). Firecrawl was alive 2026-07-10 — AC-3 re-probes before shipping webSearch.
- Anon RLS blocks direct financials/chunks reads — numeric tools go through market-server/gravity endpoints, never Supabase client.
- Unit tests + mocked deps are the verification path; live checks only via `npm run probe`. Gates per task: `npx vitest run` (from `apps/market-ui/`), `npx tsc --noEmit -p tsconfig.app.json` = 0, existing suites stay green (gridTrust 26, gridTrustRunner 9, gridLessons 6, gridRunStore 3, EdgarLink 3, sources script 37), `vercel --prod` iff UI changed.
- Vercel Hobby: 12-function cap on market-ui — any new API route rides the existing `[fn].ts` dispatcher, never a new file.

## 3. Architecture (target)

```
runGridCell(def, ticker, promptId, deps, signal, state)
  trace = newTrace()                          [gridTrace.ts — pure]
  parallel (allSettled):
    step "Searching SEC filings"   → deps.searchGravity          (existing)
    step "Fetching market data"    → deps.tools.marketQuote      (new, optional)
    step "Pulling fundamentals"    → deps.tools.fundamentals     (new, optional)
    step "Searching the web"       → deps.tools.webSearch        (new, optional, iff alive)
  step "Analyzing" → ONE DeepSeek call over ONLY the successful steps' data
                     (skipped entirely when RAG alone answered — today's path)
  cell.steps = trace.done()  (≤12, bounded meta)
  cell.citations += tool-backed citation entries (quote/fundamentals figures citable)
UI: card badge "⚡ N tools · X.Xs" · modal accordion (label, duration, ✓/✗) ·
    live current-step ticker in the running skeleton (via onStep → gridRunStore)
```

`CellStep = { label: string; tool: string; ms: number; status: 'ok' | 'failed' | 'empty'; error?: string; meta?: string }`

## 4. Regression table (tests are derived from these numbered rows)

| # | Requirement | Fails when |
|---|---|---|
| 1 | Trace records exactly the calls that executed — 2 tools mocked → 2 tool steps (+1 analyze iff LLM ran); nothing invented | decorative/phantom steps appear |
| 2 | Step `ms` values are real measurements (>0 under fake timers; each ≤ cell `durationMs` + 50ms slack) | fabricated or negative timings |
| 3 | One tool rejects → its step is `failed` with the real error; cell still `done` from remaining sources | tool failure kills the cell or the failure is hidden |
| 4 | Cells without `steps` (all pre-AC saved runs) render + score + export unchanged | legacy cell crashes or renders a fake empty trace |
| 5 | `steps` survive save→load JSON round-trip; bounded ≤12 steps, meta ≤500 chars | JSONB bloat or dropped trace |
| 6 | Analyze prompt contains ONLY data from successful steps — failed tool's partial data never reaches the LLM | laundered data from a failed step |
| 7 | Trace UI: header "called N tools · X.Xs"; one row per step with duration + ✓/✗; running cell shows the live current step label | raw JSON shown, or a static spinner hiding progress |
| 8 | A market-tool figure quoted in the answer has a citation entry (tool-sourced, with `sourceData`) — clickable like RAG cites | uncitable tool figures |
| 9 | `runGridCell` with no `tools` in deps ≡ today's behavior byte-identical (all 51 existing unit tests + 37 script checks green untouched) | default path drifts |
| 10 | Trust: multi-tool cells still graded by unchanged `scoreCellTrust` bands; corroboration only appends reasons | step count inflates a grade |
| 11 | Hardening (`runGridRounds`) over agentic cells: verification round re-runs with the SAME tool registry; merged cell keeps its round-1 trace + appends verification step summary | hardening strips or duplicates traces |
| 12 | Live probe: one agentic AAPL cell completes with ≥2 `ok` tool steps, XBRL figure present, trace timings sum sanely | probe passes without exercising tools |

## 5. Trace doctrine (AC-1 implements; rows 1-3 enforce)

- A step is opened WHEN the call starts and closed when it settles — `ms` comes from one monotonic clock, not estimates.
- Step labels are user-facing verbs ("Searching SEC filings", "Fetching market data", "Analyzing") mapped 1:1 from the tool key — a new tool key without a label entry falls back to the key itself, never to a borrowed label.
- `status: 'empty'` (ran fine, returned nothing useful) is distinct from `'failed'` (threw/HTTP error) — honest-empty at the step level, mirroring the trust layer's honest-empty at the cell level.

## 6. TASK LEDGER (execution state — loop works top-to-bottom)

One task per loop iteration. A task flips `[x]` only when its **Verify** passes and a Progress-log line with real numbers is appended to Section 7.

- [x] **AC-1 (trace foundation)** `apps/market-ui/src/services/gridTrace.ts` — pure: `CellStep` type, `newTrace(now?)` returning `{ step<T>(label, tool, fn): Promise<T>` (opens/closes a step around any promise, catches → `failed`, empty-detection hook), `done(): CellStep[]` (bounded ≤12, meta truncated 500) `}`; `traceSummary(steps): { tools: number; ok: number; failed: number; totalMs: number }`. Injectable clock for tests. Add `steps?: CellStep[]` to `GridCell` (additive, like GT-2 fields). **Verify:** new `gridTrace.test.ts` covering rows 1, 2, 3 (fake clock, resolved/rejected/empty fns, bound + truncation); tsc 0; all existing suites green.
- [x] **AC-2 (instrument the existing runner)** In `runGridCell`: wrap the existing `searchGravity` call and the existing `callLLM` call in trace steps ("Searching SEC filings", "Analyzing"); attach `steps` to every returned done/honest-empty cell. NO new tools yet, NO behavior change — row 9 is the whole point. **Verify:** tests for rows 4, 9 (mocked deps: answers byte-identical to pre-instrumentation fixtures, steps present with 1-2 entries); all 51 unit + 37 script checks green untouched; tsc 0.
- [x] **AC-3 (real tool registry)** *(webSearch SKIPPED: prod market-server lacks /api/firecrawl/search — "Cannot POST"; route exists locally, Fly image stale. Unblock = redeploy market-server to Fly (user infra), then add the webSearch fetcher.)* Extend `CellRunnerDeps` with `tools?: { marketQuote?; fundamentals?; webSearch? }` (each `(ticker, signal) => Promise<{ text: string; data?: unknown }>`). FIRST: live-probe the endpoints (`curl` market-server `/api/trading/quote?symbol=AAPL`, `/fundamentals`, firecrawl `/search`) and record real responses in the Progress log — a dead endpoint's tool is ledger-noted and skipped, not mocked. Implement fetchers in GridView deps (browser-side, VITE_API_URL base). Tools run parallel via `Promise.allSettled` inside trace steps; analyze step consumes only fulfilled results (row 6). **Verify:** tests for rows 3, 6 (mocked registry: one rejecting tool → failed step + clean analyze prompt; no-tools deps → row 9 identity); tsc 0.
- [x] **AC-4 (tool citations)** Successful `marketQuote`/`fundamentals` steps append citation entries (`source: 'market-server'`, title like "AAPL quote (market-server, live)", `sourceData.text` = the returned snapshot) so tool figures are clickable + count for trust's figure-adjacency exactly like RAG cites (row 8). **Verify:** row 8 test (tool figure in answer → resolving citation, `scoreCellTrust` sees it; grade unchanged vs same cell without tools — row 10); tsc 0.
- [x] **AC-5 (trace UI + live ticker)** GridView: card badges row gains "⚡ N·X.Xs" chip (from `traceSummary`); cell modal gains a "Tools" accordion above Sources — one row per step: label, `(X.Xs)`, ✓ / ✗ + error tooltip / ∅ for empty (row 7); running cells: `onStep` callback → `gridRunStore` map cellKey→current label → SkeletonCard shows the live step label. Legacy cells without steps: no trace UI at all (row 4). **Verify:** pure `traceSummary` + accordion-props fn unit tests; rows 4, 7; tsc 0; `vercel --prod` after visual check.
- [x] **AC-6 (persistence + hardening compat)** Steps ride `saveGridRun`/`loadGridRun` (round-trip test, bounds enforced at trace level — row 5); `runGridRounds` verification rounds pass the same deps through (they already do — prove it), merged cells keep round-1 `steps` and `mergeRounds` appends nothing trace-breaking (row 11). **Verify:** rows 5, 11 tests (round-trip toEqual; harden over an agentic cell fixture → trace intact); tsc 0.
- [x] **AC-7 (live probe extension)** `grid-numeric-probe.mjs`: one agentic-cell probe — run `runGridCell` (imported via tsx) against LIVE gravity + market-server with the real tool registry for AAPL; assert ≥2 `ok` steps, XBRL revenue figure present, `traceSummary.totalMs` > 0 (row 12). Real per-step timings pasted into Progress log. **Verify:** `npm run probe` green with the new section; tsc 0.
- [x] **AC-8 (NL endpoint — stretch, verify-first)** Single natural-language REST surface: extend the EXISTING market-ui `[fn].ts` dispatcher (12-fn cap!) with `ask` → `{ q }` → server-side single agentic cell (gravity + market-server fetches run fine in Node) → JSON `{ answer, citations, steps, trust }`. FIRST verify the import graph (`gridResearch`/`gridTrace` are browser-free modules — no `import.meta.env` leakage; shim `VITE_*` reads). If the Vercel runtime blocks it, ledger-note the blocker precisely and stop — no parallel implementation. **Verify:** dispatcher unit test with mocked fetch; live `curl` of the deployed endpoint pasted into Progress log; tsc 0; `vercel --prod`.

## 7. PROGRESS LOG (one line per completed task — real numbers only)

<!-- Loop appends here. Format: AC-n DONE YYYY-MM-DD — <tests green count>, <tsc 0>, <key real numbers>. -->
AC-8 DONE 2026-07-20 — /api/tn/ask live: GET ?q&ticker → one server-side agentic cell (runGridCell deps seam, gravity + market-server fetchers inline, maxDuration 60). Live curls: "AAPL total net sales FY2025" → $416.16B [2] + Live market [3] + Fundamentals [4], 4 citations; "AAPL FCF fiscal 2025" → done, trust B/80, 8545ms, steps [ok] marketQuote 486ms | [ok] fundamentals 583ms | [ok] rag 8542ms. Gotcha fixed: Vercel node16 ESM needs .js extensions on the fn's relative import chain ([fn].ts + gridResearch + gridTrust) — FUNCTION_INVOCATION_FAILED before, 200 after. 2 dispatcher tests (mocked fetch: 400s; grounded → answer+3 steps+2 market citations+trust B). Suites 74/74, tsc 0, sources 37/37, deployed. ROADMAP COMPLETE 8/8 (webSearch tool = only deferred item, needs market-server Fly redeploy).
AC-7 DONE 2026-07-20 — npm run probe 32/32: live agentic AAPL cell via real runGridCell → [ok] rag 7865ms | [ok] fundamentals 14525ms | [ok] marketQuote 14551ms (parallel), 3/3 ok steps, 416,161 XBRL figure present, 36941ms summed trace; all 31 prior assertions + canary stayed green. Suites 72/72, tsc 0. Probe-side deps built inline (no import.meta.env leakage). No UI change, no deploy.
AC-6 DONE 2026-07-20 — 2 new tests: JSON round-trip toEqual on 3-step cell (quote ok / fundamentals failed HTTP 500 / rag ok — steps byte-equal after revive); harden maxRounds 2 over tooled deps → merged BAD cell rounds 2 with round-1 trace intact (rag + marketQuote steps survive mergeRounds spread). Zero prod code changes needed — JSONB passthrough + {...r1} already correct. Suites 72/72, tsc 0, sources 37/37. No UI change, no deploy.
AC-5 DONE 2026-07-20 — trace UI live: card ⚡N·X.Xs chip (tooltip = per-step glyph+label+seconds), modal "Tools — called N · X.Xs (· k failed)" details accordion (✓/✗/∅ rows, ms, meta, error), SkeletonCard live step label via onStep→gridRunStore.cellSteps (set on step start, cleared on cell update in startRun/hardenRun/reRunCell); stepGlyph pure fn. 2 new tests (glyphs; cellSteps set/clear). Suites 70/70, tsc 0, sources 37/37, vercel --prod deployed. Legacy no-steps cells: zero trace UI (row 4).
AC-4 DONE 2026-07-19 — attachToolEvidence pure fn (ids continue after max, "Live market: … [N]" / "Fundamentals (TTM): … [N]" lines, market:// urls, sourceData carries snapshot) applied on grounded + LLM-fallback paths; 3 new tests (grounded+tool → 2 citations id 1/2 adjacency ok; ids 3→4/5 + empty-identity; row 10 grade B unchanged with/without tools). Suites 68/68, tsc 0, sources 37/37, vercel --prod deployed.
AC-3 DONE 2026-07-19 — live probes: /api/quote?symbols=AAPL → Nasdaq real-time (price $333.74, post-mkt $333.66); /api/fundamentals?symbol=AAPL → TTM (P/E 40.5, EPS $8.24, revenue $451.4B, FCF $101.1B, gross 47.9%, buy×43); /api/firecrawl/search → "Cannot POST" (prod stale — webSearch skipped, ledger-noted). CellTools registry + parallel allSettled fan-out + toolBlock only from successful results; GridView CELL_TOOLS wired into 3 deps sites. 3 new tests (failed tool → real error + clean LLM prompt; all-fail → honest no-sources, zero LLM; grounded+tools → RAG answer untouched). Suites 66/66, tsc 0, sources 37/37, vercel --prod deployed.
AC-2 DONE 2026-07-19 — runGridCell instrumented (rag/webSearch/llm steps incl. synthesis; error/cancelled cells keep partial trace); 4 new tests (grounded path answer byte-identical + 1 ok rag step, RAG throw → soft-fail honest cell + failed step 'HTTP 503', LLM fallback rag-empty+llm-ok, steps never leak into CSV/memo); suites 63/63, tsc 0, sources 37/37 untouched. No UI change, no deploy.
AC-1 DONE 2026-07-19 — gridTrace.ts (newTrace/step/done/traceSummary, injectable clock, TRACE_MAX_STEPS 12, TRACE_META_MAX 500) + GridCell.steps optional field; gridTrace.test.ts 8/8 (rows 1/2/3: fake-clock ms 120/35/50 exact, reject rethrown w/ real error, empty≠failed, 15→12 bound, 600→500 meta trunc); all suites 59/59, tsc 0, sources 37/37. No UI change, no deploy.
