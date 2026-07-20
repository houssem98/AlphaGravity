---
name: hermes-monthly-report
description: Monthly flywheel maintenance report - real counts of checks run, health pass-rate, alerts fired, brief streak, plus a skill dedupe audit and mean-time-to-detect, from the box's own run history
version: 1.0.0
author: alphagravity
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Maintenance, Metrics, Flywheel, Monitoring]
---

# hermes-monthly-report: flywheel metrics

## When to Use This Skill

On the monthly cron (1st, 16:00 Tunis), or when asked how the watchdog/
premium-content fleet is doing.

## How to Run

```bash
python3 ~/.hermes/scripts/hermes_monthly_report.py
```

Reads the box's own `cron/output/*/*.md` run history (run counts, all-green
rate, alert firings), the installed `skills/*/SKILL.md` set (inventory +
shared-tag dedupe audit), and the live `/api/tn/brief` blob (brief streak) —
every number is real, none hardcoded. Emits a markdown report.

## How to Report

Relay the headline counts (runs, health pass-rate, alerts fired, brief
streak, skill count) verbatim. The dedupe audit lists tags shared across
skills — shared tags are expected (all are BVMT skills); flag only if two
skills genuinely duplicate a capability, which is when to merge them.
