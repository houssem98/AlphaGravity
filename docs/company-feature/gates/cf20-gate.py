"""CF-20 gate. A metric this channel cannot resolve is reported absent, never
answered with a different metric.

`edgar_search.classify_metric` defaults to revenue for any query naming no metric
in its table. `company_skill` asked for "total debt" and "free cash flow", neither
of which was in that table, so both came back as the REVENUE figure wearing the
asked-for label — cited to a real filing, and entirely fabricated. Measured
2026-09-08: LULU reported `Total debt: $11.10B`, byte-identical to its revenue.

Run from services/gravity-api:
    .venv/Scripts/python.exe ../../docs/company-feature/gates/cf20-gate.py
"""
import asyncio
import logging
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
API = ROOT / "services" / "gravity-api"
sys.path.insert(0, str(API))

for env_file in (API / ".env", ROOT / ".env"):
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

import structlog  # noqa: E402
structlog.configure(wrapper_class=structlog.make_filtering_bound_logger(logging.CRITICAL))

from app.core.retrieval.edgar_search import (  # noqa: E402
    classify_metric, classify_metric_strict, concept_family,
)
from app.core.skills import company_skill  # noqa: E402
from app.core.skills.contract import SkillRequest  # noqa: E402

TICKERS = ["LULU", "MS", "DUK"]
failures = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global failures
    if not ok:
        failures += 1
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"\n      {detail}" if detail and not ok else ""))


def main_sync() -> None:
    # The classifier itself, before any network call.
    check("an unknown metric resolves to nothing under the strict classifier",
          classify_metric_strict("ACME total unicorns") is None)
    check("the lenient classifier still defaults to revenue for a bare question",
          classify_metric("how did ACME do")[1] == "revenue")
    check("'total debt' now resolves to a debt concept, not revenue",
          (classify_metric_strict("LULU total debt") or ("", ""))[0]
          == "DebtLongtermAndShorttermCombinedAmount",
          f"got {classify_metric_strict('LULU total debt')}")
    check("free cash flow has no us-gaap concept and resolves to nothing",
          classify_metric_strict("LULU free cash flow") is None)
    # The bug in one line: these two must never be the same family.
    debt_family = set(concept_family("DebtLongtermAndShorttermCombinedAmount"))
    rev_family = set(concept_family("RevenueFromContractWithCustomerExcludingAssessedTax"))
    check("the debt and revenue concept families are disjoint",
          not (debt_family & rev_family), f"overlap: {debt_family & rev_family}")


async def main() -> int:
    main_sync()

    for t in TICKERS:
        res = await company_skill.run(
            SkillRequest(skill="company", entities=[t], period="latest"))
        claims = res.as_dict().get("claims") or []
        by_label = {c["text"].split(":")[0].strip(): c for c in claims}

        revenue = (by_label.get("Revenue") or {}).get("value")
        debt_claim = by_label.get("Total debt") or {}
        debt = debt_claim.get("value")

        check(f"{t}: total debt is not the revenue figure",
              debt is None or revenue is None or debt != revenue,
              f"debt={debt} revenue={revenue} — identical")

        if debt is None:
            check(f"{t}: an unresolvable total debt is reported absent",
                  debt_claim.get("kind") == "absent" or "Total debt" not in by_label,
                  f"kind={debt_claim.get('kind')!r}")
        else:
            tag = ((debt_claim.get("metadata") or {}).get("tag")
                   or (debt_claim.get("citations") and "") or "")
            print(f"      {t} total debt = ${debt / 1e9:.2f}B")

        # Free cash flow has no concept at all; it must never carry a number.
        fcf = (by_label.get("Free cash flow") or {}).get("value")
        check(f"{t}: free cash flow is absent rather than a substituted figure",
              fcf is None, f"fcf={fcf} revenue={revenue}")

    print(f"\nRESULT {'PASS' if failures == 0 else f'FAIL ({failures})'}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
