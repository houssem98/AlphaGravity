# GRAVITY_LOOP — search-quality loop for gravity-api. Start it with three words:
#
#   /loop /gravity
#
# That slash command is generated from the last line of this file. If it is
# missing or the listing says STALE, regenerate:
#   node ~/.claude/scripts/loop-prompt.mjs --install
#
# The raw form still works: /loop $(tail -1 GRAVITY_LOOP.sh)
#
# Ledger:   docs/GRAVITY_SEARCH_ROADMAP.md  (tasks GS-1..GS-10, gaps G1-G8,
#           rows R1-R10 in §6, budget §4, loop graph §12)
# Contract: docs/LOOP_CONVENTIONS.md — done-criteria, truth rules, repo hard
#           constraints, escalation, cadence, stop conditions, persistence.
#           The prompt below carries only what is true of THIS loop.
# Why:      gravity_search_gap_roadmap.md (repo root) proposed adding an SEC EDGAR
#           channel. Measured on 2026-08-17, the corpus already holds the numbers:
#           AMD_CostOfGoodsAndServicesSold_FY2025_xbrl = 17,487,000,000 sits in
#           Supabase while prod answers "cost of goods sold is missing from the
#           sources". Ten channels registered, two alive — dense died with the
#           Qdrant cluster and the secret outlived it. Adding sources on top of a
#           selection bug buys nothing. §1 has the measurements.
# Live:     measured 2026-08-17 against gravity-api-prod.fly.dev, not from source —
#           /health 200 in 0.42s, image from 2026-07-07, cache-miss channels
#           ["structured","bm25"], cache-HIT channels [] with model_used "unknown".
#           Supabase 294MB of the 500MB free tier: financials 197MB (150,743 exact
#           xbrl rows / 501 tickers, 309,835 non-xbrl rows), chunks 69MB / 31
#           tickers. FinanceBench baseline 0.40 type-aware on 25 questions —
#           SE +/-9.8 points, which is why GS-7 widens it before it grades anything.
# Check:    npm run loops   (graph-lint -> governance -> gate-guard -> loop-lint)
#           node scripts/search-probe.mjs   (exists once GS-1 lands)
Read docs/GRAVITY_SEARCH_ROADMAP.md IN FULL FIRST — §1 measured truth, §2 anchors, §3 doctrine, §4 budget, §6 rows, §9 stop, §10 escalation, §11 cadence all bind and are NOT repeated here. Then do the first unchecked [ ] task in §7 under the standard loop contract in docs/LOOP_CONVENTIONS.md. Commit scope search, task IDs GS-n. ONLY WHAT NEITHER FILE STATES: (1) GS-1 IS THE GATE — scripts/search-probe.mjs is this loop's kill authority; run it plus node scripts/governance.mjs docs/GRAVITY_SEARCH_ROADMAP.md FIRST every wakeup, and a non-zero exit halts the loop whatever §7 says. Until the probe exists, writing it IS the task. (2) SELECTION BEFORE SOURCES — §1 proves the corpus already holds facts prod calls missing, so no task may add a source, a channel or an API to fix something a better query would have retrieved. (3) PROD IS READ-ONLY — measure against gravity-api-prod.fly.dev with header X-API-Key eval-unlimited-fb-2026, change code locally, and deploying is escalation E-F. (4) EVERY WRITE STATES ITS MB — print the Supabase DB total before and after; 450MB halts the loop, it does not warn it. (5) FREE TIER OR ESCALATE — halfvec(512) plus voyage-3.5-lite, never a paid vector DB, reranker or LLM key (§10 E-S). (6) THE PROBE NEVER SHRINKS — deleting or loosening an assertion to make a task pass is exactly what gate-guard catches; run node ~/.claude/scripts/gate-guard.mjs before every commit claiming green. (7) TWO THINGS ARE NOT YOURS TO DECIDE — GS-4's DELETE of 309,835 rows and any push or deploy; stop at the diff and log ESCALATION in §8. DONE ALSO REQUIRES, beyond the standard gates: probe exit 0, the §6 row IDs the task claims, and the measured numbers pasted into §8 — channels named, DB MB before/after, dev-split result, cumulative dollars spent. BUDGET: 10 tasks, 26 iterations or $15 of LLM spend, whichever comes first.
