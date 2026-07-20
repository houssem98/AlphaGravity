---
name: tn-sector-deepdive
description: Weekly BVMT sector deep-dive - rotates through all 16 board sectors by ISO week, pulls fundamentals + 3-month price change for every ticker in the rotated sector, and appends it to the tn_brief.json blob
version: 1.0.0
author: alphagravity
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [BVMT, Sector, Fundamentals, Deep Dive, Premium Content]
---

# tn-sector-deepdive: weekly sector deep-dive

## When to Use This Skill

When asked for a sector deep-dive, or on the scheduled cron (Fri 15:00 Tunis).

## How to Run

```bash
python3 ~/.hermes/scripts/tn_sector_deepdive.py
```

Rotation is deterministic: `ISO_week % sector_count` picks the sector, so
every sector is covered on a fixed multi-month cadence with no state file.
For each ticker in that sector: PER/EPS/PB/dividend (from `/api/tn/fundamentals`)
and 3-month price change (from `/api/tn/history`). Appends to
`market-data/tn_brief.json` under `deepDives.week<N>`.

## How to Report

List the rotated sector name and each ticker's PER/EPS/PB/3m-change on one
line. All numbers must be from this run's curls ([[tn-grounding]]) — PER can
legitimately differ slightly between calls (it's recomputed against the live
quote each time fundamentals is fetched); EPS/PB should match exactly.
