---
name: agm-dividends
description: Scan TSE post-AGO publications for approved dividend declarations, extract dividend-per-share with source links, and PROPOSE tn_fundamentals blob updates - never uploads, human confirms every number
version: 1.0.0
author: antigravity
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [BVMT, TSE, Dividends, AGM, AGO, Fundamentals, Monitoring]
---

# agm-dividends: AGM dividend monitor

## When to Use This Skill

When asked about newly declared TN dividends, AGM/AGO outcomes, or on the
weekly cron (Mon 15:00 Tunis).

## How to Run

```bash
python3 ~/.hermes/scripts/agm_dividends.py --limit 15
```

Scans the latest post-AGO publications (type=Ordinaire, "Post Assemblée"),
pulls each PDF, extracts the approved DPS via DeepSeek, and writes
`agm_dividends_proposals.json` next to the script.

## Hard Rules

- **Never upload.** Proposals only; a human applies them to
  `tn_fundamentals.json` explicitly after review.
- Every proposed number must carry its `source` PDF link ([[tn-grounding]]).
- Null DPS = the AGM declared nothing per-share extractable; do not infer.

## How to Report

List each proposal on one line: `TICKER: DPS=<x> TND (FY<year>, pay <date>) — source <pdf>`.
End with the count and the reminder that upload needs human confirmation.
