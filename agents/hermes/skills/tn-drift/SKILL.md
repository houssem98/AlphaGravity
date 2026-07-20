---
name: tn-drift
description: Cross-source drift check - our TUNINDEX endpoint vs TSE Grafana raw, and our crypto tape (Coinlore) vs Binance spot; reports both sources' numbers side by side and alerts on unexplained divergence
version: 1.0.0
author: alphagravity
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [BVMT, TUNINDEX, Crypto, Drift, Cross-Source, Monitoring, Watchdog]
---

# tn-drift: cross-source drift check

## When to Use This Skill

When asked to check data drift, cross-source divergence, or whether our
numbers match upstream/second sources.

## How to Run

```bash
python3 ~/.hermes/scripts/tn_drift.py
```

Exit 0 = no unexplained drift. Exit 1 = DRIFT ALERT.

## Thresholds

- TUNINDEX (ours vs TSE Grafana raw): alert > 0.5%
- Crypto BTC/ETH (ours=Coinlore aggregate vs Binance spot): alert > 1.5%
  (aggregator lag makes sub-percent gaps routine, not incidents)

## How to Report

Relay output VERBATIM — each line already shows both sources side by side
([[tn-grounding]] applies: no numbers not in this run's output). On alert,
lead with "🔴 DRIFT ALERT" and the affected series.
