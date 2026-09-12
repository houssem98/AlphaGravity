# Company Intelligence V3 — Execution Report

Branch: `feat/web-research-sec-integration`. Date: 2026-09-12.
Ledger: `COMPANY_V3_ROADMAP.md`. Control graph: `COMPANY_V3_LOOP.md`.

Nothing in this work was deployed. The changes are on the branch and uncommitted;
no `git push`, no `vercel --prod`, no `fly deploy`.

## Result

**10 of 10 rows closed, each behind an executable gate that exits 0.**
Four P0 correctness/provenance rows, six P1 rows.

One row was **promoted during the audit** — V3-10 — out of the source audit's
"Unverified" list, after gathering the evidence it was missing.

One **regression was caused and then fixed inside this session**: the V3-2 client
change broke `v2-1-gate.mjs`. It is green again. Details under *Regressions*.

## The ten rows

| # | Row | Gate | Result |
|---|-----|------|--------|
| V3-1 | A margin is never labelled as a profit, nor drawn in dollars | `gates/v3-1-gate.mjs` | **PASS** (15 assertions) |
| V3-2 | A fact with no unit stays unit-unknown | `gates/v3-2-gate.py` | **PASS** (10 assertions) |
| V3-3 | Two disagreeing values for one (metric, period) are never silently reduced to one | `gates/v3-3-gate.py` | **PASS** (12 assertions) |
| V3-4 | SEC fallback matches a period, not a substring of one | `gates/v3-4-gate.py` | **PASS** (15 assertions) |
| V3-5 | A failed trend is a failure, not an empty chart | `gates/v3-5-gate.mjs` | **PASS** (8 assertions) |
| V3-6 | A resolver that cannot run does not become permission to navigate | `gates/v3-6-gate.mjs` | **PASS** (11 assertions) |
| V3-7 | Devil's Advocate cites evidence it was actually given | `gates/v3-7-gate.mjs` | **PASS** (17 assertions) |
| V3-8 | An unauthenticated caller cannot make this server spend provider credits | `gates/v3-8-gate.mjs` | **PASS** (15 assertions) |
| V3-9 | One axis carries one unit | `gates/v3-9-gate.mjs` | **PASS** (25 assertions) |
| V3-10 | The anonymous meter keys on something the caller cannot choose | `gates/v3-10-gate.mjs` | **PASS** (12 assertions) |

Seven of the ten gates are **behavioural** — they compile the shipped module and
call the real function against a fixture (V3-1, V3-2, V3-3, V3-4, V3-5, V3-9,
V3-10). V3-6, V3-7 and V3-8 are structural: they read the code with comments
stripped first, because this ledger's comments quote the code they replaced and a
check that reads them grades the prose instead of the program.

## Files changed

### Backend — gravity-api (Python)

| File | Rows | What changed |
|------|------|--------------|
| `services/gravity-api/app/api/routes/company.py` | V3-2, V3-3 | `"unit": r.get("unit") or "USD"` became a real null with a stated `unit_reason`; the `(metric, period)` dedupe now detects disagreeing values, marks the fact `ambiguous`, names both values, and attaches **no** filing to it |
| `services/gravity-api/app/core/analytics/longitudinal_tracker.py` | V3-4 | added `_period_key` / `_same_period`; `period in got or got in period` replaced by period equality on (year, quarter), and a result carrying no period is now rejected instead of silently accepted |

### Backend — market-server (TypeScript)

| File | Rows | What changed |
|------|------|--------------|
| `services/market-server/src/routes/llm.ts` | V3-8 | `?refresh=1` removed; cold-cache probes coalesced behind one in-flight promise; `_resetHealth` test seam added |
| `services/market-server/src/routes/gravity.ts` | V3-10 | `clientKey` reads `req.ip` instead of the raw `x-forwarded-for`; exported so a gate can call it |
| `services/market-server/src/index.ts` | V3-10 | `app.set('trust proxy', TRUST_PROXY_HOPS ?? 1)`, set before any router is mounted |

### Frontend — market-ui

| File | Rows | What changed |
|------|------|--------------|
| `apps/market-ui/src/lib/figures.ts` | V3-1, V3-2 | `formatFinancialValue` no longer prefixes `$` onto every unit it does not recognise; money is the units that are money, a known non-currency unit is named beside the number, an unknown one adds nothing |
| `apps/market-ui/src/components/company/LatestQuarterCard.tsx` | V3-1 | `Gross Profit` and `Gross Margin` are separate rows; each row's unit comes from the fact; a percentage's change is reported in points (`deltaUnit`); no delta is drawn across two different units |
| `apps/market-ui/src/components/company/LatestQuarterCard.test.ts` | V3-1 | fixtures now carry `unit` (which the API has always sent); five new assertions |
| `apps/market-ui/src/components/company/chartGroup.ts` | V3-9 | **new** — `chartGroupFor`, the pure grouping the page used to do inline |
| `apps/market-ui/src/pages/CompanyPage.tsx` | V3-9 | the inline unit-blind `chartData` slice replaced by `chartGroupFor(metrics)` |
| `apps/market-ui/src/components/company/OverviewTab.tsx` | V3-9 | takes a `ChartGroup`; header states unit and period; axis and tooltip format through one unit-aware formatter; omitted facts disclosed |
| `apps/market-ui/src/components/company/useCompanyData.ts` | V3-5 | the trend surface is named in the `failures` list — five surfaces checked, not four |
| `apps/market-ui/src/components/company/TickerEntry.tsx` | V3-6 | the catch branch sets an error resolution instead of navigating; the existing "Open X anyway" escape covers it |
| `apps/market-ui/src/components/company/DevilsAdvocate.tsx` | V3-7 | the model is given numbered `citations[]` passages, not `rag.answer`; zero citations refuses **before** the billable call; the `[N]` markers now resolve to a rendered source list |
| `apps/market-ui/src/stores/companyBriefStore.ts` | V3-7 | `DevilSource` type and `devilSources` on `BriefEntry` |

### Documents and gates added

`COMPANY_V3_ROADMAP.md` (rewritten as a ledger), `COMPANY_V3_LOOP.md`,
`COMPANY_V3_SOURCE_AUDIT.md` (the original audit, preserved verbatim before the
roadmap was rewritten over it), this report, and ten gate files under
`docs/company-feature/gates/`.

`SEC_FIX_RECON.md` shows as modified in `git status`. It was already modified
before this work began and was not touched by it.

## Commands run, and what they actually returned

```
node docs/company-feature/gates/v3-1-gate.mjs      → RESULT PASS
node docs/company-feature/gates/v3-5-gate.mjs      → RESULT PASS
node docs/company-feature/gates/v3-6-gate.mjs      → RESULT PASS
node docs/company-feature/gates/v3-7-gate.mjs      → RESULT PASS
node docs/company-feature/gates/v3-8-gate.mjs      → RESULT PASS
node docs/company-feature/gates/v3-9-gate.mjs      → RESULT PASS
node docs/company-feature/gates/v3-10-gate.mjs     → RESULT PASS
python docs/company-feature/gates/v3-2-gate.py     → RESULT PASS
python docs/company-feature/gates/v3-3-gate.py     → RESULT PASS
python docs/company-feature/gates/v3-4-gate.py     → RESULT PASS

node ~/.claude/scripts/gate-guard.mjs              → gate-guard: clean · HEAD..working tree

npx vitest run            (apps/market-ui)         → PASS (1567) FAIL (0) skipped (7)
npx vitest run            (services/market-server) → PASS (76)   FAIL (0)
npx tsc --noEmit -p tsconfig.app.json (market-ui)  → TypeScript: No errors found
npm run build             (apps/market-ui)         → built; dist/index.html written
python -m compileall company.py longitudinal_tracker.py → OK

pytest, 13 offline files over the affected areas (gravity-api)
                                                   → 2 failed, 247 passed in 4.45s
                                                     both failures pre-existing at HEAD
```

### Full prior-gate regression

All 17 Python gates green, including the live-SEC ones:

```
cf10 cf15 cf18-19 cf20 cf21 cf24 cf28 → RESULT PASS
cf4  → 10/10 tickers report the true filing count
cf5  → 10/10 tickers correct and stable
v2-2 v2-3 v2-4 v2-7 v2-8              → RESULT PASS
v3-2 v3-3 v3-4                        → RESULT PASS
```

JS gates:

```
v2-1 → PASS   (see Regressions — this was red mid-session and was fixed)
v2-5 → PASS
v2-6 → PASS
v3-* → PASS (all seven)
cf1  → crashes, PRE-EXISTING
cf16 → crashes, PRE-EXISTING
cf6  → FAIL (1), PRE-EXISTING cause, see escalation E-4
cf8  → FAIL (2), PRE-EXISTING, externally blocked
cf25 → non-deterministic (live network), PASS and FAIL(3) on consecutive runs
```

Each of those five was measured at HEAD with the working tree stashed, so the
"pre-existing" labels are a measurement and not an assumption.

## Regressions

**One, caused and fixed in this session.**

`v2-1-gate.mjs` was PASS at HEAD and went FAIL (2) after the V3-2 client change.
Cause: V3-2 stopped `formatFinancialValue` from prefixing `$` onto unrecognised
units, and the currency unit this server actually emits is the literal `"USD M"`
(`longitudinal_tracker.py:693`, `_get_metric_unit`), which the first version of
the money pattern did not match. An EPS series rendered `7.46 USD M` instead of
`$7.46`. The pattern now admits a currency with a scale word, the scale word is
matched and ignored (the value is already absolute), and `v2-1-gate.mjs` is PASS.

The regression was found by running the prior gates rather than only the new ones,
which is the reason the control graph puts full regression before typecheck.

**Not a regression, found by a gate:** `v3-9-gate.mjs` caught a bug in the V3-9 fix
itself — `omitted` counted only facts on other units and periods, so twenty
same-unit facts capped at eight bars reported "0 omitted". It now counts against
what is drawn.

## Pre-existing failures — not caused by this work, not fixed by it

| Gate | Status | Cause |
|------|--------|-------|
| `cf1-gate.mjs` | crashes | hardcoded `ROOT` path is stale: it reads `<repo>/components/company/…` where the file lives under `apps/market-ui/src/`. Same crash at HEAD. |
| `cf16-gate.mjs` | crashes | same stale-root problem: `ENOENT … antigravity\src\components\company\FilingsTab.tsx`. Same crash at HEAD. |
| `cf8-gate.mjs` | FAIL (2) | live against `https://gravity-api-prod.fly.dev`, where `/v1/company/{t}/trend` answers **404** for AAPL, NVDA and TSLA — the route is not deployed there. Fly deploys are blocked by an overdue invoice, so prod is frozen well behind this branch. Same failure at HEAD. |
| `cf25-gate.mjs` | flaky | live search gate; returned `RESULT PASS` and `RESULT FAIL (3)` on two runs minutes apart, and `FAIL (2)` at HEAD. Not a usable regression signal in its current form. |
| `test_auth_entitlement.py::TestTierReachesTheLimiter` | 2 failed | `rate_limit_redis_error error='Event loop is closed'`. Measured at HEAD: same 2 fail, 5 pass. |
| market-server `tsc` | 24 errors | all in `rbac.ts`, `orgs.ts`, `predictions.ts`, `trading.ts` — `string \| string[]` header/param narrowing. Measured **24 at HEAD and 24 now**, and **zero** in the three files this work touched. `npm run build` for market-server was already failing before this work and still is. |

## Escalations

**E-1 · restatement policy (V3-3) — resolved by data constraint, owner may override.**
Keeping the original observation or the latest authoritative one both require
companyfacts' per-observation `accn`, which `sec_xbrl.py` discards at ingest.
Neither is implementable without an ingest change and a backfill of ~150,596 rows.
What shipped is the third option: refuse to attribute, and say both values. If the
owner wants original-or-latest instead, that is an ingest ticket.

**E-2 · Devil's Advocate scope (V3-7) — narrowed, not removed. Still open.**
The component now refuses only when there is no citable evidence at all, so no
capability was removed. Whether the **PM Verdict** section — a Buy/Hold/Avoid call,
which is not a filing-derived claim — should exist is still the owner's decision.
It is left in place.

**E-3 · `/api/llm/health` access policy (V3-8) — spend fixed, access unchanged.**
Who may read provider availability was deliberately not changed. If the owner wants
the route authenticated, that is one line on top of what shipped.

**E-4 · CF-6's gate no longer grades what it claims. NEW — needs a decision.**
Two independent findings, both measured:

1. `cf6-gate.mjs:44` posts to `/api/llm/chat` with **no Authorization header** to
   get its independent verdict. V2-6 put `authMiddleware` on that route, so the
   direct call now 401s for every provider and `directOk` is always false. The gate
   therefore passes only when a provider is genuinely **down**, and must fail for
   any healthy one. This has been true since V2-6 closed, independent of V3.
   Observed: `anthropic` and `gemini` PASS (both really down), `deepseek` FAILs
   with `health said ok=true, direct call said ok=false`.
2. `cf6-gate.mjs:25` requests `/api/llm/health?refresh=1`, which **V3-8 removed**.
   It now receives a cached verdict up to five minutes old.

Both need fixing for CF-6 to grade anything again, and the fix requires a decision
this work will not make alone: giving the gate a credential, or authenticating a
refresh capability and issuing the gate a token, or scoping a non-billable
server-side reset. **I did not edit `cf6-gate.mjs`** — loosening a gate to make a
diff look green is the failure mode the gate-integrity rule exists to prevent.

## What is NOT proven

- **Nothing was verified against live production.** Fly prod is frozen behind an
  overdue invoice and `/v1/company/{t}/trend` 404s there, so the V3 changes cannot
  be exercised end-to-end against the deployed API. Every claim here is from local
  gates, local suites, and the two live-SEC gates that do pass (`cf4`, `cf5`,
  `v2-8`).
- **No browser was driven.** The three structural gates (V3-6, V3-7, V3-8) assert
  the source, not rendered output. No Playwright run was made for these rows.
- **V3-8's gate is structural.** It proves no caller-controlled refresh parameter
  exists and that the cold path is coalesced; it does not observe provider billing.
- **V3-3's ambiguity path was not observed on live data.** The gate proves the route
  behaves correctly on a fixture built from the MMM duplicate shape. Which real
  `(metric, period)` pairs actually disagree in the `financials` table was not
  queried in this pass.
- **gravity-api's full pytest suite did not complete — a bounded subset did.**
  The whole suite (127 files) could not be run to a summary here: a first attempt
  with `-x --timeout=120` was killed during *collection* (a `pathlib.walk` in the
  rootdir scan), and a second, longer attempt ran ~20 tests before hitting the
  9-minute command cap. A third attempt over the affected areas hung on a live
  network call inside the EDGAR/filing-resolver tests.

  What did run to completion is the offline subset of the areas this work could
  plausibly touch — auth, entitlements, enforcement, capabilities, period maths,
  quarterly filtering, ratio-engine period typing, structured-fact ordering and
  round-trip, declared table scale:

  ```
  13 files → 2 failed, 247 passed in 4.45s
  ```

  Both failures are `tests/test_auth_entitlement.py::TestTierReachesTheLimiter`
  (`test_no_subscription_stays_on_the_free_limits`,
  `test_a_cancelled_subscription_does_not_keep_its_limits`), accompanied by
  `rate_limit_redis_error error='Event loop is closed'`. **Measured at HEAD with the
  working tree stashed: the same 2 fail, 5 pass.** Pre-existing, not caused here.

  **No pytest file in the suite references `company_financials`, `_fetch_from_edgar`,
  `longitudinal` or the company routes at all** — so the Python changes have no
  pre-existing unit coverage, and the three V3 Python gates (which import and call
  the real route and the real fetch function) are that coverage. The remaining
  ~114 test files were not exercised in this pass.

## Score

The audit scored Company Intelligence **6.5/10** and said the path to 8–9 ran
through the remaining P0 correctness and provenance defects. Those four are now
closed behind gates that execute.

What the executed evidence supports, and no more:

| Category | Was | Now | What actually changed |
|----------|-----|-----|----------------------|
| Financial data correctness | 6 | **8** | unit defaulting gone at both ends; margins no longer rendered as profits or as dollars; percentage deltas in points |
| SEC provenance | 7 | **8** | a disputed figure names no filing rather than the wrong one |
| Period correctness | — | **8** | SEC fallback requires period equality; a period-less result is refused |
| Error / failure handling | 6 | **8** | the trend surface is named on failure; a resolver fault no longer opens an unverified page |
| AI evidence binding | 6 | **7** | the challenge is prompted with numbered filing passages and refuses without them; the PM Verdict is still not a filing-derived claim (E-2) |
| Security / billing | — | **8** | the health probe is no longer an anonymous billable path; the anonymous meter keys on an address the caller cannot forge |
| UX / analyst workflow | 6 | **6** | unchanged — no P1/P2 product work was in scope |
| Company overview | 6 | **6** | unchanged |

**Overall: 7.5 / 10**, up from 6.5.

It is not 10/10 and it is not world-class. The correctness and provenance floor is
now mechanically defended, which is what this ledger set out to do. What remains
between here and the audit's target is the entire P1/P2 product layer — What
Changed, guidance vs actual, estimate revisions, segments, catalysts, valuation
against history and peers, the research agent — none of which was in V3's scope and
none of which is claimed.

Two things keep the score off 8: the AI evidence path is bound but the PM Verdict
still makes a call filings do not support (E-2), and **nothing here has been
observed running in production**, because production cannot currently be deployed to.
