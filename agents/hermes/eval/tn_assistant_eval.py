#!/usr/bin/env python3
"""H5.1: eval set + baseline accuracy for the TN Assistant ("Dexter").

Dexter runs client-side against Gemini (gemini-3.1-pro-preview) with our TN
endpoints as tool results — but the project's GOOGLE_API_KEY is dead (empty),
so this harness substitutes DeepSeek as the answering LM, fed the exact same
kind of tool-result facts Dexter would get from getFundamentalData/
getChartData. This measures the QA-over-grounded-facts capability the
Assistant depends on; swap the LM back to Gemini once a live key exists.

30 questions across 5 categories (price, ratio, comparison, session-open,
breadth/index), sampled with a fixed seed from tickers verified live in this
run. Gold answers are computed from the SAME curls handed to the model
(grounding rule 1) — never hardcoded.

Usage: python tn_assistant_eval.py
"""
import json
import os
import pathlib
import random
import re
import urllib.request
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[3]
for line in (ROOT / ".env").read_text(encoding="utf-8", errors="ignore").splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())

BASE = os.environ.get("TN_BASE", "https://market-ui-self.vercel.app/api/tn")


def get(url, timeout=45):
    url += ("&" if "?" in url else "?") + f"_ts={int(datetime.now().timestamp())}"
    req = urllib.request.Request(url, headers={"User-Agent": "tn-assistant-eval/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def ask(question, facts):
    from openai import OpenAI
    client = OpenAI(api_key=os.environ["DEEPSEEK_API_KEY"], base_url="https://api.deepseek.com")
    prompt = (
        "You are a Tunisia Stock Exchange (BVMT) financial assistant. Answer the question "
        "using ONLY the facts JSON below — never use outside knowledge, never guess. "
        'Reply ONLY JSON: {"answer": <number-or-string>}\n\n'
        f"Facts: {json.dumps(facts, ensure_ascii=False)}\n\nQuestion: {question}")
    m = client.chat.completions.create(model="deepseek-chat", max_tokens=150, temperature=0,
                                       response_format={"type": "json_object"},
                                       messages=[{"role": "user", "content": prompt}])
    return json.loads(m.choices[0].message.content).get("answer")


def num_close(got, want, tol=0.02):
    try:
        got = float(re.sub(r"[^0-9.\-]", "", str(got)))
        return want != 0 and abs(got - want) / abs(want) <= tol
    except (ValueError, TypeError):
        return False


def build_cases(markets, fundamentals, index_data, seed=42):
    random.seed(seed)
    traded = [r for r in markets if r["price"] > 0]
    fund_tickers = [tk for tk, v in fundamentals.items() if v.get("per")]
    cases = []

    for r in random.sample(traded, 10):
        cases.append({"category": "price", "ticker": r["symbol"],
                      "question": f"What is the current price of {r['symbol']} in TND?",
                      "facts": {"symbol": r["symbol"], "price": r["price"], "seance": r["seance"]},
                      "gold": r["price"]})

    for tk in random.sample(fund_tickers, 6):
        f = fundamentals[tk]
        cases.append({"category": "ratio", "ticker": tk,
                      "question": f"What is {tk}'s P/E ratio (PER)?",
                      "facts": {"symbol": tk, "per": f["per"], "eps": f["eps"]},
                      "gold": f["per"]})

    for _ in range(6):
        a, b = random.sample(fund_tickers, 2)
        fa, fb = fundamentals[a], fundamentals[b]
        higher = a if fa["per"] > fb["per"] else b
        cases.append({"category": "comparison", "ticker": f"{a}/{b}",
                      "question": f"Which has a higher P/E ratio, {a} or {b}?",
                      "facts": {a: {"per": fa["per"]}, b: {"per": fb["per"]}},
                      "gold": higher, "kind": "str"})

    now_tunis_secs = (datetime.now(timezone.utc).timestamp() + 3600) % 86400
    for r in random.sample(traded, 4):
        cases.append({"category": "session-open", "ticker": r["symbol"],
                      "question": f"Is the BVMT trading session open right now for {r['symbol']}? "
                                  "(the facts give the exchange's local wall-clock time in seconds "
                                  "since midnight and today's known session window in the same units)",
                      "facts": {"nowSecondsSinceMidnightTunis": round(now_tunis_secs),
                               "typicalSessionStartSeconds": 9 * 3600, "typicalSessionEndSeconds": 14 * 3600 + 30 * 60},
                      "gold": "yes" if 9 * 3600 <= now_tunis_secs <= 14 * 3600 + 30 * 60 else "no", "kind": "str"})

    tun = index_data.get("tunindex") or {}
    stats = index_data.get("stats") or {}
    cases.append({"category": "index", "ticker": "TUNINDEX",
                  "question": "What is the current TUNINDEX level?",
                  "facts": {"level": tun.get("level")}, "gold": tun.get("level")})
    cases.append({"category": "index", "ticker": "TUNINDEX",
                  "question": "What is TUNINDEX's percentage change today?",
                  "facts": {"changePct": tun.get("changePct")}, "gold": tun.get("changePct"), "tol": 0.15})
    cases.append({"category": "breadth", "ticker": "board",
                  "question": "How many stocks are advancing today on the BVMT?",
                  "facts": {"advancers": stats.get("advancers")}, "gold": stats.get("advancers")})
    cases.append({"category": "breadth", "ticker": "board",
                  "question": "How many trades have executed on the BVMT today?",
                  "facts": {"trades": stats.get("trades")}, "gold": stats.get("trades")})
    return cases


def main():
    markets = get(f"{BASE}/markets")["rows"]
    fundamentals = get(f"{BASE}/fundamentals")["fundamentals"]
    index_data = get(f"{BASE}/index")
    cases = build_cases(markets, fundamentals, index_data)
    print(f"cases built: {len(cases)}")

    passed = 0
    for c in cases:
        try:
            got = ask(c["question"], c["facts"])
        except Exception as e:
            got = None
            print(f"FAIL [{c['category']}] {c['ticker']}: LM error {e}")
            continue
        if c.get("kind") == "str":
            ok = str(got).strip().lower() == str(c["gold"]).strip().lower()
        else:
            ok = num_close(got, c["gold"], c.get("tol", 0.02))
        passed += ok
        print(f"{'PASS' if ok else 'FAIL'} [{c['category']}] {c['ticker']}: got={got} want={c['gold']}")

    acc = round(passed / len(cases) * 100, 1)
    print(f"\nBASELINE ACCURACY: {passed}/{len(cases)} = {acc}%")

    out = pathlib.Path(__file__).parent / "tn_assistant_baseline.json"
    out.write_text(json.dumps({"date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                               "accuracy": acc, "passed": passed, "total": len(cases),
                               "note": "DeepSeek stand-in LM — GOOGLE_API_KEY (Gemini, the real Dexter model) is dead"},
                              indent=1), encoding="utf-8")
    print(f"written -> {out}")


if __name__ == "__main__":
    main()
