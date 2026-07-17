# TN Columns Truth — every list/chooser column shows real data or dies

Audit 2026-07-16 (`apps/market-ui/scripts/audit_tn_columns.mjs`, prod, 75 board
rows) — REAL coverage per column:

| Column | Coverage | Verdict |
|---|---|---|
| spark (LAST 7 DAYS) | **0/75** | BROKEN — `closes` empty for all rows |
| 7d % | **0/75 real** (audit said 100% but counted fake zeros) | BROKEN — `change7d=0` fabricated when closes empty |
| divYield | **3/75 (4%)** | REMOVE — dividends declared at AGM, not in statements; no honest source |
| per / eps / pb / netIncome / equity | 42/75 (56%) | KEEP — honest `—` for uncovered (known fundamentals coverage) |
| volume / turnover / open / high / low | 65/75 (87%) | KEEP — missing = no trades that session (honest) |
| price / changePct / marketCap / sector / isin / shares | 75/75 | KEEP |
| engScore / engLabel / fMomentum / fVolume / fNews / fLiqTrend | 75/75 | KEEP |

Root cause of the two BROKEN rows: `fetchRecentCloses()` in
[api/tn/\[fn\].ts:703](../apps/market-ui/api/tn/%5Bfn%5D.ts#L703) (bulk Grafana
`raw_market` query) fails silently (`.catch(()=>({}))`) → every row gets
`closes: []` **and** `change7d: 0` — a fabricated zero the UI renders as
`+0.00%`. The board blob validator only checks `x.length>0`, so the broken
payload cached fine.

## Doctrine (hard rules)

- TRUTH: a column with no source shows `—`, never 0-as-data; a column with no
  possible source is REMOVED from the chooser. No scraping, no new serverless
  files (edit `/api/tn/[fn].ts` only), no new deps.
- Crypto path byte-identical (changes live in TN files / TN guards only).
- Verify per task: typecheck 0 + `vercel --prod` (repo root) + rerun
  `audit_tn_columns.mjs` with REAL numbers pasted + TN regression (board/
  intraday/news 200) + crypto audit spot 200/200 MISMATCH 0 + flip `[x]`,
  Progress-log line, commit on `roadmap/world-class`.

## Ledger

- [x] TNC-1 **Diagnose + fix `fetchRecentCloses`**: reproduce the Grafana
  `raw_market` failure (log/test the SQL via the same `gqueryTable` path — is
  the table rotated/empty, the query shape rejected, or the proxy down?). If
  recoverable, fix the query. If not, FALLBACK: build `closes` from the
  Supabase `tn_daily.json` blob (`/api/tn/history` source — accumulates one
  real bar per session; ~14 sessions exist since 2026-07-02 seed). Either way
  the board must return real `closes` again. Verify: prod board ≥60/75 rows
  with `closes.length>1`; spark renders in UI.
- [x] TNC-2 **Kill the fake-zero 7d%**: `change7d` = null (not 0) when
  `closes.length<2`; `marketsHub.fetchTunisia` maps null→undefined so the UI
  renders `—`; audit script's `sevenD` check tightened to `closes.length>1`
  (no more counting zeros as real). Verify: prod board rows without closes
  show `change7d: null`; UI 7d% cell `—` not `+0.00%`; audit sevenD == spark
  coverage.
- [x] TNC-3 **Remove divYield from the chooser** (3/75 = misleading column of
  dashes; AGM-declared dividends have no honest automated source — no
  scraping). Drop the col from `TN_COL_GROUPS` Valuation (6→5) + registry.
  Keep the 42/75 Valuation columns. Verify: chooser shows Valuation 0/5;
  typecheck 0.
- [x] TNC-4 **Re-audit sweep**: rerun `audit_tn_columns.mjs` post-fixes; every
  remaining column ≥ its honest floor (spark/7d ≥60, valuation 42, session
  cols 65, rest 75); paste the full table; TN + crypto regressions green;
  ledger + memory; final commit.

## Progress log

(append one line per completed task, real numbers only)

- **TNC-1 live** (2026-07-16): root cause = unbounded `raw_market` aggregation
  crossed the 8s fetch timeout (25.3s measured; 7,089 grouped rows since Feb) →
  silent `{}` → closes empty + change7d fake-0. Fix: date-bound scan
  (`dateSeance >= now()-21d` → 966 rows, 127 isins, 4.7s measured) + 15s timeout
  for this call. Prod after blob refresh: **69/75 rows with closes>1** (was
  0/75); BIAT closes [168.8→185], chg7d +9.6% real. Spark column renders again.
  typecheck 0; TN-only file, crypto untouched.
- **TNC-2 live** (2026-07-16): `change7d` now null (not 0) when closes<2; client
  `?? undefined` already maps null→`—` (no client change). Audit `sevenD` check
  tightened to closes-based. Prod: 6 closeless rows all `change7d: null`;
  audit sevenD == spark == **69/75 (92%)** (was fake-100%). TN board/intraday/
  news 200; crypto audit spot 200/200 MISMATCH 0.
- **TNC-3 live** (2026-07-16): divYield stripped from ColKey/DEFAULT_ORDER/
  TN_ONLY_KEYS/COLMETA/cellFor/needFund + chooser Valuation (6→5) + audit
  script. Post-removal audit: valuation 5 cols 42/75, session cols 65/75,
  spark/7d 69/75, rest 75/75 — every remaining column ≥ honest floor. TN
  board/intraday 200; crypto audit spot 200/200 MISMATCH 0.
- **TNC-4 sweep PASS** (2026-07-16): final audit, 75 board rows — spark/7d
  69/75 (92%); volume/turnover/open/high/low 65/75 (87%, untraded session =
  honest); per/eps/pb/netIncome/equity 42/75 (56%, fundamentals coverage);
  price/changePct/marketCap/sector/isin/shares + all 6 Signal cols 75/75.
  divYield removed. Zero fabricated values remain (fake-zero 7d% dead, closeless
  rows null). TN board/intraday/news 200; crypto audit spot 200/200 MISMATCH 0.

## ✅ ROADMAP COMPLETE — 4/4 (2026-07-16)
