#!/usr/bin/env python3
"""Eval harness for the TN fundamentals extraction (H3.1).

Replays apps/market-ui/scripts/tn_fundamentals.py extraction logic on labeled
cases from tn_fundamentals_cases.json WITHOUT writing the blob, and scores:

- accept cases: replayed NI (scale-normalized) within 2% of expected AND
  same fiscal year -> PASS
- reject cases: replay must also reject (no plausible-PER scale or empty
  extraction) -> PASS

Usage:
  python eval_fundamentals.py --probe STPIL UADH ...   # discover verdicts
  python eval_fundamentals.py --run 5                  # sample & score N cases
"""
import importlib.util
import json
import pathlib
import random
import sys
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
CASES = HERE / "tn_fundamentals_cases.json"

spec = importlib.util.spec_from_file_location(
    "tnf", ROOT / "apps/market-ui/scripts/tn_fundamentals.py")
tnf = importlib.util.module_from_spec(spec)
# tn_fundamentals.py runs main() only under __main__; import is side-effect free
spec.loader.exec_module(tnf)


def replay(ticker):
    """Re-run the extraction pipeline for one ticker. Returns dict verdict."""
    ref = {r["mnemo"]: r for r in tnf.gsql(
        "SELECT raw_data FROM raw_referentiels WHERE raw_data->>'grp_description' LIKE 'Ligne M%re'")
        if r.get("mnemo")}
    r = ref.get(ticker)
    if not r:
        return {"verdict": "reject", "reason": "no referentiel"}
    isin = r.get("codeEmetteur")
    shares = int(r.get("nb_titres_emis") or 0)
    board = json.load(urllib.request.urlopen(urllib.request.Request(
        "https://www.bvmt.com.tn/rest_api/rest/market/groups/11,12,52,95,99",
        headers={"User-Agent": tnf.UA})))["markets"]
    row = next((m for m in board if (m.get("referentiel") or {}).get("ticker") == ticker), {})
    price = row.get("last") or row.get("close") or 0

    pdf_url, date, typ = tnf.latest_statement_pdf(isin)
    if not pdf_url:
        return {"verdict": "reject", "reason": "no statement PDF"}
    data = tnf.extract(r.get("emetteur") or ticker, tnf.pdf_excerpt(tnf.fetch(pdf_url)))
    if not data or not data.get("net_income_mdt"):
        return {"verdict": "reject", "reason": "extraction empty", "pdf": pdf_url}
    raw = data["net_income_mdt"]
    scale = next((s for s in (1000.0, 1.0, 1e6)
                  if shares and price and raw > 0
                  and 2 <= price / (raw * s / shares) <= 80), None)
    if scale is None:
        return {"verdict": "reject", "reason": f"no plausible-PER scale (raw={raw} shares={shares} price={price})", "pdf": pdf_url}
    ni = raw * scale
    return {"verdict": "accept", "pdf": pdf_url, "fiscalYear": data.get("fiscal_year"),
            "netIncome": ni, "eps": ni / shares, "raw": raw, "scale": scale}


def main():
    if "--probe" in sys.argv:
        for tk in [a for a in sys.argv[2:]]:
            try:
                out = replay(tk)
            except Exception as e:
                out = {"verdict": "error", "reason": str(e)}
            print(tk, json.dumps(out, default=str)[:300])
        return

    n = int(sys.argv[sys.argv.index("--run") + 1]) if "--run" in sys.argv else 5
    cases = json.loads(CASES.read_text(encoding="utf-8"))
    rejects = [c for c in cases if c["verdict"] == "reject"]
    accepts = [c for c in cases if c["verdict"] == "accept"]
    random.seed(int(sys.argv[sys.argv.index("--seed") + 1]) if "--seed" in sys.argv else 42)
    sample = random.sample(accepts, max(0, n - 1)) + random.sample(rejects, 1)

    passed = 0
    for c in sample:
        tk = c["ticker"]
        try:
            out = replay(tk)
        except Exception as e:
            out = {"verdict": "error", "reason": str(e)}
        if c["verdict"] == "reject":
            ok = out["verdict"] == "reject"
            detail = out.get("reason", out.get("netIncome"))
        else:
            ok = (out["verdict"] == "accept"
                  and out.get("fiscalYear") == c["expect"]["fiscalYear"]
                  and abs(out["netIncome"] - c["expect"]["netIncome"]) / c["expect"]["netIncome"] <= 0.02)
            detail = (f"NI got={out.get('netIncome')} want={c['expect']['netIncome']} "
                      f"FY got={out.get('fiscalYear')} want={c['expect']['fiscalYear']}"
                      if out["verdict"] == "accept" else out.get("reason"))
        passed += ok
        print(f"{'PASS' if ok else 'FAIL'} {tk} [{c['verdict']}] -- {detail}")
    print(f"SCORE: {passed}/{len(sample)}")
    sys.exit(0 if passed == len(sample) else 1)


main()
