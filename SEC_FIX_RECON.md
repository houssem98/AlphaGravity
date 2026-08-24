# SEC_FIX_RECON.md

Reconnaissance for the SEC filing / financial-fact reliability upgrade.
Written **before** any implementation change, per `LOOP_PROMPT_FIX_SECFILING.md` §2.

Every claim below is one of four states. Nothing here is inferred from documentation —
where a claim rests on a probe, the probe and its output are named.

| State | Meaning |
|---|---|
| **VERIFIED** | Read in the actual source, or measured by a probe run during this recon |
| **PARTIAL** | Exists and runs, but does not cover the case this task must fix |
| **MISSING** | Searched for; does not exist |
| **UNKNOWN** | Could not be established from this machine |

---

## 0. The headline finding

**The roadmap's core premise is wrong in the way that matters most.**

`FIX_SECFILING.md` §0 says query-time SEC acquisition "should be promoted from an
ingestion-only path into a query-time authoritative source resolver," implying it does not
exist. It does. `app/core/retrieval/edgar_search.py` is a live, query-time SEC XBRL
retrieval channel, registered as channel 10 in the orchestrator, with its own test file.
Its own docstring states the intent verbatim:

> "Every other numeric channel answers from whatever ingestion happened to land. This one
> calls EDGAR at query time, so a company the corpus never covered still gets an exact,
> citable figure. Nothing is indexed."

So this task is **not** "build query-time SEC acquisition." It is: **find why the existing
query-time channel returns zero for the NVIDIA question, and fix that.**

I reproduced the failure and isolated three independent root causes. All three are defects
in existing code, not absent features. See §7.

This distinction changes the whole shape of the work, and it also resolves what would
otherwise be a direct governance conflict — see §9.

---

## 1. The real LOOP system (the roadmap's guess was wrong)

`LOOP_GRAPH_NOTE.md` §"Important evidence boundary" states the LOOP files "are not present
at the repository root on the current public branch" and proceeds on remembered design.
Its instruction to inspect the real files first is correct, and was followed. Here is what
is actually on this machine.

| Artifact | State | Actual location |
|---|---|---|
| `LOOP_SPEC.md` | **VERIFIED** | `~/.claude/LOOP_SPEC.md` — **global**, not in the repo. `@`-imported into `~/.claude/CLAUDE.md`, so it binds every project |
| `LOOP_STANDARD.md` | **VERIFIED** | `~/.claude/LOOP_STANDARD.md` — global, deliberately *not* imported |
| `LOOP_CONVENTIONS.md` | **VERIFIED** | `docs/LOOP_CONVENTIONS.md` — 20.7 KB, repo-local, 9 sections. The repo's half of the contract |
| `gate-guard.mjs` | **VERIFIED** | `~/.claude/scripts/gate-guard.mjs` — **global**, portable across projects by design |
| `graph-lint.mjs` | **VERIFIED** | `scripts/graph-lint.mjs` — repo-local, 7.0 KB, has `--self-check` |
| `governance.mjs` | **VERIFIED** | `scripts/governance.mjs` — 11.1 KB |
| `loop-lint.mjs` | **VERIFIED** | `scripts/loop-lint.mjs` + `loop-lint.test.mjs` |
| Loop graph / state files | **VERIFIED** | 20 `*_LOOP.sh` files at repo root; ledgers in `docs/*_ROADMAP.md`; generated slash commands in `.claude/commands/*.md` |
| `LOOP_GRAPH_NOTE.md`'s G0–G18 graph | **MISSING** | Not a real construct in this repo. The repo uses `docs/*_ROADMAP.md` ledgers with §7 task lists and §6 acceptance rows |

**Repo-root `LOOP_SPEC.md` / `LOOP_STANDARD.md`: MISSING** — they are global, not repo
files. The roadmap looked in the wrong place, not at an absent system.

### The gate commands that actually exist

```
npm run loops        # graph-lint → governance → gate-guard → entitlement-probe → plans-sweep → loop-lint
npm run loops:test   # the --self-check suite for each of the above
```

**Note a real gap:** `LOOP_CONVENTIONS.md` §1's done-criteria table is written for
`apps/market-ui` (vitest, `tsc -p tsconfig.app.json`, `vercel --prod`). It names **no
Python gate**. This task is entirely inside `services/gravity-api`, which is pytest.
Treating the market-ui table as literal would mean this task has no applicable test gate at
all — plainly not the intent. Recorded as a finding about the conventions file, not
silently reinterpreted. The gate I will use is `pytest` on `services/gravity-api`, which is
the analogous instrument, plus `npm run loops`.

### There is already a loop that owns this service

**VERIFIED** — `GRAVITY_LOOP.sh` → `docs/GRAVITY_SEARCH_ROADMAP.md`, tasks GS-1..GS-10,
acceptance rows R1–R10, gate `scripts/search-probe.mjs` (exists, 12.3 KB, GS-1 is `[x]`).
GS-2..GS-10 are all still `[ ]`. §9 of that ledger is its stop condition.

This is the governing ledger for `gravity-api` search quality. See §9 for the conflict it
creates and how it resolves.

---

## 2. Current SEC data flow — VERIFIED

Four distinct SEC paths exist. They are **not** duplicates of each other; they serve
different stages.

```
INGESTION (background, scheduled)
  app/ingestion/sources/sec_edgar.py     SECEdgarSource — polls EDGAR RSS every 300s
      │                                   (9 watched form types, edgartools + raw fallback)
      └→ producer → Kafka or IngestionPipeline → processing/ → indexing/

QUERY-TIME (per request, nothing indexed)
  app/core/retrieval/edgar_search.py     EdgarSearch — channel 10, calls
      │                                   data.sec.gov/api/xbrl/companyconcept live
      └→ RetrievalResult with "[EXACT FILING FIGURE]" prefix → fusion → LLM

STRUCTURED FACTS (from what was persisted)
  app/core/retrieval/structured_search.py  Supabase `financials` table via PostgREST,
                                           Elasticsearch `gravity_financials` fallback

PERIOD ARITHMETIC (shared library, no I/O)
  app/ingestion/sources/sec_quarterly.py   fiscal-year assignment, quarter derivation,
                                           Q4 back-out, filing_url()
  app/ingestion/sources/sec_xbrl.py        SECXBRLClient — companyfacts + ticker→CIK map
```

`edgar_search.py` explicitly reuses `sec_quarterly` rather than reimplementing period math
— its docstring says so, and the import at line 26 confirms it. That is the reuse
discipline the roadmap §4 asks for, already in place.

---

## 3. Item-by-item against the roadmap's Phase-0 inventory

### 3.1 Ticker → CIK resolution — **VERIFIED, three implementations**

| Where | Mechanism |
|---|---|
| `edgar_search.EdgarSearch.ticker_to_cik` | SEC `company_tickers.json`, 24 h in-process TTL |
| `sec_xbrl.SECXBRLClient.resolve_cik` | same file, plus a company-**name** index |
| `core/entity_resolver.py` (21.8 KB) | full fuzzy resolver, Redis-cached, `resolve("NVIDIA") → NVDA`. Its comments record NVIDIA-specific bugs already fixed (D R Horton collision at line 139) |

**Do not add a fourth.** Roadmap §4 Step A proposes a `sec_issuers` table; three working
resolvers already cover it.

### 3.2 Filing retrieval — **PARTIAL**

`EdgarSearch` fetches `companyconcept` (one concept, all periods). It does **not** fetch a
specific filing's documents. `filing_url()` in `sec_quarterly.py:142` constructs the index
page URL from an accession number, so citations point at a filing index — not at evidence
inside it.

### 3.3 XBRL handling — **PARTIAL, and this is the central gap**

**VERIFIED by probe** (`/tmp/probe5.py`, run 2026-08-23):

The SEC `companyconcept` and `companyfacts` APIs return **non-dimensional facts only**.
Segment and product-line revenue are *dimensional* facts — they exist only in the filing's
XBRL instance document, carried on context elements.

For NVDA's Q3 FY2026 10-Q, parsing
`https://www.sec.gov/Archives/edgar/data/1045810/000104581025000230/nvda-20251026_htm.xml`
(1,216,933 bytes) for `Revenues` facts on the context `2025-07-28 → 2025-10-26`:

| Value (USD) | Dimensions |
|---|---|
| 57,006,000,000 | *(none — consolidated)* |
| 50,908,000,000 | `srt:ConsolidationItemsAxis=us-gaap:OperatingSegmentsMember`, `us-gaap:StatementBusinessSegmentsAxis=nvda:ComputeAndNetworkingSegmentMember` |
| 6,098,000,000 | … `nvda:GraphicsSegmentMember` |
| 39,177,000,000 | `srt:StatementGeographicalAxis=country:US` |
| **51,215,000,000** | **`srt:ProductOrServiceAxis=nvda:DataCenterMember`** |
| 43,028,000,000 | `srt:ProductOrServiceAxis=nvda:ComputeMember` |
| 8,187,000,000 | `srt:ProductOrServiceAxis=nvda:NetworkingMember` |
| 4,265,000,000 | `srt:ProductOrServiceAxis=nvda:GamingMember` |

**Ground truth for the target question: NVIDIA Data Center revenue, Q3 FY2026 =
$51,215,000,000**, concept `us-gaap:Revenues`, dimension
`srt:ProductOrServiceAxis=nvda:DataCenterMember`, form 10-Q, accession
`0001045810-25-000230`, period 2025-07-28 → 2025-10-26.

This independently matches the illustrative value in `FIX_SECFILING.md` §6 (51215 USD
millions), which the roadmap presented without provenance. It is now sourced.

Two adversarial traps are **confirmed present in the real data**, not hypothetical:
- **Quarterly vs YTD** — the same filing tags a 272-day span at **147,811,000,000**.
- **Segment vs product line** — Compute & Networking is **50,908,000,000**, within 0.6 % of
  the Data Center figure. A resolver that confuses the two returns a plausible wrong
  number, which is worse than returning nothing.

**No dimensional XBRL parsing exists anywhere in the repo.** This is the genuinely new
capability the task requires. `app/ingestion/processing/xbrl_extractor.py` exists —
inspected, it does not handle dimensions.

### 3.4 Parser — **VERIFIED (exists), PARTIAL (for this purpose)**

`app/ingestion/processing/sec_form_parsers.py`, `table_parser` (tested by
`tests/test_table_parser.py`), `xbrl_extractor.py`. All ingestion-side, HTML/table-oriented.
None parses an XBRL instance for dimensional contexts.

### 3.5 Structured retrieval — **VERIFIED**

`structured_search.py` queries the Supabase `financials` table via PostgREST with curated
`ilike` metric patterns, ordered `period.desc`. Columns observed in use: `ticker`,
`metric_name`, `period`, `value_raw`, `value_float`, `document_id`, `id`. Exact XBRL rows
are identified by an `_xbrl` **suffix on `id`**. This is the persistence target — **no new
database is needed**, satisfying roadmap §19.

### 3.6 Citation / evidence model — **PARTIAL**

`RetrievalResult` (in `fusion.py`) is the universal passage contract: `chunk_id`,
`document_id`, `text`, `score`, `document_title`, `section`, `filing_date`, `ticker`,
`document_type`, `source_quality`, `metadata{}`. `EdgarSearch._to_result` already populates
`accn`, `cik`, `tag`, `unit`, `form`, `fiscal_year`, `fiscal_quarter`, `value`, `derived`,
`filing_url`.

That covers roughly 60 % of the roadmap §8 evidence object. **MISSING** from it:
`period_start`, `section_path`, `table_id`, `row_label`, `column_label`, `text_span`,
`parser_version`, `verification_status`, and any dimension/segment identity.

### 3.7 Verification — **PARTIAL**

`app/core/verification/nli_verifier.py` (10.7 KB) does NLI claim-support checking.
`tests/test_numeric_scorer.py` and `tests/test_verifier_agent.py` exist. There is **no
numeric/temporal/unit verifier gating an exact financial fact** — the specific verification
roadmap §10 asks for.

### 3.8 Tests — **VERIFIED**

**484 tests collected** in `services/gravity-api/tests/` (measured: `pytest --co`,
207.67 s, exit 0, 2026-08-23). Directly relevant: `test_edgar_search.py` (9.4 KB, has a
`_FakeHTTP` fixture harness), `test_sec_quarterly.py` (7.5 KB), `test_quarterly_period_filter.py`,
`test_structured_ratio_components.py`, `test_table_parser.py`, `test_evidence_recall.py`.

`test_edgar_search.py`'s `_FakeHTTP` is the insertion point for offline, deterministic
regression tests — no network, no credential.

---

## 4. The failure, reproduced — VERIFIED

`/tmp/probe6.py`, run 2026-08-23 against the real code:

```
Q = "What was NVIDIA's Data Center revenue in Q3 FY2026?"

classify_metric(Q)                          → ('RevenueFromContractWithCustomerExcludingAssessedTax', 'revenue')
extract_tickers(Q)                          → []
extract_tickers(Q, filters={"companies":["NVDA"]}) → ['NVDA']

EdgarSearch().search(Q, filters={"companies":["NVDA"]}, top_k=10)
  → edgar_search  quarterly=True  results=0  tag=RevenueFromContract...  tickers=['NVDA']
  → results: 0
```

Zero results **even when the ticker is handed in explicitly**. The channel contributes
nothing, retrieval falls through, and `search_pipeline.py:928` emits the terminal
"No indexed documents found" string. That is the exact reported product failure, now with a
deterministic reproduction.

---

## 5. Root causes — three independent defects, all VERIFIED

### D1 — the tag fallback chain cannot fire when the primary tag is *stale*

`edgar_search.py:194-200`:

```python
for candidate in [tag] + _TAG_FALLBACKS.get(tag, []):
    data = await self._get_json(CONCEPT_URL.format(cik=cik, tag=candidate))
    if data and (data.get("units") or {}):
        return candidate, data
```

The guard is "does this tag have **any** data," not "does it have data **for the period
asked**."

**Measured** (`/tmp/probe2.py`, `/tmp/probe3.py`): NVDA's
`RevenueFromContractWithCustomerExcludingAssessedTax` holds 28 points whose newest `end` is
**2022-01-30**. NVDA moved to `us-gaap:Revenues` — 276 points, newest `end` **2026-04-26**,
including Q3 FY2026 at 57,006,000,000 from accession 0001045810-25-000230.

So the primary tag is non-empty → returns immediately → `Revenues` is never tried → zero
rows for FY2026. **This silently breaks every recent NVDA revenue question**, not just the
segment one.

### D2 — `extract_tickers` cannot match a 6-letter company name

`edgar_search.py:137` — the no-entity fallback regex is `\b[A-Z]{1,5}\b`. "NVIDIA" is six
characters, so the bounded alternation never matches it. Verified above: `[]`.

Mitigated in the full pipeline (the entity resolver populates `filters["companies"]`), but
the channel is not robust standalone, and the probe shows it.

### D3 — no dimensional (segment / product-line) fact retrieval anywhere

`classify_metric("...Data Center revenue...")` matches the bare keyword `"revenue"` and
returns the **consolidated** tag. The phrase "Data Center" is discarded entirely.

This is the dangerous one. Once D1 is fixed, the channel will happily return **57,006 M**
(consolidated) for a question that asked for **51,215 M** (Data Center) — a confident,
cited, wrong answer. Fixing D1 without D3 makes the product *worse*, not better.

A fourth, lesser issue: `_quarterly_rows` filters by fiscal **year** only. Asking for Q3
returns every quarter of FY2026, reverse-sorted so **Q4 lands first**. There is no
quarter-number filter.

---

## 6. Insertion points for the fix

| # | File | Change |
|---|---|---|
| 1 | `app/core/retrieval/edgar_search.py` | `_fetch_concept` — carry the requested period; reject a tag with no data covering it, then continue the fallback chain. Fixes D1 |
| 2 | `app/core/retrieval/edgar_search.py` | `extract_tickers` — widen the standalone fallback. Fixes D2 |
| 3 | **new** `app/core/retrieval/sec_dimensions.py` | XBRL instance fetch + dimensional fact extraction. Fixes D3. New capability; no existing module does this |
| 4 | `app/core/retrieval/edgar_search.py` | quarter-number parse + filter; quarterly-vs-YTD span guard |
| 5 | **new** verification helper | numeric / temporal / unit / dimension checks before a fact is emitted |
| 6 | `app/core/retrieval/edgar_search.py::_to_result` | widen metadata to the canonical evidence fields |
| 7 | `search_pipeline.py` ~line 911 | the no-data exit must state a truthful source state, not an ingestion instruction |
| 8 | persistence | write verified facts to the existing Supabase `financials` table, async, non-blocking. **No new DB** |
| 9 | `tests/` | empty-corpus regression + adversarial suite, on the existing `_FakeHTTP` harness |

---

## 7. What must NOT be built (roadmap §19 checked against reality)

| Roadmap proposal | Verdict |
|---|---|
| `sec_issuers` table | **Reject** — three ticker→CIK resolvers already exist |
| Second SEC ingestion pipeline | **Reject** — `sec_edgar.py` exists; this task must not touch the polling path |
| New database / vector store | **Reject** — Supabase `financials` is the persistence target |
| 9 new tables (§10) | **Reject** — unjustified; existing `financials` columns suffice for the fact rows |
| New RAG system | **Reject** — `EdgarSearch` is already a registered channel |
| Continuous polling for the interactive path | **Already satisfied** — `EdgarSearch` indexes nothing |

---

## 8. Risks and unknowns

- **UNKNOWN — Supabase write headroom.** Memory records 294 MB/500 MB at 2026-08-17 and
  `GRAVITY_SEARCH_ROADMAP` R4 caps the DB at 450 MB, halting the loop above it. Fact
  persistence writes rows. I have not measured current MB. Persistence must be bounded and
  the reading printed, or the write is escalation.
- **UNKNOWN — prod deploy state.** Memory says prod runs a stale image (2026-07-07). All
  work here is local; deploying is escalation `E-F` under the GRAVITY ledger.
- **RISK — XBRL instance size.** 1.2 MB per filing, parsed at query time. Needs a size
  guard and a timeout; it must not become a latency regression on the common path.
- **RISK — member-name heuristics.** `nvda:DataCenterMember` is a *company-specific*
  extension tag. Matching "Data Center" → that member must be evidence-driven (read the
  label linkbase / the member's own name) and must refuse ambiguity rather than guess —
  the Compute & Networking figure sits 0.6 % away.
- **RISK — fixing D1 alone is a net negative.** Stated in §5. D1 and D3 must land together
  or the channel confidently answers the wrong number.
- **UNKNOWN — SEC availability during the test window.** Mitigated by building the
  regression on recorded fixtures via `_FakeHTTP`, so the gate does not depend on the
  network.

---

## 9. Governance conflict, and how it resolves

`GRAVITY_LOOP.sh` rule (2), binding on `services/gravity-api`:

> **SELECTION BEFORE SOURCES** — "no task may add a source, a channel or an API to fix
> something a better query would have retrieved."

Read literally against `LOOP_PROMPT_FIX_SECFILING.md`, which asks for query-time SEC
acquisition, that is a conflict. `LOOP_PROMPT_FIX_SECFILING.md` §20 says to stop and report
`BLOCKED` when the repository's real LOOP contract conflicts with the prompt.

**It does not actually conflict, and the recon is what settles it.** The SEC channel
already exists. This work adds no channel, no source and no API — it repairs selection
defects (D1, D2, the missing quarter filter) inside a registered channel, and extends its
extraction to dimensional facts the SEC endpoint it already calls cannot express. That is
precisely "a better query retrieving what is there." The GRAVITY rule and the SEC roadmap
point the same way.

Where the two genuinely diverge, `LOOP_PROMPT_FIX_SECFILING.md` §18 is explicit that the
real repository implementation wins:

- The G0–G18 graph is **not adopted**; the repo's ledger form is used.
- The roadmap's 9-table schema is **not adopted**; `financials` is reused.
- The 450 MB cap and the destructive-op escalations from `GRAVITY_SEARCH_ROADMAP` §10
  **remain binding** on anything this task writes.

**Not blocked. Proceeding.**

---

## 10. Baseline freeze

| Item | Value |
|---|---|
| Branch | `verify/multi-entity-live` |
| HEAD | `cbfa009` |
| Working tree | `M apps/market-ui/vite.config.ts`, `?? AlphaGravity_SEC_WorldClass_LOOP_Pack/` (both pre-existing, untouched) |
| pytest collection | 484 tests, exit 0, 207.67 s |
| Target query | zero EDGAR results → "No indexed documents found" |
| Ground truth | NVDA Data Center Q3 FY2026 = **$51,215,000,000**, accn `0001045810-25-000230`, `srt:ProductOrServiceAxis=nvda:DataCenterMember` |

Recon complete. No implementation code changed to produce this document.
