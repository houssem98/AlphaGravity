# Quick Answer — Skill Coverage Matrix

Every Quick Answer skill, what it needs, what it returns, and where it stops.
Written from the source, not from the UI: a skill that renders a tab but calls
an endpoint that answers 404 for every company is recorded here as dead, not as
supported.

Date: 2026-08-29 · Branch `feat/web-research-sec-integration`

---

## 1. The allowlist audit

The specification asks whether any skill is limited to a curated set of
companies. The whole repository was searched for the patterns it names.

```bash
grep -rnE "SUPPORTED_COMPANIES|SUPPORTED_TICKERS|KNOWN_TICKERS|COMPANY_ALLOW|ticker (not )?in \[|ticker ==|company ==" \
  --include=*.py --include=*.ts --include=*.tsx services/gravity-api/app apps/market-ui/src
grep -rn "NVDA\|AAPL\|TSLA" --include=*.py services/gravity-api/app
```

Every hit, classified:

| Location | Hit | Verdict |
|---|---|---|
| `app/core/entity_resolver.py` `_ALIASES` (38 entries) | `"apple" -> AAPL` etc. | **Legitimate.** A supplement to fuzzy matching, consulted *after* exact-ticker lookup and *before* fuzzy. Missing from it costs nothing: the resolver's real index is SEC's `company_tickers.json`, roughly ten thousand registrants, loaded at startup. Removing the table would not remove a company; it would make a handful of informal names resolve worse. |
| `app/core/entities/group_aliases.py` | `"FAANG" -> (META, AMZN, ...)` | **Legitimate.** These are names for *groups* — "FAANG", "Mag 7" — which are by definition enumerated lists. Not a gate on individual companies. |
| `app/core/agents/*.py`, `app/core/reasoning/prompts.py` | `"ticker": "AAPL"` | **Docstring / few-shot examples** inside prompt templates. No branch reads them. |
| `app/api/routes/documents.py` | `e.g. AAPL,MSFT,NVDA` | Query-parameter documentation. |
| `app/core/retrieval/edgar_search.py:204,300` | `NVDA's FY2026 ends…` | Comments explaining a fiscal-calendar edge case. |
| `apps/market-ui/src/components/grid/GridView.tsx`, `services/gridTrust.ts` | `c.ticker === 'ALL'` | A sentinel row in the research grid, not a company. |
| `apps/market-ui/src/components/trading/AssetInfoPanel.tsx` | 16 tickers with website/IR links | **A real limitation, out of scope.** A hand-written info panel on the *trading* surface, not on the Quick Answer path. It degrades to no links for other tickers rather than to a wrong answer. Recorded, not fixed — the specification forbids unrelated changes. |

**No accidental company allowlist was found on the Quick Answer path.** What
was found instead is described in §3: Sentiment had no company path *at all*.

---

## 2. The universal architecture

Every skill now runs the same sequence, and none of them contains a company
name:

```
query
  -> entity resolution      app/core/skills/entity.py      RESOLVED | AMBIGUOUS | UNKNOWN
  -> period eligibility     app/core/skills/period.py      REPORTED | NOT_YET_ENDED | NOT_YET_FILED
  -> capability             <skill>.capability()           executable, limitations
  -> execution              <skill>.run()
  -> evidence               SEC channels, read at query time
  -> verification           citation_verdict + period verdict
  -> result                 app/core/skills/contract.py    7 statuses
```

The two properties that make it universal are inherited, not added:

- **`EntityResolver`** indexes SEC's whole ticker file, so any registrant
  resolves.
- **`edgar_search` and `edgar_text_search`** fetch XBRL facts and filing prose
  *at query time*. Nothing has to be ingested first, so the 39-ticker local
  corpus is no longer the ceiling on coverage.

Statuses, and what each is allowed to mean:

| Status | Meaning | May carry a number? |
|---|---|---|
| `success` | answered from evidence | yes |
| `partial` | some parts answered, others named absent | yes, for the answered parts |
| `insufficient_data` | company resolved; evidence does not exist | **no** |
| `ambiguous_entity` | several registrants match | **no** |
| `unsupported_operation` | the skill cannot do this *kind* of thing, for anyone | **no** |
| `conflicting_evidence` | sources disagree; the disagreement is the answer | yes — a conflict is a reading |
| `error` | the skill or a provider failed | **no** |

`unsupported_operation` is the only capability status, and it is about the
operation, never the company. A skill that returns it for `NVDA` must return it
for every ticker.

---

## 3. The matrix

### company — `app/core/skills/company_skill.py`

| | |
|---|---|
| **Inputs** | one mention (ticker, company name, or legal name); period |
| **Required data** | SEC XBRL facts, fetched at query time |
| **Entity support** | ticker · name · legal name · alias · former name; AMBIGUOUS refused |
| **Period support** | `latest`, `FYnnnn`, `Qn YYYY`; future periods abstain before the channel is called |
| **Output** | identity block + 8 metrics, each `reported`, `derived` or **absent** |
| **Evidence** | one citation per filing, carrying accession, `view_filing_url`, `filing_details_url` |
| **Verification** | period verdict attached; every non-absent claim carries citation indexes that exist |
| **Limitations** | `sector` and `industry` are empty — SEC's ticker file does not publish them and nothing else authoritative is wired. Stated as empty rather than filled. Business description and segments are not yet extracted (the prose channel supports it; the skill does not call it). |
| **Tests** | `tests/test_skill_company_sentiment.py` (48 shared with sentiment), `eval/quick_answer_skill_coverage` 15 cases |

**The absence rule.** A metric the filer does not report has *no key* in
`data.financials` and an `absent` claim with `value=None`. It is never `0.0`.
A bank reports no gross profit; a `0.0` there produces a 0% margin and a wrong
peer average, and the test
`test_a_metric_the_filer_does_not_report_stays_absent_never_zero` fails if that
returns.

### sentiment — `app/core/skills/sentiment_skill.py`

| | |
|---|---|
| **Inputs** | one mention; period; optional query |
| **Required data** | filing prose from `edgar_text_search`, fetched at query time |
| **Entity support** | as company |
| **Period support** | as company |
| **Output** | overall label + score, positive / negative / neutral evidence quotes, counts, source mix, window, trend (explicitly `null`), limitations |
| **Evidence** | every quote carries a citation index into a filing citation |
| **Verification** | period verdict; method, evidence threshold and minimum-sentence floor stated in the result |
| **Limitations** | SEC filing language only — no earnings-call, news or analyst channel is wired, and the result says so. No prior-period trend is computed; `trend` is `null` with a note, never 0. Lexicon-based: it measures tone, not accuracy. |
| **Tests** | `tests/test_skill_company_sentiment.py`, `eval/quick_answer_skill_coverage` 16 cases |

**What was actually wrong.** `/sentiment <ticker>` called
`GET /v1/analytics/sentiment/{ticker}`, which is a *cache read* keyed on a
`document_id` the caller had to already hold. It answered 404 for every
company. There was no allowlist because there was no path. The new route is
`GET /v1/skills/sentiment?company=`, and it needs no local document.

**Price is never sentiment.** No market data reaches the module.
`test_no_market_data_reaches_the_sentiment_result` scans the serialized result
for market keys.

**Insufficient and conflicting are real outcomes.** Below `MIN_SENTENCES = 12`
scored sentences the result is `insufficient_data` with *no* score.
Positive and negative shares both above 30% and within 10 points of each other
is `conflicting_evidence` with `overall = "mixed"` — not averaged to neutral.

### filings — `apps/market-ui` CompanyPage tab + `/v1/documents`

| | |
|---|---|
| **Entity support** | ticker |
| **Output** | filing list; each row renders `EdgarLink` |
| **Evidence** | canonical SEC provenance, §4 below |
| **Limitations** | reads the local documents index, so coverage is the ingested corpus rather than all of EDGAR. This is a real coverage limit and is **not** closed by this pass. |

### data — CompanyPage tab

| | |
|---|---|
| **Output** | XBRL financials + longitudinal series |
| **Limitations** | Supabase-backed; anon RLS blocks some tables, so the server-side path is authoritative. Unchanged by this pass. |

### peer-compare — GridView

| | |
|---|---|
| **Inputs** | two or more tickers |
| **Limitations** | runs authored prompts over a named ticker list. Unchanged. |

### earnings · risks · moat · research — `apps/market-ui/src/lib/commands.ts`

Analysis skills. They mount nothing: each expands into an authored Quick Answer
prompt and runs the ordinary pipeline, so every claim goes through the same
retrieval, citation and verification path a typed question does. Universal for
the same reason the others are — `edgar_text` reads the filing at query time.

### screening · capex · tariff-risk

`blocked`, listed rather than hidden, with the reason attached. No service backs
them. These are `unsupported_operation` in the contract's terms: true for every
company.

---

## 4. SEC citation provenance — the two links

Every SEC citation now carries both, and they are never the same page:

```
view_filing_url      https://www.sec.gov/Archives/edgar/data/1045810/
                       000104581026000023/nvda-20260126.htm
filing_details_url   https://www.sec.gov/Archives/edgar/data/1045810/
                       000104581026000023/0001045810-26-000023-index.htm
```

| Field | Source | Rule |
|---|---|---|
| `cik`, `accession` | the evidence itself | validated shape before any URL interpolation |
| `form`, `filing_date`, `period_of_report` | SEC submissions API | |
| `primary_document` | **SEC submissions API `primaryDocument` only** | never inferred from ticker, date, first `.htm`, or file size |
| `view_filing_url` | `primary_document` + archive path | emitted only if it is inside *this* filing's directory, on `https://…sec.gov`, and is a bare `.htm`/`.html` name |
| `filing_details_url` | CIK + accession | deterministic; exists whenever the filing can be named |
| `primary_unresolved_reason` | resolver | set exactly when `view_filing_url` is empty |

`app/core/retrieval/sec_filing_resolver.py` is the only place a primary document
is resolved. `app/core/retrieval/citation_provenance.filing_links()` is the only
place the two links are assembled. `apps/market-ui/src/lib/secUrl.ts` consumes
them and validates independently; it **no longer constructs a SEC URL from a
ticker** — the `browse-edgar?action=getcompany&CIK=<ticker>` fallback is gone,
and with no provenance the component renders nothing.

---

## 5. Channel failure semantics

`ChannelState` is preserved end to end, and the pair that matters is
`EMPTY` vs `FAILED`:

| State | Means | Skill status |
|---|---|---|
| `success` | evidence returned | `success` / `partial` |
| `empty` | provider ran, found nothing | `insufficient_data` — a fact about the company |
| `failed` | provider raised | `error` — a fact about the system |
| `timeout` | provider did not answer in time | `error` |
| `unavailable` | provider could not be constructed | `error` |

A degraded channel never produces a limitation of the form "this company does
not report X". The channel report carries `error_type` only — never the
message, which routinely carries a DSN.

---

## 6. Known limitations, stated rather than hidden

1. **Company has no sector, industry, business description or segments.** The
   fields exist and are empty. SEC's ticker file publishes neither classification;
   the prose channel could supply description and segments and is not wired to
   this skill.
2. **Sentiment reads SEC filings only.** No earnings-call, news, analyst or
   market-derived class is wired. The result states this in `limitations` and in
   `source_mix`.
3. **Sentiment computes no trend.** `trend` is `null` with a note. Producing one
   requires reading and scoring a second filing on the same basis.
4. **`filings` coverage is the ingested corpus**, not all of EDGAR.
5. **The skills are not on the WebSocket answer path.** They are reachable at
   `/v1/skills/{skill}` and the Company page's Sentiment tab consumes the
   sentiment one. A typed Quick Answer question still runs the search pipeline.
6. **`AssetInfoPanel` has a 16-ticker hand-written link table** on the trading
   surface. Out of Quick Answer scope; recorded in §1.
