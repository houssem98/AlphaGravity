#!/usr/bin/env python3
"""Fetch each eval case's statement PDF once and cache the focused excerpt
(tn_fundamentals.pdf_excerpt output) to excerpts/{ticker}.txt, plus the
live shares/price snapshot to excerpts/meta.json — so GEPA rollouts cost
one DeepSeek call each instead of a PDF fetch + pdftotext."""
import importlib.util
import json
import pathlib
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT = HERE / "excerpts"
OUT.mkdir(exist_ok=True)

spec = importlib.util.spec_from_file_location("tnf", ROOT / "apps/market-ui/scripts/tn_fundamentals.py")
tnf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tnf)

cases = json.loads((HERE / "tn_fundamentals_cases.json").read_text(encoding="utf-8"))
ref = {r["mnemo"]: r for r in tnf.gsql(
    "SELECT raw_data FROM raw_referentiels WHERE raw_data->>'grp_description' LIKE 'Ligne M%re'") if r.get("mnemo")}
board = {m["referentiel"]["ticker"]: m for m in json.load(urllib.request.urlopen(urllib.request.Request(
    "https://www.bvmt.com.tn/rest_api/rest/market/groups/11,12,52,95,99",
    headers={"User-Agent": tnf.UA})))["markets"] if m.get("referentiel", {}).get("ticker")}

meta = {}
for c in cases:
    tk = c["ticker"]
    r = ref.get(tk)
    if not r:
        continue
    pdf_url = c.get("pdf")
    if not pdf_url:
        pdf_url, _, _ = tnf.latest_statement_pdf(r.get("codeEmetteur"))
    if not pdf_url:
        print(f"{tk}: no PDF, skipped")
        continue
    try:
        excerpt = tnf.pdf_excerpt(tnf.fetch(pdf_url))
        (OUT / f"{tk}.txt").write_text(excerpt, encoding="utf-8")
        row = board.get(tk) or {}
        meta[tk] = {"shares": int(r.get("nb_titres_emis") or 0),
                    "price": row.get("last") or row.get("close") or 0,
                    "name": r.get("emetteur") or tk, "pdf": pdf_url}
        print(f"{tk}: cached {len(excerpt)} chars")
    except Exception as e:
        print(f"{tk}: ERROR {e}")

(OUT / "meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
print(f"done: {len(meta)} cached")
