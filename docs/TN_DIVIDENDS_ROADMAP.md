# TN Dividends — restore divYield with a REAL source (post-AGO documents)

divYield was removed (TNC-3) at 3/75 because AGM-declared dividends aren't in
financial statements. A real source EXISTS — proven 2026-07-17:

- `raw_publications` (exchange Grafana DB) carries typed AGO notices per ISIN:
  118 `Ordinaire/Ordinary` rows, incl. "Informations Post Assemblée Générale
  Ordinaire" (post-AGM = APPROVED dividends), each with `linkPublication`.
- Node page → attached PDF (`/sites/default/files/...Post AGO....pdf`).
- PDF text contains the exact declaration — SOTUVER: "Les dividendes de
  l'exercice 2025 sont ainsi fixés à 250 millimes par action" = 0.250 TND.

Pipeline = same grounded pattern as T21 fundamentals (real PDF → extract →
sanity-guard → blob). NOT parametric LLM recall — every number traces to an
exchange document URL.

## Doctrine (hard rules)

- TRUTH: every dividend stores its source PDF URL + AGO date. Regex extraction
  first ("dividende(s) ... fixé(s) à X millimes/dinars par action" variants);
  DeepSeek (DEEPSEEK_API_KEY, known-alive) only for regex misses, prompt pinned
  to the PDF text, null on ambiguity. Sanity guard: 0 < yield = div/price ≤ 15%,
  else reject (extraction garbage, cf. STPIL precedent). No value → honest null.
- Extraction runs LOCALLY (one-shot build script, like fundamentals were built);
  serverless only READS. Blob write PATCHES the existing fundamentals blob's
  `dividend`/`yield` fields (schema already has them) → `/api/tn/fundamentals`
  serves them with ZERO serverless change. No new serverless files, no new deps
  (pdftotext exists on Git-Bash PATH; PowerShell can't see it).
- One hop only: structured feed link → node page → its PDF href → PDF. No
  crawling beyond the linked document.
- Crypto byte-identical. Verify per task: typecheck 0 + vercel --prod (repo
  root, only if UI changed) + audit_tn_columns.mjs REAL numbers + TN 200s +
  crypto audit spot 200/200 MISMATCH 0 + flip [x], Progress-log line, commit on
  roadmap/world-class.

## Ledger

- [x] TND-1 **Build `scripts/build_tn_dividends.mjs`**: query raw_publications
  for FY-window `Ordinaire` + "Post Assemblée" rows (latest per ISIN), resolve
  node → PDF href, pdftotext, regex-extract dividend/share (log every miss),
  DeepSeek fallback for misses, sanity-guard, then PATCH the fundamentals blob
  (`dividend`, `yield` = div ÷ current board price, plus `divSource`,
  `divAgoDate`). Print per-ticker table (real numbers) + coverage. Verify:
  ≥10 tickers with sourced dividends (feed has 118 AGO rows; not all are
  post-AGO with dividend — honest count wins), blob PATCH visible in prod
  `/api/tn/fundamentals` (yield non-null count grows from 3).
- [x] TND-2 **Restore divYield column**: revert the TNC-3 UI removal
  (ColKey/DEFAULT_ORDER/TN_ONLY_KEYS/COLMETA/cellFor/needFund + chooser
  Valuation 5→6 + audit script col). Cell shows yield% with title-attr source
  date if present; honest `—` otherwise. Verify: typecheck 0, deploy, chooser
  Valuation 6, BIAT-or-covered ticker shows real %, uncovered `—`.
- [ ] TND-3 **Sweep**: rerun audit_tn_columns.mjs — divYield coverage = real
  extracted count (paste table); spot-check 3 extracted values against their
  source PDFs BY HAND (open PDF text, confirm millimes match); TN 200s; crypto
  spot 200/200 MISMATCH 0; ledger + memory; commit.

## Progress log

(append one line per completed task, real numbers only)

- **TND-1 live** (2026-07-17): build_tn_dividends.mjs — 33 post-AGO pubs on
  board, **24 extracted** (2 regex, 22 DeepSeek-grounded on PDF text), yields
  0.87–5.98% all inside guard; honest misses: no-pdf 3 (TJARI/BIAT/CIL node
  pages carry no doc), no-mention 4, ambiguous 2. SOTUV 0.250 TND verified by
  hand against its PDF. Blob PATCH 200; prod /api/tn/fundamentals yield
  non-null 3 → **25**. Every value stores divSource PDF URL + divAgoDate.
- **TND-2 live** (2026-07-17): divYield restored (registry/chooser Valuation
  5→6/cellFor with AGO-date title attr/audit col). typecheck 0, deployed. Audit:
  divYield **25/77 (32%)** vs 3/75 pre-pipeline; TN board/intraday 200; crypto
  spot 200/200 MISMATCH 0.
