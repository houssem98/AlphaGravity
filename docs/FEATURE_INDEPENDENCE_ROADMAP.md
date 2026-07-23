# Feature independence — every long-running feature survives navigation

Goal: any feature that runs an async task keeps running when the user switches
views, and returning resumes the **same in-flight session** — live progress and
all — rather than restarting it or showing nothing. Multiple features run
concurrently, each independent.

The bug that started this: begin a Company AI Brief, switch to /trading, come
back — the brief had restarted (or vanished) instead of continuing.

## §0 The pattern (already proven in this repo — copy it)

Two features already do this correctly; they are the template, not theory:

- **Deep Research** → `stores/researchStore.ts`. State (isResearching, progress,
  report) lives in a module-level Zustand store; `runResearch` writes to it and
  is never aborted on unmount. SearchPage is a pure view over the store.
- **Research Grid** → `stores/gridRunStore.ts` + `gridAbort`. Same shape, with a
  module-level abort handle so the run is cancelled only on explicit user action.

The rule in one line: **execution state lives in a module-level store, keyed by
session; the async loop writes to the store and is aborted only by the user, not
by a component unmount; the component is a pure view that re-attaches on remount.**

Anti-pattern (what breaks it): holding run state in the component's `useState`
and/or aborting the run in a `useEffect` cleanup.

## §1 Anchors — read before changing anything

| Concern | File |
|---|---|
| Reference store #1 (research) | `src/stores/researchStore.ts`, `src/pages/SearchPage.tsx` (research mode) |
| Reference store #2 (grid) | `src/stores/gridRunStore.ts`, `src/components/grid/GridView.tsx` |
| Done this campaign (brief) | `src/stores/companyBriefStore.ts`, `src/components/company/CompanyBrief.tsx` |
| Global activity indicator | `src/stores/backgroundStore.ts`, `src/components/BackgroundActivity.tsx` |
| Acceptance harness | `e2e/featureContinuity.spec.ts` |

## §2 Hard constraints

- No new npm deps (Zustand is already the state tool — use it). Check `package.json`.
- Reuse the reference pattern; do not invent a second mechanism. A per-feature
  store keyed by session id (ticker, conversation id, …) so instances run
  concurrently.
- A run is aborted **only** by explicit user action (Stop / Regenerate / new
  input), never by `useEffect` cleanup.
- Register every lifted run in `backgroundStore` so the global indicator shows it.
- Deploy is `vercel --prod` from repo root. `/api/tn/*` and other endpoints are
  blob/edge-cached — a fix isn't verified until re-read.
- Verification per task: `npx tsc -b` clean; `npx playwright test featureContinuity`
  plus the task's own continuity spec green; existing guards
  (`tnNullFeed`, `hubAssetMarket`, `backgroundActivity`) stay green.

## §3 Measured state — 2026-07-23, prod

Empirically audited each long-running feature's state model (grep + live e2e):

| Feature | Component | State model | Survives nav w/ live continuity? |
|---|---|---|---|
| Deep Research | SearchPage (research) | `researchStore` (module-level) | **YES** — reference |
| Research Grid | GridView | `gridRunStore` + `gridAbort` | **YES** — reference |
| Company AI Brief | CompanyBrief | `companyBriefStore` (per ticker) | **YES** — fixed 2026-07-23, e2e proven |
| Quick Answer | SearchPage (qa) | local `chatHistory` useState; turns persisted to Supabase | **NO** — in-flight stream lost; reloadable after | 
| Devil's Advocate | DevilsAdvocate | local `answer`/`running` useState | **NO** — dropped on nav |
| Transcript summary | TranscriptSummary | local useState | measure — single fetch, likely low value |
| Latest quarter | LatestQuarterCard | local useState | measure — single fetch, likely low value |

Evidence: `CompanyBrief` used component `useState` for grid state and, before
this campaign, aborted the run in its unmount cleanup — so leaving the company
page dropped the run. Now proven fixed: `e2e/featureContinuity.spec.ts` starts a
brief, visits /trading, returns via the indicator, and the SAME run is still in
flight (one job, still "Stop", no duplicate). Deep Research and Grid were already
store-backed. QA / Devil's Advocate remain component-local.

## §4 Ledger — one task per loop pass, in order

- [x] **FI-1 — Company AI Brief** lifted to `companyBriefStore` (per ticker),
  never aborts on unmount, resumes the same session, registers a bg job.
  Done 2026-07-23; `featureContinuity.spec.ts` green.
- [ ] **FI-2 — Quick Answer** survives navigation. Lift the QA thread + in-flight
  answer stream out of SearchPage `useState` into a `qaStore` keyed by
  conversation id (the id already exists). The stream must keep writing to the
  store after SearchPage unmounts; returning shows the same thread still
  streaming. Register a bg job for the in-flight turn.
  Accept: a new continuity spec — ask a question, navigate to /trading mid-stream,
  return via the indicator, the same answer is still streaming into the same
  thread; no duplicate turn, no lost thread.
- [ ] **FI-3 — Devil's Advocate** survives navigation. Lift `answer`/`running`
  into a store keyed by ticker (or fold into `companyBriefStore` as a second
  entry field). Never abort on unmount; register a bg job.
  Accept: run it, navigate away and back, the same result/run is shown, not restarted.
- [ ] **FI-4 — Measure Transcript & Latest-Quarter.** Time the fetch. If it is a
  single sub-second call, document it as not worth lifting and mark done with the
  measurement. If it can run long, lift it like the others.
  Accept: a recorded timing in §5 and either a lift + spec, or a written no-op
  justification.
- [ ] **FI-5 — Sweep for remaining component-local async.** Grep the app for
  `useState` run/loading/streaming flags paired with `await`/`fetch`/`EventSource`
  in a component that a route can unmount, excluding the ones already lifted.
  List every hit in §5; lift any that are user-perceptible long-runs.
  Accept: the sweep list in §5, each item either lifted or justified.
- [ ] **FI-6 — Generalise the harness.** Parameterise `featureContinuity.spec.ts`
  so each lifted feature has a continuity case (start → detour to /trading →
  return via indicator → same session). All cases green in one run.

## §5 Progress log

| Date | Task | Result (real numbers) |
|---|---|---|
| 2026-07-23 | audit | 7 long-running features mapped. Already store-backed: Deep Research, Research Grid. Component-local (bug): Company Brief, Quick Answer, Devil's Advocate. |
| 2026-07-23 | FI-1 | Company Brief lifted to companyBriefStore (per ticker); unmount no longer aborts; resumes same session. tsc 0; featureContinuity + backgroundActivity + tnNullFeed + hubAssetMarket green. |
