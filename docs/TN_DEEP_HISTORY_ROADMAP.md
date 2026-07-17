# TN Deep History — multi-year charts for TUNINDEX + every company page

Goal: the TN market overview gets a TUNINDEX macro chart (inception 1997 →
today if the data truly exists) and every company page's TnChart gets deep
daily history (years, not the 2-week accumulator) — **REAL sourced values
only**. A Gemini mock with ~22 hand-typed TUNINDEX points exists
(gemini-code-1784310856136.md) — its NUMBERS ARE BANNED (invented/approximate
= fake data); at most its layout inspires the macro-chart UI, rebuilt with our
design tokens.

## Known state (do not re-derive)

- Our history today = `tn_daily.json` Supabase blob, one real bar per session
  since 2026-07-02 (~2 weeks) + Grafana `raw_market` ticks since ~2026-02-27
  (~5 months). Nothing deeper is ingested yet.
- Exchange Grafana DB (`tunis-stockexchange.com/grafana`, uid ef4kunff033eoe)
  tables: raw_market, raw_indices, indice_live, raw_trades, market_latest,
  raw_referentiels, raw_publications, … — date FLOORS UNKNOWN, probe first.
- BVMT itself (`bvmt.com.tn`) has a public REST API (our /trading intraday
  uses it) and an official download section (daily official list / bulletins,
  possibly CSV/XLS going back years). History endpoints UNPROBED.
- `/api/tn/history?symbol=` serves the 2-week blob; TnChart D/W/M reads it.

## Doctrine (hard rules)

- TRUTH: every candle/level traces to an exchange source (BVMT REST/official
  downloads, exchange Grafana DB). NO invented points, NO interpolation
  presented as data, NO third-party chart scraping (ilboursa/investing.com
  BANNED). If deep data only exists from year X, the chart honestly starts at
  X and the UI says so — a shorter true chart beats a longer fake one.
- Sources: official/public REST + file downloads + the exchange Grafana DB
  only. One-hop rule (feed link → its document). Grafana full-scans MUST be
  date-bounded (raw_market grows — 25s timeout precedent).
- Ingestion runs LOCALLY (one-shot backfill scripts → Supabase Storage blobs,
  service-role key from repo .env); serverless only READS blobs. NO new
  serverless files — new `fn` branches inside `/api/tn/[fn].ts` only. No new
  npm deps. Heavy backfills: log partial progress to the ledger BEFORE long
  operations, write blobs incrementally so an interrupted run resumes.
- Crypto path byte-identical. TN regressions (board/intraday/news/history
  200s) + crypto audit spot MISMATCH 0 after every task.
- Verify per task: real numbers pasted (row counts, date floors, spot-checked
  values vs source), typecheck 0 + vercel --prod (repo root) when UI/api
  changed, flip [x], one Progress-log line, commit on roadmap/world-class
  (git commit -F file if the message has quotes — rtk mangles them).

## Ledger

- [ ] TNH-1 **Source probe (no product code)**: measure real floors —
  (a) Grafana: `min(dateSeance)` / row counts for raw_market, raw_indices,
  raw_trades, market_latest (date-bounded probes, information_schema first);
  (b) BVMT REST: enumerate known api paths from our own market-server/tn code,
  curl for history-shaped endpoints (per-ISIN daily, index history);
  (c) bvmt.com.tn official downloads: locate daily-official-list/bulletin file
  URLs and their year range (HEAD/GET a few, confirm parseable CSV/XLS/PDF).
  Output: a SOURCES verdict table in this doc (source × coverage window ×
  granularity × format), each row backed by a real probe response. Pick the
  ingestion plan for TNH-2/TNH-3 from evidence.
- [ ] TNH-2 **TUNINDEX (+ sub-indices) deep history**: backfill script →
  `tn_index_history.json` blob (`{index: {"YYYY-MM-DD": level}}`) from the
  best TNH-1 source; serve via new `fn=indexhistory` branch; spot-check ≥3
  historical levels against the official source document by hand. Floor +
  point count pasted.
- [ ] TNH-3 **Per-company deep daily closes**: backfill script → deep blob(s)
  keyed by ISIN (`{"YYYY-MM-DD":[o,h,l,c,v]}` or close-only if that's what the
  source truly provides — do NOT fabricate OHLC from closes; a close-only line
  is honest). Merge read path in `fn=history`: deep blob ∪ existing
  tn_daily accumulator (accumulator keeps winning for recent sessions).
  Coverage histogram pasted (symbols × years). Spot-check 3 symbols × 2 dates
  vs source.
- [ ] TNH-4 **UI — macro index chart + deep company ranges**: TN market
  overview gains a TUNINDEX macro line chart (lightweight-charts or the
  existing sparkline pattern — NO new deps, our tokens, honest floor label
  e.g. "since 2010 — official data floor"); TnChart daily mode gains range
  buttons (1Y / 5Y / MAX) that read the merged history; W/M aggregation reuses
  aggDaily. key={asset} remount + one-source rules hold. typecheck 0, deploy,
  BIAT + TUNINDEX verified in prod with real numbers.
- [ ] TNH-5 **Sweep**: coverage audit (per-symbol year-span histogram + index
  floor), 3 hand spot-checks vs official documents pasted, TN regressions
  200s, crypto audit spot MISMATCH 0, ledger + memory
  (project_tn_deep_history), final commit.

## Progress log

(append one line per completed task, real numbers only)
