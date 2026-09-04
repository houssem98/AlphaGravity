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

Closing T10 therefore needs three things this loop did not do on its own
authority: push the branch, enable the workflow, and widen its trigger. Enabling
CI starts automation on `main` and is an outward-facing change, so it is an
escalation rather than a loop decision. It is recorded here as the named next
step, not performed.

**`2270 passed` and every count after it remain well-evidenced claims rather
than independently verified facts**, and round 3's documents say it that way.
