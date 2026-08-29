"""
Skill coverage evaluation — does a skill work for companies nobody curated?

    python -m eval.quick_answer_skill_coverage.run_eval
    python -m eval.quick_answer_skill_coverage.run_eval --json results/skill_coverage.json

What this measures and what it does not. It measures the SKILL'S OWN LOGIC:
entity resolution, period gating, absence handling, channel semantics, citation
shape, and abstention correctness, over nine issuers in nine sectors none of
which is hard-coded anywhere in the pipeline. Evidence is injected, so a run is
deterministic and needs no credentials.

It does NOT measure end-to-end answer accuracy against live SEC data. That is
`eval/quick_answer/live_e2e.py`, it needs network, and it reports itself
separately. A fixture-driven pass is evidence that the skill is not
company-scoped; it is not evidence that SEC is up.

The metrics are the specification's:

    entity accuracy       the right registrant, or the right refusal
    period accuracy       the requested period survived to the result
    abstention accuracy   abstained exactly when it should have
    citation validity     every citation names a filing and two distinct links
    unsupported claims    a claim whose citations do not exist
    false confidence      a number produced where the skill should have abstained
    coverage              cases that ran without an unhandled error
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.core.skills import company_skill, sentiment_skill  # noqa: E402
from app.core.skills.contract import SkillRequest, SkillStatus  # noqa: E402

HERE = Path(__file__).parent
CASES = HERE / "cases.json"
AS_OF = date(2026, 8, 29)

POSITIVE = (
    "Revenue growth accelerated and margins improved substantially across the segment. "
    "Demand remains strong and the outlook is favorable for the coming year. "
    "We delivered record results with robust cash generation and improved profitability. "
    "Our expansion strategy exceeded expectations and drove significant gains. "
    "Operating efficiency increased and costs declined meaningfully this period. "
    "Customer retention strengthened and new bookings grew at a healthy pace. "
)
NEGATIVE = (
    "Revenue declined sharply and margins deteriorated across every region we serve. "
    "Demand weakened considerably and the outlook remains challenging and uncertain. "
    "We recorded a significant impairment charge and losses widened during the period. "
    "Competitive pressure intensified and pricing eroded throughout the year. "
    "Costs increased substantially and operating efficiency worsened materially. "
    "Customer attrition accelerated and new bookings fell well below our plan. "
)
THIN = "Revenue grew modestly during the period under review."


# ── Injected channels ─────────────────────────────────────────────────────


class Passage:
    def __init__(self, text, metadata, title="", section=""):
        self.text, self.metadata = text, metadata
        self.document_title, self.section = title, section


def sec_meta(ticker, cik, *, value=None, accn="0000123456-25-000001", form="10-K"):
    nod = accn.replace("-", "")
    return {
        "accn": accn, "cik": int(cik), "issuer": f"{ticker} INC", "form": form,
        "filed": "2025-02-20", "fiscal_year": 2025,
        "period_end": "2024-12-31", "period_of_report": "2024-12-31",
        "unit": "USD", "value": value,
        "filing_url": f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{nod}/{accn}-index.htm",
        "filing_index_url": f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{nod}/{accn}-index.htm",
        "primary_document": f"{ticker.lower()}-20241231.htm",
        "primary_document_url": f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{nod}/{ticker.lower()}-20241231.htm",
    }


DEFAULT_SUPPLY = {
    "total revenue": 4_500_000_000.0,
    "net income": 1_200_000_000.0,
    "operating income": 1_500_000_000.0,
    "cash and cash equivalents": 900_000_000.0,
}


class FactsChannel:
    def __init__(self, ticker, cik, supply):
        self.ticker, self.cik, self.supply = ticker, cik, supply
        self.calls = 0

    async def search(self, query, entities=None, top_k=10, filters=None):
        self.calls += 1
        for key, value in self.supply.items():
            if key in query.lower():
                return [Passage(f"[EXACT FILING FIGURE] {value}",
                                sec_meta(self.ticker, self.cik, value=value),
                                title=f"{self.ticker} 10-K — FY2025")]
        return []


class ProseChannel:
    def __init__(self, ticker, cik, text, n=3):
        self.ticker, self.cik, self.text, self.n = ticker, cik, text, n
        self.calls = 0

    async def search(self, query, entities=None, top_k=10, filters=None):
        self.calls += 1
        return [
            Passage(self.text, sec_meta(self.ticker, self.cik,
                                        accn=f"000012345{i}-25-000001"),
                    title=f"{self.ticker} 10-K — 2024-12-31",
                    section="Item 7. Management's Discussion and Analysis")
            for i in range(self.n)
        ]


class Broken:
    def __init__(self, exc):
        self.exc, self.calls = exc, 0

    async def search(self, *a, **k):
        self.calls += 1
        raise self.exc


class Empty:
    def __init__(self):
        self.calls = 0

    async def search(self, *a, **k):
        self.calls += 1
        return []


class Resolved:
    def __init__(self, ticker, cik, name, confidence=1.0, match_type="exact_ticker",
                 alternatives=None):
        self.ticker, self.cik, self.name = ticker, cik, name
        self.confidence, self.match_type = confidence, match_type
        self.alternatives = alternatives or []
        self.former_names = []


class Resolver:
    def __init__(self, issuers):
        self.table = {}
        for i in issuers:
            self.table[i["ticker"].lower()] = Resolved(i["ticker"], i["cik"], i["legal_name"])
            self.table[i["legal_name"].lower()] = Resolved(
                i["ticker"], i["cik"], i["legal_name"], 0.95, "fuzzy_name")
        self.table["apple"] = Resolved(
            "AAPL", "320193", "Apple Inc.", 0.95, "fuzzy_name",
            alternatives=[{"ticker": "APLE", "name": "Apple Hospitality REIT",
                           "score": 0.93}])

    async def resolve(self, mention, top_k=3):
        return self.table.get(mention.lower(), Resolved("", "", "", 0.0, "unknown"))


# ── Grading ───────────────────────────────────────────────────────────────


def _channel_for(case, issuers):
    ticker = case["company"]
    row = next((i for i in issuers if i["ticker"].lower() == ticker.lower()
                or i["legal_name"].lower() == ticker.lower()), None)
    tk = row["ticker"] if row else "XXXX"
    cik = row["cik"] if row else "1"
    kind = case.get("channel", "")
    if kind == "failed":
        return Broken(RuntimeError("postgres://user:pw@host/db unreachable"))
    if kind == "timeout":
        return Broken(TimeoutError("slow"))
    if kind == "empty":
        return Empty()
    if case["skill"] == "company":
        return FactsChannel(tk, cik, case.get("supply", DEFAULT_SUPPLY))
    tone = case.get("tone", "positive")
    text = {"positive": POSITIVE, "negative": NEGATIVE,
            "mixed": POSITIVE + NEGATIVE, "thin": THIN}[tone]
    return ProseChannel(tk, cik, text, n=1 if tone == "thin" else 3)


async def _run_one(case, issuers, resolver):
    channel = _channel_for(case, issuers)
    request = SkillRequest(
        skill=case["skill"], entities=[case["company"]],
        period=case.get("period", "latest"),
    )
    t0 = time.perf_counter()
    if case["skill"] == "company":
        result = await company_skill.run(request, facts_search=channel,
                                         resolver=resolver, as_of=AS_OF)
    else:
        result = await sentiment_skill.run(request, text_search=channel,
                                           resolver=resolver, as_of=AS_OF)
    return result, channel, (time.perf_counter() - t0) * 1000


def grade(case, result, channel) -> tuple[bool, list[str]]:
    """Every assertion the case declares. Returns (passed, failures)."""
    bad: list[str] = []
    status = result.status.value

    want = case.get("expect_status")
    if want and status not in want:
        bad.append(f"status={status} not in {want}")

    if case.get("expect_entity"):
        got = (result.entities[0].get("ticker") if result.entities else "")
        if got != case["expect_entity"]:
            bad.append(f"entity={got!r} != {case['expect_entity']!r}")

    if case.get("expect_period") and result.period != case["expect_period"]:
        bad.append(f"period={result.period!r} != {case['expect_period']!r}")

    if case.get("expect_abstain") and not result.abstained:
        bad.append("expected abstention")

    if case.get("expect_no_channel_call") and getattr(channel, "calls", 0) != 0:
        bad.append(f"channel was called {channel.calls}x on an abstaining case")

    if case.get("expect_channel_state"):
        got = result.channels[0].state.value if result.channels else ""
        if got != case["expect_channel_state"]:
            bad.append(f"channel state={got!r} != {case['expect_channel_state']!r}")

    for label in case.get("expect_absent", []):
        if label not in result.data.get("not_reported", []):
            bad.append(f"{label!r} should be reported absent")

    if case.get("expect_no_zero"):
        for key, v in (result.data.get("financials") or {}).items():
            if v.get("value") == 0:
                bad.append(f"{key} came back as a zero standing in for absent")

    if case.get("expect_no_score") and result.data.get("overall_score") is not None:
        bad.append("a score was produced on an abstaining case")

    if case.get("expect_conflict_or_directional"):
        overall = result.data.get("overall")
        if overall == "mixed" and status != "conflicting_evidence":
            bad.append("mixed reading not reported as conflicting_evidence")
        if overall != "mixed" and status == "conflicting_evidence":
            bad.append("conflicting status without a mixed reading")

    if case.get("expect_no_market_data"):
        blob = json.dumps(result.as_dict()).lower()
        for banned in ('"price"', '"close"', '"volume"', '"ohlc"'):
            if banned in blob:
                bad.append(f"market data leaked into sentiment: {banned}")

    if case.get("expect_two_links"):
        if not result.citations:
            bad.append("no citations on a citation case")
        for c in result.citations:
            if not c.get("accession"):
                bad.append("citation without an accession")
            v, d = c.get("view_filing_url", ""), c.get("filing_details_url", "")
            if not d:
                bad.append("citation without a filing-details URL")
            if v and v == d:
                bad.append("View filing and Filing details are the same URL")

    # Universal invariants, asserted on every case regardless of what it declares.
    for claim in result.claims:
        for idx in claim.citations:
            if idx < 0 or idx >= len(result.citations):
                bad.append(f"claim cites index {idx}, which does not exist")
    if result.abstained and result.data.get("overall_score") is not None:
        bad.append("false confidence: a score on an abstaining result")
    if result.abstained and any(c.kind == "reported" for c in result.claims):
        bad.append("false confidence: a reported claim on an abstaining result")

    return not bad, bad


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", dest="out", default="")
    args = ap.parse_args()

    spec = json.loads(CASES.read_text(encoding="utf-8"))
    issuers, cases = spec["issuers"], spec["cases"]
    resolver = Resolver(issuers)

    rows, latencies = [], []
    counters = {
        "entity_ok": 0, "entity_total": 0,
        "period_ok": 0, "period_total": 0,
        "abstain_ok": 0, "abstain_total": 0,
        "citation_ok": 0, "citation_total": 0,
        "unsupported_claims": 0, "false_confidence": 0,
    }

    for case in cases:
        try:
            result, channel, ms = await _run_one(case, issuers, resolver)
        except Exception as e:  # noqa: BLE001 — a crash is a failed case, not a crashed run
            rows.append({"id": case["id"], "skill": case["skill"],
                         "category": case["category"], "passed": False,
                         "failures": [f"raised {type(e).__name__}: {e}"], "ms": 0.0})
            continue
        latencies.append(ms)
        passed, failures = grade(case, result, channel)
        rows.append({
            "id": case["id"], "skill": case["skill"], "category": case["category"],
            "passed": passed, "failures": failures, "status": result.status.value,
            "ms": round(ms, 2),
        })

        if case.get("expect_entity"):
            counters["entity_total"] += 1
            counters["entity_ok"] += int(not any("entity=" in f for f in failures))
        if case.get("expect_period"):
            counters["period_total"] += 1
            counters["period_ok"] += int(not any("period=" in f for f in failures))
        if case.get("expect_abstain"):
            counters["abstain_total"] += 1
            counters["abstain_ok"] += int(result.abstained)
        if case.get("expect_two_links"):
            counters["citation_total"] += 1
            counters["citation_ok"] += int(not any("URL" in f or "accession" in f
                                                   for f in failures))
        counters["unsupported_claims"] += sum(
            1 for f in failures if "does not exist" in f)
        counters["false_confidence"] += sum(
            1 for f in failures if "false confidence" in f)

    passed = sum(1 for r in rows if r["passed"])
    latencies.sort()

    def pct(n, d):
        return round(n / d, 4) if d else None

    report = {
        "dataset": spec["dataset"],
        "version": spec["version"],
        "cases": len(rows),
        "passed": passed,
        "failed": len(rows) - passed,
        "pass_rate": pct(passed, len(rows)),
        "metrics": {
            "entity_accuracy": pct(counters["entity_ok"], counters["entity_total"]),
            "period_accuracy": pct(counters["period_ok"], counters["period_total"]),
            "abstention_accuracy": pct(counters["abstain_ok"], counters["abstain_total"]),
            "citation_validity": pct(counters["citation_ok"], counters["citation_total"]),
            "unsupported_claim_count": counters["unsupported_claims"],
            "false_confidence_count": counters["false_confidence"],
            "coverage": pct(sum(1 for r in rows if "raised" not in str(r["failures"])),
                            len(rows)),
            "latency_ms_p50": round(latencies[len(latencies) // 2], 2) if latencies else None,
            "latency_ms_p95": round(latencies[int(len(latencies) * 0.95)], 2) if latencies else None,
        },
        "by_category": {},
        "rows": rows,
    }
    for r in rows:
        b = report["by_category"].setdefault(r["category"], {"passed": 0, "total": 0})
        b["total"] += 1
        b["passed"] += int(r["passed"])

    print(f"\n{spec['dataset']} v{spec['version']} — {passed}/{len(rows)} passed")
    for name, value in report["metrics"].items():
        print(f"  {name:26} {value}")
    print()
    for cat, b in sorted(report["by_category"].items()):
        mark = "ok  " if b["passed"] == b["total"] else "FAIL"
        print(f"  [{mark}] {cat:22} {b['passed']}/{b['total']}")
    for r in rows:
        if not r["passed"]:
            print(f"\n  FAILED {r['id']}:")
            for f in r["failures"]:
                print(f"    - {f}")

    if args.out:
        p = Path(args.out)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"\nwrote {p}")

    return 0 if passed == len(rows) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
