# SEC SOURCE CLICK AUDIT

| | |
|---|---|
| **Branch** | `verify/multi-entity-live` |
| **Commit** | `655638ec53d896622d184a6033cdcf53045aaf9b` (`655638e`) |
| **Parent** | `69dc4df` |
| **Date** | 2026-08-26 |
| **Verdict** | **FIXED — proven by a real-DOM click test, not by inspection** |

---

## 0. Reproduction: what was actually broken

The report said a source click opened
`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=EOG&type=10-K`.

Tracing the chain named in §1 found **two independent causes**, either of which
alone was sufficient. Fixing one would have left the bug in place.

### Cause 1 — the source object carried no URL at all

`search_pipeline.py:1072` built each source card as:

```python
{"id", "chunk_id", "title", "section", "text", "ticker", "date",
 "document_type", "source_quality", "score", "channels"}
```

No `url`, no `filing_url`, no accession. `SourcePassage`
(`app/api/schemas/search.py:97`) had no field for one either, and
`_coerce_source` (`app/api/routes/search.py:147`) is a whitelist — so even if
one had been added upstream, the REST response would have dropped it. The thing
the user clicks had nothing to click, so the frontend rebuilt a URL from the
ticker.

### Cause 2 — the endpoint the frontend resolved against does not exist

`EdgarLink.tsx` resolved the link by calling
`GET /v1/documents/filing-url?ticker=…&filing_type=…&filing_date=…`, and fell
back to the company listing whenever that call failed:

```
$ grep -rn "filing-url" services/gravity-api/app/
(no matches)
```

`app/api/routes/documents.py` registers ten routes; `filing-url` is not among
them. The fetch 404'd on **every render**, `resolved` stayed `null`, and the
"fallback" was not a fallback — it was the only path the component ever took.
That is why the bug reproduced 100% of the time rather than intermittently.

### Cause 3 (found while wiring, same class)

`provenance()` used `document_url` to build `evidence_location` but never
emitted `document_url` itself, so §4's "preserve both" was quietly unmet. Caught
by a test written for this task, not by inspection.

---

## 1. IMPLEMENTATION — exact files and functions changed

### Backend — `services/gravity-api`

| File | Function | Change |
|---|---|---|
| `app/core/retrieval/citation_provenance.py` | `source_click_url` (new) | The canonical policy: filing index from verified CIK + accession → Archives document → other authoritative SEC URL → `""`. Never a company listing. |
| | `is_trusted_sec_url` (new) | Host allow-list: `www.sec.gov`, `sec.gov`, `data.sec.gov`, `efts.sec.gov`, https only. |
| | `payload` (new) | Flattens verified provenance onto sources and citations identically, so the two cannot disagree. |
| | `citation_url` | Now delegates to `source_click_url`. |
| | `provenance` | Emits `document_url` (Cause 3). |
| `app/core/search_pipeline.py` | `SearchPipeline.search` (Stage 5) | Source cards carry `**citation_provenance.payload(...)`. |
| | `_normalize_citations` | Both builders — the join and the resilience branch — use `payload()`. |
| `app/api/schemas/search.py` | `SourcePassage` | +13 provenance fields incl. `canonical_url`. |
| | `Citation` | +`accession_number`, `issuer`, `cik`, `form`, `filing_date`, `fiscal_period`, `document_url`, `source_url`, `evidence_location`, `canonical_url`. |
| `app/api/routes/search.py` | `_coerce_source`, `_coerce_citation` | Whitelists widened; a field omitted there is a field deleted from the response. |

### Frontend — `apps/market-ui`

| File | Function | Change |
|---|---|---|
| `src/lib/secUrl.ts` (new) | `canonicalSecUrl` | Client half of the same policy: `canonical_url` → `filing_url` → `document_url` → `source_url` → rebuild from CIK + accession → a trusted non-generic `url`. |
| | `filingIndexUrl` | Generic construction; `''` rather than a guess on malformed input. |
| | `isTrustedSecUrl`, `isGenericEdgarUrl`, `isValidAccession` | §7 guards. |
| `src/components/EdgarLink.tsx` | `edgarHref` (new, exported) | The href decision, in one place, assertable without a DOM. |
| | `EdgarLink` | Takes `provenance`; with it, **no fetch and no fallback**. Legacy resolve-by-date kept only for callers with no accession. Renders `data-testid`, `data-exact-filing`, `data-accession`. |
| `src/pages/SearchPage.tsx` | `CitationPanel` | Passes `provenance={citation}`; displays issuer / form / fiscal period / **accession** (§12). Form and filed date now come from verified provenance rather than a regex over the title. |
| `src/hooks/useGravitySearch.ts` | `SecFilingProvenance` (new) | `GravitySource` and `GravityCitation` extend it. |
| `src/components/grid/GridView.tsx` | `CellSources`, `SourceViewerData` | Provenance carried into the grid source modal. |
| `src/services/gridResearch.ts` | 3 citation builders | Provenance carried from RAG results. |
| `src/services/gravitySearchService.ts` | `GravityRAGSource`, citations | Types widened. |
| `vitest.config.ts` (new) | — | Vitest was referenced but never installed or configured. |

### Proxy — `services/market-server`

| File | Function | Change |
|---|---|---|
| `src/services/gravityClient.ts` | `normalizeSources`, `exactFilingUrl` (new) | The exact filing wins; `buildEdgarUrl` is now reachable only for sources that never named a filing. |
| `src/services/deepResearchService.ts` | `edgarFilingUrlFromHit` (new) | Same bug, second location — see §7 below. |

---

## 2. BACKEND — canonical URL result

```
$ python -c "from app.ingestion.sources.sec_quarterly import filing_url; \
             print(filing_url(821189, '0000821189-25-000011'))"
https://www.sec.gov/Archives/edgar/data/821189/000082118925000011/0000821189-25-000011-index.htm
```

Accession normalised for the Archives path
(`0000821189-25-000011` → `000082118925000011`) and kept hyphenated for the
visible filing identity, exactly as §3 requires. Generic, not hardcoded:
asserted for NVDA and AAPL accessions too.

**STATUS: PASS.**

---

## 3. API — citation and source payload result

Measured through the real pipeline (`test_source_click_e2e.py`), the EOG source
card the UI receives:

```json
{
  "id": "src_1",
  "ticker": "EOG",
  "issuer": "EOG RESOURCES INC",
  "cik": 821189,
  "form": "10-K",
  "filing_date": "2025-02-27",
  "fiscal_period": "FY2024",
  "accession": "0000821189-25-000011",
  "accession_number": "0000821189-25-000011",
  "filing_url": "https://www.sec.gov/Archives/edgar/data/821189/000082118925000011/0000821189-25-000011-index.htm",
  "document_url": "https://data.sec.gov/api/xbrl/companyconcept/CIK0000821189/us-gaap/Revenues.json",
  "source_url": "https://www.sec.gov/Archives/edgar/data/821189/000082118925000011/0000821189-25-000011-index.htm",
  "evidence_location": "https://data.sec.gov/api/xbrl/companyconcept/CIK0000821189/us-gaap/Revenues.json",
  "verification_status": "verified",
  "canonical_url": "https://www.sec.gov/Archives/edgar/data/821189/000082118925000011/0000821189-25-000011-index.htm"
}
```

Every field §5 lists is present. The frontend never reconstructs a SEC URL from
an untrusted string; `canonical_url` is already decided server-side.

`accession_number` is emitted **alongside** `accession` rather than replacing
it: the specification names the former, the shipped `Citation` model and its
tests already use the latter. Both carry the same value.

**STATUS: PASS.**

---

## 4. FRONTEND — source-click result

The component is rendered into a real DOM (jsdom), the anchor is really clicked,
and the assertion is on `HTMLAnchorElement.href` at click time — the value the
browser navigates to. jsdom does not perform navigation itself, so the click
handler captures the target; nothing about the target is simulated.

```
$ npx vitest run src/components/EdgarLink.click.test.tsx
 ✓ the click target is the exact SEC filing URL                      53ms
 ✓ the click target is NOT the generic EDGAR company page             7ms
 ✓ never asks the backend to resolve a link it already has
 ✓ opens in a new tab, safely
 ✓ shows the accession, so the card names what it opens
 ✓ rebuilds the exact filing from a legacy payload carrying only CIK + accession
 ✓ ignores a stored generic browse-edgar URL when an accession exists
 ✓ refuses an untrusted URL even when it arrives as the canonical field
 ✓ does not append a text fragment to a synthesized XBRL snippet
 ✓ scrolls to a verbatim prose citation inside the filing
 ✓ still offers the company search, since no filing was ever named
 ✓ renders nothing at all when there is neither a ticker nor a filing
 Tests  54 passed (54)
```

The `fetch` stub in that suite returns **404**, which is what the real backend
does for `/v1/documents/filing-url`. A passing test is therefore passing
*without* the resolver, which is the condition the production bug was created
by.

**STATUS: PASS — proven by a click, not by inspection.**

---

## 5. EOG

| | |
|---|---|
| Ticker | `EOG` |
| Issuer | `EOG RESOURCES INC` (SEC's `company_tickers.json` spelling; companyconcept says `EOG RESOURCES, INC.`) |
| CIK | `821189` |
| Accession | `0000821189-25-000011` |
| Form / filed | `10-K`, filed `2025-02-27` |
| Fiscal period | `FY2024` |
| Value in that filing | `23,698,000,000` USD, `us-gaap:Revenues` |
| **Filing URL** | `https://www.sec.gov/Archives/edgar/data/821189/000082118925000011/0000821189-25-000011-index.htm` |

The fixture is **recorded, not invented**:
`tests/fixtures/eog_revenues_concept.json` was fetched from `data.sec.gov` on
2026-08-26 and trimmed to the three points that accession reports.
`RevenueFromContractWithCustomerExcludingAssessedTax` 404s for this filer, so
this is also a live exercise of the concept-family fallback.

---

## 6. Path results

| Path | Spec | Test | Result |
|---|---|---|---|
| **NORMAL** (SEC → exact filing → answer → citation → click) | §10 A | `TestRunA_SecPath` (9) | **PASS** — `canonical_url` = exact EOG URL on both the source card and the citation |
| **LOCAL PERSISTED** (persisted evidence → answer → citation → click) | §10 B | `TestRunB_PersistedLocalPath` (4) | **PASS** — `VERIFIED_LOCAL_HIT`, 0 SEC requests, **same accession, same exact URL** |
| **RESILIENCE** (model drops its citations array) | §11 | `TestEveryCitationBuilderUsesTheSameProvenance` (4) | **PASS** — both builders produce identical `url` / `filing_url` / `canonical_url` / `accession` |
| **SECURITY** | §7 | `TestOnlyTrustedSecUrlsBecomeLinks` (16) + `secUrl.test.ts` (24) | **PASS** |

`test_both_runs_agree_on_the_click_target` asserts §10's requirement directly:
the SEC path and the local path resolve to the same URL. An exact URL on the
first ask and a company listing on the second is the failure that would
otherwise be invisible until someone clicked the second answer.

---

## 7. §15 — every generic-EDGAR generator in the repository, classified

| # | Location | Classification | Action |
|---|---|---|---|
| 1 | `apps/market-ui/src/components/EdgarLink.tsx:75` | **BUG** — the reported one; taken 100% of the time | **FIXED** |
| 2 | `services/gravity-api/app/core/search_pipeline.py:1072` (`source_data`) | **BUG** — source card had no URL at all | **FIXED** |
| 3 | `app/api/schemas/search.py` `SourcePassage` / `app/api/routes/search.py` `_coerce_source` | **BUG** — whitelist would have stripped a fix | **FIXED** |
| 4 | `apps/market-ui/src/pages/SearchPage.tsx:748` | **BUG** — dropped `citation.filing_url` / `accession` at the call site | **FIXED** |
| 5 | `services/market-server/src/services/gravityClient.ts:53` `buildEdgarUrl` | **BUG** — built a listing for every source | **FIXED** — exact filing wins; listing now reachable only when no filing was named |
| 6 | `services/market-server/src/services/deepResearchService.ts:309` | **BUG** — EFTS hits name their filing in `_id`; both accession and CIK were discarded | **FIXED** — `edgarFilingUrlFromHit` |
| 7 | `app/core/search_pipeline.py:2204` `_edgar_browse_url` | **SAFE** — last-resort fallback for passages that never named a filing; already ranked below exact provenance | kept, tested |
| 8 | `apps/market-ui/src/services/secEdgarService.ts:25` | **INTENTIONAL** — `output=atom` company *search* to discover a CIK. A data fetch, not a click target | unchanged |
| 9 | `app/ingestion/sources/sec_edgar.py:30` `EDGAR_RSS_URL` | **INTENTIONAL** — the ingestion polling feed | unchanged |
| 10 | `apps/market-ui/src/components/trading/AssetInfoPanel.tsx:519-533` | **INTENTIONAL** — a company-level "SEC filings" link on an asset page. No accession exists or could exist | unchanged |
| 11 | `apps/market-ui/src/components/trading/MarketList.tsx:25` | **INTENTIONAL** — market-level company search | unchanged |
| 12 | `apps/market-ui/src/pages/CompanyPage.tsx:546` | **INTENTIONAL** — "latest 10-K" button; genuinely has no accession, and `allowLatest` is what it wants | unchanged |
| 13 | `apps/market-ui/src/pages/CompanyPage.tsx:886` (document drawer) | **LEGACY** — `GravityDocument` carries no accession, so there is nothing to pass. Accepts provenance now; gaining one needs the documents API to expose `accession_number`, which it stores but does not return | **not fixed — stated, not hidden** |

---

## 8. §4 / §13 — document URL vs filing URL, and evidence location

Both are preserved, and the click target is a deliberate choice between two
sentences of the specification:

* §2 ranks "exact SEC filing/document URL returned by authoritative SEC" first.
* §12 says clicking "opens the exact SEC **filing**".

`document_url` for a consolidated fact is the `data.sec.gov` companyconcept
endpoint, and for a dimensional fact the raw XBRL instance — authoritative
evidence, but raw JSON/XML rather than a filing a person can read. So the click
opens `filing_url`, the exact filing index, and the precise evidence location is
**kept, not discarded**: `document_url`, `evidence_location`
(`<document>#<contextRef>`) and `extraction_method` all travel on the provenance
object and are asserted by
`TestDocumentUrlAndEvidenceLocationArePreserved` (4 tests). §13's requirement is
that the index not be *pretended* to be the exact location; it is not.

When SEC serves an Archives document and no filing index is available, that
document is the click target —
`test_an_archives_document_is_preferred_when_there_is_no_filing_url`.

---

## 9. SECURITY

**STATUS: PASS.** Existing SSRF protections preserved; none weakened.

| Check | Result |
|---|---|
| `javascript:` / `data:` / `file:` | Refused, both sides |
| `localhost`, `127.0.0.1`, `169.254.169.254` | Refused |
| `https://evil.example/Archives/edgar/…` | Refused — path shape does not confer trust |
| `https://www.sec.gov.evil.example/…` | Refused — hostname compared exactly, not by suffix |
| `http://www.sec.gov/…` (plain http) | Refused |
| Untrusted URL in `canonical_url` | Refused; falls through to the next trusted field |
| Model-emitted URL overriding provenance | Refused (`test_a_model_supplied_url_cannot_override_provenance`) |
| Untrusted accession → URL path | Refused (`ACCESSION_RE`, `\A…\Z`) |
| Traversal in an EFTS `_id` | Refused (`edgarFilingUrlFromHit`) |

The frontend keeps `safeUrl` (scheme guard) **and** adds the host allow-list;
the two are layered, not substituted.

---

## 10. TESTS — actual numbers

### gravity-api

```
$ cd services/gravity-api && python -m pytest tests -q
814 passed, 56 skipped, 26 warnings in 455.31s
```

| | Before this change | After |
|---|---|---|
| passed | 758 | **814** (+56) |
| failed | 0 | **0** |

New: `test_source_click_url.py` **43**, `test_source_click_e2e.py` **13**.

```
$ python -m pytest tests/test_source_click_url.py -q      → 43 passed
$ python -m pytest tests/test_source_click_e2e.py -q      → 13 passed (89.23s)
$ GRAVITY_LIVE_SEC=1 python -m pytest tests/live -q       → 29 passed (36.60s)
```

### market-ui

```
$ npx vitest run
Test Files  81 passed | 7 skipped (88)
     Tests  1336 passed | 7 skipped (1343)
```

New: `src/lib/secUrl.test.ts` **39**, `src/components/EdgarLink.click.test.tsx` **15**.

```
$ npx tsc --noEmit -p tsconfig.app.json   → TypeScript: No errors found
```

### market-server

```
$ npx vitest run src/services/edgarFilingUrl.test.ts   → 9 passed
```

### Gates

```
$ node ~/.claude/scripts/gate-guard.mjs   → gate-guard: clean · HEAD..working tree
$ node scripts/graph-lint.mjs             → 8 graph(s), 0 drifted, 0 decorative
$ node scripts/governance.mjs             → 10/10 closed, 14 iterations logged, 0 violation(s)
```

---

## 11. REGRESSIONS — actual numbers

**Zero regressions.** 758 → 814 passing in gravity-api, 0 failing before and
after. market-ui 1336 passing, 0 failing.

Two pre-existing conditions surfaced by installing vitest, neither caused by
this change and neither hidden:

1. **Vitest was never installed.** `package.json` referenced it
   (`eval:loop`) and ~30 `*.test.ts(x)` files imported it, but it was absent
   with no config — the frontend suite **could not be run at all**. It now runs.
2. **Eight of those files are not vitest suites.** They are standalone scripts
   that define their own `check()`, print their own results and call
   `process.exit`. Collecting them yields "No test suite found", which is noise,
   not signal. They are excluded **by name with the reason stated** in
   `vitest.config.ts` and still run under their own runners —
   `gridResearch.sources.test.ts` passes **37/37** via `npx tsx`.
   One genuine pre-existing failure lives in that set:
   `deepResearchService.phase2.test.ts` → **"toCSV pending -> empty field"**, a
   CSV-export assertion unrelated to SEC URLs. **Not fixed here** (unrelated
   area); recorded rather than omitted.

`services/market-server` has **23 pre-existing typecheck errors** in
`rbac.ts` / `orgs.ts` / `deepResearchService.ts` (an unrelated `Cannot find name
'query'`). The count is unchanged by this work and none is in a file it touches.

---

## 12. ACCEPTANCE CRITERION (§18)

```
User clicks source
        ↓  SearchPage passes provenance={citation}
AlphaGravity source object
        ↓  canonical_url resolved server-side by source_click_url()
canonical verified provenance
        ↓  verification_status = "verified"
exact accession
        ↓  0000821189-25-000011
exact SEC filing URL
        ↓  .../data/821189/000082118925000011/0000821189-25-000011-index.htm
browser opens exact filing
        ↓  asserted on HTMLAnchorElement.href after a real click
```

**Met.** Not met by inspection or by asserting the citation object alone: the
component is rendered, the anchor is clicked, and the browser's navigation
target is the assertion — with the resolver endpoint stubbed to 404, as it
really is.

---

## 13. Known limitations, stated

1. **The CompanyPage document drawer still uses the legacy path** (row 13 in
   §7). `GravityDocument` carries no accession, so there is nothing to pass.
   `documents.py:506` stores `accession_number` but the list endpoint does not
   return it; exposing it is a separate change to the documents API.
2. **`/v1/documents/filing-url` still does not exist.** It is no longer needed
   for any path that has provenance, and `EdgarLink` no longer calls it in that
   case. The legacy resolve-by-date branch remains for the "latest 10-K" button
   and will keep failing quietly there, falling back to company search as it
   always has. Building the endpoint was not required to fix the reported bug
   and is not attempted here.
3. **`deepResearchService.phase2` "toCSV pending -> empty field"** is a
   pre-existing failure, unrelated, not fixed.
4. **Nothing is deployed.** Fly deploys remain blocked on billing; every number
   above was measured locally at `655638e` on `verify/multi-entity-live`. The
   branch was not merged and not pushed.
5. **The E2E is fixture-driven, not live.** The EOG fixture is genuine
   (recorded from data.sec.gov on 2026-08-26), but the E2E run itself does not
   open a socket. The separate live suite (29 tests) does, and covers NVDA.

---

## 14. COMMIT / BRANCH

```
COMMIT   655638ec53d896622d184a6033cdcf53045aaf9b   (655638e)
BRANCH   verify/multi-entity-live
PARENT   69dc4df
FILES    25 changed, +3096 / -58
```
