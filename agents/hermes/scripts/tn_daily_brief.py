#!/usr/bin/env python3
"""H4.1: nightly TN Daily Brief. Fetches live prod (grounding rule 1), builds
a facts JSON, has DeepSeek write ONE short paragraph strictly from those
facts (no outside knowledge), and appends today's entry to the Supabase
Storage blob market-data/tn_brief.json (read by api/tn/[fn].ts brief route
in H4.2).

Usage: python tn_daily_brief.py
"""
import json
import os
import pathlib
import urllib.request
from datetime import datetime, timezone

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
    req = urllib.request.Request(url, headers={"User-Agent": "tn-brief/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def build_facts():
    markets = get(f"{BASE}/markets")["rows"]
    traded = [r for r in markets if r.get("volume", 0) > 0]
    advancers = sum(1 for r in traded if r["changePct"] > 0)
    decliners = sum(1 for r in traded if r["changePct"] < 0)
    unchanged = len(traded) - advancers - decliners
    movers = sorted(traded, key=lambda r: r["changePct"], reverse=True)
    top_gainers = [{"symbol": r["symbol"], "changePct": round(r["changePct"], 2), "price": r["price"]} for r in movers[:5]]
    top_losers = [{"symbol": r["symbol"], "changePct": round(r["changePct"], 2), "price": r["price"]} for r in movers[-5:][::-1]]

    idx = get(f"{BASE}/index")
    tunindex = idx.get("tunindex") or {}

    highs = get(f"{BASE}/highs")["byIsin"]
    near_highs = sorted(
        ({"isin": k, **v} for k, v in highs.items() if v.get("highRatio", 0) >= 0.98),
        key=lambda v: v["highRatio"], reverse=True)[:5]

    # Deterministic engine standout: biggest gainer with real volume.
    standout = None
    if top_gainers:
        try:
            standout = get(f"{BASE}/engine?symbol={top_gainers[0]['symbol']}")
        except Exception:
            standout = None

    return {
        "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "seance": traded[0]["seance"] if traded else None,
        "tunindex": {"level": tunindex.get("level"), "changePct": tunindex.get("changePct")},
        "breadth": {"advancers": advancers, "decliners": decliners, "unchanged": unchanged, "traded": len(traded)},
        "topGainers": top_gainers,
        "topLosers": top_losers,
        "nearHighs": near_highs,
        "engineStandout": None if not standout else {
            "symbol": standout["symbol"], "score": standout["score"], "label": standout["label"]},
    }


def write_paragraph(facts):
    from openai import OpenAI
    client = OpenAI(api_key=os.environ["DEEPSEEK_API_KEY"], base_url="https://api.deepseek.com")
    prompt = (
        "Write a 3-4 sentence TN (Tunis Stock Exchange / BVMT) daily close brief in English, "
        "for investors, using ONLY the numbers in this JSON — do not invent, round loosely, or "
        "add any number, name, or fact not present below. Mention TUNINDEX level and change, "
        "breadth (advancers vs decliners), the top gainer and top loser by name and %, and the "
        "engine standout if present. Plain prose, no markdown, no bullet points.\n\n"
        + json.dumps(facts, ensure_ascii=False))
    m = client.chat.completions.create(model="deepseek-chat", max_tokens=220, temperature=0.3,
                                       messages=[{"role": "user", "content": prompt}])
    return m.choices[0].message.content.strip()


def main():
    facts = build_facts()
    facts["text"] = write_paragraph(facts)
    print(json.dumps(facts, indent=1, ensure_ascii=False))

    if not (SUPA and SKEY):
        print("\n[no SUPABASE_* env — skipping blob write]")
        return

    h = {"apikey": SKEY, "Authorization": f"Bearer {SKEY}"}
    try:
        req = urllib.request.Request(BLOB, headers=h)
        blob = json.loads(urllib.request.urlopen(req, timeout=45).read())
    except Exception:
        blob = {"entries": {}}
    blob.setdefault("entries", {})[facts["date"]] = facts
    # keep last 30 days
    for d in sorted(blob["entries"])[:-30]:
        del blob["entries"][d]
    body = json.dumps(blob, ensure_ascii=False).encode()
    put = urllib.request.Request(BLOB, data=body, method="POST",
                                 headers={**h, "Content-Type": "application/json", "x-upsert": "true"})
    with urllib.request.urlopen(put, timeout=45) as resp:
        print(f"\nstored -> HTTP {resp.status}, entries={len(blob['entries'])}")


if __name__ == "__main__":
    main()
