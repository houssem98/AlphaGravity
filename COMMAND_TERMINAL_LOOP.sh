# COMMAND_TERMINAL_LOOP — start it with three words, not a pasted wall of text:
#
#   /loop /command-terminal
#
# That slash command is generated from the last line of this file. If it is
# missing or the listing says STALE, regenerate:
#   node ~/.claude/scripts/loop-prompt.mjs --install
#
# The raw form still works: /loop $(tail -1 COMMAND_TERMINAL_LOOP.sh)
#
# Ledger:   docs/COMMAND_TERMINAL_ROADMAP.md  (gaps G1-G4 / Q1a-Q3, rows R1-R11, CT-1..CT-10)
# Contract: docs/LOOP_CONVENTIONS.md — done-criteria, truth rules, repo hard
#           constraints, escalation, cadence, stop conditions, persistence.
#           The prompt below carries only what is true of THIS loop.
# Source:   gemini-code-1786132427239.md is the ORIGINAL BRIEF, not the spec.
#           §1 of the ledger records, line by line, where it disagrees with the
#           tree — two of its seven skills are unbuildable, two more are already
#           tabs, and its Phase 2 shipped before it was written.
# Why:      five of the seven surfaces already exist and none of them has an
#           ADDRESS. The second half is output quality: GravityMetric carries
#           {metric,value,unit?,period?,ticker?} and nothing else, so the figures
#           cannot be cited and Q1b is closed by escalation, never by inference.
# Check:    npm run loops   (graph-lint -> gate-guard -> loop-lint)
Read docs/COMMAND_TERMINAL_ROADMAP.md IN FULL FIRST — §1 brief-vs-tree, §2 anchors, §3 doctrine, §4 command matrix, §9 stop, §10 escalation, §11 cadence are binding and are NOT repeated here. Then do the first unchecked [ ] task in §7 under the standard loop contract in docs/LOOP_CONVENTIONS.md. Commit scope command-terminal, task IDs CT-n. ONLY WHAT NEITHER FILE STATES: (1) NEVER INFER A CITATION — GravityMetric (CompanyPage.tsx:65) has no accession, no document id, no report date and no GAAP basis, so any code that maps a figure to a filing by matching periods FAILS row 7b however plausible it looks; where provenance is absent you render the honest-null marker, record the count, and escalate the payload gap to gravity-api rather than closing it in this repo. (2) ADDRESS, DO NOT REBUILD — every buildable command in §4 routes to a surface that already renders, so if your diff re-implements a Company tab, a peer strip or a second widget system you have taken the wrong turn; reuse parseBlock and dexterLang from src/services/dexterBlocks.ts, which the answer feed already renders. (3) THE BUDGET IS SPENT — api/ holds 12 of 12 Vercel functions and api/_sina.ts is underscore-ignored, so a task that needs a new route or a new npm dependency (including any rich-text editor) is an ESCALATION, and /capex and /tariff-risk close as ⛔ with the measurement that proves it, never as a fabricated answer. (4) A LABEL IS PART OF THE NUMBER — a figure ships with its period and its unit or it ships as a null, fiscal periods carry their period-end because FY2026 ended in January 2026 for NVDA, and a comparison states its basis or says it cannot. DONE ALSO REQUIRES, beyond the standard gates: you loaded the live alias, typed the command into the real Quick Answer textarea, and pasted the measured numbers into §8 (figures total / labelled / null / bare, traceable-to-source count, request count via the command path versus the mode-toggle path, tap count, and the seven keyboard assertions individually). BUDGET: 10 tasks or 22 iterations, whichever comes first.
