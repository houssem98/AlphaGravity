# Company Feature — Fix Roadmap

Branch: `feat/web-research-sec-integration` (the feature does not exist on `main`).
Surface: `apps/market-ui/src/pages/CompanyPage.tsx` (994 lines), `components/company/*`,
`services/gravity-api/app/api/routes/company.py`.

Ordering principle: **fix what makes the feature lie before what makes it slow.**
A blank answer rendered as an answer, and a truncated count labelled `total`, are
worse than a slow chart.

## Ledger

| # | Task | Gate (binary) | Status |
|---|------|---------------|--------|
| CF-1 | Brief + Devil's Advocate call a model that returns content | Live POST to `/api/llm/chat` with the brief's default config returns non-empty `text` for 6/6 seed prompts. Recorded with the response bodies. | **DONE** |
| CF-2 | No credential in the client bundle | `grep -r "deep-research-internal" apps/market-ui/src` → 0 hits, AND `npm -w market-ui run build` output greps clean for the literal. | **DONE** |
| CF-3 | One auth scheme on the company page | Every `fetch` in `CompanyPage.tsx` carries the same auth header construction; anonymous load renders a stated refusal, not a half page. | **DONE** |
| CF-4 | `total` is the real filing count, or is not called `total` | For a ticker with >4000 chunks, the response's count matches a direct `count(distinct)` against the table. If unfixable without an RPC, the field is renamed and the cap is stated in the payload. | **DONE** |
| CF-5 | Financials dedupe before truncation | For NVDA (402 XBRL rows), `limit=80` returns the 80 newest distinct metric+period pairs, verified against an unlimited query. | **DONE** |
| CF-6 | The model picker offers only models that work | Each option is probed at mount; a failing provider is disabled with the provider's own error as its tooltip. No option is offered that returned an error in the last probe. | **DONE** |
| CF-7 | The spinner cannot hang | An induced throw inside the settle handler still clears `loading`. Test asserts it. | **DONE** |
| CF-8 | Trend chart costs one round trip, not two | Longitudinal periods derived without waiting on the financials response, or the two are issued in one batch. Measured before/after. | **DONE** |
| CF-9 | `CompanyPage.tsx` under 400 lines | `wc -l` < 400; tabs extracted as components; no behaviour change (existing tests green). | **DONE** |
| CF-10 | One backend company service | Sentiment + longitudinal + filings + financials reachable under one router with one auth dependency. | **DONE** |
| CF-11 | An empty LLM completion is an error, not an answer | `llm.ts` returns `''` for a null completion today, with `ok: true` in the trace. Gate: a null/empty completion produces a non-2xx from `/api/llm/chat` and `ok: false` in the emitted trace, asserted by a test. | **DONE** |
| CF-12 | The internal key stops bypassing billing | `auth.py` routes API keys around `_apply_entitlement`, so `deep-research-internal` carries `tier: unlimited` with no rate limit. CF-2 moved that key server-side but did not change what it grants. Gate: a request authenticated with an internal service key is subject to a stated tier and rate limit, asserted by a test. **Owner chose per-viewer metering at the proxy, 2026-09-08.** | **DONE** |
| CF-13 | market-server's own gravity calls authenticate | `services/market-server/src/services/gravityClient.ts` sends no auth header on any gravity-api call. Gate: every `fetch` in that file carries the key; a 401 from upstream surfaces as a named error, not an empty result. | **DONE** |
| CF-14 | The company feature's existing tests actually run somewhere | **Corrected 2026-09-08** — the first wording of this row was wrong. `LatestQuarterCard.test.ts` and `TranscriptSummary.test.ts` are not silently collected as zero; they are named in `vitest.config.ts`'s `exclude` list with a documented rationale, and are meant to run under `npx tsx`. The real problem is that nothing invokes them: the only reference to their runner (`npm run phase2`) is in `.github/workflows/ci.yml.disabled`. Gate: a command that CI actually runs executes those assertions and fails when one fails. | **DONE** |
| CF-15 | The revenue trend has data, or the card says why it does not | **The chart has never rendered a point.** `/v1/analytics/longitudinal/{t}` answers 200 with `value: null` for every period, for every ticker probed. `longitudinal_tracker._fetch_metric` reads `SELECT value FROM financial_statements` over the asyncpg session — a table that does not exist in Supabase (only `chunks` and `financials` do) through a session `company.py`'s own docstring calls a dead stub. The exception is swallowed and each period returns null, so a missing data source is indistinguishable from a company with no revenue history. The facts it wants are in `financials` under names like `Revenue (Total Revenue, Net Sales)`, not `revenue`. Gate: for AAPL, NVDA and TSLA the endpoint returns a non-null revenue value for at least 3 periods, matching `financials` exactly; a metric it genuinely cannot source returns a stated reason rather than a null. | **DONE** |
| CF-16 | `tsc --noEmit -p tsconfig.json` stops reporting clean on broken code | `apps/market-ui/tsconfig.json` is a references-only root, so that command type-checks **nothing** and prints "No errors found" regardless. Found in CF-9: it passed while `CompanyPage.tsx` referenced three undefined names, which `tsc -b` caught immediately. Anyone verifying a change with the obvious command gets false assurance. Gate: introduce a deliberate type error and confirm the documented typecheck command fails. | **DONE** |

| CF-17 | AAPL has no revenue in the corpus from FY2019 onward | Found closing CF-15. `financials` holds `Revenue (Total Revenue, Net Sales)` for AAPL only at FY2017 and FY2018; from FY2019 it has COGS and no revenue row. NVDA, TSLA, CRM, DELL and 100+ others carry 6 periods. The endpoint reports the gap correctly, so this is an ingestion gap, not a code defect — but AAPL is the default demo ticker and its revenue trend will be empty. Gate: AAPL returns a non-null revenue for FY2023, FY2024 and FY2025, matching its 10-K. | **DONE** — closed by CF-19; AAPL FY2023 $383.29B / FY2024 $391.04B now come from live SEC. |

| CF-18 | Filings are listed for any registrant, not just the 39 ingested | The list is built from `chunks`, which covers 39 tickers; every other company got an empty list that reads as "this company has filed nothing", which is never true of a registrant. Gate: LULU, ANET, MS and DUK each return ≥5 filings with a form and a date, the payload names SEC as the source, unindexed filings say `not_indexed` rather than claiming a chunk count, and an ingested ticker still answers from the local index. | **DONE** |
| CF-19 | Financial facts come from SEC when the table has none | `financials` covers 501 tickers and has gaps inside them — AAPL holds no revenue row after FY2018, banks and utilities hold none at all. Gate: LULU (absent from the table) and AAPL (gap) return revenue matching their filings for FY2023/FY2024; every value the table DOES hold is served unchanged; a company that reports no revenue anywhere states that rather than substituting a metric; the storage cost is measured, not claimed. | **DONE** |
| CF-20 | `company_skill` stops reporting revenue as total debt | Measured 2026-09-08: LULU's profile returns `Total debt: $11.10B`, byte-identical to its revenue (`11102600000` for both). A wrong tag mapping, not a coincidence. Gate: for LULU, MS and DUK, total debt differs from revenue and matches the filed balance-sheet figure, or is reported absent. | **DONE** |
| CF-21 | The trend card handles filers that report no revenue line | Banks and utilities file no us-gaap Revenue tag: MS, TFC, DUK return nothing for `revenue` but do report `net_income` (MS $13.39B FY2024) and sometimes `operating_income` (DUK $7.93B). The stated reason is correct today and better than a fabricated substitution, but the card could offer the metric the filer actually reports, clearly labelled. Gate: for MS and DUK the card renders a labelled series from a metric those filers report, and never renders a substituted metric under a "Revenue" heading. | OPEN |

### Gate scripts

Gates that hit an API take `GRAVITY_BASE`. **Prod is frozen** (Fly deploys are
invoice-blocked), so it does not serve routes added after the freeze — point them at a
local API instead: from `services/gravity-api`,
`APP_ENV=development .venv/Scripts/python.exe -m uvicorn app.main:app --port 8010`, then
`GRAVITY_BASE=http://127.0.0.1:8010 node docs/company-feature/gates/cf8-gate.mjs`.

- CF-1 — `node docs/company-feature/gates/cf1-gate.mjs` (needs market-server up; set
  `PROXY=` if it is not on :3002). Reads the default model config out of the real
  source files rather than a transcription, so it keeps grading after edits.
- CF-3 — `npx vitest run src/pages/CompanyPage.surfaces.test.ts` from `apps/market-ui`.
  9 assertions over `surfaceFailure` / `surfaceData`, including the anonymous-load case.
- CF-5 — from `services/gravity-api`:
  `.venv/Scripts/python.exe ../../docs/company-feature/gates/cf5-gate.py`. Checks the
  returned pairs against an independent paged read, and checks two identical calls agree.
  Note the row count in the gate's wording ("402") was stale: NVDA holds 385.
- CF-20 — from `services/gravity-api`:
  `.venv/Scripts/python.exe ../../docs/company-feature/gates/cf20-gate.py`. Five assertions
  on the classifier itself (no network) plus three per ticker on the built profile.
- CF-18/19 — from `services/gravity-api`:
  `.venv/Scripts/python.exe ../../docs/company-feature/gates/cf18-19-gate.py`. Reads live
  SEC, and measures the storage delta with PostgREST's exact count rather than asserting it.
- CF-4 — from `services/gravity-api`:
  `.venv/Scripts/python.exe ../../docs/company-feature/gates/cf4-gate.py`. Calls the real
  handler against real Supabase for 10 tickers and checks `total` against a count walked
  by a separate code path, so a bug inside `sb_select_all` cannot hide from it.

## Stop conditions

- **Target** — all 10 gates green, each verified by its stated check actually run.
- **Budget** — 30 iterations.
- **Stall** — 3 consecutive iterations with no gate flipping and no new failure mode
  named. On stall: stop and report which gate is genuinely blocked and why.

## Escalation — halt and ask

- Any deploy, push to `main`, or Vercel prod publish.
- Rotating or revoking the leaked `deep-research-internal` key (breaks other callers —
  grep the repo for other consumers first and report them).
- Any provider key purchase or plan change (CF-6 may surface that all three are dead;
  that is a **finding to report**, not a spend decision to make).
- A gate that cannot be verified this iteration — say so, do not mark it green.

## Gate integrity

Gates may grow. A gate may never be weakened in the same change that claims it green.
Before any commit claiming a row green:

```bash
node ~/.claude/scripts/gate-guard.mjs
```

## Notes

- CF-1 is the unblocker: CF-6 cannot be assessed while the default model is wrong, and
  the whole AI surface (brief, Devil's Advocate) reads as "no data" until it lands.
- CF-2 and CF-3 are one commit's worth of work but land as separate rows because the
  second is a design decision and the first is a leak.
- Prod state as recorded: Fly deploys are blocked on an overdue invoice. This loop
  therefore works locally and **never deploys** — see escalation.
