---
name: tn-alerts
description: Owner watchlist - compile natural-language BVMT alert rules into structured checks and ping the owner on Telegram when a rule fires against live endpoint data
version: 1.0.0
author: alphagravity
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [BVMT, Alerts, Watchlist, Telegram, Copilot]
---

# tn-alerts: owner watchlist + NL alert rules

## When to Use This Skill

When the owner asks to be pinged on a market condition ("alert me if SFBT
spread > 1%", "ping me when BH gains more than 3%"), or on the scheduled
cron (every 15 min, Mon–Fri 09:00–14:59 Tunis).

## Add a rule (NL → structured)

```bash
python3 ~/.hermes/scripts/compile_alert_rule.py "ping me if BH gains more than 3% today"
```

DeepSeek compiles the sentence into `{name, ticker, metric, op, threshold}`
and appends it to `tn_alert_rules.json`. Supported metrics: `price`,
`changePct`, `spreadPct`, `volume` (today's cumulative shares — not a single
print), `turnover`, `engineScore`.

## Evaluate (what the cron runs)

```bash
python3 ~/.hermes/scripts/tn_alerts.py
```

Curls `/api/tn/markets` (+ `/engine` only if a rule needs the score) in that
run ([[tn-grounding]]), evaluates every rule, prints one 🔔 line per firing
rule. **Empty stdout when nothing fires** — under `--no-agent --deliver
telegram` that means silent until a real event trips a rule, then it pings.

## How to Report

Relay each 🔔 line verbatim (rule name, ticker, live metric value, operator,
threshold) — every number is from this run's curl. Never restate a threshold
as if it were the live value.
