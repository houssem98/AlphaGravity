"""
Dimensional (segment / product-line / geographic) XBRL facts from a filing.

`companyconcept` and `companyfacts` — the endpoints `edgar_search` already calls —
return **non-dimensional facts only**. NVIDIA's consolidated Q3 FY2026 revenue is
there; its Data Center revenue is not, and no amount of querying those endpoints
will produce it. Segment and product-line figures exist only in the filing's own
XBRL instance document, hung off context elements as explicit members.

Measured on NVDA's Q3 FY2026 10-Q (accession 0001045810-25-000230), the single
context 2025-07-28 → 2025-10-26 carries `us-gaap:Revenues` eight times over:

    57,006,000,000  (no dimension — consolidated)
    51,215,000,000  srt:ProductOrServiceAxis = nvda:DataCenterMember
    50,908,000,000  us-gaap:StatementBusinessSegmentsAxis = nvda:ComputeAndNetworkingSegmentMember
     8,187,000,000  srt:ProductOrServiceAxis = nvda:NetworkingMember
     ...

Two of those are 0.6% apart and mean completely different things, which is why
member matching here refuses ambiguity instead of picking a best guess. A wrong
number delivered with a citation is worse than no number.

This module does NOT resolve periods or filings — `edgar_search` has already done
that from companyconcept by the time it calls in, and the (start, end) it passes
is what pins the context. That is also what makes the quarterly/YTD trap
unreachable: the same filing tags a 272-day span at 147,811,000,000, and it is
never selected because it is not the resolved period.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET

import structlog

from app.core.retrieval.citation_provenance import (
    valid_accession,
    valid_instance_name,
)

logger = structlog.get_logger()

INDEX_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{accn_nodash}/index.json"
ARCHIVE_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{accn_nodash}/{name}"

# NVDA's Q3 FY2026 instance is 1.2 MB. 16 MB leaves generous headroom for a large
# 10-K while still refusing something pathological at query time.
INSTANCE_MAX_BYTES = 16_000_000

# Axes that carry the breakdowns people ask for by name. Anything else (legal
# entity, restatement, fair-value hierarchy) is deliberately ignored — those are
# not what "Data Center revenue" means.
NAMED_AXES = (
    "ProductOrServiceAxis",
    "StatementBusinessSegmentsAxis",
    "StatementGeographicalAxis",
)

def _local(tag) -> str:
    """Local name of an `{namespace}name` tag. stdlib ElementTree keeps the
    namespace inline and offers no accessor, unlike lxml's QName."""
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _namespace(tag) -> str:
    """Namespace URI of an `{namespace}name` tag, or "" when unqualified."""
    if isinstance(tag, str) and tag.startswith("{"):
        return tag[1:].split("}", 1)[0]
    return ""


# The US GAAP taxonomy. Every filing also carries the issuer's own namespace
# (`http://www.nvidia.com/20251026` here) for extension concepts, which is where
# non-GAAP measures live. A filer may define an extension whose local name
# matches a us-gaap one, so matching on local name alone can serve a non-GAAP
# figure as though it were the GAAP one. Matching the namespace makes that
# impossible rather than unlikely.
US_GAAP_NS_MARKER = "fasb.org/us-gaap"


def is_us_gaap(tag) -> bool:
    return US_GAAP_NS_MARKER in _namespace(tag)


_CAMEL = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")
_NON_ALNUM = re.compile(r"[^a-z0-9]+")
# Trailing noise on member names that carries no meaning for matching.
_TRAILING = ("member", "segment", "domain")


def normalize_label(raw: str) -> str:
    """
    `nvda:ComputeAndNetworkingSegmentMember` -> `compute and networking`.

    Splits CamelCase, drops the namespace prefix, folds `&` to `and`, and strips
    the trailing XBRL noise words so a member name compares against the phrasing
    a person actually types.
    """
    s = raw.split(":", 1)[-1]
    s = _CAMEL.sub(" ", s)
    s = s.replace("&", " and ")
    s = _NON_ALNUM.sub(" ", s.lower()).strip()
    parts = s.split()
    while parts and parts[-1] in _TRAILING:
        parts.pop()
    return " ".join(parts)


class DimensionalFact:
    """One dimensionally-qualified fact, with the identity needed to cite it."""

    __slots__ = ("concept", "value", "unit", "members", "start", "end", "context_id")

    def __init__(self, concept, value, unit, members, start, end, context_id):
        self.concept = concept
        self.value = value
        self.unit = unit
        self.members = members          # list[(axis, member)] — raw QNames
        self.start = start
        self.end = end
        self.context_id = context_id

    @property
    def is_consolidated(self) -> bool:
        return not self.members

    @property
    def labels(self) -> list[str]:
        """Normalized member names, for matching against a query."""
        return [normalize_label(m) for _axis, m in self.members]

    @property
    def axis_names(self) -> list[str]:
        return [a.split(":", 1)[-1] for a, _m in self.members]

    def __repr__(self) -> str:
        return f"<DimensionalFact {self.concept}={self.value} {self.labels}>"


async def find_instance_name(http, cik: int, accn: str) -> str | None:
    """
    The XBRL instance document's filename inside the filing archive.

    It is conventionally `{ticker}-{period_end}_htm.xml`, but the ticker prefix
    and the date both vary, so the filing index is read rather than guessed.
    """
    if not valid_accession(accn):
        logger.warning("sec_bad_accession", accn=str(accn)[:40])
        return None
    nodash = accn.replace("-", "")
    r = await http.get(INDEX_URL.format(cik=int(cik), accn_nodash=nodash))
    if r.status_code != 200:
        return None
    items = (r.json().get("directory", {}) or {}).get("item", []) or []
    # The filename is about to be appended to an Archives URL. Only a bare
    # filename is accepted: a scheme, a path separator or a parent-directory hop
    # in this field would send the fetch somewhere other than the filing
    # archive, and the field comes off the wire.
    names = [
        i.get("name", "") for i in items if valid_instance_name(i.get("name", ""))
    ]
    for n in names:
        if n.endswith("_htm.xml"):
            return n
    # Older filings ship the instance without the `_htm` infix.
    for n in names:
        if n.endswith(".xml") and not n.endswith(
            ("_cal.xml", "_def.xml", "_lab.xml", "_pre.xml", "FilingSummary.xml")
        ):
            return n
    return None


def parse_dimensional_facts(
    xml_bytes: bytes,
    concepts: set[str],
    start: str,
    end: str,
) -> list[DimensionalFact]:
    """
    Every fact for `concepts` on the context spanning exactly `start`..`end`.

    Pinning both endpoints is what keeps a year-to-date or prior-year column from
    being mistaken for the quarter that was asked about — they are different
    contexts, and only the requested one is read.

    A body that will not parse yields no facts rather than an exception. The
    input is a document fetched over the network, so "unparseable" is a normal
    outcome (a truncated read, an error page served with a 200), and the honest
    result is the same as "this filing reports no such fact": nothing.
    """
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as e:
        logger.warning("sec_instance_unparseable", error=str(e)[:160])
        return []

    contexts: dict[str, dict] = {}
    for cx in root.iter():
        if _local(cx.tag) != "context":
            continue
        cid = cx.get("id")
        if not cid:
            continue
        members: list[tuple[str, str]] = []
        c_start = c_end = None
        for el in cx.iter():
            ln = _local(el.tag)
            if ln == "explicitMember":
                members.append((el.get("dimension") or "", (el.text or "").strip()))
            elif ln == "startDate":
                c_start = (el.text or "").strip()
            elif ln == "endDate":
                c_end = (el.text or "").strip()
        contexts[cid] = {"members": members, "start": c_start, "end": c_end}

    wanted = {
        cid
        for cid, c in contexts.items()
        if c["start"] == start and c["end"] == end
    }
    if not wanted:
        return []

    out: list[DimensionalFact] = []
    for el in root.iter():
        if _local(el.tag) not in concepts:
            continue
        if not is_us_gaap(el.tag):
            # An issuer-extension concept sharing a us-gaap local name — a
            # non-GAAP measure wearing a GAAP name. Never served.
            logger.info("sec_non_gaap_concept_skipped", tag=str(el.tag)[:120])
            continue
        cid = el.get("contextRef") or ""
        if cid not in wanted:
            continue
        try:
            value = float((el.text or "").strip())
        except (TypeError, ValueError):
            continue
        c = contexts[cid]
        out.append(
            DimensionalFact(
                concept=_local(el.tag),
                value=value,
                unit=el.get("unitRef") or "",
                members=c["members"],
                start=c["start"],
                end=c["end"],
                context_id=cid,
            )
        )
    return out


def select_by_query(
    facts: list[DimensionalFact], query: str
) -> tuple[DimensionalFact | None, str, list[str]]:
    """
    Pick the fact whose breakdown the query actually names.

    Evidence-driven rather than ontology-driven: instead of guessing which phrase
    in the question is a segment name, this asks which of the members *this
    filing defines* appear in the question. A filing that has no Data Center
    member cannot yield a Data Center answer, and saying so is the correct
    outcome.

    Longest match wins, so "compute and networking" beats the bare "compute" it
    contains. A genuine tie is reported as ambiguous and answers nothing.

    Returns (fact, status, candidate_labels) where status is one of
    `matched` / `consolidated` / `ambiguous` / `no_match`.
    """
    qnorm = _NON_ALNUM.sub(" ", (query or "").lower().replace("&", " and ")).strip()
    qnorm = f" {qnorm} "

    scored: list[tuple[int, str, DimensionalFact]] = []
    for f in facts:
        if f.is_consolidated:
            continue
        # Only breakdowns along an axis people name in prose.
        if not any(a in NAMED_AXES for a in f.axis_names):
            continue
        for label in f.labels:
            if label and f" {label} " in qnorm:
                scored.append((len(label), label, f))

    if not scored:
        consolidated = next((f for f in facts if f.is_consolidated), None)
        return consolidated, ("consolidated" if consolidated else "no_match"), []

    best = max(s[0] for s in scored)
    top = [s for s in scored if s[0] == best]
    labels = sorted({s[1] for s in top})
    if len({s[2].value for s in top}) > 1:
        logger.info("sec_dimension_ambiguous", labels=labels, query=query[:120])
        return None, "ambiguous", labels
    return top[0][2], "matched", labels


async def corroborate(
    http,
    cik: int,
    accn: str,
    concept: str,
    start: str,
    end: str,
    value: float,
    members: list | None = None,
) -> dict:
    """
    Confirm a cited figure is actually in the filing it is cited to.

    `companyconcept` is an aggregation SEC builds *from* filings. This opens the
    filing's own instance document and checks the number is there, on a context
    with the stated period and the stated dimensions. Different artefact, same
    claim — which is what makes it a check rather than a restatement of the
    source.

    Returns `{"ok": bool, "reason": str, "found": [...]}`. `ok` is False when the
    filing does not contain the figure as cited; `reason` says which part failed,
    so a failure is diagnosable rather than just red.
    """
    want_members = sorted(
        (a, m) for a, m in (members or [])
    )
    try:
        name = await find_instance_name(http, cik, accn)
        if not name:
            return {"ok": False, "reason": "instance document not found", "found": []}
        url = ARCHIVE_URL.format(
            cik=int(cik), accn_nodash=accn.replace("-", ""), name=name
        )
        r = await http.get(url)
        if r.status_code != 200:
            return {"ok": False, "reason": f"instance HTTP {r.status_code}", "found": []}
        facts = parse_dimensional_facts(r.content, {concept}, start, end)
        if not facts:
            return {
                "ok": False,
                "reason": f"no {concept} fact for {start}..{end} in this filing",
                "found": [],
            }
        for f in facts:
            if sorted(f.members) != want_members:
                continue
            if abs(f.value - float(value)) < 1e-6:
                return {"ok": True, "reason": "", "found": [f.value]}
            return {
                "ok": False,
                "reason": f"filing reports {f.value:,.0f}, citation claims {float(value):,.0f}",
                "found": [f.value],
            }
        return {
            "ok": False,
            "reason": "no fact with the cited dimensions on that period",
            "found": [f.value for f in facts[:5]],
        }
    except Exception as e:
        return {"ok": False, "reason": f"{type(e).__name__}: {e}", "found": []}


async def resolve_dimensional_fact(
    http,
    cik: int,
    accn: str,
    concepts: set[str],
    start: str,
    end: str,
    query: str,
) -> dict | None:
    """
    Fetch the filing's instance and return the fact the query names, with the
    identity needed to cite it. `None` when the filing cannot be read.

    The returned dict's `status` distinguishes a real answer (`matched`,
    `consolidated`) from a truthful refusal (`ambiguous`, `no_match`).
    """
    try:
        name = await find_instance_name(http, cik, accn)
        if not name:
            logger.info("sec_instance_not_found", cik=cik, accn=accn)
            return None
        url = ARCHIVE_URL.format(
            cik=int(cik), accn_nodash=accn.replace("-", ""), name=name
        )
        r = await http.get(url)
        if r.status_code != 200:
            return None
        body = r.content
        if len(body) > INSTANCE_MAX_BYTES:
            logger.warning("sec_instance_too_large", accn=accn, bytes=len(body))
            return None

        facts = parse_dimensional_facts(body, concepts, start, end)
        if not facts:
            return None
        fact, status, labels = select_by_query(facts, query)
        return {
            "fact": fact,
            "status": status,
            "candidates": labels,
            "document_url": url,
            "available": sorted(
                {lbl for f in facts for lbl in f.labels if lbl}
            ),
        }
    except Exception as e:  # network / malformed XML — the caller falls back
        logger.warning("sec_dimensional_failed", accn=accn, error=str(e)[:200])
        return None
