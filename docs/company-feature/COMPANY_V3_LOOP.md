# Company Intelligence V3 — Control Graph

The execution order for `COMPANY_V3_ROADMAP.md`. This file is the control graph:
what runs, what it is blocked on, what proves it, and what happens when a gate fails.

## Stop is three conditions

- **Target** — all ten gates exit 0 *and* the full regression, typecheck and build
  were actually run. A gate that was not executed is not a pass.
- **Budget** — one pass per row plus at most 3 fix→retest cycles per row. A row that
  burns its third cycle escalates instead of looping again.
- **Stall** — 3 consecutive cycles on one row with no change in which assertion fails
  and no new failure mode. On stall: stop that row, record it OPEN with the failing
  assertion quoted, and continue with the rows that do not depend on it.

## Gate integrity

A gate may grow; it may never shrink in the change that claims it green. Before the
commit that closes any row:

```bash
node ~/.claude/scripts/gate-guard.mjs
```

Deleting an assertion, loosening one (`toBe(42)` → `toBeDefined()`), or removing the
instrumentation a gate reads is an escalation that must name which assertion went and
why it no longer grades anything real.

## Dependency graph

```
                        RE-AUDIT  (done — 9 confirmed at source, +1 promoted)
                            │
                            ▼
                      CLASSIFY P0 / P1
                            │
        ┌───────────────────┴───────────────────┐
        ▼                                       ▼
   PHASE A · P0                            (blocked until A passes)
        │
        ├── V3-2  unit stays unknown ──────────┐   server contract
        │                                      │   changes first:
        ├── V3-3  ambiguous restatement ───────┤   V3-1 and V3-9 both
        │                                      │   consume `unit`
        ├── V3-4  exact period match           │
        │                                      │
        └── V3-1  margin ≠ profit  ◄───────────┘   depends on V3-2
        │
        ▼
   P0 GATE: v3-1 v3-2 v3-3 v3-4
        │
        ├── FAIL ──► FIX ──► RETEST  (≤3 cycles, then escalate)
        │
        └── PASS
              │
              ▼
        PHASE B · P1
              │
              ├── V3-5  trend failure named        (independent)
              ├── V3-6  resolver fault ≠ navigate  (independent)
              ├── V3-7  evidence-bound prompt      (independent)
              ├── V3-8  health spends nothing      (independent)
              ├── V3-10 meter key unspoofable      (independent)
              └── V3-9  one axis, one unit  ◄───── depends on V3-2
              │
              ▼
        P1 GATE: v3-5 … v3-10
              │
              ├── FAIL ──► FIX ──► RETEST  (≤3 cycles, then escalate)
              │
              └── PASS
                    │
                    ▼
        FULL REGRESSION — every prior gate, not only the new ones
          cf1 cf4 cf5 cf6 cf8 cf10 cf15 cf16 cf18-19 cf20 cf21 cf24 cf25 cf28
          v2-1 … v2-8
          vitest run   (market-ui unit suites)
                    │
                    ├── ANY PRIOR GATE RED ──► that is a REGRESSION, not a
                    │                          new finding. Return to the fix
                    │                          loop for the row that caused it.
                    └── GREEN
                          │
                          ▼
        TYPECHECK + BUILD
          npm -w market-ui run typecheck
          npm -w market-ui run build
          npm -w market-server run build
          python -m compileall on the touched modules
                    │
                    ▼
        FINAL RE-AUDIT — re-read each changed file and confirm the
        defect described in the ledger is actually gone from the source,
        not merely routed around
                    │
                    ├── REGRESSION ──► FIX LOOP
                    └── PASS
                          │
                          ▼
        EVIDENCE-BASED SCORE — every claim names the command that proved it
                          │
                          ▼
        COMPANY_V3_EXECUTION_REPORT.md
```

## Why this order

**V3-2 runs before V3-1 and V3-9.** All three are the same bug seen from three
places: a unit that is unknown becomes USD. Fixing the display first would make the
display correct about a value the server already corrupted, and the client gate would
pass against a lie. The server contract changes first; the two display rows then
consume it.

**V3-3 runs before anything that reads `accession`.** If a figure can be attributed
to the wrong filing, a later row that renders that attribution more prominently makes
the defect more visible, not less real.

**Phase B never runs while a Phase A gate is red.** This is the masking rule: a P1
row that touches the same file as a failing P0 row can turn the P0 gate green by
moving code rather than by fixing it. The P0 gates are re-run inside the full
regression precisely so a later change cannot quietly close them.

## Escalation triggers — halt and ask, do not decide alone

- Any irreversible or outward-facing action. **Nothing in this ledger deploys.**
  `vercel --prod`, `fly deploy`, `git push` are all out of scope; the work lands on
  the branch and stops there.
- A gate that cannot be made to pass without removing an assertion.
- Any change to what a figure *claims*, as opposed to how it is displayed —
  E-1 is exactly this, and it is recorded rather than decided silently.
- A fix that would require an ingest change or a backfill.

## Per-row gate commands

| Row | Gate | Command |
|-----|------|---------|
| V3-1 | `gates/v3-1-gate.mjs` | `node docs/company-feature/gates/v3-1-gate.mjs` |
| V3-2 | `gates/v3-2-gate.py` | `python docs/company-feature/gates/v3-2-gate.py` |
| V3-3 | `gates/v3-3-gate.py` | `python docs/company-feature/gates/v3-3-gate.py` |
| V3-4 | `gates/v3-4-gate.py` | `python docs/company-feature/gates/v3-4-gate.py` |
| V3-5 | `gates/v3-5-gate.mjs` | `node docs/company-feature/gates/v3-5-gate.mjs` |
| V3-6 | `gates/v3-6-gate.mjs` | `node docs/company-feature/gates/v3-6-gate.mjs` |
| V3-7 | `gates/v3-7-gate.mjs` | `node docs/company-feature/gates/v3-7-gate.mjs` |
| V3-8 | `gates/v3-8-gate.mjs` | `node docs/company-feature/gates/v3-8-gate.mjs` |
| V3-9 | `gates/v3-9-gate.mjs` | `node docs/company-feature/gates/v3-9-gate.mjs` |
| V3-10 | `gates/v3-10-gate.mjs` | `node docs/company-feature/gates/v3-10-gate.mjs` |

Every gate exits 0 on pass and non-zero on fail, so the graph is machine-checkable:

```bash
for g in docs/company-feature/gates/v3-*.mjs; do node "$g" || echo "RED $g"; done
for g in docs/company-feature/gates/v3-*.py;  do python "$g" || echo "RED $g"; done
```

## Reporting rule

A failed gate is a real result. If a row cannot be closed, the report says so with the
failing assertion quoted verbatim — it does not get downgraded to "partially done", and
no score is claimed above what the executed commands prove.
