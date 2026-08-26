# WEB_RESEARCH_SEC_RECON

Audit of the AlphaGravity repository against every requirement in
`WEB_RESEARCH_SEC_INTEGRATION.md`, performed **before** any code was written.

Repository state at audit time:

```
branch      verify/multi-entity-live
HEAD        b8db57e  docs: source-click audit — exact SEC filing proven by a real click
merge-base  4b7e116  (origin/main and origin/roadmap/world-class DO share history)
```

Classification key:

| | meaning |
|---|---|
| **VERIFIED** | exists, read, and does what the spec asks |
| **PARTIAL** | exists but does not cover the spec's case |
| **MISSING** | nothing in the repo implements it |
| **BLOCKED** | cannot be done in this environment; reason stated |
| **UNKNOWN** | could not be determined without running something unavailable |

---

## 0. Headline

The repository already contains **most of the evidence architecture the spec
describes** — it was built for SEC. The gate, the provenance object, the
question classifier, the domain-authority table and the trusted-URL policy are
all present and all generic enough to extend.

What is missing is the **web half**: no search provider, no page
fetch-and-extract, no web evidence object, no claim-to-evidence map, and — the
finding that matters most — **no SSRF protection anywhere in the codebase.**

So the correct shape of this work is *extension*, not construction. Building a
second pipeline would violate the spec and would also be strictly worse than
what is already here.

---

## 1. Existing architecture — what can be reused as-is

### `app/core/retrieval/evidence_gate.py` — VERIFIED

The verified-evidence gate. Four routing states (`VERIFIED_LOCAL_HIT`,
`LOCAL_MISS`, `LOCAL_UNVERIFIED`, `LOCAL_CONFLICT`), a full identity match
(ticker / CIK / concept-family / FY / FQ / dimension / unit / accession /
period bounds), conflict detection on disagreeing values, a 90-day staleness
re-validation, and `channels_after_gate()` — the single place that decides
whether `edgar` is dropped.

Satisfies spec section 5 (LOCAL-FIRST) for the SEC path exactly. **Must not be
touched.** The web layer routes *around* it, never through it.

### `app/core/retrieval/citation_provenance.py` — VERIFIED

The canonical provenance object. `provenance()` builds it from passage
metadata, `payload()` flattens it for the wire, `source_click_url()` and
`citation_url()` enforce *exact filing URL beats generic browse-edgar*,
`is_trusted_sec_url()` is a **host allow-list** (`SEC_HOSTS`), and
`rehydrate()` recovers provenance from a persisted `financials` row.

Carries every field spec section 11 demands for SEC: CIK, accession, filing
date, filing URL, document URL, XBRL concept, dimension, dimension value,
period, unit. Plus `provenance_chain`, `verification_status`, `restated`,
`is_amendment`.

**This is the "existing canonical provenance system" the spec says remains the
source of truth.** Web citations extend this module; they do not get their own.

### `app/core/question_class.py` — PARTIAL

`classify()` already produces a deterministic, regex-only, network-free class
before retrieval, and `route_channels()` already adds channels without
removing any. Seven classes exist:

```
EXACT_FINANCIAL_FACT  FINANCIAL_TABLE  FINANCIAL_CALCULATION
FILING_QUALITATIVE    MULTI_DOCUMENT_RESEARCH  MARKET_NEWS  GENERAL
```

Spec section 4 asks for seven, and four have no equivalent here:
`COMPANY_RESEARCH`, `MARKET_CONTEXT`, `MACRO`, `GENERAL_WEB_RESEARCH`
(`FINANCIAL_ANALYSIS` maps onto the existing `FILING_QUALITATIVE` /
`FINANCIAL_CALCULATION` pair). And nothing in this module decides *source
classes* — it decides retrieval channels. Spec section 4 wants LOCAL / SEC / WEB.

**Extend, do not replace.** The existing class names are load-bearing:
`NEEDS_PRIMARY_SOURCE` gates the exact-fact path and `test_question_class.py`
pins the current behaviour.

### `app/core/retrieval/fusion.py` — PARTIAL

`_DOMAIN_QUALITY` is already a 10-point domain-authority table with the exact
tier ordering spec section 8 asks for: sec.gov / fred / bls / treasury at 10,
`investor.` and `ir.` prefixes at 9, businesswire / prnewswire at 7,
Bloomberg / Reuters at 6, down to social at 2. `get_source_quality()` resolves
document_type then URL domain then title hints then a default of 5.

Missing: the **named tier** (`TIER_1`..`TIER_4`) the spec asks the ranking
system to reason about, and any *financial source policy* ("SEC outranks
generic web for reported numbers"). The scores exist; the policy that uses them
does not.

### `app/core/retrieval/orchestrator.py` — VERIFIED

Parallel `asyncio.gather` fan-out, per-channel timeout budgets, exception
isolation (`return_exceptions=True` — a failing channel yields `[]` and never
propagates), and `search_multi_entity()` for comparisons.

Directly satisfies spec section 6 (SEC+WEB parallelism) and section 15 (web
failure must not crash the SEC pipeline) — a `web` channel registered here
inherits both properties for free. Cheapest correct integration point.

### `app/api/schemas/search.py` — PARTIAL

`Citation` already carries `accession`, `filing_url`, `verification_status`
and a free-form `provenance` dict. `SearchMetadata` already carries
`question_class`, `local_evidence_status`, `sec_invoked`, `sec_skip_reason`,
four `sec_*_requests` counters, and a per-stage latency breakdown.

Missing: every web field (`url` / `domain` / `published_at` / `retrieved_at` /
`source_type`), the source **category**, and all web observability counters
from spec section 28.

### `apps/market-ui/src/lib/secUrl.ts` — VERIFIED (SEC only)

Client-side mirror of the backend URL policy: `SEC_HOSTS` allow-list,
`ACCESSION_RE`, `isGenericEdgarUrl()` (explicitly detects the browse-edgar
listing this whole effort removed), `canonicalSecUrl()` with a documented
four-step priority, and `filingIndexUrl()` reconstruction for legacy payloads.

Satisfies spec section 24 for SEC clicks. Has no web equivalent.

### `apps/market-ui/src/pages/SearchPage.tsx` — PARTIAL

`SourceCard` renders ticker, section, score, title, filing date and an
expandable passage. It is **not clickable at all** and has no category
grouping. Spec section 23 wants four labelled categories with every card
clickable.

### `app/ingestion/sources/gdelt.py` — PARTIAL

A real news channel with a 3s courtesy throttle. But `_gdelt_to_results()` in
the orchestrator builds `RetrievalResult` from `art["snippet"]` — **the search
snippet is used directly as evidence text.** Precisely what spec sections 10
and 32 forbid. It is the closest thing to a web layer in the repo and it
violates the central web rule.

### `app/core/retrieval/edgar_search.py` — VERIFIED, with one caveat

The live SEC channel. `_SEC_SEMAPHORE = asyncio.Semaphore(8)` bounds
concurrency and a descriptive `User-Agent` is set. Spec section 30 asks for the
current SEC guidance — a 10 req/s ceiling — and a semaphore of 8 bounds
*in-flight* requests, not *rate*. In practice 8 concurrent round-trips against
data.sec.gov cannot exceed 10/s at observed latencies, but the guarantee is
incidental rather than stated. Noted; not a blocker.

---

## 2. Requirement-by-requirement

| Sec | Requirement | Status | Evidence / gap |
|---|---|---|---|
| 1 | Target architecture | **PARTIAL** | LOCAL + SEC legs complete. WEB leg absent from SOURCE ROUTER down. |
| 2 | Do not break SEC | **VERIFIED** | Gate + provenance + exact-URL policy present and tested (`test_evidence_gate.py`, `test_citation_provenance.py`, `test_verified_evidence_gate.py`). |
| 3 | Web source class abstraction | **MISSING** | Zero hits for tavily/exa/serper/brave/firecrawl/perplexity across `app/**.py`. Only a docstring mention in `web_pdf_fetcher.py`. |
| 4 | Deterministic source routing | **PARTIAL** | `classify()` is deterministic and pre-retrieval. Four of seven classes missing; no LOCAL/SEC/WEB source plan. |
| 5 | Local-first, except fresh questions | **PARTIAL** | Local-first done. Freshness override: `MARKET_NEWS` exists but only appends `gdelt`; nothing forces live retrieval or forbids stale reuse. |
| 6 | SEC + WEB parallelism | **PARTIAL** | Orchestrator gathers in parallel already; no web channel to gather. |
| 7 | Structured web results | **MISSING** | No structured result type. GDELT yields raw dicts. |
| 8 | Source quality tiers | **PARTIAL** | `_DOMAIN_QUALITY` 1-10 exists; no TIER_1..4 naming, no policy consuming it. |
| 9 | Financial source policy | **MISSING** | Nothing enforces "SEC outranks third-party for a reported number"; nothing detects SEC/web disagreement. |
| 10 | Web fetch, extract, evidence | **MISSING** | `web_pdf_fetcher.py` fetches PDFs only, contains a dead branch (`... if False else ...`), produces no evidence object. |
| 11 | Citation provenance reuse | **PARTIAL** | SEC side canonical and complete. No web provenance builder. |
| 12 | Unified evidence model | **MISSING** | No `EvidenceSource`. Passages are `RetrievalResult` plus an untyped `metadata` dict. |
| 13 | Claim to evidence mapping | **MISSING** | Citations attach to the answer, not to individual claims. Spec calls this "critical". |
| 14 | Cross-source verification | **MISSING** | `Contradiction` schema exists and is emitted for local contradictions; no cross-source agreement analysis. |
| 15 | Degraded modes explicit | **PARTIAL** | Channel failures isolated and logged; `channels_dark` reported. Web has no degraded-mode reporting. |
| 16 | Freshness | **MISSING** | No `published_at` / `retrieved_at` on any evidence. `test_freshness_lag.py` covers filing lag, not web staleness. |
| 17 | Deduplication | **MISSING** | RRF dedupes by `chunk_id`; no URL canonicalization, no syndication detection. |
| 18 | Search query generation | **PARTIAL** | `multi_query.py` and `hyde.py` generate variants for *dense retrieval*. Nothing generates web search queries. |
| 19 | Web search budget | **MISSING** | No budget object. |
| 20 | **SSRF prevention** | **MISSING** | **No host validation, no private-IP blocking, no scheme allow-list anywhere in `app/`.** `web_pdf_fetcher.fetch_and_extract()` follows redirects to any URL including `169.254.169.254`. The only allow-list in the repo is `SEC_HOSTS`, which governs rendering links, not fetching. |
| 21 | Prompt-injection defense | **MISSING** | Retrieved text is interpolated into `USER_CONTEXT_TEMPLATE` with no fencing and no instruction-stripping. Low-risk today because all sources are SEC/corpus; high-risk the moment arbitrary web pages are fetched. |
| 22 | FACT / CONTEXT / INFERENCE | **PARTIAL** | Prompt rules 11 and 12 enforce GROUNDED-OR-REFUSE and grounded analysis. No three-way labelling. |
| 23 | UI source categories | **MISSING** | `SourceCard` is a flat, non-clickable list. |
| 24 | Source click | **PARTIAL** | SEC click **VERIFIED** (`canonicalSecUrl`, generic-URL rejection, tests). Web click: nothing. |
| 25 | Search status | **PARTIAL** | Stage events, `channels_dark` and `sec_*` counters stream today. No research summary. |
| 26 | Test matrix A-P | **PARTIAL** | A/B/C/M/N/P covered by the SEC suites. D-L and O have no tests. |
| 27 | Golden tests | **MISSING** | `tests/golden_eval.json` exists for retrieval eval; no golden question suite of the shape asked for. |
| 28 | Observability | **PARTIAL** | `sec_*` counters and stage latency present. Every web counter missing. |
| 29 | Performance | **PARTIAL** | Per-stage latency measured. No per-route measurement, and nothing prevents web search on every query. |
| 30 | SEC rate limits | **PARTIAL** | Semaphore(8) plus UA. Concurrency-bounded, not rate-bounded. |
| 31 | Final audit doc | **MISSING** | To be produced. |
| 32 | Prohibitions | **VERIFIED** | Reviewed; the plan below violates none. |

---

## 3. Blocked / environment

| item | status | reason |
|---|---|---|
| Live Tavily search | **BLOCKED** | `TAVILY_API_KEY` present in `.env`, but this account's Tavily key has returned HTTP 432 since 2026-07-10 (recorded in project memory). Provider abstraction must degrade; live validation must be attempted and reported honestly. |
| Live Firecrawl fetch | **UNKNOWN** | `FIRECRAWL_API_KEY` present and believed alive. To be probed, not assumed. |
| Production deployment | **BLOCKED** | Fly builder returns 403 on an overdue invoice; prod frozen at v228 (2026-07-07). Nothing here can be deployed. |
| Elasticsearch / Neo4j | **BLOCKED** | Not configured in this deployment; bm25 and graph channels dark. Pre-existing. |

---

## 4. The smallest architecture that satisfies the spec

One principle: **the web is a retrieval channel and a provenance dialect, not a
second pipeline.**

```
                    question_class.classify()          <- extended, deterministic
                              |
                    route_sources()  ->  SourcePlan{local, sec, web}   <- NEW
                              |
        +---------------------+---------------------+
        |                     |                     |
   evidence_gate          edgar_search          web channel            <- NEW
   (untouched)            (untouched)                |
        |                     |            query gen -> search
        |                     |            -> select -> SSRF check
        |                     |            -> fetch -> sanitize
        |                     |            -> extract -> WebEvidence
        +---------------------+---------------------+
                              |
                    RetrievalOrchestrator          <- +1 channel registration
                              |
                    fusion / rerank (untouched)
                              |
                    citation_provenance            <- + web_provenance()
                    (SAME module, SAME payload shape)
                              |
                    claim -> evidence map          <- NEW
                              |
                    API schemas  ->  UI
```

New package `app/core/research/`:

| module | responsibility |
|---|---|
| `url_safety.py` | SSRF guard (scheme, host, resolved-IP allow/deny), URL canonicalization, dedup keys |
| `providers.py` | `WebSearchProvider` / `WebFetchProvider` ABCs, Tavily / Firecrawl / GDELT adapters, registry |
| `sanitize.py` | Prompt-injection defense: fence web text as data, neutralise instruction patterns |
| `source_quality.py` | TIER_1..4 over the existing `_DOMAIN_QUALITY`; financial source policy |
| `evidence.py` | `EvidenceSource` union (`SEC_EVIDENCE` / `LOCAL_EVIDENCE` / `WEB_EVIDENCE`), claim-to-evidence map, cross-source verification |
| `budget.py` | Query/result/page caps, timeouts, and the usage record sections 19 and 28 want |
| `web_research.py` | The orchestration above, exposed as a channel with `.search()` |

Extended (never rewritten): `question_class.py`, `citation_provenance.py`,
`orchestrator.py`, `search_pipeline.py`, `api/schemas/search.py`, `fusion.py`
(tier names only), `secUrl.ts`, `SearchPage.tsx`.

Untouched: `evidence_gate.py`, `edgar_search.py`, `sec_dimensions.py`,
`fact_verification.py`, `fact_persistence.py`.

---

## 5. Risks accepted going in

1. **The GDELT snippet-as-evidence violation is pre-existing.** Fixing it
   inside this change means altering a channel the spec did not ask about.
   Decision: leave `gdelt` alone, mark its results with a source type that can
   never be mistaken for fetched evidence, and route important claims through
   the new web path instead.

2. **SSRF is the only genuine security hole found.** It is currently
   unexploitable in practice because no attacker-controlled URL reaches
   `web_pdf_fetcher`. Adding web search *creates* that path, so the guard must
   land in the same change, not after it.

3. **Live web validation may be unavailable.** If both providers fail, the
   audit says so and does not claim live validation from fixtures.
