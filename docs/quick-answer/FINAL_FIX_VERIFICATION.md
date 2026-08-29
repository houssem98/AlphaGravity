# Quick Answer — Ruthless Fix Verification

Every number here came from a command run in this repository on 2026-08-29.
Where a gate could not be run, it says `BLOCKED` and why, rather than being
omitted or estimated.

Branch: `feat/web-research-sec-integration`
Baseline commit: `3ebd1d4`

---

## 0. A tooling warning that affected this work

**RTK's `vitest` filter misreports failures.** During this pass it printed

```
PASS (64) FAIL (0)
```

for a run in which `vitest` itself exited `1` with **10 failing tests**. Every
test result in this document therefore comes from the raw runner, written to a
file, with the real exit code captured:

```bash
npx vitest run src/ > /c/tmp/out.txt 2>&1; echo "EXIT=$?"
```

The same applies to `pytest`: RTK's filter reported `Pytest: No tests collected`
for a run that collected and passed 1270. **Do not gate on RTK output.**

---

## 1. Baseline, before any edit

| Gate | Command | Dir | Exit | Result |
|---|---|---|---|---|
| Backend | `python -m pytest tests/ -q --ignore=tests/live --ignore=tests/eval -p no:cacheprovider` | `services/gravity-api` | 0 | **1270 passed**, 0 failed, 747.25s |
| Frontend | `npx vitest run src/` | `apps/market-ui` | 0 | **1404 passed**, 0 failed |

---

## 2. Final gate table

| # | Gate | Command | Exit | Result | Verdict |
|---|---|---|---|---|---|
| 1 | Backend tests | `python -m pytest tests/ -q --ignore=tests/live --ignore=tests/eval -p no:cacheprovider` | 0 | **1536 passed, 0 failed**, 847s | **PASS** |
| 2 | Frontend tests | `npx vitest run src/` | 0 | **1516 passed, 0 failed, 87 files** | **PASS** |
| 3 | Typecheck | `npx tsc --noEmit -p tsconfig.app.json` | 0 | no errors | **PASS** |
| 4 | Build | `npx tsc -b && npx vite build` | 0 | `dist/` written | **PASS** |
| 5 | Quick Answer eval | `python -m eval.quick_answer.run_eval` | 0 | 30/30, false-confidence 0 | **PASS** |
| 6 | Skill coverage eval | `python -m eval.quick_answer_skill_coverage.run_eval` | 0 | **37/37**, all metrics 1.0 | **PASS** |
| 7 | SEC resolver tests | `python -m pytest tests/test_sec_filing_resolver.py -q` | 0 | 62 passed | **PASS** |
| 8 | Filing-links contract | `python -m pytest tests/test_filing_links_contract.py -q` | 0 | 22 passed | **PASS** |
| 9 | Entity tests | `python -m pytest tests/test_skill_entity.py -q` | 0 | 18 passed | **PASS** |
| 10 | Future-period tests | `python -m pytest tests/test_skill_period.py -q` | 0 | 41 passed | **PASS** |
| 11 | Company + Sentiment skills | `python -m pytest tests/test_skill_company_sentiment.py -q` | 0 | **56 passed** | **PASS** |
| 12 | Verification tests | `test_citation_verdict.py` + `test_quick_answer_adversarial.py` | 0 | 20 + 47 passed | **PASS** |
| 13 | Adversarial pass | `python -m pytest tests/test_quick_answer_adversarial.py -q` | 0 | **47 passed** | **PASS** |
| 14 | **Live SEC matrix** | `python -m eval.quick_answer_skill_coverage.live_sec_matrix` | 0 | **12/12 filings, 5/5 negatives**, both URLs fetched 200 | **PASS** |
| 15 | Performance | `python -m eval.quick_answer_skill_coverage.perf --live` | 0 | measured, §6 | **PASS** |
| 16 | Gate integrity | `node ~/.claude/scripts/gate-guard.mjs` | 0 | `clean · HEAD..working tree` | **PASS** |
| 17 | Lint (changed files) | `npx eslint src/lib/secUrl.ts src/components/EdgarLink.tsx …` | 1 | 3 errors, **identical to baseline**, all pre-existing in `EdgarLink.tsx`; new files clean | **PASS (no regression)** |
| 18 | Browser E2E | — | — | not run; see §7 | **BLOCKED** |
| 19 | End-to-end answer accuracy | — | — | not run; see §7 | **BLOCKED** |
| 20 | **Live skill run against SEC** | `python /c/tmp/live_skill_probe.py` | 0 | **6/6 runs** (3 issuers x 2 skills) against real sec.gov | **PASS** |

Backend delta **1270 → 1536 = +266**, which is exactly the eight new test files
(62 + 22 + 41 + 18 + 56 + 13 + 7 + 47 = 266). No pre-existing test failed, was
skipped, or disappeared; `--collect-only -q` confirms collection matches the
run exactly, so nothing was silently dropped.

Frontend delta **1404 → 1516 = +112**: `secUrlLinks.test.ts` (66),
`sentimentSkill.test.ts` (20), `EdgarLink.click.test.tsx` (15 → 26, **+11**),
and 15 from the pre-existing suites' own parametrisation over the new exports.

---

## 3. The critical SEC fix, proven against sec.gov

`python -m eval.quick_answer_skill_coverage.live_sec_matrix` — **exit 0**, real
network, no credentials needed (sec.gov is public, so a failure here would be a
real failure).

For each of twelve filings it resolves the identity, then **fetches both URLs**
and asserts `View filing` returns 200 and is HTML:

| Issuer | Form | View filing (primary document) | Filing details |
|---|---|---|---|
| NVDA | 10-K | `…/000104581026000021/nvda-20260125.htm` | `…/0001045810-26-000021-index.htm` |
| NVDA | 10-Q | `…/000104581026000075/nvda-20260726.htm` | `…/0001045810-26-000075-index.htm` |
| AAPL | 10-K | `…/000032019325000079/aapl-20250927.htm` | `…/0000320193-25-000079-index.htm` |
| AAPL | 8-K | `…/000032019326000018/aapl-20260730.htm` | `…/0000320193-26-000018-index.htm` |
| TSLA | 10-K | `…/000162828026003952/tsla-20251231.htm` | `…/0001628280-26-003952-index.htm` |
| MSFT | 10-K | `…/000119312526323660/msft-20260630.htm` | `…/0001193125-26-323660-index.htm` |
| JNJ | 10-K | `…/000020040626000016/jnj-20251228.htm` | `…/0000200406-26-000016-index.htm` |
| JPM | 10-Q | `…/000162828026054343/jpm-20260630.htm` | `…/0001628280-26-054343-index.htm` |
| XOM | DEF 14A | `…/000119312526147614/d16317ddef14a.htm` | `…/0001193125-26-147614-index.htm` |
| KO | DEF 14A | `…/000110465926028215/ko-20260429xdef14a.htm` | `…/0001104659-26-028215-index.htm` |
| CPRT | 10-K | `…/000162828025042946/cprt-20250731.htm` | `…/0001628280-25-042946-index.htm` |
| ODFL | 10-K | `…/000119312526067161/odfl-20251231.htm` | `…/0001193125-26-067161-index.htm` |

**12/12 verified.** Ten sectors, four form types, and four filename
conventions — `nvda-20260125.htm` is ticker-dated, `d16317ddef14a.htm` is
Donnelley's, `ko-20260429xdef14a.htm` is Broadridge's, `msft-20260630.htm` came
through a filing agent. A rule that read the filename out of the ticker would be
wrong for two of the twelve; a rule that took the first `.htm` in the directory
would be wrong for most.

**5/5 negative cases refused:**

- an accession the registrant never filed → details-only, with a reason
- a malformed accession → no identity at all
- a wrong CIK for a real accession → no primary URL
- a `browse-edgar` company-listing URL → refused outright
- a caller-supplied `primary_document` → **discarded**; SEC's answer wins

`primaryDocument` values that are not HTML — SEC serves
`xslF345X06/wk-form4_….xml` for Form 4 — are correctly refused, and those
filings offer `Filing details` alone with `primary_unresolved_reason` set.

### Where the rule lives

- `app/core/retrieval/sec_filing_resolver.py` — the only place a primary
  document is resolved, and its only authority is SEC's submissions API.
- `app/core/retrieval/citation_provenance.filing_links()` — the only place the
  two links are assembled.
- `apps/market-ui/src/lib/secUrl.ts` — consumes them, validates independently.

### What the frontend no longer does

`EdgarLink` used to build
`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=<ticker>&type=<form>`
whenever it had no provenance, and label it as the filing. **That code is
gone.** With no provenance the component renders nothing. Two tests pin it:

```
renders no filing link from a ticker alone
returns nothing rather than a company listing when nothing exact exists
```

---

## 4. Universal skills, proven on companies nobody curated

`python -m eval.quick_answer_skill_coverage.run_eval` — **exit 0, 37/37**.

```
entity_accuracy            1.0
period_accuracy            1.0
abstention_accuracy        1.0
citation_validity          1.0
unsupported_claim_count    0
false_confidence_count     0
coverage                   1.0
latency_ms_p50             1.57
latency_ms_p95            27.72
```

Per category — `unseen_company` 12/12, `channel_failure` 6/6, `future_period`
3/3, `legal_name` 3/3, `ambiguity` 2/2, `unknown_company` 2/2,
`citation_validity` 2/2, `missing_metric` 2/2, `annual` 1/1, `quarterly` 1/1,
`conflicting_evidence` 1/1, `insufficient_evidence` 1/1, `no_market_proxy` 1/1.

The issuers are CPRT, ODFL, TPL, EXPD, WSO, LNTH, AOS, JPM, NVDA — nine
registrants, nine sectors. `test_the_issuers_are_not_the_ones_someone_hard_coded`
asserts against the source that none of the `unseen_company` tickers appears in
`_ALIASES` or `group_aliases`, so a passing suite means something.

**Allowlist audit:** the full `grep` sweep the specification names is recorded
in `SKILL_COVERAGE_MATRIX.md` §1. **No accidental company allowlist exists on
the Quick Answer path.** What existed instead was worse and quieter: Sentiment
had *no company path at all* — `GET /v1/analytics/sentiment/{ticker}` is a
cache read keyed on a `document_id` the caller had to already hold, and it
answered 404 for every company. The new `GET /v1/skills/sentiment?company=`
resolves the mention against SEC's whole ticker file and reads the filing at
query time.

---

## 5. The seven honesty invariants

| Requirement | Where enforced | Test |
|---|---|---|
| No fabricated data | `contract.missing()`; an absent metric has **no key** in `financials` | `test_a_metric_the_filer_does_not_report_stays_absent_never_zero` |
| No fabricated sentiment | `MIN_SENTENCES = 12` floor; below it `insufficient_data` with no score | `test_too_little_text_is_insufficient_not_a_confident_neutral` |
| No price-as-sentiment | no market data reaches the module | `test_no_market_data_reaches_the_sentiment_result` |
| No false verified citations | verdict re-applied **after** the provenance `.update()` | `test_a_provenance_transform_cannot_overwrite_a_computed_verdict`, `test_the_pipeline_reapplies_the_verdict_after_the_provenance_update` |
| No future-period confidence | deterministic verdict from period + calendar + filings + date | `test_two_hundred_runs_give_exactly_one_answer`, `test_a_future_verdict_cannot_be_flipped_by_repetition` (500 runs) |
| Provider failure ≠ empty | `ChannelState` `EMPTY` vs `FAILED`/`TIMEOUT`/`UNAVAILABLE` | `test_a_provider_failure_is_an_error_not_an_empty_company` |
| Ambiguity not guessed | margin rule, not absolute score | `test_a_coin_flip_between_two_registrants_is_never_resolved_silently` |
| No mixed-period profile | `pin_to_one_period()`; one fiscal period per profile | `test_a_profile_never_mixes_two_fiscal_years` |

Two real defects were found by these tests and fixed **in the code, not the
test**:

1. `belongs_to_filing` accepted `http://www.sec.gov/...` — a real SEC path over
   a downgradeable connection. Now requires `https`.
2. `classify()`'s ambiguity margin was decided by an unrounded float
   subtraction, putting a gap of exactly the margin on the wrong side by 4e-17.
   A verdict that depends on binary floating point is not a verdict.

A third was found by the eval's own log output: the new skills logged the
provider exception *message*, which routinely carries a DSN. Both now log
`error_type` only.

A fourth — the most serious — was found only by **running the skill against
live SEC**, and no fixture would have caught it. Asking Copart for its `latest`
figures returned:

```
revenue           $1,805,695,000   cited to  cprt07312018-10k.htm     (FY2018)
operating income  $1,696,714,000   cited to  cprt-20250731.htm        (FY2025)
net income        $1,552,449,000   cited to  cprt-20250731.htm        (FY2025)
```

Each metric is fetched independently, so each took the best match SEC returned
for its own concept — and revenue's best match was seven years old. Both
numbers are real, both are correctly cited, and the profile built from them is a
comparison the filings never make. Revenue that predates the operating income
beside it by seven years reads as a collapsing margin that never happened.

`company_skill.pin_to_one_period()` now keeps only the newest fiscal period any
metric resolved to. A metric that exists solely in an older filing moves to the
absent list **with its period named** — `off_period_excluded: {"revenue":
"FY2018"}` — rather than being shown or silently dropped, and the result states
`All figures are from FY2025`. Undated facts are kept, because a missing label
is not evidence of an old period. Eight tests pin it, including
`test_a_profile_never_mixes_two_fiscal_years`.

Re-run live after the fix:

```
CPRT company  status=partial  reported=[eps, net_income, operating_income]
              absent=[Revenue, Gross profit, Cash and equivalents, Total debt,
                      Free cash flow]
              all three cite  .../000162828025042946/cprt-20250731.htm
              LIMIT: All figures are from FY2025.
```

Fewer metrics, one period, one filing. That is the correct trade: a consistent
profile with five gaps named is worth more than an eight-row profile in which
one row is silently from another decade.

---

## 6. Performance — measured, by stage

`python -m eval.quick_answer_skill_coverage.perf --live` — exit 0.

**Skill layer, 60 iterations, evidence injected** (this is the part this work is
responsible for):

| Stage | p50 | p95 | mean | max |
|---|---|---|---|---|
| entity resolution | 0.02 ms | 0.05 ms | 0.02 ms | 0.06 ms |
| period evaluation | 0.04 ms | 0.06 ms | 0.04 ms | 0.18 ms |
| company skill, total | 0.74 ms | 1.61 ms | 1.30 ms | 32.99 ms |
| sentiment skill, total | 2.50 ms | 4.62 ms | 2.89 ms | 20.70 ms |

**SEC round trips, live network** (n=6 each):

| Stage | p50 | p95 | mean | max |
|---|---|---|---|---|
| primary-document resolution, cold | 345.54 ms | 1246.51 ms | 524.16 ms | 1246.51 ms |
| primary-document resolution, warm | 1.42 ms | 30.73 ms | 10.81 ms | 30.73 ms |
| filing-index fetch | 352.44 ms | 942.74 ms | 475.89 ms | 942.74 ms |

The cold/warm split is the cache working: one submissions fetch per registrant
serves every filing that registrant has made, so a page of citations from one
company pays the ~350 ms once.

**Not measured, and not claimed.** Generation, reranking and embedding need
provider credentials; `eval/quick_answer/live_perf.py` owns them. The prompt
records a previously measured p50 of about 28 s for end-to-end Quick Answer.
**Nothing in this pass claims to have moved it** — nothing in this pass touched
generation, and no verification was removed for speed. The SEC enrichment added
by this work is one extra submissions fetch per registrant per hour, ~345 ms
cold and ~1 ms warm, which is the honest cost of not guessing a filename.

---

## 7. BLOCKED and UNVERIFIED — stated, not hidden

**`BLOCKED` — browser E2E (Phase 16).** No browser was driven against a running
stack in this session. The stack needs Supabase credentials for auth, and the
session is non-interactive. What *was* proven programmatically is the part the
phase cares about most: `View filing` and `Filing details` resolve to different
real SEC pages, and both were fetched and returned HTTP 200 with the primary
confirmed to be HTML (§3). The DOM behaviour — that two distinct anchors render
with those hrefs, correct labels, and that the document link is absent when the
primary is unresolved — is covered by 26 real-DOM tests in
`EdgarLink.click.test.tsx`, which mount the component, click the anchor, and
assert the navigation target. The *visual* result was not observed.

**`BLOCKED` — end-to-end financial answer accuracy.** Needs live LLM and
reranker credentials and a live corpus. No accuracy figure is claimed.

**Now verified — the skills against live SEC.** Both skills were run against
the real sec.gov for three registrants that appear in no alias table. All six
runs succeeded; the period-mixing defect in §5 is what this run found.

| Issuer | Skill | Status | Result |
|---|---|---|---|
| CPRT | company | `partial` | 3 metrics, all FY2025, all citing `cprt-20250731.htm` |
| CPRT | sentiment | `success` | `neutral`, 72 scored sentences, 12 citations |
| ODFL | company | `partial` | operating income, net income, EPS, cash, FCF from FY2025 |
| ODFL | sentiment | `success` | `positive`, 71 scored sentences |
| AOS | company | `success` | all 8 metrics, `absent=[]`, FY2025 |
| AOS | sentiment | `success` | `negative`, 74 scored sentences |

Every sentiment run reported `source_mix: {'sec_filing': N}` and carried both
SEC URLs, e.g. `…/000009114226000008/aos-20251231.htm` and
`…/0000091142-26-000008-index.htm`. Live latency was 10–27 s per call,
dominated by the SEC round trips in §6.

**`PARTIAL` — Company skill completeness.** `sector`, `industry`, business
description and segments are **empty**, not populated. SEC's ticker file
publishes no classification; the prose channel could supply description and
segments and is not wired. Stated as empty rather than filled from a guess, and
recorded in `SKILL_COVERAGE_MATRIX.md` §6.

**`PARTIAL` — Sentiment source classes.** SEC filing language only. No
earnings-call, news, analyst or market-derived class is wired. The result says
so in `limitations` and `source_mix`, and computes no trend (`trend: null` with
a note, never 0).

**`PARTIAL` — skills are not on the WebSocket answer path.** They are reachable
at `/v1/skills/{skill}` and the Company page's Sentiment tab consumes the
sentiment one. A typed Quick Answer question still runs the search pipeline —
which is where the SEC two-link provenance now flows, via
`search_pipeline.py:1172` (sources) and `:2541`/`:2611` (citations).

**Out of scope, recorded not fixed.** `AssetInfoPanel.tsx` holds a hand-written
16-ticker table of website/IR links on the *trading* surface. It degrades to no
links for other tickers rather than to a wrong answer, and it is not on the
Quick Answer path.

---

## 8. Files

Modified (8):

```
apps/market-ui/src/components/EdgarLink.tsx
apps/market-ui/src/components/EdgarLink.click.test.tsx
apps/market-ui/src/lib/secUrl.ts
apps/market-ui/src/pages/CompanyPage.tsx
services/gravity-api/app/core/retrieval/citation_provenance.py
services/gravity-api/app/core/retrieval/edgar_search.py
services/gravity-api/app/core/retrieval/edgar_text_search.py
services/gravity-api/app/main.py
```

Added (26):

```
apps/market-ui/src/lib/secUrlLinks.test.ts
apps/market-ui/src/lib/sentimentSkill.ts
apps/market-ui/src/lib/sentimentSkill.test.ts
services/gravity-api/app/api/routes/skills.py
services/gravity-api/app/core/retrieval/sec_filing_resolver.py
services/gravity-api/app/core/skills/__init__.py
services/gravity-api/app/core/skills/contract.py
services/gravity-api/app/core/skills/entity.py
services/gravity-api/app/core/skills/period.py
services/gravity-api/app/core/skills/company_skill.py
services/gravity-api/app/core/skills/sentiment_skill.py
services/gravity-api/eval/quick_answer_skill_coverage/__init__.py
services/gravity-api/eval/quick_answer_skill_coverage/cases.json
services/gravity-api/eval/quick_answer_skill_coverage/run_eval.py
services/gravity-api/eval/quick_answer_skill_coverage/live_sec_matrix.py
services/gravity-api/eval/quick_answer_skill_coverage/perf.py
services/gravity-api/tests/test_sec_filing_resolver.py
services/gravity-api/tests/test_filing_links_contract.py
services/gravity-api/tests/test_skill_period.py
services/gravity-api/tests/test_skill_entity.py
services/gravity-api/tests/test_skill_company_sentiment.py
services/gravity-api/tests/test_skills_route.py
services/gravity-api/tests/test_skill_coverage_eval_gate.py
services/gravity-api/tests/test_quick_answer_adversarial.py
docs/quick-answer/SKILL_COVERAGE_MATRIX.md
docs/quick-answer/FINAL_FIX_VERIFICATION.md
```

---

## 9. The final acceptance question

> Give Quick Answer a company that was not in a hard-coded test alias list. Ask
> Company and Sentiment questions over valid periods. Require citations. Click
> the SEC citation. Does it resolve to the exact filing document? If evidence
> does not exist, does the system clearly say so instead of inventing an answer?

**Company not in any alias list:** COPART (`CPRT`), and six more. Both skills
execute; `test_the_issuers_are_not_the_ones_someone_hard_coded` proves against
the source that they are not curated.

**Citations:** every non-absent claim carries citation indexes that exist —
asserted on every eval case, `unsupported_claim_count: 0`.

**Does the SEC citation resolve to the exact filing document?** Yes, proven by
fetching it:

```
View filing     https://www.sec.gov/Archives/edgar/data/900075/
                  000162828025042946/cprt-20250731.htm      HTTP 200, HTML
Filing details  https://www.sec.gov/Archives/edgar/data/900075/
                  000162828025042946/0001628280-25-042946-index.htm   HTTP 200
```

**Does it say so when evidence does not exist?** Yes, and it distinguishes four
different ways of not knowing: `insufficient_data` (the evidence does not
exist), `ambiguous_entity` (the company is not determined), `error` (the
provider failed — never rendered as an absence of disclosure), and the period
verdict `not_yet_ended` / `not_yet_filed` (the period cannot have been reported).
`false_confidence_count: 0` across 37 eval cases and 47 adversarial tests.

**Remaining honest gaps:** the browser leg and end-to-end answer accuracy are
`BLOCKED` on credentials; the skills' live behaviour against sec.gov is
`UNVERIFIED`; Company's sector/industry/description and Sentiment's non-SEC
source classes are `PARTIAL` and say so in their own output.
