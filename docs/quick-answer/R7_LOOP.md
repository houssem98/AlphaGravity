# Round 7 — the canonical evidence layer

Branch `feat/web-research-sec-integration`. Baseline `de74147` (2497 passed).
Successor to `docs/quick-answer/R6_LOOP.md`, which closed the grader work and
said the next move is the system, not the measurement instrument.

Invocation: **`/loop Execute docs/quick-answer/R7_LOOP.md`**

---

## 1. The finding this round is built on

The sixth audit asked for a canonical evidence object:

> Introduce a canonical financial Quantity/Evidence object that survives from
> retrieval → citation → claim binding, instead of reconstructing financial
> meaning from citation text.

```
EvidenceFact
 ├─ entity      ├─ unit       ├─ segment
 ├─ metric      ├─ scale      ├─ filing/accession
 ├─ value       ├─ period     ├─ section
 ├─ currency    ├─ scope      └─ evidence_id
```

**It already exists.** `app/core/retrieval/citation_provenance.py:68` opens
with the words *"The canonical evidence object for one passage"*, and it is
populated with 21 fields including every financial one the audit lists but
`scale`.

*(The first draft of this file counted nine dropped fields. It is ten —
`scope` is in the object as well, and was dropped with the rest. Corrected
here rather than quietly, because the count is the round's headline number.)*

**Then one function throws the financial half away.** `payload()` — line 241,
what `search_pipeline` attaches to a citation with
`citation.update(citation_provenance.payload(_prov))` — emits identity and
URLs, and drops the rest. Measured, on an Apple FY2025 revenue fact:

```
provenance()                              payload() → the citation
  value            416161000000             DROPPED
  unit             'USD'                    DROPPED
  xbrl_concept     'RevenueFrom…Tax'        DROPPED      ← the metric
  scope            'segment'                DROPPED
  dimension        ['srt:ProductOr…Axis']   DROPPED
  dimension_value  ['us-gaap:ProductMember']DROPPED      ← the segment
  period_start     '2024-09-29'             DROPPED
  period_end       '2025-09-27'             DROPPED
  fiscal_year      '2025'                   DROPPED
  fiscal_quarter   None                     DROPPED

  10 of 10 financial fields dropped. `fiscal_period` survives as the
  rendered label "FY2025"; nothing else does.
```

So `verdict_for_citation` and `eval/head_to_head/rubric.py` receive a citation
carrying an accession, a URL and some prose — and have no choice but to recover
the metric, the value, the unit, the scale and the period by running regexes
over the passage text.

**R7 is therefore not "build an object". It is "stop dropping the one that
exists, and teach the two readers to use it."** That is a materially smaller
round than the audit assumed, and its first row is one function.

---

## 2. Goal

**A citation that carries fields is graded from its fields, never from its
prose.**

The metric is the share of graded citations carrying a populated evidence
object, and it starts at **0**.

The round is done when, on the structured/XBRL path:

```
Claim ──supports──> EvidenceFact          not
Claim ──regex over rendered text──> a number that might be the right one
```

---

## 3. Why this and not another grader round

Rounds 1–6 produced twenty-three numbered defects. Sorted by where they live,
the pattern is not subtle:

| Where | Defects |
|---|---|
| Re-deriving a figure's magnitude from text | V1, V14, V15, V19 |
| Re-deriving which metric a figure belongs to | U3, V12, V16, V21 |
| Re-deriving which period a figure belongs to | V17 |
| Re-deriving what is a figure at all | V20, V23 |

Every one is the same sentence: *the fields existed upstream and were thrown
away.* **V23, found while writing this file, is the class in miniature** — the
exact-fact renderer wrote `($416.16B)` for "also expressed as", filings write
parentheses for negative, so every fact ≥ $1M stated a negative it does not
hold, and partly-covered claims on the ground-truth channel were promoted to
`conflicting`. No object would have made that reachable.

**This is the last round that may fix one of these with a regex.** A row here
proposing a new pattern, a new vocabulary list or a new special case is
answering the wrong question, and the audit's standard — *"the smallest
architectural move that attacks the underlying class of failures rather than
another symptom"* — is what the row is held to.

---

## 4. The evals, both, every loop

```bash
cd services/gravity-api
.venv/Scripts/python.exe -m pytest tests/ -q --ignore=tests/live --ignore=tests/eval
node ~/.claude/scripts/gate-guard.mjs
```

Baseline **2497 passed** at `de74147`. Runs take 10–16 minutes; pytest buffers
its dots, so an empty output file is not a hang. Background it and let the
harness report completion — never a `sleep` loop.

**The round inherits its instruments rather than rebuilding them:**

- `tests/test_grader_agrees_with_production_verifier.py` — the differential rig.
  Its hand-declared `Fact` is a stand-in for the real object; when a citation
  carries fields, the rig grades those, and `KNOWN_SHARED_GAPS` /
  `KNOWN_SHARED_EDGE_GAPS` must **shrink**, never grow. Each entry removed is a
  row closed here.
- `tests/test_structured_fact_round_trip.py` — the `fields → text → regex`
  round trip, measured on the channel fusion weights treat as ground truth.
- `tests/test_provenance_mutation_rig.py` and
  `tests/test_gate_accepts_real_pipeline_citations.py` — both pin what
  `payload()` writes, and this file predicted **row E1 will move them**. It
  did not: both pin a hardcoded literal citation rather than asserting
  `payload()`'s exact key set, so an additive change is invisible to them.
  Recorded because a prediction that misses is worth as much as one that
  lands — the gate-shrink escalation E1 was braced for was not needed.
  `tests/test_filing_links_contract.py` and `tests/test_source_click_url.py`
  assert named keys for the same reason and were likewise unmoved.

**A row is not closed by a passing test it also wrote.** State which existing
assertion changed verdict, or which pinned gap was removed.

---

## 5. Rows

**E1–E3 are the round; E4–E6 are the payoff and depend on it.**

### E1 — stop dropping the fields

`payload()` carries the financial half of `provenance()` through to the
citation: value, unit, `xbrl_concept`, dimension, dimension_value, and the four
period fields. Nothing is computed; the fields are copied.

Deliverable: the fields on the citation, and the measurement in §1 re-run to
show 9 of 9 surviving instead of 0.

**Two things to get right, and they are the whole row:**

- **Additive only.** `payload()` output is a frontend contract with tests
  pinning it. Adding keys must not rename or remove one.
- **Empty for prose.** `provenance()` already returns `None` for a passage
  without an accession, and `payload()` already returns `{}` for that. Prose
  chunks, news and web results must keep carrying nothing — a citation that
  invents fields is worse than one that carries none, and is the failure this
  round exists to remove, re-created one layer up.

### E2 — the scale, which is the one field genuinely missing

Of the audit's twelve, `scale` is the only one `provenance()` does not hold.
XBRL values are absolute — 416161000000, not 416161 with a `(in millions)`
header — so on this path `scale` is 1 and the field is honest rather than
inferred. The header-derived scale that V14 and V19 read from prose belongs to
the text path and must not be back-filled onto facts that do not need it.

Deliverable: `scale` present and explicitly 1 on XBRL-sourced facts, plus a
test that nothing infers a scale for them.

### E3 — grade from the fields when they are there

`verdict_for_citation` learns one branch: a citation carrying an evidence
object is compared field to field — value, unit, scale, period, metric — and
the text path is skipped. The text path stays unchanged for every citation that
carries no fields.

Deliverable: the branch, plus a demonstrated verdict change on the
structured path.

~~**V16 and V17 are the two that should fall here.**~~ **They do not** — see
ledger row 8. V16 needs a concept-to-English map to compare an XBRL tag
against a claim written in prose, which is the vocabulary §7 forbids; it
needs the CLAIM to carry a metric, so it is E5. V17 is the grader not
looking at periods at all, so it is E4. E3 makes production's period
evidence authoritative and stops there.

**Escalate before landing.** This changes what production calls verified.
Done: the metric question and the fields-vs-text scope were both owner
decisions before the row landed.

### E4 — the grader stops re-parsing too

`eval/head_to_head/rubric.py` reads the fields when the citation carries them.
The audit's phrase for the target state is that the grader becomes *boring*.

Deliverable: `KNOWN_SHARED_GAPS` and `KNOWN_SHARED_EDGE_GAPS` measurably
smaller, each removal named.

### E5 — V21, which needs claims and not just evidence

`edge-metric-figure-transposed` survives because `_claim_is_bound` works per
SENTENCE, not per proposition — its own T9 caveat. `Claim ──supports──>
EvidenceFact` is the half of the audit's diagram this round has not built.

Deliverable: decomposition of a multi-proposition sentence into claims, each
binding on its own. **This is the largest row and may not fit one loop.** If it
does not, say so and stop — do not half-build it.

### E6 — the reference set

Still the highest-leverage human action, still blocking certification since
round 1, and **still not something a loop can produce**. Recorded here so the
round does not quietly pretend the other five rows add up to certification.

---

## 6. Rules, all binding

Carried from R6 unchanged, because they are what made its findings hold up:

- **Every new test runs against UNFIXED code first and is observed to fail**,
  and the failing output goes into the ledger row and the commit.
- **Never delete, skip, weaken or loosen a test.** Run
  `node ~/.claude/scripts/gate-guard.mjs` before any commit claiming a fix. A
  legitimate removal is an escalation naming which assertion went and why it no
  longer grades anything real — R6 row 8 is the worked example.
- **Reconcile every count delta** against the tests the commit adds. A rise
  larger than that means duplication; smaller means something stopped running.
- **Never write** `world class`, `certified`, `production ready` or `fixed`
  while any row is OPEN. Six audits have declined the first label.
- **Append one ledger row per attempt. Never edit a row — supersede it.**
- Push before quoting a SHA outside the session.

**Escalate:** deploys, pushes to `main`, spend, unread files, anything
unverifiable, any change making FinalGate refuse, **any change to what
production calls verified** (E3), and **any change to what the benchmark counts
as correct** (E4).

**Stop:** every row CLOSED or OPEN-with-reason and both evals ran; budget 6
loops; 3 loops with no verdict change. E5 not fitting is a valid stop.

---

## 7. What this round must NOT do

- **Not a sixth metric vocabulary.** R14, T1, T2 and V16 are one mistake made
  four times. The fact carries its `xbrl_concept`; nothing looks it up.
- **Not a rewrite of the prose channels.** Most retrieval is prose and will stay
  prose. The object is for evidence that HAS fields, and the text path must
  remain the honest fallback for evidence that does not.
- **Not a new object when one exists.** `provenance()` is the canonical object.
  Defining a second beside it would add the seventh vocabulary round 3 counted.
- **Not certification.** See §8.

---

## 8. Certification — unchanged, stated plainly

`NOT CERTIFIED`, and this round does not change that. What blocks it:

| Blocker | Who |
|---|---|
| **Blind head-to-head — no reference set exists** | **Human.** E6 |
| **Live database** | Infrastructure |
| **Independently executed suite** — CI disabled behind a large `ruff` backlog | Human decision, then a lint round |
| **Browser E2E** — `apps/gravity-ui` has no test directory | A loop, once an app instance is runnable |
| **Canonical evidence layer** | **This round** |

R7 moves exactly one line of that table.

---

## Ledger

| # | Loop | Row | Defect | Verdict | Backend | gate-guard | Commit | Red-before-fix |
|---|---|---|---|---|---|---|---|---|
| 0 | — | — | — | BASELINE | 2497 passed / 0 failed | clean | `de74147` | n/a |
| 1 | 1 | §3 | V23 — the exact-fact channel stated a negative it does not hold. `_fmt_value` wrote the restatement as `($416.16B)`; parentheses mean NEGATIVE in a filing, so every fact ≥ $1M injected a spurious negative twin, which landed in `citation_verdict`'s `source_leftover` and promoted partly-covered claims to `conflicting` — the harshest verdict, against a correct claim on the ground-truth channel | CLOSED | 2503 passed / 0 failed | clean | `a38ec8b` | 2 of 6 assertions in `tests/test_structured_fact_round_trip.py` failed on the unfixed renderer: the passage parsed to `{416161000000.0, -416160000000.0, 2025.0}`, and `"Apple revenue grew to $416,161 million from $391,035 million [1]."` graded `conflicting` where the control passage without the restatement graded `partially_supported` |
| 2 | 1 | §1 | The canonical object exists and `payload()` drops its financial half | MEASURED — E1 opens against it | n/a | clean | `a38ec8b` | n/a — measurement, not a fix. `provenance()` holds value, unit, `xbrl_concept`, dimension, dimension_value, `period_start`, `period_end`, `fiscal_year`, `fiscal_quarter`; `payload()` emits none of the nine |
| 3 | 1 | §1 | Superseded row 2 — the count is TEN, not nine. `scope` (`"segment"` / `"consolidated"`) is held by `provenance()` and was dropped by `payload()` with the rest. Row 2 undercounted its own finding | SUPERSEDES ROW 2 | n/a | clean | `bd1146e` | n/a — correction to a measurement |
| 4 | 1 | E1 | `payload()` dropped the financial half of the canonical object, so every reader below re-derived metric, magnitude and period from prose | CLOSED | 2518 passed / 0 failed | clean | `bd1146e` | 12 of 15 assertions in `tests/test_evidence_fields_reach_the_citation.py` failed against the unfixed `payload()`. The 3 that passed are the guardrails that already held — a prose passage carries `{}`, and the identity/link keys are present — which is what makes the other twelve mean something |
| 5 | 1 | §4 | The round predicted E1 would move `test_provenance_mutation_rig.py` and `test_gate_accepts_real_pipeline_citations.py`, and braced for a gate-shrink escalation | PREDICTION MISSED — recorded | 2518 passed / 0 failed | clean | `bd1146e` | n/a. Both pin a hardcoded literal citation rather than `payload()`'s key set, so an additive change is invisible to them. No escalation was needed |
| 6 | 1 | E2 | `scale` — the one field of the audit's twelve that `provenance()` does not hold | CLOSED BY DECISION — no field added | 2532 passed / 0 failed | clean | `c48e264` | n/a — no fix, so no red. The 4 tests pin an existing invariant E3 depends on. Measured: a table scrape, the legacy companyfacts backfill and declared-scale prose all yield `payload() == {}`, because the accession is the gate. Only the XBRL path reaches a citation and XBRL values are absolute, so `scale` would be a constant 1. The first test reopens the decision if a non-absolute producer ever arrives |
| 7 | 1 | E3 | V24 — `_fmt_value` prints `${v/1e6:,.0f} million`, so below ~$120M the rendered passage no longer holds the figure the filing states, and a claim quoting the filing's EXACT value was graded `conflicting / numeric_not_in_source` | CLOSED | 2532 passed / 0 failed | clean | `c48e264` | 6 of 10 assertions in `tests/test_verdict_reads_the_fact.py` fail with the field reads disabled. Measured on the unfixed path: fact 12,499,000 rendered `$12 million` → conflicting; 2,500,000 → `$2 million` → conflicting; 1,499,999 → `$1 million` → conflicting; 416,161,000,000 → verified throughout. The 4 passing assertions are the guards — wrong figure still caught, wrong period still conflicts, large facts unchanged, fieldless citations unchanged |
| 8 | 1 | E3 | The round's §5 claimed **V16 and V17 fall to E3**. Neither does | CLAIM WITHDRAWN — both stay OPEN | 2532 passed / 0 failed | clean | `c48e264` | n/a — correction. V16 needs a concept↔English map to compare the fact's `xbrl_concept` against a claim written in prose, which is the vocabulary §7 forbids; it needs the CLAIM to carry a metric, which is E5. V17 is the grader not checking period at all — E3 only makes production's period evidence authoritative, so it is E4. Owner-escalated before landing; the decision was to leave V16 open and say so |
