# MOBILE_FIELD_LOOP — feed the last line of this file to /loop:
#   /loop $(tail -1 MOBILE_FIELD_LOOP.sh)
#
# Ledger:   docs/MOBILE_FIELD_ROADMAP.md   (faults G1-G17, doctrine, MF-1..MF-12)
# Contract: docs/LOOP_CONVENTIONS.md — done-criteria, truth rules, repo hard
#           constraints, escalation, cadence, stop conditions, persistence.
#           The prompt below carries only what is true of THIS loop.
# Evidence: attachments/Screenshot_20260805-*.png — 16 real-device frames,
#           Android Chrome, portrait 720x1568 and landscape 1576x720 device px.
#           These are the specification. Read them.
# Target:   https://market-ui-self.vercel.app on a real phone, BOTH orientations
# Why V2:   docs/MOBILE_APP_ROADMAP.md closed 16/16 with 109 checks green, then
#           the phone showed 16 faults. V1 was blind in two axes: every gate
#           measured overflow at the document root (never a child painting OVER a
#           sibling), and every Playwright project was portrait (landscape is
#           ~788x360 CSS, ABOVE md:768, so the phone renders the desktop
#           three-panel shell in a 360px-tall viewport).
# Baseline: 857 vitest passing / 0 failing / 7 skipped; tsc 0 errors; 6 Playwright
#           projects green; V1 mobileSweep 109/109.
#
# ARCHIVE: the pre-conventions prompt was 11,592 chars, of which ~45% was the
# shared contract now in docs/LOOP_CONVENTIONS.md. Recoverable from git history.
# Do not restore it — the duplicated half was re-sent on every wakeup.
Read docs/MOBILE_FIELD_ROADMAP.md IN FULL FIRST — §3 doctrine, §4 hard constraints, §5 device matrix, §9 stop, §10 escalation, §11 cadence and §12 reporting are binding and are NOT repeated here. Then do the first unchecked [ ] task in §7 under the standard loop contract in docs/LOOP_CONVENTIONS.md. Commit scope mobile-field, task IDs MF-n. ONLY WHAT NEITHER FILE STATES: (1) THE SCREENSHOTS ARE THE SPEC — attachments/Screenshot_20260805-*.png, 16 real-device frames (portrait 720x1568 renders md:hidden MobileNav so CSS width is BELOW 768; landscape 1576x720 renders the md:flex rail so CSS width is AT OR ABOVE 768). Read the ones your task's fault names before touching code; where your wording and a screenshot disagree the screenshot wins and you say so in §8. Read no other file in attachments/, and treat any new file there as an escalation. (2) MOBILE IS A SECOND LAYOUT, NOT A SHRUNKEN FIRST ONE — panels sitting side by side on desktop become destinations on a phone, exactly one primary surface owns the viewport below the hinge, and any task whose answer is "make it smaller" is the wrong answer. Scope is layout and presentation ONLY: never edit a service, fetcher, API route or scoring fn, because a mobile task that seems to need different data needs a different LAYOUT, not a different payload. (3) TOKENS ONLY in new code — no hex literal, no text-[Npx], no rounded-2xl (off-scale), no prose-* (@tailwindcss/typography is NOT installed, so every prose class compiles to nothing). Legacy hex may stay unless a task names it. Grep your own diff for those four patterns before calling a task done. DONE ALSO REQUIRES, beyond the standard gates: npx playwright test green, and you loaded the live alias at the task's REAL viewport in its REAL orientation and pasted the measured numbers into the log (clientWidth x clientHeight, documentElement.scrollWidth minus clientWidth, the overpaint-pair count, the offending element's tag and classes and rect, the price-cell text versus the API payload value, the sheet height in dvh) — a fixture proves the component, only prod proves the product. BUDGET: 12 tasks or 20 iterations, whichever comes first.
