# Hermes flywheel report — 2026-07-08

**Scheduled runs on record:** 9
**Health checks:** 5 run(s), 5 all-green (100% pass)
**Alert firings:** 1
**Daily-brief streak:** 3 day(s) ['2026-07-06', '2026-07-07', '2026-07-08']
**Skills installed:** 7 — agm-dividends, bvmt-health, tn-alerts, tn-brief, tn-drift, tn-grounding, tn-sector-deepdive

## Per-job
- agm-dividends: 1 run(s)
- bvmt-health-close: 3 run(s), 3 green
- bvmt-health-open: 2 run(s), 2 green
- tn-alerts: 1 run(s), 1 fired
- tn-daily-brief: 2 run(s)

## Skill dedupe audit
Tags shared by >1 skill (expected overlap, no dupes to merge):
- `BVMT`: agm-dividends, bvmt-health, tn-alerts, tn-brief, tn-drift, tn-grounding, tn-sector-deepdive
- `Fundamentals`: agm-dividends, tn-sector-deepdive
- `Monitoring`: agm-dividends, bvmt-health, tn-brief, tn-drift
- `Premium Content`: tn-brief, tn-sector-deepdive
- `TSE`: agm-dividends, bvmt-health, tn-grounding
- `TUNINDEX`: tn-brief, tn-drift
- `Tunisia`: bvmt-health, tn-grounding
- `Watchdog`: bvmt-health, tn-drift

## Mean-time-to-detect
Health watchdog cadence = 2×/weekday (09:20 + 14:20 Tunis) → any endpoint regression is caught within one half-day cycle. This month's real catch: the bvmt-health skill flagged a 1000× BIAT fundamentals scale bug (PER 17950 ∉ [2,80]) on its first run — flywheel working as designed.
