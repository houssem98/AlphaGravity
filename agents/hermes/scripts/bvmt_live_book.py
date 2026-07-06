#!/usr/bin/env python3
"""bvmt-live-book: capture raw BVMT groups payload during the live session,
archive it, and report limit.bid/limit.ask vs last-trade evidence for the
5 liquid names (BIAT, SFBT, AB, TINV, DH) plus board-wide direction stats.

Run only makes sense Mon-Fri 09:00-14:00 Tunis (live session).
"""
import json
import os
import urllib.request
from datetime import datetime, timezone

URL = "https://www.bvmt.com.tn/rest_api/rest/market/groups/11,12,52,95,99"
OUT = os.path.expanduser("~/.hermes/captures")
NAMES = ("BIAT", "SFBT", "AB", "TINV", "DH")

os.makedirs(OUT, exist_ok=True)
req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
raw = urllib.request.urlopen(req, timeout=45).read()
ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
path = f"{OUT}/groups-live-{ts}.json"
open(path, "wb").write(raw)

d = json.loads(raw)
ms = d.get("markets", [])
print(f"captured {path} ({len(raw)} bytes, {len(ms)} markets)")

gt = lt = eq = 0
for m in ms:
    l = m.get("limit") or {}
    b, a = l.get("bid") or 0, l.get("ask") or 0
    if b > 0 and a > 0:
        gt, lt, eq = gt + (b > a), lt + (b < a), eq + (b == a)
print(f"two-sided books: bid>ask={gt} bid<ask={lt} bid==ask={eq}")

for m in ms:
    t = (m.get("referentiel") or {}).get("ticker", "")
    if t in NAMES:
        l = m.get("limit") or {}
        print(f"{t}: time={m.get('time')} last={m.get('last')} "
              f"limit.bid={l.get('bid')}x{l.get('bidQty')} "
              f"limit.ask={l.get('ask')}x{l.get('askQty')} volume={m.get('volume')}")
