#!/usr/bin/env python3
"""bvmt-health: invariant checks against live prod TN endpoints.

One line per check: OK/FAIL name -- real numbers. Exit 1 if any FAIL.
All data fetched in THIS run (grounding rule 1). Stdlib only.
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = os.environ.get("TN_BASE", "https://market-ui-self.vercel.app/api/tn")
GRAFANA = "https://tunis-stockexchange.com/grafana/api/ds/query"
FR_MONTHS = {"janv": 1, "févr": 2, "mars": 3, "avr": 4, "mai": 5, "juin": 6,
             "juil": 7, "août": 8, "sept": 9, "oct": 10, "nov": 11, "déc": 12}

lines = []
failed = False


def report(ok, name, detail):
    global failed
    if not ok:
        failed = True
    lines.append(f"{'OK  ' if ok else 'FAIL'} {name} -- {detail}")


def get(url, timeout=45):
    # cache-buster: validate origin data, not CDN staleness (s-maxage up to 1h)
    url += ("&" if "?" in url else "?") + f"_ts={int(datetime.now().timestamp())}"
    req = urllib.request.Request(url, headers={"User-Agent": "bvmt-health/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def last_weekday_tunis():
    now = datetime.now(timezone.utc) + timedelta(hours=1)  # Tunis = UTC+1
    d = now.date()
    # before ~10:00 UTC the current session may not have prints yet; accept today or previous weekday
    prev = d
    while prev.weekday() >= 5:
        prev -= timedelta(days=1)
    return prev


def parse_seance(s):
    # "6 juil. 2026" -> date
    try:
        day, mon, year = s.replace(".", "").split()
        key = next((k for k in FR_MONTHS if mon.lower().startswith(k)), None)
        return datetime(int(year), FR_MONTHS[key], int(day)).date() if key else None
    except Exception:
        return None


def main():
    # 1. markets
    try:
        m = get(f"{BASE}/markets")
        rows = m.get("rows", [])
        crossed = sum(1 for r in rows if r.get("bid") and r.get("ask") and r["bid"] > r["ask"])
        nullside = sum(1 for r in rows if r.get("bid") is None or r.get("ask") is None)
        report(len(rows) == 75 and crossed == 0 and nullside <= 60, "markets",
               f"rows={len(rows)} crossed={crossed} nullSide={nullside}")
        seance = rows[0].get("seance") if rows else None
    except Exception as e:
        report(False, "markets", f"error: {e}")
        seance = None

    # 2. intraday (BIAT)
    try:
        it = get(f"{BASE}/intraday?symbol=BIAT")
        ss, se = it.get("sessionStart"), it.get("sessionEnd")
        candles = it.get("candles", [])
        bad = sum(1 for c in candles if not (c["low"] <= c["open"] <= c["high"] and c["low"] <= c["close"] <= c["high"]))
        ok = ss is not None and se is not None and ss <= se and bad == 0
        report(ok, "intraday", f"sessionStart={ss} sessionEnd={se} candles={len(candles)} outOfBounds={bad}")
    except Exception as e:
        report(False, "intraday", f"error: {e}")

    # 3. history (BIAT)
    try:
        h = get(f"{BASE}/history?symbol=BIAT")
        cs = h.get("candles", [])
        inc = all(cs[i]["time"] < cs[i + 1]["time"] for i in range(len(cs) - 1))
        hilo = sum(1 for c in cs if c["high"] < c["low"])
        report(len(cs) > 0 and inc and hilo == 0, "history",
               f"candles={len(cs)} strictlyIncreasing={inc} hiLtLo={hilo}")
    except Exception as e:
        report(False, "history", f"error: {e}")

    # 4. highs
    try:
        hi = get(f"{BASE}/highs")
        by = hi.get("byIsin", {})
        over = sum(1 for v in by.values() if v.get("highRatio", 0) > 1 + 1e-9)
        report(len(by) > 0 and over == 0, "highs", f"stocks={len(by)} ratioOver1={over}")
    except Exception as e:
        report(False, "highs", f"error: {e}")

    # 5. fundamentals
    try:
        f = get(f"{BASE}/fundamentals")
        blob = f.get("fundamentals", {})
        eps = [k for k, v in blob.items() if isinstance(v, dict) and v.get("eps")]
        pers = [v.get("per") for v in blob.values() if isinstance(v, dict) and v.get("per")]
        badper = [p for p in pers if not (2 <= p <= 80)]
        report(len(eps) >= 42 and not badper, "fundamentals",
               f"coverage={len(eps)} pers={len(pers)} perOutside[2,80]={len(badper)}")
    except Exception as e:
        report(False, "fundamentals", f"error: {e}")

    # 6. index + TSE Grafana cross-check
    try:
        ix = get(f"{BASE}/index")
        lvl = (ix.get("tunindex") or {}).get("level") or 0
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
        vals = (((j.get("results") or {}).get("A") or {}).get("frames") or [{}])[0].get("data", {}).get("values", [[]])[0]
        tse = 0
        for s in vals:
            try:
                o = json.loads(s)
                if o.get("fullIndiceName") == "TUNINDEX":
                    tse = float(o.get("indexLevel") or 0)
            except Exception:
                pass
        drift = abs(lvl - tse) / tse * 100 if tse else 999
        report(lvl > 0 and tse > 0 and drift <= 10, "index",
               f"ours={lvl} tseGrafana={tse} driftPct={drift:.3f}")
    except Exception as e:
        report(False, "index", f"error: {e}")

    # 7. snapshot freshness (proxy: seance == last weekday; blob not public — see roadmap log)
    try:
        expect = last_weekday_tunis()
        got = parse_seance(seance) if seance else None
        report(got is not None and got == expect, "snapshot",
               f"seance={seance} parsed={got} lastWeekday={expect} (proxy: blob not publicly readable)")
    except Exception as e:
        report(False, "snapshot", f"error: {e}")

    print("\n".join(lines))
    print(f"SUMMARY: {'RED ALERT' if failed else 'ALL GREEN'} ({sum(1 for l in lines if l.startswith('OK'))}/{len(lines)} checks passed)")
    sys.exit(1 if failed else 0)


main()
