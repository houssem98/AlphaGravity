# COMMAND_TERMINAL_V2_LOOP — start it with three words, not a pasted wall of text:
#
#   /loop /command-terminal-v2
#
# That slash command is generated from the last line of this file. If it is
# missing or the listing says STALE, regenerate:
#   node ~/.claude/scripts/loop-prompt.mjs --install
#
# The raw form still works: /loop $(tail -1 COMMAND_TERMINAL_V2_LOOP.sh)
#
# Ledger:   docs/COMMAND_TERMINAL_V2_ROADMAP.md  (gaps P1-P6 / V1-V4, rows R1-R12, CT2-1..CT2-10)
# Contract: docs/LOOP_CONVENTIONS.md — done-criteria, truth rules, repo hard
#           constraints, escalation, cadence, stop conditions, persistence.
#           The prompt below carries only what is true of THIS loop.
# Prior:    docs/COMMAND_TERMINAL_ROADMAP.md closed at CT-10 — 5 buildable commands,
#           3 blocked, and one escalation (Q1b, no provenance) it could not close
#           from inside market-ui. This ledger picks that up. §1 records where the
#           LinqAlpha brief disagrees with the tree, measured not remembered.
# Why:      their lead claim is "source-linked research you can verify" and we ship
#           zero of it — yet company.py:80 FILTERS on document_id and :83 never
#           SELECTS it. The id is in the row and dropped at the API boundary. The
#           second half is the outer loop: V1-V4 give the loop an authority above
#           itself, which the last ledger did not have.
# Source:   the loop-governance article is PAYWALLED. §1 says so and names exactly
#           which four concepts came from the free preview. Do not invent the rest.
# Check:    npm run loops   (graph-lint -> gate-guard -> loop-lint -> governance)
Read docs/COMMAND_TERMINAL_V2_ROADMAP.md IN FULL FIRST — §1 brief-vs-tree, §2 anchors, §3 doctrine, §4 matrix, §9 stop, §10 escalation, §11 cadence are binding and are NOT repeated here. Then do the first unchecked [ ] task in §7 under the standard loop contract in docs/LOOP_CONVENTIONS.md. Commit scope command-terminal-v2, task IDs CT2-n. ONLY WHAT NEITHER FILE STATES: (1) CT2-1 IS THE GATE — scripts/governance.mjs is the loop's kill authority (§9 KILL, rows R9/R10/R11) and no product task may claim green before R1 is green; run it FIRST every wakeup, and a non-zero exit halts the loop whatever the task ledger says. (2) MEASURE BEFORE YOU SHIP — CT2-2 is a probe that changes no UI; if zero document_id values resolve against the filings payload then CT2-3 closes ⛔ with that number, because a citation you cannot resolve is worse than an honest null. (3) NEVER INFER A CITATION — resolution is an ID LOOKUP against company.py filings; matching a figure to a filing by period FAILS row R5 however plausible it looks, and where provenance is absent you render the honest-null marker and record the count. (4) ADDRESS, DO NOT REBUILD — every buildable command routes to a surface that already renders, so reuse parseBlock and dexterLang from src/services/dexterBlocks.ts; a diff that re-implements a Company tab, a peer strip or a second widget system has taken the wrong turn. (5) THE BUDGET IS SPENT — apps/market-ui/api holds 12 of 12 Vercel functions, so a new route, a new npm dependency or a vercel.json change is an ESCALATION, and /screening may re-close ⛔ with its measurement rather than inventing a screener. (6) TIERS ARE REAL — a §7 task marked review: human may not be checked [x] without an escalation entry in §8, and row R11 is what catches it. DONE ALSO REQUIRES, beyond the standard gates: governance.mjs green, you loaded the live alias, you typed the command into the real Quick Answer textarea, and you pasted the measured numbers into §8 (figures total / with source / null / bare, document_id rows and how many resolved, tap count per command versus the mode-toggle path). BUDGET: 10 tasks or 24 iterations, whichever comes first.
