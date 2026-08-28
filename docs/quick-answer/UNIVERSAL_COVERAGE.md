# Quick Answer — universal coverage and the analysis skills

Two phases, executed in that order because the second is worthless without the
first: analyst skills over a 39-ticker corpus are just more ways to print
"No data available".

## The diagnosis

| Claim | Evidence |
|---|---|
| The prose corpus covers 39 tickers | `select count(distinct ticker) from chunks` → 39, 21,610 chunks. Thin, too: GOOG 47 chunks, EA 7, MSFT 321. |
| Numerics were **already** universal | `edgar_search.py` resolves any registrant via `company_tickers.json` → CIK → live XBRL `companyconcept`. Its own docstring: "a company the corpus never covered still gets an exact, citable figure." |
| Qualitative coverage was the gap | No query-time channel fetched filing *text*. `sec_edgar.py` fetches documents, but only as an ingestion poller. |

So "risks, drivers, competition, legal proceedings" — the questions an analyst
actually asks — were answerable for 39 companies and abstained for every other
registrant. The abstention was honest; the coverage was the bug.

**The `/company` screenshot was a separate fault.** `gridResearch.ts:587` is the
no-sources abstention, firing because RAG returned 0 **and** web returned 0. It
also interpolates the whole authored prompt into the message, which is why the
prompt came back at the reader. Not fixed here — a separate defect in a separate
surface, recorded so it is not mistaken for a coverage problem.

What the corpus holds for AMD is worth stating exactly, because "531 chunks"
reads as coverage and is not:

| `filing_type` | chunks | embedded | dates |
|---|---|---|---|
| `document` | 356 | 122 | 2024-12-29 → 2025-12-28 |
| `10-Q` | 120 | 40 | 2026-05-06 |
| `8-K` | 51 | 8 | 2026-02-10 → 2026-05-15 |
| `earnings_transcript` | 4 | 1 | 2026-05-05 |

**No 10-K at all**, and 171 of 531 chunks (32%) carry an embedding — so the dense
channel is mostly blind on AMD even where rows exist. A ticker being "in the
corpus" is not the same as its annual report being there.

## Phase 1 — `edgar_text` channel

`app/core/retrieval/edgar_text_search.py`. Any ticker → CIK → latest 10-K/10-Q →
Item sections → passages carrying the accession, so `citation_provenance`
resolves the exact filing for a paragraph exactly as it already does for a
figure. Nothing is indexed. Sections come from the same `SectionDetector` the
ingestion pipeline uses.

Wiring: `dependencies.py` (composed on `EdgarSearch`, so it exists only when that
does), `orchestrator.py` (registration, dispatch, 25s budget), `fusion.py`
(weight 1.1 — above ingested prose, below every exact-fact channel),
`question_class.py` (routing).

### Defects the live probe found, each now a test

| Defect | Symptom | Fix |
|---|---|---|
| HTTP-layer decoding | Every curly quote and em dash became `�` — SEC serves iXBRL with no charset header | Pass bytes to BeautifulSoup, which sniffs the document's own declared encoding |
| Binary term presence | Scores saturated at 1.0; a water-scarcity question tied four passages and broke the tie on document order | In-filing rarity weighting, plus phrase and density terms |
| Ubiquitous query terms | "coca", "cola" and "risk" are on every page of Coca-Cola's 10-K and outvoted "scarcity" | Weight each term by `1 - df/n` **within that filing** |
| Shared 10s HTTP budget | Multi-MB filings aborted mid-read; a company intermittently had no coverage at all | `DOC_TIMEOUT_S = 20.0` on the document GET only |
| 10-K item names on a 10-Q | MD&A cited as "Properties" — Item 2 means different things per form | `_QUARTERLY_ITEM_NAMES` relabel |
| Both schedules boosted together | "What legal proceedings" hit Item 1 — Legal Proceedings in a 10-Q's Part II, Business in the 10-K being read | `_wanted_items(query, quarterly)` keeps the schedules apart |
| Length filter on sections | Cheesecake Factory's Item 3 is **158 characters** and was discarded as boilerplate | Keep the longest section per item id — drops the table of contents without dropping a terse Item |
| Amendment preferred over the report | AMD filed a 10-K/A the same day as its FY2025 10-K; the newest annual filing won, and a 10-K/A has no Item 1A, so a risk question returned exhibit boilerplate | `forms` is a preference order, scanned in turn — base report first, amendment only when it is the only one |

### Evidence

`python -m eval.quick_answer.live_coverage` — every ticker outside the 39.

```
TXRH   PASS 3 hits ( 7395ms) 10-K  item_1a  Risk Factors                 0001104659-26-021292
PLOW   PASS 3 hits ( 3085ms) 10-K  item_1   Business                     0001437749-26-005316
CAKE   PASS 3 hits ( 4389ms) 10-K  item_3   Legal Proceedings            0001104659-26-018643
WM     PASS 3 hits ( 3611ms) 10-K  item_7   Management's Discussion      0001104659-26-012049
ODFL   PASS 3 hits ( 4969ms) 10-K  item_2   Properties                   0001193125-26-067161
KO     PASS 3 hits ( 3143ms) 10-Q  item_2   Management's Discussion      0001628280-26-050503

6/6 cited from the filer; 6 routed to the expected Item      exit 0
```

Every row carries a real accession and a `document_url` that opens the filing the
passage was read from. Exit code is non-zero on any uncited case, so this is a
gate and not only a report.

## Phase 2 — analysis skills

Four commands that mount nothing. They expand into an authored Quick Answer
prompt and run the ordinary pipeline, so every claim still goes through the same
retrieval, citation and verification path a typed question does.

| Command | Anthropic template it corresponds to | Reads |
|---|---|---|
| `/earnings <ticker>` | Earnings reviewer | latest 10-Q MD&A + XBRL |
| `/risks <ticker>` | (risk review) | Item 1A |
| `/moat <ticker>` | (business & competition) | Item 1 |
| `/research <ticker> [question]` | Market researcher | filings + web, kept apart |

The framing is the skill: someone who types "AMD risks" gets whatever the
retriever ranks first, while these name the Item that answers the question, fix
the shape of the reply, and state the abstention rule. Tests assert every prompt
asks for citations, says what to do when the source is silent, and asks for no
price target, rating or recommendation.

**Not built**, because no service backs them: pitch builder (no deck
generation), model builder and valuation reviewer (no spreadsheet), and the four
back-office templates — GL reconciler, month-end closer, statement auditor, KYC
screener. The three previously blocked commands stay blocked; the skills were
added because a channel now answers them, not by lowering the bar.

The command is what the thread **displays**; the expansion is what goes on the
wire (`runQa(..., prompt)`). Showing the expansion instead is the failure the
Company Brief already shipped once.

### Two routing defects this exposed

Only `/risks` reached the new channel at first.

1. **Class-gated prose.** `/moat` classified `FINANCIAL_TABLE`, `/earnings`
   `FINANCIAL_CALCULATION` — both routed to the XBRL channels and no prose
   channel at all. `_FILING_PROSE_INTENT` in `question_class.py` now adds
   `edgar_text` on the question's own words, whatever the class. A pure figure
   question still does **not** get it, so a revenue lookup does not pay for a
   multi-megabyte download.
2. **The source plan could only veto web.** `route_sources` is documented as
   "authoritative for WEB", but `search_pipeline` only ever *removed* the
   channel. A question the plan routed to WEB still ran without it whenever the
   class had not already added it — every class outside `NEEDS_WEB_RESEARCH` and
   `WEB_AUGMENTED`, which is why `/research` got no web sources.

After both: all four skills route to `edgar_text` and `web`; the numeric control
routes to neither.

## Test results

| Gate | Result |
|---|---|
| `tests/test_edgar_text_search.py` | 44 passed |
| Backend suite | 1265 passed, 56 skipped, **2 failed** — see below |
| `apps/market-ui` vitest | 1425 passed, 0 failed, 7 skipped |
| `tsc --noEmit` (market-ui) | no errors |
| `gate-guard.mjs` | clean; 2 assertions in `commands.test.ts` rewritten at equal or greater strength |
| `live_coverage` | 7/7 cited, 7/7 routed to the expected Item, exit 0 |

The two backend failures are `test_auth_entitlement.py`'s free-tier cases, and
they are **not** from this work. They share a real Redis daily counter keyed
`u-1` that no fixture resets, so repeated full-suite runs exhaust the free tier's
daily quota and the endpoint returns 429 where the test expects headers. The
counter was observed climbing 19 → 23 → 24 across consecutive runs. Both passed
on the first full run of the day. Pre-existing test-isolation defect, left
unfixed because it is outside this scope and fixing it means editing an
unrelated test's assertions.
