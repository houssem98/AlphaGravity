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
| Done this campaign (QA) | `src/stores/qaStore.ts`, `src/pages/SearchPage.tsx` (qa mode) |
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
| Quick Answer | SearchPage (qa) | `qaStore` (per conversation) | **YES** — fixed 2026-07-23, e2e proven |
| Devil's Advocate | DevilsAdvocate | `companyBriefStore` `devil*` (per ticker) | **YES** — fixed 2026-07-23, e2e proven |
| Transcript summary | TranscriptSummary | `companyBriefStore` `transcript*` (per ticker) | **YES** — fixed 2026-07-23, e2e proven |
| Latest quarter | LatestQuarterCard | none — pure fn of the `metrics` prop | **N/A** — no async, nothing to lift |

Evidence: `CompanyBrief` used component `useState` for grid state and, before
this campaign, aborted the run in its unmount cleanup — so leaving the company
page dropped the run. Now proven fixed: `e2e/featureContinuity.spec.ts` starts a
brief, visits /trading, returns via the indicator, and the SAME run is still in
flight (one job, still "Stop", no duplicate). Deep Research and Grid were already
store-backed.

Quick Answer re-measured 2026-07-23 against the code before FI-2: the row above
understated it — not only was `chatHistory`/`currentQuery` component `useState`,
the whole stream lived in `useGravitySearch`'s `useState` + `wsRef`, and
`conversationId` was re-seeded with a fresh `crypto.randomUUID()` on every mount,
so a remount could not have re-attached to the in-flight run even in principle.
Lifted in FI-2 to `qaStore` (execution, socket and thread all module-level).

## §4 Ledger — one task per loop pass, in order

- [x] **FI-1 — Company AI Brief** lifted to `companyBriefStore` (per ticker),
  never aborts on unmount, resumes the same session, registers a bg job.
  Done 2026-07-23; `featureContinuity.spec.ts` green.
- [x] **FI-2 — Quick Answer** survives navigation. QA thread + in-flight stream
  lifted into `qaStore` keyed by conversation id; the WebSocket is module-level
  and closed only by Cancel / a new question. Registers a bg job per turn.
  Done 2026-07-23; `qaContinuity.spec.ts` green.
- [x] **FI-3 — Devil's Advocate** survives navigation. `answer`/`running`/`error`
  folded into `companyBriefStore` as `devil*` fields on the ticker's entry; never
  aborts on unmount; registers a bg job.
  Done 2026-07-23; `devilsAdvocateContinuity.spec.ts` green.
- [x] **FI-4 — Measured Transcript & Latest-Quarter.** Timed against prod:
  the transcript's RAG call is 1.7s / 9.4s / 14.7s — not sub-second, so it was
  lifted into `companyBriefStore` as `transcript*` fields (+ bg job, resumes on
  remount). Latest-Quarter needed no lift and no measurement: it issues no fetch
  at all — it is a pure function of the `metrics` prop the company page already
  has. Done 2026-07-23; `transcriptContinuity.spec.ts` green.
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
| 2026-07-23 | FI-4 | Measured, then lifted. Transcript RAG call (POST prod /v1/search, fast depth, AAPL) timed 3x: 9.43s / 14.71s / 1.69s (the 1.7s is a semantic-cache hit) — not sub-second, so lifted to companyBriefStore transcript* fields + bg job + resume-on-remount. Latest-Quarter re-measured and §3 was wrong about it: it has NO fetch and NO state, it is a pure function of the metrics prop, so there is nothing to lift (no-op, recorded). tsc -b 0 errors; deployed prod (market-grxnadfw3, aliased). transcriptContinuity + devilsAdvocate + qa + featureContinuity + backgroundActivity + tnNullFeed + hubAssetMarket 7 passed 1.1m. featureContinuity hardened in the same pass: it compared TOTAL job counts, which the new auto-running transcript job would have made racy, so it now asserts exactly 1 "AAPL Company Brief" job. |
| 2026-07-23 | FI-3 | Devil's Advocate folded into companyBriefStore as devil* fields on the ticker entry (measured first: answer/running/error were component useState, no unmount abort, so the run continued but wrote to a dead component and the result was lost). Registers a bg job. tsc -b 0 errors; deployed prod (dpl_4kcxn9ax; `vercel --prod` died on ECONNRESET while polling — deployment itself was Ready and aliased, verified with `vercel inspect`). devilsAdvocateContinuity + qaContinuity + featureContinuity + backgroundActivity + tnNullFeed + hubAssetMarket 6 passed 38.9s in one parallel run. Spec fix during the run: asserting the TOTAL job count was racy (the page's own brief job registers asynchronously), so it now asserts exactly 1 Devil's Advocate job. |
| 2026-07-23 | FI-2 | Quick Answer lifted to qaStore (per conversation): WS + thread + persistence module-level; SearchPage QA is a pure view; useGravitySearch reduced to types/cleanAnswer; bg job kind 'qa'. tsc -b 0 errors; vite build 0 errors; deployed prod (market-ui-self.vercel.app). qaContinuity 1 passed 5.3s; featureContinuity + backgroundActivity + tnNullFeed + hubAssetMarket 4 passed 34.0s. Spec fix during the run: probe text matched 2 nodes in the indicator, so the job click is scoped to `li button`. |
