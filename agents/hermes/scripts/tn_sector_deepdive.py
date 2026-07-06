#!/usr/bin/env python3
"""H4.3: weekly BVMT sector deep-dive, appended to the tn_brief.json blob.

Rotates deterministically through the board's sectors by ISO week number
(week % sector_count), so every sector gets covered on a fixed cadence with
no state to track. For the rotated sector: fundamentals table (PER/EPS/PB/
dividend where available) + each ticker's 3-month price change from the
history endpoint. All numbers same-run curls of prod (grounding rule 1).

Usage: python tn_sector_deepdive.py
"""
import json
import os
import pathlib
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = pathlib.Path(__file__).resolve().parents[3]
ENV = pathlib.Path("/root/.hermes/.env") if pathlib.Path("/root/.hermes/.env").exists() else (ROOT / ".env")
for line in ENV.read_text(encoding="utf-8", errors="ignore").splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())

BASE = os.environ.get("TN_BASE", "https://market-ui-self.vercel.app/api/tn")
SUPA = os.environ.get("SUPABASE_URL")
SKEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
BLOB = f"{SUPA}/storage/v1/object/market-data/tn_brief.json" if SUPA else None


def get(url, timeout=45):
    url += ("&" if "?" in url else "?") + f"_ts={int(datetime.now().timestamp())}"
    req = urllib.request.Request(url, headers={"User-Agent": "tn-sector-deepdive/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def three_month_change(candles):
    if not candles:
        return None
    cutoff = candles[-1]["time"] - 92 * 86400
    past = [c for c in candles if c["time"] <= cutoff]
    base = past[-1]["close"] if past else candles[0]["close"]
    last = candles[-1]["close"]
    return round((last - base) / base * 100, 2) if base else None


def main():
    ref = get(f"{BASE}/ref")["ref"]
    sectors = {}
    for tk, v in ref.items():
        s = v.get("sector")
        if s:
            sectors.setdefault(s, []).append(tk)
    names = sorted(sectors)
    week = datetime.now(timezone.utc).isocalendar()[1]
    sector = names[week % len(names)]
    tickers = sectors[sector]
    print(f"ISO week {week} -> sector [{week % len(names)}/{len(names)}]: {sector} ({len(tickers)} tickers)")

    fundamentals = get(f"{BASE}/fundamentals")["fundamentals"]
    rows = []
    for tk in tickers:
        hist = get(f"{BASE}/history?symbol={tk}")
        chg3m = three_month_change(hist.get("candles", []))
        f = fundamentals.get(tk) or {}
        rows.append({
            "ticker": tk, "sector": sector,
            "per": f.get("per"), "eps": f.get("eps"), "pb": f.get("pb"),
            "dividend": f.get("dividend"),
            "change3m": chg3m,
        })
        print(f"  {tk}: PER={f.get('per')} EPS={f.get('eps')} PB={f.get('pb')} 3mChange={chg3m}%")

    entry = {"isoWeek": week, "sector": sector, "generatedAt": datetime.now(timezone.utc).isoformat(), "rows": rows}
    print(json.dumps(entry, indent=1, ensure_ascii=False))

    if not (SUPA and SKEY):
        print("\n[no SUPABASE_* env — skipping blob write]")
        return
    h = {"apikey": SKEY, "Authorization": f"Bearer {SKEY}"}
    try:
        blob = json.loads(urllib.request.urlopen(urllib.request.Request(BLOB, headers=h), timeout=45).read())
    except Exception:
        blob = {}
    blob.setdefault("deepDives", {})[f"week{week}"] = entry
    body = json.dumps(blob, ensure_ascii=False).encode()
    put = urllib.request.Request(BLOB, data=body, method="POST",
                                 headers={**h, "Content-Type": "application/json", "x-upsert": "true"})
    with urllib.request.urlopen(put, timeout=45) as resp:
        print(f"\nstored -> HTTP {resp.status}")


if __name__ == "__main__":
    main()
