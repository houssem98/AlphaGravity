# Reproducing round 3's numbers

T10's complaint is fair and is not answered by asserting the number again. Every
"closed" claim in rounds 2 and 3 rests on a suite count executed inside the
session that produced it, by the process that wanted it to pass. This file is
what an outsider needs to check that, and an honest statement of what it still
does not give them.

## The command

```bash
cd services/gravity-api
python -m pytest tests/ -q --ignore=tests/live --ignore=tests/eval
node ~/.claude/scripts/gate-guard.mjs      # from the repo root
```

`tests/live` needs network and credentials. `tests/eval` is excluded by the
roadmap's own eval definition — note it does **not** exclude
`eval/head_to_head/rubric.py`, which is the module round 3 spent four loops in.

## The environment these numbers came from

| | |
|---|---|
| Python | 3.12.10 |
| pytest | 9.0.3 |
| Platform | Windows 11, `services/gravity-api/.venv` |
| Branch | `feat/web-research-sec-integration` |
| Wall time | 570–940s per run |

Wall time varies by ~40% between identical runs because parts of the suite block
on network timeouts rather than compute. A run that looks hung usually is not;
pytest buffers its progress dots when stdout is not a terminal.

## What was recorded, and against which commit

| Commit | Loop | Count | gate-guard | Delta and what accounts for it |
|---|---|---|---|---|
| `82a7d3d` | baseline | 2270 passed / 0 failed | clean | — |
| `4ce49b0` | L1 · T1, T2 | 2280 passed / 0 failed | clean | +10 = 9 new in `test_rubric_not_wider_than_gate.py`, net +1 in `test_head_to_head_rubric.py` |
| `79660a6` | L2 · T3 | 2298 passed / 0 failed | clean | +18 = `test_rubric_accession_is_validated.py` |
| `f3b3b63` | L3 · T5 | 2299 passed / 0 failed | clean | +1 = `test_a_cik_alone_cannot_bind_an_entity` |
| `64f4b8d` | L4 · T4 | 2310 passed / 0 failed | clean | +11 = `test_entity_unknown_is_ungraded.py` |

Every delta is accounted for by tests added in that commit. No count dropped,
and no test was deleted, skipped or loosened at any point — `gate-guard` ran
before each commit that claims a fix.

**Reconciling a delta is the check worth doing.** A count that rises by more
than the tests added means something was parametrised or duplicated; one that
rises by less means something stopped running. Both are invisible if you only
compare the totals.

## What this still does not establish

**Nobody outside the session has executed any of it.** That is T10's actual
claim and this file does not close it — it makes the claim checkable, which is a
different and smaller thing.

**The branch is now pushed.** `28b3b84..279cd98` on
`origin/feat/web-research-sec-integration`, tree clean, nothing ahead. Every SHA
quoted in round 3's documents is reachable by anyone with repository access —
which closes the guardrail round 2 lost a cycle to, though not T10 itself.

**The CI scope was verified locally before anything was proposed.** The
workflow's test command differs from the roadmap's: it runs `pytest tests/` with
no `--ignore` flags. Run that way, the result is **2315 passed, 56 skipped, 0
failed** — `tests/live` self-skips because it is opt-in behind
`GRAVITY_LIVE_SEC=1`, and `tests/eval` contributes nothing because its files are
benchmark runners rather than `test_*.py` modules. So the wider scope is safe.

**No SHA in this range carries a status check.** The reason is now specific
rather than assumed:

- `.github/workflows/ci.yml` does not exist. `.github/workflows/ci.yml.disabled`
  does, and it runs `pytest tests/` for the API — so CI is switched off here,
  not absent.
- Even enabled, it triggers on `push: [main, develop]` and `pull_request:
  [main]`. `feat/web-research-sec-integration` matches neither, so it would not
  fire on this work regardless.
- The branch is unpushed at the time of writing, so no remote SHA exists to
  attach a check to.

**And enabling it would fail on lint, not on tests.** Measured before proposing
it, which changed the recommendation:

| Workflow step | `continue-on-error` | Local result |
|---|---|---|
| `ruff check app/` | **no** | **1347 errors** |
| `ruff format --check app/` | **no** | **211 files would be reformatted** |
| `pyright app/` | yes — advisory | — |
| `pytest tests/` | no | **2315 passed, 0 failed** |

Renaming `ci.yml.disabled` to `ci.yml` would make `api-lint` fail on every push
to `main`, permanently, while the tests pass. It would publish a red `main` that
says the codebase is broken when what is actually broken is a lint
configuration nobody has ever enforced. **That is the likely reason the workflow
is disabled**, and it is recorded here so the next person does not rediscover it
by turning `main` red.

So T10 does not reduce to "switch CI on". The options, in increasing cost:

1. **A narrow workflow that runs only the suite** on this branch — additive,
   leaves `ci.yml.disabled` alone, and produces exactly the status check T10
   asks for. The test scope behind it is already verified green.
2. **Fix the lint debt**, then enable the full workflow. 1347 errors and 211
   files is a real piece of work and is nothing to do with quick-answer quality.
3. **Leave it**, and record `2270`–`2315` as well-evidenced claims rather than
   independently verified facts — which is what every round-3 document already
   says.

None of these is a loop decision. Option 1 is the cheapest thing that would
actually close T10.

**`2270 passed` and every count after it remain well-evidenced claims rather
than independently verified facts**, and round 3's documents say it that way.
