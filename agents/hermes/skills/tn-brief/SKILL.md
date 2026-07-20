---
name: tn-brief
description: Generate the nightly TN Daily Brief (TUNINDEX, breadth, top movers, near-highs, engine standout, one-paragraph summary) from live prod data and append it to the tn_brief.json Supabase blob
version: 1.0.0
author: alphagravity
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [BVMT, TUNINDEX, Daily Brief, Premium Content, Monitoring]
---

# tn-brief: nightly TN Daily Brief

## When to Use This Skill

When asked to generate today's TN close report, or on the scheduled cron
(Mon-Fri 14:30 Tunis, post-close).

## How to Run

```bash
python3 ~/.hermes/scripts/tn_daily_brief.py
```

Fetches markets/index/highs/engine from live prod ([[tn-grounding]] applies),
computes breadth + top 5 gainers/losers + near-highs + one engine standout,
has DeepSeek write a 3-4 sentence paragraph strictly from those facts, and
appends today's entry to the `market-data/tn_brief.json` Supabase blob
(keeps a rolling 30-day history). Read by the `brief` route (H4.2).

## How to Report

Relay the `text` paragraph plus the key numbers (TUNINDEX level/change,
breadth, top gainer/loser). If SUPABASE_* env is missing, note the blob
write was skipped — that's a setup issue, not a data issue.
