# Loop Conventions

The part of every `*_LOOP.sh` prompt that was identical in all of them.

A loop prompt is re-sent on **every wakeup**. Anything invariant that lives inline
is paid for again each tick, in every loop, forever. This file holds that part
once; a loop prompt names it and states only its own deltas.

**Loop prompts say:** `under the standard loop contract (docs/LOOP_CONVENTIONS.md)`.
Read this file at the start of a loop iteration, not once per session — it is
deliberately NOT `@`-imported into `CLAUDE.md`, because most sessions are not loops.

Global loop doctrine (nine parts, evals, sequential-testing hazard) lives in
`~/.claude/LOOP_STANDARD.md`. This file is the *repo's* half: the contract a task
must satisfy here, and the constraints this codebase actually imposes.

---

## 1. The task contract

Do **only the first unchecked `[ ]` task** in the ledger's Section 7. The task's
spec text is the requirement; the Section 6 rows it names are the acceptance
tests. Nothing else in the ledger is in scope.

**A task is done only when all of these hold:**

| # | Gate | Command |
|---|------|---------|
| 1 | its named §6 rows are green | `npx vitest run` from `apps/market-ui/` |
| 2 | app typecheck clean | `npx tsc --noEmit -p tsconfig.app.json` |
| 3 | agent handler typecheck clean *(if `api/agent` changed)* | `npx tsc --noEmit -p tsconfig.api.json` |
| 4 | every pre-existing suite stayed green | full `npx vitest run` |
| 5 | any measurement came from a **committed, seeded** script with a stated window and a recorded command line | not a scratch file |
| 6 | deployed **and** probed *(only if the UI or an api function changed)* | `vercel --prod` from repo root, then POST the real payload and read the actual response |

**Acceptance rows are written before the task that satisfies them**, not in the
same breath as the implementation. `LOOP_STANDARD.md` §2 says never let one model
grade its own work; a ledger cannot hire a second model, but it can stop a task
from authoring its own pass mark. Adding a §6 row while implementing the thing it
grades is the failure mode — if a task needs a row that does not exist, add the
row, say so in the log, and treat that as a finding about the ledger.

Then, in this order: flip the ledger box to `[x]`; append **one** Section 8
progress line with real numbers (n, window, counts, status codes, measured
pixels — **no adjectives**); commit.

**Commit:** on `roadmap/world-class`, message
`feat(<scope>): <ID> <what> — <verify numbers>`.
Use `git commit -F <file>` when the message contains quotes — `rtk` mangles them.
**Never `git push` unless explicitly asked** — a push to `main` clobbers Vercel prod.

## 2. Truth rules

- Never invent a number, endpoint, benchmark result, citation, token, class or
  breakpoint. Read the ledger's anchor list first; live-probe any endpoint before
  wiring or citing it.
- **Never build what already exists, and never trust that what exists works.**
  Grep before writing a module; probe before reusing one. Modules listed as
  "verify before reuse" have failed their own probe before.
- Honest nulls are wins. "No edge at n=30, net of costs, contamination suspect"
  beats a tuned constant. Never fit a parameter until a backtest turns green.
- A failed gate is a real result. If a row cannot go green, log the measurement
  that proves it and close the row — never invent a new task to keep a loop alive.

## 3. Repo hard constraints

These bite silently. All of them have cost a debugging session already.

- **Vercel Hobby caps functions at 12** and `apps/market-ui/api` is full. Add **no**
  new API route — everything rides an existing `[fn].ts` dispatcher.
- **Do not touch `apps/market-ui/vercel.json`.** The `/api/((?!tn/|agent/).*)` Fly
  rewrite and the SPA fallback are both load-bearing.
- **Vercel Node ESM needs explicit `.js` extensions** on relative imports from
  `src/` reachable by `api/`. Omitting one builds fine and 500s at request time.
- `erasableSyntaxOnly` forbids constructor parameter properties.
- **`import.meta.env` is browser-only.** A bare one at module scope throws at
  *import* time under Node, so any `api/` import of that file dies on load. Read
  `process.env` first and fall back only if `import.meta.env` exists.
- **Only `DEEPSEEK_API_KEY` and `FRED_API_KEY` are live.** Gemini is quota-dead,
  Anthropic 401, Groq 401.
- A missing credential must **fail loudly**, never fall back to a placeholder — a
  placeholder makes a credential fault look like a data fault.
- Supabase journal needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`; absent, it
  is silently off.
- Prod alias `https://market-ui-self.vercel.app`. Deploy straight to prod from the
  repo root (project `market-ui`) — never stage a preview.
- Agent chat body shape: `{messages, asset:{symbol,isTN,isCrypto,name}, stream}`.
  A flat `symbol` yields a null ctx, an empty tool belt and a misleading probe.
- `tsconfig.app.json` includes only `src`. `api/` is checked by
  `tsconfig.api.json`, which is scoped to `api/agent` — the rest of `api/` has
  100+ pre-existing errors and is unchecked.

## 4. Escalate — do not decide alone

Halt and ask for: any `git push`; any deploy beyond `vercel --prod` on
`market-ui`; any new npm dependency; any change to `vercel.json`; any new API
route; **any file entering the repo the loop did not write and has not read**;
spend above the cap; any result that would justify committing capital; anything
unverifiable this iteration.

Escalation is the loop working, not the loop failing.

## 5. Cadence

**This family of loops works rather than watches.** Every iteration is edit →
test → deploy → verify → log, all performed by the agent, with no external state
to wait on. Schedule the next wakeup at **120 seconds**.

The exception is a loop genuinely blocked on something else finishing (a long
replay, CI, a market threshold): match that thing's rate, and if a background task
notifies on completion, use a long fallback heartbeat (1200–1800s) instead of
polling.

## 6. Stop — three conditions, say which one fired

- **TARGET** — no `[ ]` remains **and** the ledger's final sweep actually ran.
  Checked boxes with an unrun gate is not a target hit.
- **BUDGET** — N tasks or N iterations, whichever comes first. Each ledger states
  its own numbers.
- **STALL** — 3 consecutive iterations with no row changing state and no new
  failure mode. Report which row is stuck and on what. Do **not** widen scope or
  re-run a green sweep to manufacture activity.

If a task is blocked on user-only input (credentials, infra, a real device), say
exactly what is needed, ledger-note it, and skip to the next unblocked task. Only
if **all** remaining tasks are blocked, `ScheduleWakeup` 3600s.

## 7. Persistence

Never end a loop on a usage limit, 429 or overload. Stop consuming tokens
immediately, `ScheduleWakeup` 3600s with the same `/loop` prompt, and on wake
re-read the ledger and its progress log and resume the same task from its last
verified step. Log partial progress **before** any long or risky operation — a
30-decision replay is ~240 LLM calls and must be logged before it starts.

---

## 8. Writing a loop prompt

**Starting one.** The documented invocation `/loop $(tail -1 X_LOOP.sh)` is POSIX: in
PowerShell there is no `tail` and `$( )` does not substitute the same way, so the line
silently fails to expand and you paste the literal string instead. `loop-prompt.mjs`
reads the file in Node, which behaves identically in both shells, and with `-c` puts the
`/loop` line on the clipboard (`clip` / `pbcopy` / `xclip`, printing if none is there).
With no argument it lists the loops whose ledger still has open tasks — a closed ledger
cannot run, so it is not offered.

With this file in place a loop's last line is a pointer plus its deltas:

```
/loop Read docs/<LEDGER>.md. Do the first unchecked [ ] task in §7 under the
standard loop contract (docs/LOOP_CONVENTIONS.md). Commit scope <scope>, task IDs
<PREFIX>-n. Deltas: <what makes THIS loop different — its domain doctrine, its
anchors section, its carve-outs, its budget numbers>.
```

Everything in §§1–7 above is then implied and costs nothing per wakeup.

**Only put a rule in the loop prompt if it is not true of the other loops.** If it
is true of all of them, it belongs in this file.

---

## 9. Checking a loop file

```bash
node scripts/loop-prompt.mjs                   # which loops can still run
node scripts/loop-prompt.mjs MOBILE_PARITY -c  # its /loop line, onto the clipboard

npm run loops                                  # all three checkers
npm run loops:test                             # all three self-checks

node scripts/loop-lint.mjs                     # every *.sh / *.md with LOOP in the name
node scripts/loop-lint.mjs GRID_LOOP.sh        # one
node scripts/graph-lint.mjs                    # do the loop graphs still resolve?
node ~/.claude/scripts/gate-guard.mjs          # did this diff weaken a gate?
```

`npm run loops` runs graph-lint and gate-guard **before** loop-lint on purpose. The
chain is `&&`, and loop-lint currently exits 1 on a known ledger backlog; running it
last means the two checks that are green today still report, and a new failure in
either surfaces immediately instead of hiding behind the backlog.

`gate-guard` lives in `~/.claude/scripts/`, not here: it has no repo assumptions —
just `git diff` and a regex — and every project needs it on day one. One copy, so
there is nothing to drift. The other two read this repo's `docs/` and root loop
files, so they stay repo-local.

The self-check is mutation-tested: disabling the CLOSED skip, forcing delegation
true, or removing the hard cap each make it fail. A check that cannot be made to
fail is a check that proves nothing.

The linter reduces `~/.claude/LOOP_STANDARD.md`'s nine parts to what a machine can
verify. A rule with no check is a wish.

Seventeen checks: usage header, single-line prompt, the ledger doc exists on disk,
first-unchecked-only, acceptance rows named, the three stop conditions, escalation,
a numeric cadence, persistence through a 429, commit format, the no-push rule,
real-numbers-in-the-log, judge-threshold discipline, and the two size bands.

**Scope is the word `LOOP`, not the suffix and not the extension.** `*_LOOP.sh` let
ten files opt out by how they were named — `LOOP_SELF_IMPROVE.sh` and
`CRYPTO_LOOP_V2..V10.sh` — and `.sh` let seven markdown loop specs opt out on top of
that. **15 → 25 → 32 files.** A checker whose scope is a naming convention checks
whatever agrees to be checked.

**Three shapes of loop file.** Most are a header plus one prompt line fed to `/loop`.
Some are bash harnesses that run the loop themselves (detected by shell expansion in
the last line — length cannot separate the two, because a terse delegating prompt is
legitimately short). Some are `.md` specs pasted in whole. The latter two have no
prompt line, so they are held to the four rules that belong to the **loop** rather
than to the **prompt** — target, budget, stall, judge-threshold — instead of being
drowned in prompt-shaped failures they cannot satisfy.

The `CLOSED` skip searches the whole file for those two shapes: a `.md` spec names
its ledger in prose, not on its last line. `COMPANY_LOOP.md` was failing three checks
purely because the skip only ever read the final line.

**`judge-threshold`.** A stop condition graded by a model score must name a
holdout, a distinct judge model, and a trial count. Identical repeated LLM-judge
evaluations flip their pairwise preference 13.6% of the time on average, agree
across judges only 76% (κ = 0.51), and need ~11 trials for a majority vote to
recover the 50-trial verdict at 95% confidence (arXiv 2606.13685). One judge call
at a fixed threshold is a coin with a bias. See `docs/LOOP_RESEARCH.md` §4.

Most checks pass either by stating the rule inline **or** by pointing at this file
— a loop that delegates gets them for free, which is the point.

**Size has two thresholds, deliberately.** A prompt over the **3,000-char hard cap**
is provably carrying contract text that belongs here. Between the **1,500-char
target** and that cap it merely warns, because a loop can legitimately have a lot
of genuine doctrine. Never trim real doctrine to hit a number: fix the number, or
accept the warning and say why.

### Baseline, first run 2026-08-03

15 loop files, 60,770 prompt chars, **15/15 failing**. What it found was not mainly
verbosity:

| Defect | Loops affected |
|---|---|
| no STALL stop condition | 11 |
| no numeric BUDGET | 13 |
| no escalation triggers | 4 |
| no usage header | 4 |
| names a ledger doc that does not exist (`QA_LOOP.sh`) | 1 |

`LOOP_SPEC.md` states that stop is three conditions. Most of these loops had one,
so they could not stop on stall and could not stop on budget — they ran until
someone noticed.

### After conversion

A loop whose ledger has **no unchecked boxes cannot run again**, so its prompt
costs nothing and its missing stop conditions cannot bite. The linter reports
those as `CLOSED` and does not lint them — a linter that fails on dead files
teaches you to ignore the linter. It still fails a loop whose ledger is missing
entirely.

Only **one** of the 15 loops was live: `MOBILE_FIELD_LOOP.sh` (10 open, 2 done).
Both it and the reference loop were converted; the other 13 were left alone,
because converting a ledger that will never run again is the exact waste this
file exists to remove.

| loop | before | after | cut |
|---|---|---|---|
| `DEXTER_INSTITUTIONAL_LOOP.sh` (reference) | 7,469 | **1,623** | 78% |
| `MOBILE_FIELD_LOOP.sh` (live) | 11,592 | **2,164** | 81% |

Total across all 15 fell 60,770 → 4,723 chars, because the 13 closed loops are no
longer counted at all.

**The biggest single win was not the shared contract.** `MOBILE_FIELD_LOOP.sh`
restated its own ledger's §3 doctrine, §4 hard constraints, §5 device matrix, §9
stop, §10 escalation and §11 cadence — in a prompt whose first instruction was to
read that ledger. Eleven of its fourteen clauses were already in the file it
pointed at. A loop prompt should name sections, not paraphrase them.

Remaining failure: `QA_LOOP.sh` names a ledger doc that does not exist. Its work
is finished, so it is a dead file rather than a broken loop — deliberately not
repaired.

### Second run 2026-08-06, after the scope fix

**32 files, 8 failing.** Widening scope past the `.sh` extension found seven markdown
loop specs that had never been linted. Six of the seven have **no stall condition**;
five have no numeric budget:

| file | missing |
|---|---|
| `ARCHITECTURE_DISCOVERY_LOOP.md` | budget, stall, judge-threshold |
| `LOOP_PROMPT.md` | target, stall, judge-threshold |
| `GAMMA_LOOP_TASK.md` | budget, judge-threshold |
| `LOOP_TASK.md` · `WC_LOOP_TASK.md` · `DR_LOOP_TASK.md` | budget, stall |
| `COMPANY_LOOP.md` | — (now correctly `CLOSED`) |
| `LOOP_SELF_IMPROVE.sh` | target, stall, judge-threshold |
| `QA_LOOP.sh` | 7, pre-existing, dead file |

None of these seven carries its own task boxes and only one named a ledger, so the
`CLOSED` skip cannot prove any of them dead. They can be pasted into `/loop` tomorrow
and would run without a stall condition — which is why they fail rather than being
excused. `ARCHITECTURE_DISCOVERY_LOOP.md` is the sharpest case: its only stop is
"continue while the completeness score < 95%", a score the agent computes about its
own documentation. That is a judged stop at n = 1 with no budget and no stall.

---

## 10. Known decoration

Three roadmaps (`AI_TRADING_AGENT`, `DEXTER_DESIGN`, `DEXTER_INSTITUTIONAL`) carry
a mermaid "graph of loops". **No loop prompt references one, and none was consulted
across the 15 DI tasks.** They restate doctrine the ledger already states in prose.

Left in place rather than deleted, but recorded here as unused: either cite one
from a loop prompt so it earns its keep, or delete it. An unread diagram rots into
a lie, because nothing fails when it stops matching the code.

**Resolved 2026-08-06 by making them fail.** `scripts/graph-lint.mjs` resolves every
concrete thing a graph node names — repo paths, `§N` sections, task IDs, camelCase
code symbols — and exits 1 when one stops resolving. A graph naming none of those is
reported as `DECORATION`. First run: 3 graphs, **17/17 refs resolve, 0 drifted** — the
diagrams were accurate, they were merely unchecked. The linter prints the *mix* of
reference kinds, because `DEXTER_INSTITUTIONAL`'s graph names no file and no code
symbol (4 sections, 3 task IDs) and is therefore checked far more weakly than the
other two. Mutation-verified against the real file: breaking one path yields
`FAIL 1/7`.

The same test applies to anything else in a ledger: if no task ever reads it, it is
not doctrine, it is decoration.

## 11. Gate integrity

A gate may grow. A gate may not shrink in the same change that claims it green.

`~/.claude/scripts/gate-guard.mjs` refuses a diff that shrinks a gate — a test file, an
`e2e/` spec, or a `scripts/*lint*|*gate*|*sweep*|*eval*` script. Run it before the commit
that flips a `[ ]`. Three ways to shrink one:

| finding | what it caught |
|---|---|
| `net assertion loss` | the file ends with fewer assertions than it started with |
| `weakened matcher` | the count held but the constraint dropped — `toBe(42)` → `toBeDefined()`, `toEqual({a:1})` → `toBeTruthy()` |
| `muted test` | a `.skip` / `.todo` / `.only` / `xit` was added |

Matcher strength is a token lookup, not an AST parse: the matcher *name* carries the whole
signal, so a parser dependency would buy precision nothing here consumes.

**Judged per file, and a rewrite at equal or greater strength is a printed note, not a
failure.** A line-by-line rule fires on every edit to a test — including strengthening one
— and a guard that always fires is a guard that gets bypassed. The bypass is the real loss.

Why, precisely: in the Darwin Gödel Machine (arXiv 2505.22954 Appendix H) the agent
was scored on whether tool-use hallucination markers appeared in its logs. Node 114
scored a perfect 2.0 after two modifications — by deleting the marker emission,
"despite instructions not to change the special tokens". The paper reports that
objective hacking "occurs more frequently when these functions are not hidden" from
the agent. Our loops cannot hide their gates — the same agent writes the test, the
code, and the ledger tick — so the next-cheapest defence is that a shrinking gate
cannot pass unnoticed.

If a deletion is genuinely correct, record in §8 which assertion went and why it no
longer grades anything real, then re-run with `--acknowledged`. Do not silence it.
