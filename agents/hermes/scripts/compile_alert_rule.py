#!/usr/bin/env python3
"""H6.1: compile a natural-language alert into a structured rule with DeepSeek
and append it to tn_alert_rules.json. This is the "agent compiles NL → cron
skill" half — tn_alerts.py is the runtime that evaluates what this writes.

Usage: python compile_alert_rule.py "ping me if SFBT spread > 1%"
"""
import json
import os
import pathlib
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[3]
ENV = pathlib.Path("/root/.hermes/.env") if pathlib.Path("/root/.hermes/.env").exists() else (ROOT / ".env")
for line in ENV.read_text(encoding="utf-8", errors="ignore").splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())

RULES = pathlib.Path(__file__).parent / "tn_alert_rules.json"
METRICS = ["price", "changePct", "spreadPct", "volume", "turnover", "engineScore"]


def compile_rule(nl):
    from openai import OpenAI
    client = OpenAI(api_key=os.environ["DEEPSEEK_API_KEY"], base_url="https://api.deepseek.com")
    prompt = (
        "Compile this natural-language Tunis Stock Exchange (BVMT) alert into a rule. "
        f"Reply ONLY JSON: {{\"name\": <short label>, \"ticker\": <BVMT symbol uppercase>, "
        f"\"metric\": one of {METRICS}, \"op\": one of [\">\",\"<\",\">=\",\"<=\"], "
        "\"threshold\": <number>}\n"
        "metric meanings: price=TND last; changePct=today %move; spreadPct=(ask-bid)/price*100; "
        "volume=today cumulative shares; turnover=today TND traded; engineScore=0-100 signal. "
        "A phrase like 'prints > N shares' maps to volume. Percent thresholds are plain numbers "
        "(1% -> 1). Never invent a ticker; use exactly what's named.\n\n"
        f"Alert: {nl}")
    m = client.chat.completions.create(model="deepseek-chat", max_tokens=150, temperature=0,
                                       response_format={"type": "json_object"},
                                       messages=[{"role": "user", "content": prompt}])
    return json.loads(m.choices[0].message.content)


def main():
    if len(sys.argv) < 2:
        print("usage: compile_alert_rule.py \"<natural language alert>\"")
        sys.exit(1)
    rule = compile_rule(sys.argv[1])
    assert rule["metric"] in METRICS, f"bad metric {rule['metric']}"
    assert rule["op"] in [">", "<", ">=", "<="], f"bad op {rule['op']}"
    rules = json.loads(RULES.read_text(encoding="utf-8")) if RULES.exists() else []
    rules.append(rule)
    RULES.write_text(json.dumps(rules, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"compiled -> {json.dumps(rule, ensure_ascii=False)}")
    print(f"{len(rules)} rule(s) in {RULES}")


if __name__ == "__main__":
    main()
