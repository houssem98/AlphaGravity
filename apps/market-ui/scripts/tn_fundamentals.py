#!/usr/bin/env python3
"""Extract BVMT fundamentals (net income, equity, dividend) from the exchange's
financial-statement PDFs, compute ratios, and upsert a Supabase Storage blob
(market-data/tn_fundamentals.json). Serves /api/tn/fundamentals.

Usage:  python tn_fundamentals.py AB BIAT SFBT        # specific tickers
        python tn_fundamentals.py --all               # every board ticker

Env (from repo-root .env): ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
"""
import os, re, sys, json, subprocess, tempfile, urllib.request, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[3]
for line in (ROOT / ".env").read_text(encoding="utf-8", errors="ignore").splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())

GRAFANA = "https://tunis-stockexchange.com/grafana/api/ds/query"
DS_UID = "ef4kunff033eoe"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0"
SUPA = os.environ["SUPABASE_URL"]
SKEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
BLOB = f"{SUPA}/storage/v1/object/market-data/tn_fundamentals.json"
# Prefer parent-company statements (share count matches), then consolidated.
FIN_TYPES = ["Individuels", "États Financiers", "Etats Financiers", "Consolidés"]


def _post(url, data, headers):
    req = urllib.request.Request(url, data=json.dumps(data).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def gsql(sql):
    j = _post(GRAFANA, {"queries": [{"refId": "A", "datasource": {"uid": DS_UID, "type": "grafana-postgresql-datasource"},
                                     "rawSql": sql, "format": "table"}]},
              {"Content-Type": "application/json", "Referer": "https://tunis-stockexchange.com/grafana/", "User-Agent": UA})
    vals = j["results"]["A"]["frames"][0]["data"]["values"]
    return [json.loads(s) for s in (vals[0] if vals else [])]


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()


def latest_statement_pdf(isin):
    pubs = gsql(f"SELECT raw_data FROM raw_publications WHERE raw_data->>'codeIsin'='{isin}' "
                f"AND raw_data->>'langue'='fr' ORDER BY raw_data->>'date' DESC")
    for want in FIN_TYPES:
        for p in pubs:
            if (p.get("type") or "").strip() == want and p.get("linkPublication"):
                html = fetch(p["linkPublication"]).decode("utf-8", "ignore")
                m = re.search(r'href="(/sites/default/files/[^"]+\.pdf)"', html)
                if m:
                    return "https://tunis-stockexchange.com" + m.group(1), p.get("date"), want
    return None, None, None


def pdf_excerpt(pdf_bytes):
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(pdf_bytes); path = f.name
    txt = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", path, "-"], capture_output=True).stdout.decode("utf-8", "ignore")
    os.unlink(path)
    # Keep only lines near the numbers we need — LLM sees a focused slice.
    keys = re.compile(r"r[eé]sultat|b[eé]n[eé]fice|capitaux propres|produit net bancaire|"
                      r"dividende|affectation|par action|exercice|arr[eê]t", re.I)
    lines = [l for l in txt.splitlines() if keys.search(l)]
    return "\n".join(lines)[:12000]


def extract(name, excerpt):
    from openai import OpenAI  # DeepSeek is OpenAI-compatible
    client = OpenAI(api_key=os.environ["DEEPSEEK_API_KEY"], base_url="https://api.deepseek.com")
    prompt = (
        f"From these lines of {name}'s BVMT financial statements (French, amounts usually in "
        f"thousands of dinars 'mDT'), extract the most recent full-year figures. Reply ONLY JSON:\n"
        '{"fiscal_year":<int>,"net_income_mdt":<number|null>,"equity_mdt":<number|null>,'
        '"dividend_per_share_tnd":<number|null>}\n'
        "net_income = résultat net / bénéfice net de l'exercice (the bottom-line profit, NOT revenue "
        "or produit net bancaire). equity = total capitaux propres. dividend_per_share only if "
        "explicitly stated per share (else null). Numbers only, no thousands-separators.\n\n" + excerpt)
    try:
        m = client.chat.completions.create(
            model="deepseek-v4-flash", max_tokens=300, temperature=0,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}])
        return json.loads(m.choices[0].message.content)
    except Exception as e:
        print(f"    [deepseek failed: {e}]")
    return None


def main():
    args = sys.argv[1:]
    ref = {r["mnemo"]: r for r in gsql("SELECT raw_data FROM raw_referentiels WHERE raw_data->>'grp_description' LIKE 'Ligne M%re'") if r.get("mnemo")}
    board = {m["referentiel"]["ticker"]: m for m in
             json.load(urllib.request.urlopen(urllib.request.Request(
                 "https://www.bvmt.com.tn/rest_api/rest/market/groups/11,12,52,95,99", headers={"User-Agent": UA})))["markets"]
             if m.get("referentiel", {}).get("ticker")}
    tickers = list(ref.keys()) if "--all" in args else [a.upper() for a in args] or ["AB"]

    try:
        blob = json.load(urllib.request.urlopen(urllib.request.Request(BLOB, headers={"apikey": SKEY, "Authorization": f"Bearer {SKEY}"})))
    except Exception:
        blob = {}

    for tk in tickers:
        r = ref.get(tk)
        if not r:
            print(f"{tk}: no referentiel, skip"); continue
        isin = r.get("codeEmetteur"); shares = int(r.get("nb_titres_emis") or 0)
        price = (board.get(tk) or {}).get("last") or (board.get(tk) or {}).get("close") or 0
        try:
            pdf_url, date, typ = latest_statement_pdf(isin)
            if not pdf_url:
                print(f"{tk}: no statement PDF"); continue
            data = extract(r.get("emetteur") or tk, pdf_excerpt(fetch(pdf_url)))
            if not data or not data.get("net_income_mdt"):
                print(f"{tk}: extraction empty"); continue
            # Statements aren't uniformly in mDT: some publish full TND, some
            # millions. Try the three scales; the plausible-PER band (2..80,
            # a 40x span) admits at most one of the 1000x-apart scales.
            raw = data["net_income_mdt"]
            scale = next((s for s in (1000.0, 1.0, 1e6)
                          if shares and price and raw > 0
                          and 2 <= price / (raw * s / shares) <= 80), None)
            if scale is None:
                print(f"{tk}: REJECTED (no scale gives plausible PER; raw={raw} shares={shares} price={price})")
                continue
            if scale != 1000.0:
                print(f"{tk}: scale-normalized x{scale:g} (statement not in mDT)")
            ni = raw * scale
            eq = (data.get("equity_mdt") or 0) * scale
            eps = ni / shares
            per = price / eps
            dps = data.get("dividend_per_share_tnd")
            blob[tk] = {
                "fiscalYear": data.get("fiscal_year"),
                "netIncome": ni, "equity": eq or None, "eps": eps,
                "per": (price / eps) if eps and price else None,
                "pb": (price * shares / eq) if eq and price and shares else None,
                "dividend": dps, "yield": (dps / price * 100) if dps and price else None,
                "source": pdf_url, "sourceDate": date, "sourceType": typ,
            }
            print(f"{tk}: FY{data.get('fiscal_year')} NI={ni/1e6:.1f}M EPS={eps:.2f} PER={blob[tk]['per']:.1f}" if eps else f"{tk}: done")
        except Exception as e:
            print(f"{tk}: ERROR {e}")

    body = json.dumps(blob).encode()
    req = urllib.request.Request(BLOB, data=body, method="POST", headers={
        "apikey": SKEY, "Authorization": f"Bearer {SKEY}", "Content-Type": "application/json", "x-upsert": "true"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        print(f"\nStored {len(blob)} companies -> HTTP {resp.status}")


if __name__ == "__main__":
    main()
