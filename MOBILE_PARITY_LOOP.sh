# MOBILE_PARITY_LOOP — feed the last line of this file to /loop:
#   /loop $(tail -1 MOBILE_PARITY_LOOP.sh)          bash / WSL / IDE terminal
#   /loop $(Get-Content MOBILE_PARITY_LOOP.sh -Tail 1)   PowerShell
#
# Neither expanding? Any shell, straight to the clipboard:
#   node scripts/loop-prompt.mjs MOBILE_PARITY -c
#
# Ledger:   docs/MOBILE_PARITY_ROADMAP.md   (faults F1-F5 / U1-U4, rows R1-R12, MP-1..MP-9)
# Contract: docs/LOOP_CONVENTIONS.md — done-criteria, truth rules, repo hard
#           constraints, escalation, cadence, stop conditions, persistence.
#           The prompt below carries only what is true of THIS loop.
# Evidence: attachments/Screenshot_20260805-*.png — 16 real-device frames,
#           Android Chrome, portrait 720x1568 and landscape 1576x720 device px.
# Target:   https://market-ui-self.vercel.app on a real phone, BOTH orientations
# Why V3:   V1 (MOBILE_APP) closed 16/16 and the phone showed 16 faults. V2
#           (MOBILE_FIELD) built the overpaint evaluator and closed what it could
#           see. The 2026-08-05 frames show V2 green and the phone still wrong:
#           a cell that CLIPS its own text is covered by nothing, so overpaintPairs
#           finds no pair, and R7 compares DOM textContent which is intact. The
#           pixels are wrong and every assertion passes. V3's axis is legibility.
# Check:    npm run loops   (graph-lint -> gate-guard -> loop-lint)
Read docs/MOBILE_PARITY_ROADMAP.md IN FULL FIRST — §2 anchors, §3 doctrine, §4 device matrix, §5 faults, §9 stop, §10 escalation, §11 cadence are binding and are NOT repeated here. Then do the first unchecked [ ] task in §7 under the standard loop contract in docs/LOOP_CONVENTIONS.md. Commit scope mobile-parity, task IDs MP-n. ONLY WHAT NEITHER FILE STATES: (1) THE BLIND SPOT IS THE POINT — V2's instruments answer "is anything covering this?" and "does the DOM string match the payload?", and a self-clipping cell passes both, so until MP-1 ships you may not call any F or U row green on the strength of an existing gate; if your fix makes an old gate greener without making clippedText quieter you have measured nothing. (2) THE FRAMES ARE THE SPEC — read only the ones your task's fault row names, and where your wording and a frame disagree the frame wins and you say so in §8; treat any new file in attachments/ as an escalation. (3) NEVER SHRINK THE TYPE — clipped text is fixed by widening, reflowing or moving the value, never by dropping below the type scale, and a diff that closes a row by reducing font size is rejected even if the row goes green. (4) U ROWS ARE UTILITY, NOT OVERFLOW — a nine-column grid rendered one letter per line is not overflowing and is still broken; MP-7 owes a phone layout, not a narrower table. DONE ALSO REQUIRES, beyond the standard gates: npx playwright test green, and you loaded the live alias at the task's REAL viewport in its REAL orientation and pasted the measured numbers into §8 (clientWidth x clientHeight, documentElement.scrollWidth minus clientWidth, clippedText count and the worst clipped px, overpaint-pair count, the price-cell rendered text versus the API payload value) — a fixture proves the component, only prod proves the product. BUDGET: 9 tasks or 20 iterations, whichever comes first.
