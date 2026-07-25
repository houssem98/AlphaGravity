#!/usr/bin/env python3
"""agm-dividends (H3.3): scan TSE post-AGO publications for declared
dividends, extract DPS with DeepSeek, and PROPOSE blob updates.

NEVER uploads — prints a proposal JSON for human confirmation, with the
source publication link for every number (grounding rule 1).

Usage: python agm_dividends.py [--limit 15]
"""
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[3]
for line in (ROOT / ".env").read_text(encoding="utf-8", errors="ignore").splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())

UA = "Mozilla/5.0"
GRAFANA = "https://tunis-stockexchange.com/grafana/api/ds/query"


def gsql(sql):
    body = json.dumps({"queries": [{"refId": "A", "datasource": {"uid": "ef4kunff033eoe",
        "type": "grafana-postgresql-datasource"}, "rawSql": sql, "format": "table"}]}).encode()
    req = urllib.request.Request(GRAFANA, data=body, headers={
        "Content-Type": "application/json",
        "Referer": "https://tunis-stockexchange.com/grafana/", "User-Agent": UA})
    j = json.load(urllib.request.urlopen(req, timeout=60))
    vals = j["results"]["A"]["frames"][0]["data"]["values"]
    return [json.loads(s) for s in (vals[0] if vals else [])]


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()


def pdf_lines(pdf_bytes):
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(pdf_bytes)
        path = f.name
    txt = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", path, "-"],
                         capture_output=True).stdout.decode("utf-8", "ignore")
    os.unlink(path)
    keys = re.compile(r"dividende|distribution|par action|coupon|mise en paiement|exercice", re.I)
    return "\n".join(l for l in txt.splitlines() if keys.search(l))[:8000]


def extract_dps(company, excerpt):
    from openai import OpenAI
    client = OpenAI(api_key=os.environ["DEEPSEEK_API_KEY"], base_url="https://api.deepseek.com")
    prompt = (
        f"These lines come from {company}'s post-AGM (Assemblée Générale Ordinaire) publication "
        "on the Tunis Stock Exchange (French). Extract the APPROVED dividend. Reply ONLY JSON:\n"
        '{"dividend_per_share_tnd":<number|null>,"fiscal_year":<int|null>,"payment_date":"<YYYY-MM-DD|null>"}\n'
        "dividend_per_share_tnd = dividend per share in dinars as voted/approved (null if the AGM "
        "declared no dividend or the lines don't state a per-share amount). If the excerpt is empty, "
        "everything is null. Never guess.\n\n" + excerpt)
    m = client.chat.completions.create(model="deepseek-v4-flash", max_tokens=200, temperature=0,
                                       response_format={"type": "json_object"},
                                       messages=[{"role": "user", "content": prompt}])
    return json.loads(m.choices[0].message.content)


def main():
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else 15
    ref = {r.get("codeEmetteur"): r["mnemo"] for r in gsql(
        "SELECT raw_data FROM raw_referentiels WHERE raw_data->>'grp_description' LIKE 'Ligne M%re'")
        if r.get("mnemo")}
    pubs = gsql("SELECT raw_data FROM raw_publications WHERE raw_data->>'type'='Ordinaire' "
                "AND raw_data->>'langue'='fr' AND raw_data->>'title' LIKE '%Post Assembl%' "
                f"ORDER BY raw_data->>'date' DESC LIMIT {limit}")
    proposals = []
    for p in pubs:
        tk = ref.get(p.get("codeIsin"), p.get("codeIsin"))
        try:
            html = fetch(p["linkPublication"]).decode("utf-8", "ignore")
            m = re.search(r'href="(/sites/default/files/[^"]+\.pdf)"', html)
            if not m:
                print(f"{tk}: no PDF on {p['linkPublication']}")
                continue
            pdf_url = "https://tunis-stockexchange.com" + m.group(1)
            excerpt = pdf_lines(fetch(pdf_url))
            if not excerpt.strip():
                print(f"{tk}: empty excerpt (image-only PDF?) {pdf_url}")
                continue
            d = extract_dps(p.get("denomination") or tk, excerpt)
            dps = d.get("dividend_per_share_tnd")
            print(f"{tk}: DPS={dps} FY={d.get('fiscal_year')} pay={d.get('payment_date')} src={pdf_url}")
            if dps:
                proposals.append({"ticker": tk, "dividend": dps,
                                  "fiscalYear": d.get("fiscal_year"),
                                  "paymentDate": d.get("payment_date"),
                                  "source": pdf_url,
                                  "publication": p["linkPublication"],
                                  "pubDate": p.get("date")})
        except Exception as e:
            print(f"{tk}: ERROR {e}")

    out = pathlib.Path(__file__).parent / "agm_dividends_proposals.json"
    out.write_text(json.dumps(proposals, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"\nPROPOSALS ({len(proposals)}) -> {out}")
    print("NOT uploaded. Human must review and apply to tn_fundamentals.json explicitly.")


if __name__ == "__main__":
    main()
