# DEXTER_INSTITUTIONAL_LOOP — feed the last line of this file to /loop:
#   /loop $(tail -1 DEXTER_INSTITUTIONAL_LOOP.sh)
#
# Ledger:   docs/DEXTER_INSTITUTIONAL_ROADMAP.md  (gaps G1-G13, doctrine, DI-1..DI-15)
# Prior:    docs/AI_TRADING_AGENT_ROADMAP.md      (DX-1..DX-17)
#           docs/DEXTER_DESIGN_ROADMAP.md         (DD-1..DD-14, closed 14/14)
# Status:   COMPLETE 15/15 as of 2026-08-03; G13 closed, macro extension shipped.
#           A re-run stops on TARGET immediately, which is the correct behaviour.
#
# Contract: docs/LOOP_CONVENTIONS.md carries done-criteria, truth rules, repo hard
#           constraints, escalation, cadence, the three stop conditions and
#           persistence. The prompt below states ONLY what is true of this loop
#           and no other.
#
# ARCHIVE: the pre-conventions prompt was 7,469 chars, roughly 55% of it the
# contract now held in docs/LOOP_CONVENTIONS.md. Recoverable from git history
# (any commit before the LOOP_CONVENTIONS one). Do not restore it — the
# duplicated half was re-sent on every wakeup.
Read docs/DEXTER_INSTITUTIONAL_ROADMAP.md. Do the first unchecked [ ] task in §7 under the standard loop contract in docs/LOOP_CONVENTIONS.md — read that file first. Commit scope dexter-inst, task IDs DI-n. DELTAS TRUE ONLY HERE: (1) HARD GATE — DI-1 and DI-2 must both be [x] before any task from DI-4 onward runs; until then no ledger line, commit or sentence may quote a performance number without BOTH a contamination label and a cost basis. (2) Every existing R is suspect until measured — the replay windows sit inside deepseek-v4-flash's plausible training range. (3) The model never emits a number code can compute: direction may be argued, but size, stop distance, R:R, exposure, heat, correlation and limits are arithmetic, and a model-supplied value for a computable field is discarded and replaced. (4) Hybrid not autonomous — deterministic logic proposes, the LLM arbitrates; veto and downgrade allowed, inversion rejected with a recorded reason. (5) Falsifiability: every thesis states what would prove it wrong and by when, and an invalidation trigger is a condition distinct from the stop; a view without one renders as an explicit gap. (6) Report gross AND net with assumptions inline; a zero-cost run must be asked for by name. (7) Never regress the spine — citations, trust grading, honest-empty, the trace, the journal and the DD-1..DD-14 presentation contract stay green; this ledger is additive. (8) §3 lists fredService, pdfDesigner and evaluation as verify-before-reuse; each has failed its own probe before, so probe again rather than cite. BUDGET: 15 tasks or 25 iterations, whichever comes first.
