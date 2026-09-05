# R8 QA-17 — the duplicate-concept register

Roadmap §24: classify every duplicate concept as **canonical**, **transport**,
**legacy** or **derived**, and write it down. §24 also forbids cosmetic
refactoring, so nothing here is renamed for tidiness — each row says what the
duplicate *is*, and only the ones that were actively wrong were changed.

This round is unusually well placed to write this, because five of its defects
were duplicate concepts disagreeing with each other rather than any single
piece of code being wrong.

---

## 1. Source class — five lists, now one predicate

| where | classification | note |
|---|---|---|
| `answer_contract.SourceClass` enum | **canonical** | the vocabulary |
| `research/evidence.py` — `SEC_EVIDENCE` / `LOCAL_EVIDENCE` / `WEB_EVIDENCE` | **transport** | the wire values a frontend branches on |
| `answer_contract.is_primary_class` | **canonical** | THE predicate, since QA-3 |
| `skills/scope.PRIMARY_CLASSES` | **derived** | now a view of the predicate, was a rival list |
| `rubric._PRIMARY_CLASS_NAMES` | **derived** | now delegates |
| `source_tier._TIER` | **separate concept** | a *source_type* tiering, not a source class. Left alone deliberately |

**What was wrong:** `scope` did not contain `SEC_EVIDENCE`, the string
`payload()` actually stamps, so a real 10-K was classified
`SECONDARY_CANDIDATE`. `edgar` and `edgar_text` were **channel names** in a
source-class set, and `xbrl` was a *source_type*. Closed in QA-3 (V32).

---

## 2. Metric spans — two copies, now one module

| where | classification |
|---|---|
| `app/core/verification/metric_spans.py` | **canonical**, since QA-12 |
| `rubric._metric_spans` / `_metric_keys` / `_ROW_LABEL` | **derived** — imports the above |
| `query_plan._METRIC_RES` | **canonical** — the metric vocabulary itself |

**What was wrong:** the evaluator had span logic and production had none, so
`citation_verdict` grounded figures against every number in a passage. V41.

---

## 3. Scale and currency — production owns them, the evaluator imports

| symbol | classification |
|---|---|
| `citation_verdict.declared_scale` / `declared_scales` | **canonical** |
| `citation_verdict.currencies_in` / `currency_of` | **canonical** |
| `citation_verdict.column_years` | **canonical**, added in QA-8 |
| `citation_verdict._periods` / `_periods_disagree` | **canonical** |
| the evaluator's uses of all of the above | **derived** — imported, not copied |

This is the arrangement the round standardised on: **production defines, the
evaluator imports**. Every duplicate that caused a defect this round was one
where that had not been done.

---

## 4. Number extraction — two readers, deliberately still two

| where | classification | why not merged |
|---|---|---|
| `nli_verifier._extract_numbers` | **canonical** for production | |
| `rubric._readings` | **parallel, reconciled** | it returns `(value, explicit)` pairs the grader needs and production does not |

**Not merged, and that is a decision rather than an omission.** They were
reconciled on *sign* in V28 and on the prose-parenthetical rule in V30, and a
test compares them directly so they cannot drift apart again. Merging the
shapes would be the cosmetic refactoring §24 forbids.

**Known residue:** V40 — `_ASSERTED` does not match a bare per-share figure, so
`$10.12` never becomes an asserted level. Recorded, not fixed.

---

## 5. Verification status vocabularies

| where | classification |
|---|---|
| `citation_verdict` — `VERIFIED` / `PARTIALLY_SUPPORTED` / `UNSUPPORTED` / `CONFLICTING` / `NOT_VERIFIABLE` | **canonical** |
| the citation's `verification_status` / `is_verified` | **transport** |
| the FILING's `verification_status` inside `payload()` | **legacy name collision** |

**The collision is real and is guarded rather than renamed.** `payload()`
carries a `verification_status` meaning *was this FILING verified against the
filer*, which is a different question from *does this source support this
claim*. `test_quick_answer_adversarial` pins that a provenance update cannot
overwrite a computed verdict. Renaming it is an outward-facing wire change and
was not done for tidiness.

---

## 6. Scope and restatement

| symbol | classification |
|---|---|
| `provenance()["scope"]` — consolidated / segment / geographic / continuing / discontinued | **canonical**, five states since QA-9 |
| `provenance()["restated"]` (bool) | **legacy** — superseded by the below, kept for existing readers |
| `provenance()["restatement_status"]` — ORIGINAL / RESTATED / AMENDED / UNKNOWN | **canonical**, since QA-9 |

`restated` is a bool that cannot express UNKNOWN, which is why
`restatement_status` exists. It is **legacy, not derived**: it is still written
and still read, and removing it is a separate change with its own blast radius.

---

## 7. What this register does NOT claim

- It covers the Quick Answer path. Ingestion, retrieval channels and the UI
  have their own duplicates and were not surveyed.
- `source_tier._TIER` is listed as a separate concept because that is what it
  is; if it later grows a source-*class* meaning it becomes a sixth vocabulary
  and belongs in section 1.
- Nothing here was renamed. §24 forbids cosmetic refactoring, and the only
  changes this round made to duplicates were the ones that fixed a measured
  defect: V32, V41, and the QA-8 scale/period imports.
