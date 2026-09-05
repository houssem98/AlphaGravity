# Round 8 — evidence integrity, to certification or to a named blocker

Branch `feat/web-research-sec-integration`. Baseline `aa2440c` (2532 passed).
Built from `docs/quick-answer/AlphaGravity Quick Answer — R8 World-Class
Hardening Roadmap.md`, read in full before this file was written.

Invocation: **`/loop Execute docs/quick-answer/R8_LOOP.md`**

One file, like R6 and R7. The graph, the rows, the rules and the ledger live
together because three rounds of keeping them apart taught that a graph nothing
reads rots into a lie.

---

## 1. What "world class" means here, and what it cannot mean

The objective, in the roadmap's own words:

> a Quick Answer system where a financially wrong answer cannot obtain VERIFIED
> evidence merely because the right number, metric word, or citation happens to
> appear somewhere nearby.

**That is achievable by this loop, and it is a different claim from the one
seven audits have declined.** Rounds 1–7 could not certify because certification
was defined as *is this better than ChatGPT*, which needs a human-authored
reference set that no loop can produce. R8's success criteria contain no such
item. Every one of them is a mechanical property of the evidence path, and a
loop can settle mechanical properties.

**So the honest statement of the goal is:** by the end of this round, either
every criterion in the roadmap's §26 is demonstrated and the round says
`CERTIFIED`, or the round names exactly which criteria are not and why. Both are
successful outcomes. A third outcome — a green suite and a confident summary —
is the failure this round exists to make impossible.

**Three criteria will decide which**, and they are the ones the roadmap places
last:

| Criterion | Why it decides | Attacked in |
|---|---|---|
| a fixture corpus with non-USD, restated and segmented filings, **not fabricated** | If the repository holds no such filing, the currency, restatement and segment criteria cannot be demonstrated at all | QA-2, **first**, not last |
| the actual Quick Answer route and WebSocket path tested end to end | Everything else is unit-level. Without this the round proves properties of functions, not of the system | QA-1 feasibility, QA-15 |
| performance measured end to end, p50/p95/p99 | Local infrastructure is not production. A number measured against stubs is not the number | QA-1 feasibility, QA-16 |

**These are settled in loop 1, not loop 12.** Discovering in the last loop that
a required fixture does not exist is how a round ends in an apology. If any of
the three is impossible, it is recorded as `BLOCKED` with the reason on the
first day and the round proceeds around it.

---

## 2. Stop is three conditions

- **Target** — every row CLOSED or OPEN-with-reason, both evals run, and
  `docs/quick-answer/R8_FINAL_AUDIT.md` written with a certification decision of
  `CERTIFIED`, `NOT CERTIFIED` or `BLOCKED`. The decision defaults to
  `NOT CERTIFIED`.
- **Budget** — 20 loops. The suite takes 11–16 minutes, so this is roughly a
  day of wall time and it is the cap, not a target.
- **Stall** — 3 consecutive loops with no verdict change and no new failure
  mode. On stall: stop and report, do not keep ticking.

**There is no external audit at the end of this round.** Seven have been run;
the last three found less than the round's own rigs did. QA-13's theatre test
and QA-12's differential matrix are the replacement, and they are stronger
because they execute. If the round wants an eighth opinion it has failed to
build an instrument it trusts.

---

## 3. The graph

Dependency order, which is **not** the roadmap's section order. Fixtures and
feasibility come first because they decide whether the end is reachable.

```mermaid
flowchart TD
    QA1["QA-1 trace the real path · §1 · search_pipeline.py"]
    QA2["QA-2 fixture corpus · real_sec_fixtures.py"]
    QA3["QA-3 one source_class vocabulary · answer_contract.py"]
    QA4["QA-4 accession alone is not primary · _is_primary"]
    QA5["QA-5 entity MATCH/MISMATCH/UNKNOWN · entity_resolver.py"]
    QA6["QA-6 canonical evidence everywhere · citation_provenance.py"]
    QA7["QA-7 unit scale currency · declared_scale"]
    QA8["QA-8 period attachment · fact_value"]
    QA9["QA-9 scope segment restatement · evidence_gate.py"]
    QA10["QA-10 atomic claim + asserted parsing · rubric.py"]
    QA11["QA-11 metric to value binding V21 · _claim_is_bound"]
    QA12["QA-12 status matrix + edge mutations · verdict_for_citation"]
    QA13["QA-13 theatre test on every round · §7"]
    QA14["QA-14 differential matrix · structured_search.py"]
    QA15["QA-15 test pyramid + real E2E · §1"]
    QA16["QA-16 performance p50 p95 p99"]
    QA17["QA-17 observability + cleanup"]
    QA18["QA-18 final report · §2 certification"]

    QA1 --> QA2
    QA1 --> QA3
    QA1 --> QA15
    QA1 --> QA16
    QA2 --> QA7
    QA2 --> QA8
    QA2 --> QA9
    QA2 --> QA14
    QA3 --> QA4
    QA3 --> QA6
    QA4 --> QA6
    QA5 --> QA10
    QA6 --> QA7
    QA6 --> QA8
    QA6 --> QA9
    QA7 --> QA10
    QA8 --> QA10
    QA9 --> QA10
    QA10 --> QA11
    QA11 --> QA12
    QA12 --> QA13
    QA13 --> QA14
    QA14 --> QA18
    QA15 --> QA18
    QA16 --> QA18
    QA17 --> QA18
```

The graph is checked, not drawn:

```bash
node scripts/graph-lint.mjs docs/quick-answer/R8_LOOP.md
```

Every node names a file, a section or a symbol that must resolve, and the
linter exits non-zero when one stops resolving. `graph-lint.mjs` could not see
`.py` paths or snake_case symbols until this round extended it — a Python
roadmap's graph was passing on its section numbers alone, which is the scope
opt-out failure mode with the checker itself as the culprit.

---

## 4. The rows

Each row states its roadmap section, its deliverable, and **the specific way it
is allowed to fail**. A row with no stated failure mode has not been thought
about.

### QA-1 — trace the real path, and settle the three deciders

Roadmap §1. **No code changes.** Produce `docs/quick-answer/R8_DATAFLOW.md`
with actual file and function names for: query → `search_pipeline` → retrieval
channels → source objects → citation construction → provenance → generation →
answer contract → FinalGate → publication → cache write → cache replay.

Then answer three questions with a command, not an opinion:

1. Does a test exercise the real route and the real WebSocket path today?
2. Can end-to-end latency be measured without live infrastructure, and if not,
   what exactly is missing?
3. Which of the roadmap §17 fixture dimensions exist in this repository —
   non-USD, restated/amended, segmented?

**Fails as:** a dataflow document that paraphrases the architecture rather than
naming the functions. If a reader cannot grep every name in it, it is prose.

### QA-2 — the fixture corpus

Roadmap §17. Extend `real_sec_fixtures.py`. **Do not fabricate SEC data.** Use
corpus text or filings already on disk.

**Fails as:** a dimension quietly dropped because no fixture exists. Missing
dimensions are recorded as `BLOCKED` in the ledger with the search that failed,
not left out of the matrix.

### QA-3 — one `source_class` vocabulary

Roadmap §3. Find every producer and consumer of `source_class` and its
neighbours, define one canonical mapping, add a contract test that no consumer
interprets another producer's string.

**Fails as:** a new enum added beside the old strings instead of replacing
them — the seventh vocabulary round 3 counted.

### QA-4 — an accession alone is not primary provenance

Roadmap §2.3. `_is_primary` and `provenance` currently treat a valid-looking
accession as sufficient. Require coherent filing identity. Negative tests: fake
accession with web, local, blog and news source classes, and a valid accession
embedded in arbitrary prose.

**Fails as:** tightening this rejects real citations. The primary-provenance
rate on the existing fixtures is measured before and after, and a drop is
investigated rather than accepted.

### QA-5 — entity binding has three states

Roadmap §4. `MATCH` / `MISMATCH` / `UNKNOWN`, and `UNKNOWN` never satisfies a
requirement. Canonical normalization for ticker, legal name, common name, CIK,
issuer and document title. `ABC` must not match `ABCDEF`.

**Fails as:** normalization that is a substring matcher wearing a new name.

### QA-6 — the canonical evidence object reaches every source class

Roadmap §2.1, §2.2. R7 measured that `provenance` returns `None` without an
accession, so prose citations carry no fields. Decide, with a measurement of how
many real citations that affects, whether the object extends to prose evidence
or whether prose is graded honestly by the text path forever.

**Fails as:** labelling web or local evidence as filing evidence to make the
fields non-empty. Source identity, financial fact identity and verification
strength stay three separate things.

### QA-7 — unit, scale and currency are semantic

Roadmap §8. Scale comes from evidence — a header, prose, structured metadata —
never from a number's appearance. Currency mismatch fails: USD, EUR, GBP, JPY,
CNY, and the `$` `€` `£` symbols.

**Fails as:** adding scale to XBRL values that are already absolute, which R7
row E2 decided against for reasons that still hold.

### QA-8 — period attachment

Roadmap §7. `MATCH` / `MISMATCH` / `UNKNOWN`, and `UNKNOWN` does not satisfy a
required period. FY vs FY, Q vs Q, quarter vs full year, TTM vs FY, calendar vs
fiscal, comparative columns. **This is V17**, open since round 6.

**Fails as:** period checked in production and not in the evaluator, which is
exactly the state V17 describes.

### QA-9 — scope, segment, restatement

Roadmap §9, §10. Consolidated vs segment vs geographic vs continuing vs
discontinued. `ORIGINAL` / `RESTATED` / `AMENDED` / `UNKNOWN`, and two
conflicting facts stay `CONFLICTING` rather than collapsing to `VERIFIED`.

**Owner decision, QA-1:** there is no amended or restated filing in this
repository — zero `/A` forms across 1408 manifest rows, and only 20 filing
files on disk at all. The semantics are built and tested against constructed
evidence, and the §26 criterion is recorded **`UNPROVEN` on real filing
data**. One real `10-K/A` in `data/filings*/` upgrades it to `PROVEN` without
touching the implementation.

**Fails as:** the synthetic evidence quietly becoming the claim, with the
`UNPROVEN` label dropped from the final report.

### QA-10 — the atomic claim

Roadmap §5, §14. `_claim_is_bound` works per SENTENCE, not per proposition —
its own T9 caveat. Decompose into atomic claims each carrying entity, metric,
value, currency, unit, scale, period, scope and segment. Define the semantic
rule for what a sentence asserts before touching punctuation.

**This is the largest row and it may not fit one loop.** If it does not, say so
and stop; do not half-build it.

**Fails as:** a punctuation list. If the fix is characters rather than a rule,
it is the wrong fix.

### QA-11 — metric to value binding

Roadmap §6. **This is V21**, pinned open in
`KNOWN_SHARED_EDGE_GAPS` since round 6. Adjacent table rows, several numbers in
one paragraph, one number serving two metrics, prior/current year columns,
quarterly/annual columns, percentages beside dollars, EPS beside revenue,
margins beside absolutes.

**Fails as:** a concept-to-English mapping table. R7 escalated this and the
decision was that the claim must carry its own metric — QA-10 is what makes
this row possible, which is why it sits after it.

### QA-12 — the status compatibility matrix and edge mutations

Roadmap §11, §12, §13. The differential rig's invariant fires only on
`UNSUPPORTED`, and `verdict_for_citation` returns that **only** when a citation
fails to resolve; every value, entity and period disagreement returns
`CONFLICTING`. So the invariant is close to vacuous and round 7 said so without
fixing it. Replace it with the full production×grader matrix. Add the edge
mutations the roadmap lists, including citation-index transposition.

**Fails as:** widening "rejects" to include `CONFLICTING` and then pinning the
new violations as known gaps. A matrix that grows exemptions is the ratchet, not
the fix.

### QA-13 — the theatre test, run against every round

Roadmap §19. For each regression test this project has: revert the production
fix, confirm the test fails, restore, confirm it passes, then change fixture
wording, citation order and the numbers, and confirm the result still follows
semantics. **A test that passes before its own fix is theatre and is replaced.**

Run it against rounds 3 through 7, not only against R8's own tests. **Expect it
to invalidate some existing green tests.** That is the row working.

**Fails as:** running it only on new tests, which proves nothing about the
suite's history.

### QA-14 — the differential matrix

Roadmap §18. For every QA-2 fixture: `CORRECT`, `WRONG_VALUE`, `WRONG_UNIT`,
`WRONG_SCALE`, `WRONG_CURRENCY`, `WRONG_PERIOD`, `WRONG_ENTITY`, `WRONG_SCOPE`,
`WRONG_SEGMENT`, `WRONG_METRIC`, `WRONG_CITATION`, `WRONG_CITATION_INDEX`,
`CONFLICTING`, `UNSUPPORTED`, each with an explicitly defined expected result.

**Fails as:** a matrix whose expected results were written after seeing the
actual ones.

### QA-15 — the test pyramid and the real end-to-end

Roadmap §20, §21. Six layers: semantic unit, provenance integration, pipeline
integration, API and WebSocket E2E, cache replay, production-like fixture. The
only permitted substitution is an external dependency that genuinely cannot run.

**Fails as:** substituting the component under test, which makes the E2E a
mock's self-portrait.

### QA-16 — performance, measured separately

Roadmap §22. Retrieval, generation, provenance construction, FinalGate,
serialization, cache hit, cache miss, end to end. p50, p95, p99.

**Owner decision, QA-1:** bring up local infrastructure (`make infra`) and
populate the stores, rather than reporting only the pure stages. That makes
retrieval, generation and true end-to-end measurable — **locally**. The word
`local` is required in every number this row publishes, and
`R8_FINAL_AUDIT.md` must say it too: local hardware with a locally seeded
store is not the production environment.

**Fails as:** a number from a grader microbenchmark presented as Quick Answer
latency, or a local number presented as a production one.

### QA-17 — observability and cleanup

Roadmap §23, §24. Telemetry sufficient to answer why a claim was verified,
which evidence supported it, which entity and period matched, which gate
rejected it. Then classify every duplicate concept as canonical, transport,
legacy or derived and write it down.

**Fails as:** cosmetic refactoring, which §24 forbids explicitly.

### QA-18 — the final report

Roadmap §27. `docs/quick-answer/R8_FINAL_AUDIT.md`, the twelve named sections,
every claim tagged `PROVEN` / `TESTED` / `READ` / `INFERRED` / `UNPROVEN` /
`BLOCKED`, and one certification decision.

**Fails as:** the word "world-class" appearing anywhere that evidence does not.

---

## 5. Rules, all binding

The roadmap's fifteen non-negotiables hold in full and are not restated here.
On top of them, the rules R6 and R7 were built on, because they are what made
those rounds' findings survive contact:

- **Every new test runs against UNFIXED code first and is observed to fail**,
  and the failing output goes into the ledger row and the commit. A test that
  passes before its fix is theatre — QA-13 exists to find the ones already in
  the tree.
- **Never delete, skip, weaken or loosen a test.** Run
  `node ~/.claude/scripts/gate-guard.mjs` before any commit claiming a fix. A
  legitimate removal is an escalation naming which assertion went and why it no
  longer grades anything real.
- **Reconcile every count delta** against the tests the commit adds. A rise
  larger than that means duplication; smaller means something stopped running.
- **Never write** `world class`, `certified`, `production ready` or `fixed`
  while any row is OPEN.
- **Append one ledger row per attempt. Never edit a row — supersede it.**
- **Keep `docs/quick-answer/R8_PROGRESS.md`** current: discovered issue, root
  cause, files and functions, implementation, tests, remaining uncertainty.
- Push before quoting a SHA outside the session.

---

## 6. Escalation

Halt and ask; do not decide alone:

- deploys, pushes to `main`, spend
- any file entering the repo the loop did not write and has not read
- **any change to what production calls verified**
- **any change to what the benchmark counts as correct**
- any change that would make FinalGate refuse an answer it accepts today
- removing or weakening an existing assertion, including one QA-13 finds to be
  theatre
- anything unverifiable this iteration

Escalation is the loop working. Seven rounds of this project have been improved
by it and none delayed by it.

---

## 7. What this round must NOT do

- **Not an eighth audit.** See §2.
- **Not a second evidence model.** Roadmap rule 6. `provenance` is the canonical
  object; extend it.
- **Not a new metric vocabulary.** R14, T1, T2, V16 are one mistake made four
  times.
- **Not benchmark-score optimisation.** Roadmap line 7 and rule 13.
- **Not unrelated architecture.** Roadmap rule 14.

---

## 8. The evals, both, every loop

```bash
cd services/gravity-api
.venv/Scripts/python.exe -m pytest tests/ -q --ignore=tests/live --ignore=tests/eval
node ~/.claude/scripts/gate-guard.mjs
node scripts/graph-lint.mjs docs/quick-answer/R8_LOOP.md
```

Baseline **2532 passed** at `aa2440c`. Runs take 11–16 minutes; pytest buffers
its dots, so an empty output file is not a hang. Background it and let the
harness report completion — never a `sleep` loop.

---

## 9. Ledger

| # | Loop | Row | What | Verdict | Backend | gate-guard | Commit | Red-before-fix |
|---|---|---|---|---|---|---|---|---|
| 0 | — | — | — | BASELINE | 2532 passed / 0 failed | clean | `aa2440c` | n/a |
| 1 | 0 | §3 | `graph-lint.mjs` could not see `.py` paths or snake_case symbols, so a graph over `services/gravity-api` passed on its section numbers alone | CLOSED | n/a | clean | `15fc5ac` | n/a — checker capability, not a defect fix. Self-check 9/9 still passes and all 8 existing graphs still pass; two gained refs (12→13, 20→24), so the change strictly increased what is checked |
| 2 | 1 | QA-1 | The real Quick Answer path traced end to end into `docs/quick-answer/R8_DATAFLOW.md`, no code changed | CLOSED | 2540 passed / 0 failed | clean | `14a0f63` | n/a — a trace, not a fix. 19 publication sites in `SearchPipeline.search`, of which **3** are `type="answer"` (751 cache hit, 1327 refusal, 2116 generated) and each has a gate immediately before it (744, 1320, 2107). Recorded **READ, not PROVEN** — QA-13 must execute each path |
| 3 | 1 | QA-1 | A **fourth** publication path exists: line 794 is a bare `yield event` delegating to `app/core/agents/orchestrator.py`, with no `_gate_check` around it in `search_pipeline.py` | OPEN — outside the scope fence | 2540 passed / 0 failed | clean | `14a0f63` | n/a — measurement. Agentic is not `reasoning_depth="fast"`, so it is out of R8's fence, but the roadmap §15 warning "do not assume there are only three paths" was correct and is recorded rather than absorbed |
| 4 | 1 | QA-1 | Decider 3 — the fixture corpus is far smaller than the manifests imply | BLOCKED, decided | 2540 passed / 0 failed | clean | `14a0f63` | n/a — measurement. 1408 manifest rows / 218 tickers, but **20 files on disk / 3 tickers** (ZTS, AFL, PNW); 1388 rows point at files not kept. Zero `/A` forms and zero 20-F/40-F/6-K anywhere. Owner decision: restatement semantics built on synthetic evidence and labelled `UNPROVEN` on real data |
| 5 | 1 | QA-1 | Decider 1 — the real route and the real pipeline are each tested, and never together | OPEN — QA-15 owns it | 2540 passed / 0 failed | clean | `14a0f63` | n/a — measurement. `test_search_stream_contract.py` drives the real WebSocket route but injects `FakePipeline`; `test_quick_answer_pipeline_e2e.py` drives the real `SearchPipeline` with only external boundaries stubbed. §21 forbids replacing the component under test, and `FakePipeline` replaces exactly it |
| 6 | 1 | QA-1 | Decider 2 — end-to-end latency is not measurable without live stores and a live LLM | RESOLVED by decision | 2540 passed / 0 failed | clean | `14a0f63` | n/a — measurement. Pure stages (provenance, FinalGate, serialization, cache hit/miss) are measurable now; retrieval, generation and true end-to-end are not. Owner decision: bring up local infrastructure and populate it, and label every resulting number `local` |
| 7 | 1 | QA-2 | `AFL_JAPAN_OPERATIONS` — Aflac's 2026 10-K Japan segment table, verbatim, accession `0001628280-26-011402`. The only genuinely multi-currency table in the corpus; closes currency, dual scale and segment in one excerpt | CLOSED | 2540 passed / 0 failed | clean | `14a0f63` | n/a — a fixture, not a fix. Count reconciled at +8 rather than the predicted +7: the new file adds 7 and `test_every_real_sec_excerpt_counts_as_a_primary_filing` is parametrized over `ALL_EXCERPTS`, which went 3 → 4 |
| 8 | 1 | QA-2 | **V25** — a table header may declare more than one scale. `declared_scale` returns a single float and takes the first match, so `(In millions of dollars and billions of yen)` resolves to `1e6` and the yen column is read a thousandfold small | OPEN — pinned, fix escalated | 2540 passed / 0 failed | clean | `14a0f63` | Measured on the verbatim excerpt: `¥1,009 billion` (the filing's own figure) → refused; `¥1,009 million` (wrong by 1000×) → bound; `$6,744 million` → bound. Exactly inverted. V14 and V19's class a third time — the earlier three fixtures each declared exactly one scale and could not surface it |
| 9 | 1 | QA-2 | **V26** — currency is never compared. Nothing in the binding path distinguishes `$` from `¥`, `€` or `£` | OPEN — pinned, fix escalated | 2540 passed / 0 failed | clean | `14a0f63` | `€6,744 million` and `£6,744 million` both bind against the US dollar figure. Roadmap §8.3 requires a matching numeric value with the wrong currency to fail |
| 10 | 1 | §1 | QA-2's fixture found V25 before QA-7, the row that owns scale, had started | ORDERING VINDICATED — recorded | 2540 passed / 0 failed | clean | `14a0f63` | n/a — a note on method. On the roadmap's own ordering §17 runs after §8, so the unit/scale row would have been declared done against single-scale fixtures. Putting the corpus first is why V25 exists as a finding rather than as a later surprise |
| 11 | 1 | QA-7 | **V25 SUPERSEDES ROW 8** — a header declares a scale per currency. `declared_scales` returns `{"USD": 1e6, "JPY": 1e9}` for the Aflac header and the claim's own currency picks the entry; the unkeyed entry stays the fallback for ordinary `(in millions)` headers | CLOSED | 2544 passed / 0 failed | clean | `fdb54c9` | Red before the fix, on the verbatim excerpt: `¥1,009 billion` (the filing's own figure) → refused; `¥1,009 million` (wrong by 1000×) → bound. After: → bound / → still bound **for a different reason, see row 13**. UAL `1e6` and LYV `1e3` unchanged, asserted |
| 12 | 1 | QA-7 | **V26 SUPERSEDES ROW 9** — currency is now compared. Both sides must name a currency for the check to fire | CLOSED | 2544 passed / 0 failed | clean | `fdb54c9` | Red before the fix: `€6,744 million` → bound, `£6,744 million` → bound, against the US dollar column. After: both refused. One-directional by construction — a claim naming no currency is not penalised (asserted on UAL), and `currency_of` returns empty for a sentence naming two rather than guessing |
| 13 | 1 | QA-7 | **V27** — a filing footnote marker is read as a figure. `(1)` in `Net earned premiums (1)` parses to 1.0; under the yen column's billions scale `1.0 × 1e9` is 0.9% from `¥1,009 billion`, inside the 1% tolerance | OPEN — pinned, fix escalated | 2544 passed / 0 failed | clean | `fdb54c9` | The thousandfold-wrong `¥1,009 million` still binds — through a spurious FIGURE, not a wrong multiplier, so V25's fix could not reach it. V20's class (a marker counted as a figure) one layer over, source-side. Recorded alongside: `_readings` returns `(408)` as POSITIVE 408, so this layer applies no accounting-negative convention at all, while `citation_verdict._extract_numbers` returns −408 for the same text. Divergence recorded, not fixed |
| 14 | 1 | §6 | **The suite count was being reconciled against a baseline no command reproduces.** Every round since row 0 quoted a passed-count; the invocation behind it collected 56 fewer tests than `python -m pytest tests -q` does from `services/gravity-api` | CLOSED by re-baselining | 2606 collected / 2550 passed / 56 skipped / 0 failed | clean | `dcffd4e` | Found while reconciling V27: the run reported 56 skips where the previous run reported none. `2606 = 2544 + 6 new + 56`, exact. The 56 are documented opt-ins, not muted assertions — 29 `tests/live/test_sec_authority.py` (`GRAVITY_LIVE_SEC=1`) and 27 `tests/eval/test_deepeval_rag.py` (`GRAVITY_API_URL`), the latter returning under QA-16's local infrastructure. Counts from row 15 on cite the explicit command |
| 15 | 1 | QA-7 | **V27** — a scaled reading may not invent precision the source never wrote. `_matches` refuses to apply a scale when the source reading carries fewer significant digits than the claim | CLOSED | 2606 collected / 2550 passed / 56 skipped / 0 failed | clean | `dcffd4e` | Red before the fix: `¥1,009 million` (wrong by 1000×) → bound, because `(1)` parses as 1.0 and `1.0 × 1e9` is 0.9% from `1.009e9`. After: refused. One-directional and asserted as such — `$6.7 billion` against a source reading `6,744` in a millions table still binds, so the guard only ever refuses a coarse source under a precise claim. **Escalated before landing** per §6: it changes what the benchmark counts as correct. Owner chose the sig-digit guard over a footnote-parse heuristic, on the ground that the heuristic could not separate `(1)` the footnote from `(408)` the accounting negative and no fixture proved it could |
