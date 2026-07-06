#!/usr/bin/env python3
"""tn-drift: cross-source drift check.

TUNINDEX: our /api/tn/index vs TSE Grafana raw (same-run). Alert > 0.5%.
Crypto tape: our /api/crypto/markets (Coinlore) vs Binance spot. Alert > 1.5%
(aggregator lag makes sub-percent gaps routine, not incidents).
Both sources' numbers printed side by side. Exit 1 on any alert.
"""
import json
import os
import sys
import urllib.request
from datetime import datetime

BASE = os.environ.get("MUI_BASE", "https://market-ui-self.vercel.app/api")
GRAFANA = "https://tunis-stockexchange.com/grafana/api/ds/query"
TN_ALERT, CRYPTO_ALERT = 0.5, 1.5

alerts = []


def get(url, timeout=45, nonce=True):
    if nonce:
        url += ("&" if "?" in url else "?") + f"_ts={int(datetime.now().timestamp())}"
    req = urllib.request.Request(url, headers={"User-Agent": "tn-drift/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def line(name, ours, theirs, src_a, src_b, limit):
    drift = abs(ours - theirs) / theirs * 100 if theirs else 999
    flag = "ALERT" if drift > limit else "ok   "
    if drift > limit:
        alerts.append(name)
    print(f"{flag} {name}: {src_a}={ours} | {src_b}={theirs} | drift={drift:.3f}% (limit {limit}%)")


# 1. TUNINDEX ours vs TSE Grafana raw
try:
    ours = (get(f"{BASE}/tn/index").get("tunindex") or {}).get("level") or 0
    body = json.dumps({"queries": [{"refId": "A", "datasource": {"uid": "ef4kunff033eoe",
            "type": "grafana-postgresql-datasource"},
            "rawSql": "SELECT raw_data FROM indice_live WHERE ingested_at=(SELECT max(ingested_at) FROM indice_live)",
            "format": "table"}]}).encode()
    req = urllib.request.Request(GRAFANA, data=body, headers={
        "Content-Type": "application/json",
        "Referer": "https://tunis-stockexchange.com/grafana/",
        "User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=45) as r:
        j = json.loads(r.read())
    tse = 0
    for s in j["results"]["A"]["frames"][0]["data"]["values"][0]:
        try:
            o = json.loads(s)
            if o.get("fullIndiceName") == "TUNINDEX":
                tse = float(o.get("indexLevel") or 0)
        except Exception:
            pass
    line("TUNINDEX", ours, tse, "ours(/api/tn/index)", "TSE-Grafana(indice_live)", TN_ALERT)
except Exception as e:
    alerts.append("TUNINDEX")
    print(f"ALERT TUNINDEX: error {e}")

# 2. Crypto tape (BTC, ETH) ours vs Binance spot
try:
    tape = {c["symbol"]: float(c["priceUsd"]) for c in get(f"{BASE}/crypto/markets")}
    for sym, pair in [("BTC", "BTCUSDT"), ("ETH", "ETHUSDT")]:
        b = get(f"https://api.binance.com/api/v3/ticker/price?symbol={pair}", nonce=False)
        line(sym, tape.get(sym, 0), float(b["price"]), "ours(/api/crypto/markets)", "Binance-spot", CRYPTO_ALERT)
except Exception as e:
    alerts.append("crypto")
    print(f"ALERT crypto: error {e}")

print(f"SUMMARY: {'DRIFT ALERT: ' + ','.join(alerts) if alerts else 'NO UNEXPLAINED DRIFT'}")
sys.exit(1 if alerts else 0)
