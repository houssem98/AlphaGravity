# Company Intelligence V4 — Control Graph

Execution order for `COMPANY_V4_ROADMAP.md`, with the failure behaviour that makes
it a loop rather than a checklist.

## Stop is three conditions

- **Target** — all six gates exit 0, *and* the full V3 + V2 + CF regression is
  green or its failures are measured at HEAD as pre-existing, *and* typecheck and
  build ran.
- **Budget** — one pass per row, at most 3 fix→retest cycles per row. A row that
  burns the third cycle escalates instead of looping again.
- **Stall** — 3 cycles on one row with no change in which assertion fails and no
  new failure mode. On stall: stop that row, record it OPEN with the failing
  assertion quoted, continue with rows that do not depend on it.

## Graph

```
RE-AUDIT (done — 6 findings, each VERIFIED at source or by execution;
          V3-10 re-verified CORRECT against fly.toml)
     │
     ▼
CLASSIFY  P0: V4-1 V4-2 V4-3 V4-4      P1: V4-5 V4-6
     │
     ▼
P0 WAVE 1 — no dependencies, run first
     ├── V4-1  period engine        gates/v4-1-gate.py
     ├── V4-2  paid-route auth      gates/v4-2-gate.mjs
     └── V4-5  schema duplicates    (asserted inside v4-1-gate.py)
     │
     ▼
P0 GATE 1 ──FAIL──► FIX ──► RETEST  (≤3 cycles, then escalate)
     │ PASS
     ▼
P0 WAVE 2 — depend on wave 1 or on each other
     ├── V4-3  disputed-fact UI     gates/v4-3-gate.mjs
     ├── V4-4  citation contract    gates/v4-4-gate.mjs
     └── V4-6  DataTab formatter    (same cell as V4-3 — strictly after it)
     │
     ▼
P0 GATE 2 ──FAIL──► FIX ──► RETEST
     │ PASS
     ▼
FULL REGRESSION — every prior gate, not only the new ones
     cf1 cf4 cf5 cf6 cf8 cf10 cf15 cf16 cf18-19 cf20 cf21 cf24 cf25 cf28
     v2-1 … v2-8 · v3-1 … v3-10
     vitest (market-ui, market-server) · targeted pytest
     │
     ├── A PRIOR GATE THAT WAS GREEN IS NOW RED
     │        → REGRESSION. Return to the fix loop. Do NOT edit the gate.
     ├── A PRIOR GATE WAS ALREADY RED
     │        → measure it at HEAD with the tree stashed before calling it
     │          pre-existing. "Pre-existing" is a measurement, never an assumption.
     └── GREEN
          │
          ▼
TYPECHECK + BUILD
     npx tsc --noEmit -p tsconfig.app.json     (market-ui)
     npm run build                              (market-ui)
     npx tsc --noEmit                           (market-server — RED AT HEAD,
                                                 24 errors, compare the count)
     python -m compileall                       (changed modules)
     │
     ▼
RUNTIME VERIFY — where it can actually be done
     Gates that compile and CALL the shipped module count as runtime.
     Production does NOT: Fly is frozen behind an overdue invoice and
     /v1/company/{t}/trend answers 404 there. Anything needing prod is
     marked UNVERIFIED, never assumed.
     │
     ▼
RE-AUDIT — re-read each changed file, confirm the defect is gone from the
           source rather than relocated into a helper the gate does not read
     │
     ├── STILL PRESENT ──► FIX LOOP
     └── GONE
          │
          ▼
EVIDENCE-CLASSIFIED SCORE → COMPANY_V4_EXECUTION_REPORT.md
```

## Gate integrity

A gate may grow; it may never shrink in the change that claims it green.
Before any commit that closes a row:

```bash
node ~/.claude/scripts/gate-guard.mjs
```

V4 adds a specific rule learned from V3: **three V3 gates are structural only**
(v3-6, v3-7, v3-8 — they match source patterns rather than executing behaviour).
Where V4 changes behaviour those gates cover, the V4 gate must be **behavioural**:
compile the shipped module, call it, assert on the return value. A source-pattern
assertion is permitted only as a supplement, never as the whole gate.

Comments are stripped before any source-pattern assertion, because this ledger's
comments quote the code they replace and a check that reads them grades prose.

## Escalation triggers — halt, do not decide alone

- Any irreversible or outward-facing action. **Nothing in this ledger deploys.**
- A gate that cannot pass without removing or loosening an assertion.
- Any change to what a figure *claims*, as opposed to how it is displayed.
- A fix requiring an ingest change or a backfill — V3's E-1 is already one of
  these, and V4-4's segment work would be another.
- A P1/P2 feature whose input data cannot be shown to exist.

## Gate commands

| Row | Gate | Command |
|-----|------|---------|
| V4-1 + V4-5 | `gates/v4-1-gate.py` | `python docs/company-feature/gates/v4-1-gate.py` |
| V4-2 | `gates/v4-2-gate.mjs` | `node docs/company-feature/gates/v4-2-gate.mjs` |
| V4-3 | `gates/v4-3-gate.mjs` | `node docs/company-feature/gates/v4-3-gate.mjs` |
| V4-4 | `gates/v4-4-gate.mjs` | `node docs/company-feature/gates/v4-4-gate.mjs` |

```bash
for g in docs/company-feature/gates/v4-*.mjs; do node "$g" || echo "RED $g"; done
cd services/gravity-api && for g in ../../docs/company-feature/gates/v4-*.py; do python "$g" || echo "RED $g"; done
```

## Reporting rule

A failed gate is a real result. A row that cannot close is reported OPEN with the
failing assertion quoted verbatim — not downgraded to "partially done". No score
is claimed above what the executed commands prove, and every claim carries its
evidence class: VERIFIED / PARTIALLY VERIFIED / UNVERIFIED / INFERENCE.
