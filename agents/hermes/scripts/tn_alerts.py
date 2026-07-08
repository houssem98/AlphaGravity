#!/usr/bin/env python3
"""H6.1: watchlist alert engine. Reads tn_alert_rules.json, evaluates each
rule against a same-run curl of our prod endpoints (grounding rule 1), and
prints one line per FIRING rule. Empty stdout when nothing fires — so under
`hermes cron ... --no-agent --deliver telegram` it stays silent until a real
market event trips a rule, then pings the owner.

Rule shape (compiled from NL by compile_alert_rule.py):
  {"name": str, "ticker": str, "metric": str, "op": ">"|"<"|">="|"<=", "threshold": number}
metric ∈ price | changePct | spreadPct | volume | turnover | engineScore
(spreadPct/volume/turnover are today's cumulative session values; volume is
the session share count, not a single print — documented ceiling.)

Usage: python tn_alerts.py
"""
import json
import os
import pathlib
import urllib.request
from datetime import datetime

ROOT = pathlib.Path(__file__).resolve().parents[3]
ENV = pathlib.Path("/root/.hermes/.env") if pathlib.Path("/root/.hermes/.env").exists() else (ROOT / ".env")
for line in ENV.read_text(encoding="utf-8", errors="ignore").splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())

BASE = os.environ.get("TN_BASE", "https://market-ui-self.vercel.app/api/tn")
RULES = pathlib.Path(__file__).parent / "tn_alert_rules.json"
OPS = {">": lambda a, b: a > b, "<": lambda a, b: a < b,
       ">=": lambda a, b: a >= b, "<=": lambda a, b: a <= b}


def get(url, timeout=45):
    url += ("&" if "?" in url else "?") + f"_ts={int(datetime.now().timestamp())}"
    req = urllib.request.Request(url, headers={"User-Agent": "tn-alerts/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def metric_value(rule, row, engine_cache):
    m = rule["metric"]
    if m == "spreadPct":
        b, a, p = row.get("bid"), row.get("ask"), row.get("price")
        return (a - b) / p * 100 if b and a and p else None
    if m == "engineScore":
        tk = rule["ticker"]
        if tk not in engine_cache:
            try:
                engine_cache[tk] = get(f"{BASE}/engine?symbol={tk}").get("score")
            except Exception:
                engine_cache[tk] = None
        return engine_cache[tk]
    return row.get(m)  # price | changePct | volume | turnover


def main():
    if not RULES.exists():
        return
    rules = json.loads(RULES.read_text(encoding="utf-8"))
    by_ticker = {r["symbol"]: r for r in get(f"{BASE}/markets")["rows"]}
    engine_cache = {}
    fired = []
    for rule in rules:
        row = by_ticker.get(rule["ticker"])
        if not row:
            continue
        val = metric_value(rule, row, engine_cache)
        if val is None:
            continue
        if OPS[rule["op"]](val, rule["threshold"]):
            unit = {"changePct": "%", "spreadPct": "%"}.get(rule["metric"], "")
            fired.append(f"🔔 {rule['name']}: {rule['ticker']} {rule['metric']}="
                         f"{round(val, 2)}{unit} {rule['op']} {rule['threshold']}{unit}")
    if fired:
        print(f"TN alerts ({by_ticker.get(rules[0]['ticker'], {}).get('seance', 'live')}):")
        print("\n".join(fired))


if __name__ == "__main__":
    main()
