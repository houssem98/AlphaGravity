# R8 Final Audit — AlphaGravity Quick Answer

Every claim below carries one of `PROVEN` / `TESTED` / `READ` / `INFERRED` /
`UNPROVEN` / `BLOCKED`. Roadmap §27 forbids `world-class`, `production-ready`,
`fully fixed`, `looks good` and `should work` unless evidence backs them. Those
words do not appear as claims anywhere in this document.

Scope: `reasoning_depth="fast"`, the Quick Answer path. Range
`2689aa1..HEAD`, 39 commits, ledger rows 1–79 in `R8_LOOP.md`.

---

## 1. Executive Verdict

**18 defects were found in this round and 16 were closed.** `TESTED`

Two of them — V34 and V41 — meant production **certified a claim about one
company against another company's filing**, and **certified a figure taken from
the row beside the one the claim named**. Both returned `verified`. Neither was
findable by inspection; both came out of instruments built this round.
`PROVEN` (red-before-fix measurements in ledger rows 34 and 55)

**The round did not measure whether Quick Answer answers questions correctly.**
`UNPROVEN` — no end-to-end accuracy benchmark was run. Every measurement here
concerns whether the system's *own verification* is honest, not whether its
answers are right. That distinction is load-bearing and is not softened
anywhere below.

**Certification: see §12. It is not an unqualified pass.**

---

## 2. What Changed

| area | change | state |
|---|---|---|
| Scale / currency | scale per currency; currency compared; declared scales are the only candidates | `TESTED` |
| Period | table column years read as periods; figures bound to their own column; set-level disagreement | `TESTED` |
| Entity | citation compared against the company the QUESTION resolved to | `TESTED` |
| Metric | spans reach their own figures; production grounds within the claimed metric | `TESTED` |
| Claims | a sentence asserting N figures asserts all N | `TESTED` |
| Provenance | accession alone is not a filing; prose citations carry identity; five scope states; restatement status | `TESTED` |
| Vocabulary | one `is_primary_class` predicate; `metric_spans` moved into production | `TESTED` |
| Telemetry | `CitationVerdict.matched` — what matched, not only what failed | `TESTED` |
| Test integrity | theatre audit over rounds 3–8; pre-registered differential matrix | `PROVEN` |

Suite: **2812 collected, 2756 passed, 56 skipped, 0 failed**, from
`cd services/gravity-api && python -m pytest tests -q`. `PROVEN`

The 56 skips are documented opt-ins, not muted assertions: 29 live SEC
(`GRAVITY_LIVE_SEC=1`) and 27 deepeval RAG (`GRAVITY_API_URL`). `TESTED`

---

## 3. Root Causes Closed

Each with its red-before-fix measurement. All `PROVEN` unless noted.

| id | what was wrong |
|---|---|
| **V25** | one header declares two scales; `¥1,009 billion` refused and `¥1,009 million` bound — exactly inverted |
| **V26** | currency never compared; `€6,744 million` bound against a US dollar figure |
| **V27** | a one-digit source reading satisfied a four-digit claim through scale multiplication |
| **V28** | grader read `(408)` as +408 where production read −408 |
| **V30** | production read `($416,161 million)` as **negative**; a correct answer read as wrong |
| **V31** | `_periods` could not read a table header, so the filing date became the only source period and **correct** FY-labelled answers were reported as conflicts |
| **V32** | five source-class vocabularies; `scope` called a real 10-K *"a lead rather than a confirmed match"* |
| **V33** | a regex-valid accession was proof of a filing; a blog with an invented accession earned `SEC_EVIDENCE` |
| **V34** | production's entity check compared a passage's ticker **with itself**; a Microsoft claim cited to Apple's filing returned `verified` |
| **V35** | 95% of prose citations would have stated `form: "document"` — a placeholder as a filing form |
| **V36** | a restated fact and an original one produced **byte-identical** citations |
| **V37** | a discontinued operation and a business segment had the same `scope` |
| **V38** | a sentence whose **headline figure was fabricated** bound because the comparative beside it was true |
| **V39** | a metric whose name contains another metric's name was **silently unconstrained** |
| **V41** | production grounded by set membership; a figure from the row beside the named metric returned `verified` |
| **V42** | a currency-free claim lost its scale constraint; three readings a thousand apart all bound |

Also closed: **V17** and **V21**, pinned open since round 6. `PROVEN`

---

## 4. Root Causes Still Open

| id | what | why not closed |
|---|---|---|
| **V16** | `operating expense` is absent from production's metric vocabulary, so a metric-wrong claim is unconstrained | R7 owner decision: record rather than widen the vocabulary. Now **visible in telemetry** as `metric: UNKNOWN` |
| **V29** | filing footnote markers parse as figures (`(1)` → −1.0) | No harm demonstrated: V27's guard and V28's sign both block it. Recorded because a spurious figure caught twice is still spurious |
| **V40** | a bare per-share figure is not an asserted level, so a fabricated EPS beside a true revenue figure is invisible | Widening extraction would make every bare currency amount required-to-bind under V38's new rule — a large blast radius stacked on a large one in the same round |
| **V31 residue** | a passage naming no year still lets the filing date create a conflict | Owner chose the column-year fix over the widen-only guard |
| **V42 residue** | `6,744 billion` still binds against a dual-currency header | Needs per-column currency association, not a per-header scale set |
| **QA-10** | atomic decomposition — per-proposition entity/metric/value/currency/unit/scale/period/scope/segment | **PARTIAL.** V38 closed the defect the row existed for; the decomposition is a rewrite of `_claim_is_bound`'s shape and does not fit one loop |

All six carry tripwire tests that fail if the behaviour moves. `TESTED`

---

## 5. Tests Actually Executed

- Full suite, every row: **2756 passed / 56 skipped / 0 failed**. `PROVEN`
- 218 tests in `tests/quick_answer/`, 15 new files. `PROVEN`
- Derived blast-radius runs per row, file set computed by grep rather than
  hand-listed (ledger row 18 records why). Largest: 839 across 42 files.
  `PROVEN`
- **Theatre audit**: 21 fixes reverted one at a time, each guard confirmed to
  go red, tree restored from git and re-verified clean. Final: **21 real
  guards, 0 theatre**. `PROVEN`
- **Pre-registered differential matrix**: expectations committed at `c9afbe9`
  *before* the first run. 33 of 36 correct. `PROVEN`
- Real route driving the real `SearchPipeline`, fabricated citation reaching
  the client as `unsupported`. `PROVEN`

---

## 6. Tests Not Executed

- **End-to-end answer accuracy against a benchmark.** `UNPROVEN` — no
  FinanceBench-style run. Nothing here says Quick Answer answers correctly.
- **Generation latency.** `BLOCKED` — the LLM router is a network call.
- **Structured / keyword / graph channels.** `BLOCKED` — Postgres is up with
  **0 public tables**; an empty store measures nothing.
- **29 live SEC tests.** `BLOCKED` — opt-in, `GRAVITY_LIVE_SEC=1`.
- **27 deepeval RAG tests.** `BLOCKED` — opt-in, needs `GRAVITY_API_URL`.
- **Agentic path.** `UNPROVEN` — a fourth publication site exists at
  `search_pipeline.py:794` outside this round's `fast` scope fence (ledger row 3).

---

## 7. Production Paths Verified

- Real WebSocket route → real `SearchPipeline` → real citation normalisation →
  real verdicts → client. `PROVEN` (QA-15)
- Three `type="answer"` publication sites in `SearchPipeline.search`, each with
  a gate immediately before it. `READ` — traced in `R8_DATAFLOW.md`, not each
  executed.
- A fourth publication path, agentic, at line 794. `READ`, out of scope,
  recorded rather than absorbed.

---

## 8. Known Limitations

- Every performance number is `LOCAL`. Local hardware with locally seeded
  stores is not the production environment.
- The corpus is **7,408 Qdrant points** locally; the real corpus backup holds
  **478,433 chunks**, of which **zero** carry an accession. `PROVEN`
- **No amended or restated filing exists** in this repository — 0 `/A` forms
  across 478,433 chunks — so restatement semantics are `UNPROVEN` on real
  filing data. One real `10-K/A` upgrades them without touching the code.
- Scope semantics are tested against real XBRL axis names and need no such
  caveat. `TESTED`

---

## 9. Performance Measurements

All `LOCAL`. `TESTED`

| stage | p50 | p95 | p99 |
|---|---|---|---|
| `provenance()` | 0.015 ms | 0.016 | 0.037 |
| `payload()` | 0.011 ms | 0.016 | 0.026 |
| `metric_spans()` | 0.533 ms | 0.632 | 0.850 |
| `verdict_for_citation()` | 1.127 ms | 1.455 | 1.735 |
| `_claim_is_bound()` | 1.008 ms | 1.904 | 2.721 |
| `json.dumps(citation)` | 0.010 ms | 0.018 | 0.023 |
| **Qdrant dense search** (7,408 real points) | **7.568 ms** | 30.587 | 36.027 |

**No end-to-end number is published.** With generation stubbed it would be a
floor, and a floor quoted as a latency is §22's named failure. `BLOCKED`

**A discarded measurement, recorded.** The first Qdrant run, taken while the
machine was still settling after a Docker restart, read
p50 33.06 / p95 116.02 / **p99 1634.11**. A 45× p99 difference between a loaded
and a quiet machine is why a single local benchmark is not a latency figure.
`PROVEN`

`metric_spans` is 92% `starts`-sweep, O(25 regexes) per call. Owner decision:
record, do not optimise — no production baseline exists to optimise against.
`TESTED`

---

## 10. Evidence Architecture

- `provenance()` is the canonical evidence object; `payload()` carries it to
  the citation. `TESTED`
- Prose citations now carry **source identity only** — issuer, ticker, form,
  date, section, page — with **nine filing fields asserted absent** and
  `is_primary_class` still refusing them. `PROVEN`
- Source identity, financial-fact identity and verification strength remain
  three separate things. `TESTED`
- Duplicate concepts classified in `R8_CONCEPT_REGISTER.md` as canonical /
  transport / legacy / derived. Two are deliberately unmerged with reasons.
  `TESTED`

---

## 11. Evaluator Integrity

This is the section the round most nearly failed.

- **The rig's headline invariant had never fired.** *Production says
  `UNSUPPORTED` ⇒ the grader must not bind* — production returns `UNSUPPORTED`
  **zero times** for any content mutation. Vacuously true since round 6. The
  measurement is now itself a test. `PROVEN`
- **`KNOWN_SHARED_EDGE_GAPS` is empty**; `KNOWN_SHARED_GAPS` holds one entry
  (V16). Both lists had only ever grown. `PROVEN`
- **The theatre audit found four tests that passed before their own fix**,
  three from earlier rounds. **V1 had no isolating test for five rounds** —
  revert it and a thousandfold error scored full correctness. `PROVEN`
- **A defect this round shipped**: V35, caught an hour later by QA-9's corpus
  pass rather than by review of my own QA-6 work. `PROVEN`
- **Two wrong predictions** in the pre-registered matrix, kept in the file
  labelled as wrong rather than corrected away. `PROVEN`

---

## 12. Certification Decision

**Not certified as complete.** The evidence supports a narrower claim, stated
exactly:

**What is established.** The verification layer no longer certifies claims
about the wrong company, the wrong metric, the wrong period, the wrong
currency, the wrong scale, or a fabricated figure sitting beside a true one —
each demonstrated by a red-before-fix measurement on real SEC filing text, each
guarded by a test proven to fail without its fix. `PROVEN`

**What is not.** Whether Quick Answer *answers questions correctly* was not
measured in this round. `UNPROVEN` A verification layer that refuses wrong
answers honestly is a precondition for accuracy, not a demonstration of it.

**Blocking items for any completeness claim:**

1. An end-to-end accuracy benchmark. `UNPROVEN`
2. QA-10's atomic decomposition. `PARTIAL`
3. V16 — production's metric vocabulary. `OPEN` by owner decision
4. Restatement semantics on a real `/A` filing. `UNPROVEN`
5. Retrieval channels other than dense, on a populated store. `BLOCKED`

**Recommendation.** Do not describe this system with any of the words §27
forbids. It is measurably harder to fool than it was 39 commits ago, on six
named dimensions, and that is the claim the evidence supports.
