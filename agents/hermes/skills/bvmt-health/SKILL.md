---
name: bvmt-health
description: Run the BVMT/TN endpoint invariant health check (markets, intraday, history, highs, fundamentals, index vs TSE Grafana, snapshot freshness) against live prod and report one line per check plus the summary verdict
version: 1.0.0
author: alphagravity
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [BVMT, TSE, Tunisia, Health Check, Monitoring, Invariants, Watchdog]
---

# bvmt-health: TN endpoint invariant watchdog

## When to Use This Skill

When asked to run the BVMT health check / TN endpoint health / market data
watchdog, or on the scheduled cron runs (Mon-Fri 09:20 and 14:20 Tunis).

## How to Run

Execute with the terminal tool:

```bash
python3 ~/.hermes/skills/bvmt-health/scripts/bvmt_health.py
```

Exit 0 = all green. Exit 1 = at least one FAIL → treat as RED ALERT.

## How to Report

Relay the script output VERBATIM — one line per check plus the SUMMARY line.
Do not paraphrase numbers, do not round, do not add numbers of your own
(grounding policy [[tn-grounding]] applies: only numbers from this run's
output). If RED ALERT, prefix the report with "🔴 RED ALERT" and name the
failing checks; if all green, prefix with "🟢".

## What Each Check Asserts

- markets: exactly 75 rows, 0 crossed books (bid>ask), null-side count ≤ 60
- intraday (BIAT): sessionStart ≤ sessionEnd, every candle has low ≤ open/close ≤ high
- history (BIAT): session dates strictly increasing, high ≥ low on every candle
- highs: no stock with last/high ratio > 1
- fundamentals: coverage ≥ 42 tickers with EPS, every PER within [2, 80]
- index: our TUNINDEX level > 0 and within ±10% of TSE Grafana's raw level
- snapshot: newest séance date == last weekday (Tunis) — proxy until a public
  blob route exists
