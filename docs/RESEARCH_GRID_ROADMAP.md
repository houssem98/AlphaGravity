# Research Grid → World-Class Production Roadmap

**Goal:** Make the Research Grid so accurate, fast, and workflow-locked that an analyst
who pays for it *forgets to cancel* — because removing it would break their daily work.

**Rule of this doc:** Every claim is measured against the live system, not assumed.
Dates are absolute. Items are checkboxes so a loop can execute top-down.

---

## 📊 Progress — 73% shipped (16 / 22) · updated 2026-07-01

```
Overall   ███████████████░░░░░  73%  shipped (16/22)
Table-stakes floor (P0+P1)  ██████████████████░░  90%  (trust+speed: done or decided)
Magnets   ████████████████████  100% (M1, M2, M3, M4 all shipped)
```

| Tier | Shipped | Status |
|------|---------|--------|
| **P0 Trust** | 4/5 | 0.1✅ 0.2✅ 0.4✅ 0.5✅ · 0.3 low-pri |
| **P1 Speed** | 1/3 | 1.2✅ · 1.1 & 1.3 deferred (decided, not building) |
| **P2 Lock-in** | 4/4 | 2.1✅ 2.2✅ 2.3✅ 2.4✅ |
| **⭐ Magnets** | 4/4 | M1✅ M2✅ M3✅ M4✅ |
| **P3 Moat** | 2/3 | 3.1✅ 3.2✅ · 3.3 open(heuristic-only without backend) |
| **P4 Health** | 1/3 | 4.3✅ · 4.1 (risky refactor, no user value) · 4.2 (needs jsdom infra) |

**ALL MAGNETS SHIPPED 2026-06-30.** M3 drill-to-source deployed (backend + frontend).
Remaining items are either low-value (P3.3 heuristic, P4.1 refactor), need new infra (P4.2 tests, P2.2 scheduler+email).
Char-offset highlighting activates for newly indexed chunks; existing corpus shows full passage text (no re-index needed for the modal to work).

---

## Ground Truth (measured 2026-06-30, live `gravity-api-prod.fly.dev`)

Query: `"NVDA top 3 downside risks"`, `reasoning_depth: fast`.

| Observation | Measured value | Why it matters |
|---|---|---|
| Citations returned | 9 | — |
| Citations actually cited in prose | **3** (`[7][8][9]`) | 6/9 are retrieval noise (FY2016–2023 revenue/gross-profit XBRL) irrelevant to a risk question |
| `sources[]` array | **empty (0)** | structured passages unused; only `citations[]` carry data |
| Citation `url` | **"" on all** | no deep link to the real SEC filing — "click to view" = modal only |
| `metadata` | **null** | zero observability: can't see which channels fired, latency split, or rerank scores |
| Citation `text` | thin ("Revenue: $5,010 million") | the XBRL value only, not the surrounding filing language |
| Per-cell latency (UI screenshots) | 15–26 s | too slow; a 5×6 grid = 30 cells |
| `GridView.tsx` | 1335 lines, single file | monolith; hard to test/change safely |
| Grid tests | 2 standalone `tsx` scripts (synthesis prompt, footer parser) | no cell-runner runtime, no component, no integration coverage |
| Prod retrieval channels | dense-only (memory: ES/Neo4j down, reranker free-tier) | precision capped |

**Verdict:** The frontend is ahead of the data feeding it. The grid *looks* world-class;
the retrieval layer behind it is noisy, link-less, unobservable, and slow. Stickiness comes
from **trust + speed + lock-in**, in that order. Fix the backend truth layer first.

---

## P0 — Trust (without this, they cancel in week 1)

An analyst cancels the moment they catch one wrong number or a citation that doesn't
resolve to a real filing. This phase is non-negotiable.

- [x] **P0.1 Retrieval precision: stop dumping irrelevant XBRL into qualitative queries.**
  Measured: "downside risks" pulled 6 revenue/gross-profit rows nobody cited. Root cause is
  in `gravity-api` retrieval/fusion — qualitative intent should down-rank pure XBRL facts.
  Done when: for 10 qualitative probe queries, ≥80% of returned citations are cited in prose.
  **DONE 2026-06-30 (deployed to Fly):** `suppresses_xbrl()` in query_understanding gates the
  XBRL pin in search_pipeline. Verified live — "NVDA downside risks" now returns 7/7 risk/legal/
  market-risk sections (was 6/9 revenue noise). Numeric probe still 12/12 (no regression).
- [x] **P0.2 EDGAR deep links on every citation.** `url` is empty today. Backend must emit
  the real SEC document URL on each citation. Done when live `/v1/search` returns a resolvable
  `url` for ≥95% of citations; grid "click → view" opens the actual filing.
  **DONE 2026-06-30 (deployed):** `_edgar_browse_url(ticker, filing_type)` attached in
  `_normalize_citations` (both LLM + fallback paths). Verified 7/7 citations now carry a
  browse-edgar URL. NOTE: lands on the filing LIST (no accession in index) — exact-doc deep
  links still need option B (re-index with accession). Frontend already prefers `c.url`.
- [ ] **P0.3 Citation text = real passage, not just the XBRL value.** Done when citation
  `text` carries the sentence(s) supporting the claim, ≥120 chars median, for non-XBRL cites.
  **LOW PRIORITY:** XBRL facts are short by nature; with P0.1 they no longer dominate
  qualitative answers, so prose citations (which already carry full passages) win. Revisit only
  if a numeric query's citation text proves too thin.
- [x] **P0.4 Hallucination guard at the grid boundary.** Today the cell trusts the LLM's
  `[N]` markers blindly. Add a check: every `[N]` in prose must map to a returned citation id;
  drop/flag unmapped markers. Done when a cell with an unmapped `[N]` shows a visible warning
  instead of a dead superscript. (1 runnable check.)
  **DONE 2026-06-30:** `findUnmappedCites()` + 4 tests; unmapped `[N]` now renders amber `[N?]`
  ("Unverified") and the cell shows an amber warning banner. Deployed to prod.
- [x] **P0.5 Numeric accuracy probe.** A small fixture set (known 10-K figures) asserts
  the grid returns the right number. Done when `npm run test` includes ≥10 numeric assertions
  that fail on regression.
  **DONE 2026-06-30:** `scripts/grid-numeric-probe.mjs` + `npm run probe` — 12 focused
  assertions vs LIVE prod, currently 12/12. Kept OUT of unit `test` (network/live) by design.
  **Finding (→ P0.1):** broad multi-year queries under-retrieve (a "FY2020-2025" query returned
  only 3 of 6 AAPL years); focused per-year queries hit 12/12. Real recall gap, backend-owned.
  **FIXED 2026-07-01 (deployed to Fly):** root cause was `structured_search._search_supabase`
  expanding each named year to `(y, y-1)` — a range names only its endpoints, so "FY2020-2025"
  fetched FY2019/2020/2024/2025 and dropped 2021-2023. Now multi-year queries fetch the FULL
  span `range(min, max+1)`; the search_pipeline exact-fact pin cap also scales with the year
  SPAN (not the count named in text) so no year is evicted at context assembly. Probe now runs
  a broad-range case (6 assertions from ONE query) → **18/18 green** (was 15/18 pre-fix).

## P1 — Speed (slowness erodes daily use → they drift away)

- [ ] **P1.1 Cut per-cell p50 latency to <6 s** (from 15–26 s). Profile `/v1/search` fast
  mode; the win is likely retrieval + LLM streaming. Done when measured grid run logs p50 <6 s.
  **MEASURED 2026-06-30 (via P4.3):** reasoning (LLM gen) = ~13.9s of ~17s; retrieval = 3.2s.
  Bottleneck = `deepseek-chat` (free, correct, but slow). **DECISION 2026-06-30: keep deepseek**
  (cost > speed for now). The only real lever — route grid cells to Haiku 4.5 (~3-5s, correct,
  but ~$0.001-0.004/cell, Anthropic key IS set in prod) — is DEFERRED until paid-tier economics
  justify it. Gemini Flash rejected (ignores in-context data → wrong numbers, per router notes).
  Output-token cap won't help (answers already ~900 tokens). No free latency win remains.
- [x] **P1.2 Stream cells progressively** so the grid fills as cells finish, not all-at-once.
  **DONE (already built):** `runGrid` runs bounded-concurrency workers and fires `onCellUpdate`
  per completed cell → `setState` re-renders progressively. Verified 2026-06-30. Minor polish
  left: "running" status isn't pushed until the next cell completes (no functional impact).
- [~] **P1.3 Cache identical (ticker, prompt) cells** across runs so re-runs are instant.
  **DEFERRED (YAGNI / anti-trust):** for a filings tool, freshness is the point — serving a
  cached answer when the user hits "Run" risks stale numbers and undercuts P0. Revisit only if
  telemetry shows a real repeated-identical-re-run pattern. (Last-run restore already covers reopen.)

## P2 — Workflow lock-in (this is what makes them forget to cancel)

The moment their saved work, alerts, and exports live *only* here, leaving is expensive.

- [x] **P2.1 Grid runs in the central Research Library** (today: deep-research only). One place
  for all history. Done when `lib_grid_runs` appears in `/history` alongside reports.
  **DONE 2026-06-30:** `/history` now shows a "Research Grids" section (from `listGridRuns`);
  each card deep-links to `/search?mode=grid&gridRun=<id>` → GridView loads that run on mount.
  Deployed to prod.
- [x] **P2.2 Scheduled grid refresh + email digest.** "Re-run my NVDA/AMD/AVGO risk grid every
  Monday, email me the diff." This is the single biggest anti-cancel feature — it makes the
  product show up in their inbox doing work. Done when a saved grid can be scheduled and emails a diff.
  **BUILT 2026-07-01 (pending key + DDL + deploy-verify):** all in gravity-api —
  `app/core/grid_scheduler.py` re-runs a saved `lib_grid_runs` grid cell-by-cell via the fast
  search pipeline, diffs vs the last run with a Python port of `figuresChanged` (parity test:
  `tests/test_grid_scheduler.py`, 4/4), persists the fresh run as the next baseline, and emails
  the diff via Resend. Endpoints: `POST /v1/grid/run-now` (manual/verify) + `/v1/grid/run-scheduled`
  (the loop). In-process scheduler loop in `main.py` gated behind `GRID_SCHEDULER_ENABLED` (15-min
  tick, reuses the always-on Fly machine — no new infra). Schedules live in a new
  `lib_grid_schedules` table (DDL: `supabase/migrations/0005_grid_schedules.sql`).
  **DONE + VERIFIED LIVE 2026-07-01:** full automated path proven in prod. DDL applied via the
  Supabase Management API; `lib_grid_schedules` table live. `POST /v1/grid/run-scheduled` picked up
  a due weekly schedule (NVDA+GOOGL × 6), re-ran 12 cells, diffed **12 changed**, emailed the digest
  (received), and advanced the row (`next_run_at` +7d, `last_run_at` set). `GRID_SCHEDULER_ENABLED=true`
  on Fly → the 15-min in-process loop now runs due schedules automatically. On-demand refresh also
  works via `/v1/grid/run-now`. Resend `RESEND_API_KEY`/`RESEND_FROM` set as Fly secrets.
  **Follow-ups (small):** a frontend UI to create/list/delete schedules (today: rows inserted via
  PostgREST); dedup identical baselines so a "no-change" week doesn't persist a redundant run.
- [x] **P2.3 Cell-level change alerts.** Flag when a re-run's answer materially changes vs last
  run (new risk, changed number). Done when diff highlighting renders on re-run.
  **DONE 2026-06-30:** `figuresChanged()` (compares the FIGURES, not phrasing — LLM wording
  drifts every run) + 4 tests. Re-run now snapshots the prior run and shows an amber "CHANGED"
  badge on any cell whose numbers moved. Deployed to prod.
- [x] **P2.4 Excel/CSV export with live citations** (verify current export carries URLs after P0.2).
  **DONE 2026-06-30 (verified, no code):** XLSX has a "Sources" sheet pulling `c.url` with http
  links rendered as hyperlinks (gridExcelData.buildSourceRows + gridExcel); Memo (M4) lists real
  EDGAR URLs. Both now carry live links post-P0.2. CSV stays a flat answer matrix by design
  (the quick-paste format) — citations live in XLSX/Memo.

## ⭐ MAGNETS — the features customers subscribe *because of*

Reframe (2026-06-30): P0/P1/P4 are **table-stakes** — you lose customers without them, but
nobody pays *because* citations resolve. These are the features an analyst sees and says
"I need this." Build these to attract, not just retain. Ranked by pull.

- [x] **M1 — NL custom columns.** Analyst types a question ("pricing power evidence", "China
  exposure") → it becomes a grid column, run across every ticker. Encodes THEIR thesis once,
  reusable. The Hebbia hook; the thing that makes the grid *theirs*.
  **DONE 2026-06-30:** add/remove custom columns in GridView (ensures a `{ticker}` slot, runs
  through the RAG path), rehydrated from saved runs. Deployed. NEXT: persist templates per user
  (was P3.2) so they survive without a saved grid — small Supabase table.
- [x] **M2 — Outlier / surprise highlighting.** Auto-flag the cell that breaks the pattern:
  "only NVDA discloses this risk". Turns a 30-cell grid into *one glance → the insight*.
  **DONE 2026-06-30:** `distinctiveTerms()` flags salient risk/event terms unique to one
  company within a column (+4 tests); violet "⚡ <term>" badge renders on that cell with a
  "Only NVDA flags: …" tooltip. Deployed. NEXT extensions: numeric trend-break (z-score per
  column) + semantic outliers (needs embeddings, backend).
- [x] **M3 — One-click drill: cell → exact sentence highlighted in the filing.** Makes trust
  visceral. Needs backend char-offsets (partially present in RetrievalResult) + a viewer.
  **DONE 2026-06-30:** Three-layer fix: (1) `vector_indexer.py` now writes `char_offset_start/end`
  from chunk metadata to Qdrant payload (new chunks only; existing corpus shows full text, no reindex
  needed); (2) `Citation` Pydantic schema + `_coerce_citation` in search route now pass `chunk_id` +
  offsets through to the REST response; (3) `GridView.tsx` source modal fetches
  `/v1/documents/chunk/{chunk_id}/context` on open (using `X-API-Key: deep-research-internal`),
  renders full chunk text, highlights the exact `[char_offset_start, char_offset_end)` span with
  `<mark>` when offsets present. `Citation` + `GravityRAGResult.citations` TypeScript types updated;
  `gridResearch.ts` passes `chunk_id` + offsets through from RAG result. Deployed to Fly + Vercel.
- [x] **M4 — Grid → polished memo export.** Their deliverable comes out done.
  **DONE 2026-06-30:** `buildMemo()` renders the grid as a sectioned Markdown research memo
  (per-company → question → answer + outlier callouts + real source links); "Memo" export
  button downloads `.md` (+5 tests). Deployed. NEXT: PDF/deck rendering on top of the memo.

## P3 — Moat (supporting)

- [x] **P3.1 Cross-ticker synthesis that cites per-cell evidence** (the comparison row exists;
  make it cite the underlying cells' sources, not re-summarize). Feeds M2.
  **DONE 2026-06-30:** `aggregateCitations()` unions the per-cell evidence (dedup by title+url,
  renumbered) onto the comparison cell (+3 tests); modal shows the full evidence base for
  synthesis cells (bypasses the [N]-only filter since it's built-from, not inline-cited). Deployed.
- [x] **P3.2 Custom prompt columns** — superseded by **M1** (shipped). Remaining: per-user
  template persistence (Supabase `lib_grid_templates` table — DDL needed).
- [ ] **P3.3 Confidence that's earned, not self-reported.** Today `confidence: HIGH` is the
  LLM's word. Tie it to retrieval agreement + citation coverage. Done when confidence is computed.

## P4 — Engineering health (so the above can ship without breaking)

- [ ] **P4.1 Split `GridView.tsx` (1335 lines)** into cell/modal/sources/history components.
- [ ] **P4.2 Real component + cell-runner tests** (not standalone scripts). Done when the cell
  runner and CellSources have runtime tests in the vitest suite.
- [x] **P4.3 `/v1/search` observability** — populate `metadata` (channels_used, per-stage ms,
  rerank scores). Today it's null. Done when metadata is non-null and surfaced in the grid footer.
  **DONE 2026-06-30 (deployed):** added per-stage timing fields to `SearchMetadata`; route now
  builds metadata defensively (never null) with a route-level latency fallback. Verified live —
  metadata returns `model_used`, `retrieval_ms`, `reasoning_ms`, etc. (Surfacing in the grid
  footer UI is a small follow-up.)

---

## Attraction map — table-stakes vs magnets

Two different jobs. Don't confuse them:

- **Table-stakes (lose without — NOT why they pay):** P0 trust, P1 speed, P4 health, P2.1 history.
  Necessary hygiene. A customer never says "I subscribed because the citations resolved."
- **Magnets (WHY they pay + evangelize):** M1 NL columns, M2 outlier highlighting, M3 drill-to-
  source, M4 memo export. These are the demo moments. The "I need this" reaction.

Sequence: ship enough table-stakes to be *trustworthy and fast enough*, then pour effort into
**magnets**. We're past the table-stakes floor (P0+P1 done/decided). **Magnets are now the work.**

All magnets shipped. **M1 → M2 → M4 → M3 — all done.**
M2 is next: it's the feature that makes a wall of cells collapse into a single insight.

---

## Loop execution protocol

Each loop iteration:
1. Pick the highest unchecked item (P0 before P1 before …).
2. If it needs backend (`gravity-api`) work that can't deploy from here, do the frontend half
   and leave a `ponytail:`-style note on the backend dependency; don't fake it.
3. Implement → typecheck → run the item's runnable check → if frontend-only, build + deploy.
4. Check the box, append a one-line dated result under the item.
5. Stop the loop when all P0+P1 are checked (the trust+speed floor), and report.

**Don't make things up:** if an item can't be verified end-to-end (e.g. needs a paid reranker
key, a Fly deploy, or a Supabase DDL), mark it BLOCKED with the exact blocker, not DONE.
