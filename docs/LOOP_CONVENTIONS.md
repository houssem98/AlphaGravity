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
node scripts/loop-lint.mjs                     # every *_LOOP.sh
node scripts/loop-lint.mjs GRID_LOOP.sh        # one
```

The linter reduces `~/.claude/LOOP_STANDARD.md`'s nine parts to what a machine can
verify. A rule with no check is a wish.

Sixteen checks: usage header, single-line prompt, the ledger doc exists on disk,
first-unchecked-only, acceptance rows named, the three stop conditions, escalation,
a numeric cadence, persistence through a 429, commit format, the no-push rule,
real-numbers-in-the-log, and the two size bands.

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
