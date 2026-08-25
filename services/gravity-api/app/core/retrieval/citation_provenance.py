"""
The provenance a citation must carry when the number came out of a filing.

`edgar_search` already resolves the exact accession, the exact filing URL, the
XBRL concept, the dimensional context and the verified period, and hangs all of
it on `RetrievalResult.metadata`. `_normalize_citations` then built the citation
from *attributes* of the passage only — and `RetrievalResult` has no attribute
for any of it. So every field was resolved, verified, persisted, and then thrown
away one step before the user could see it, and the citation URL fell back to a
generic `browse-edgar?action=getcompany` company listing while the exact filing
index URL sat unread in `metadata["filing_url"]`.

This module is the join. It reads the metadata a SEC-authoritative passage
carries and returns the canonical evidence object, so the accession survives:

    SEC client -> evidence -> retrieval metadata -> answer generation
    -> citation generation -> API response -> UI

Two rules it enforces, both of which the tests pin:

**The exact filing URL wins.** A generic EDGAR browse URL is a fallback for
passages that never named a filing. When an accession is known, silently
substituting the company listing for the filing is a downgrade of the evidence,
not a convenience.

**Nothing is fabricated.** A field absent from the metadata is absent from the
citation. `provenance()` returns `None` for a passage that is not an
authoritative filing fact, so prose chunks and news are unaffected.
"""

from __future__ import annotations

import re

# EDGAR accession numbers are `NNNNNNNNNN-NN-NNNNNN`, always. The format is
# checked before the value is interpolated into a URL path or shown to a user:
# it arrives from a parsed JSON document, and "it came from sec.gov" is an
# assumption about the network, not a property of the string.
#
# `\Z`, not `$`: `$` also matches immediately before a trailing newline, so
# an accession with a trailing newline would validate and then be
# interpolated into a URL path.
ACCESSION_RE = re.compile(r"\A\d{10}-\d{2}-\d{6}\Z")

# The instance document's filename comes out of the filing's own index.json and
# is interpolated into an Archives URL. A name with a path separator, a scheme,
# or a parent-directory hop would point the fetch somewhere other than the
# filing archive, so only a plain filename is accepted.
INSTANCE_NAME_RE = re.compile(r"\A[A-Za-z0-9._-]{1,128}\.xml\Z")


def valid_accession(accn) -> bool:
    """Whether this string is an accession number, rather than merely truthy."""
    return bool(ACCESSION_RE.match(str(accn or "")))


def valid_instance_name(name) -> bool:
    """Whether this is a bare filename safe to append to an archive URL."""
    n = str(name or "")
    return bool(INSTANCE_NAME_RE.match(n)) and ".." not in n


def _clean(value):
    """Drop the empties so an absent field is absent, not an empty string."""
    return value if value not in (None, "", [], {}) else None


def provenance(metadata: dict | None, *, ticker: str = "") -> dict | None:
    """
    The canonical evidence object for one passage, or `None` when the passage is
    not an authoritative SEC filing fact.

    The accession is the discriminator: a passage without one cannot name the
    filing it came from, and a citation that cannot name its filing has no
    provenance to carry. That is deliberately stricter than "channel == edgar" —
    a channel label is a claim about plumbing, an accession is a claim about a
    document.
    """
    m = metadata or {}
    if not valid_accession(m.get("accn")):
        # A passage from the local corpus is a `financials` row, not a live SEC
        # result: the identity is there, encoded in `source_section`, but under
        # different keys. Rehydrating it here is what stops the second, locally
        # answered ask of the same question from producing a citation with no
        # accession — the exact failure the persistence layer exists to avoid.
        m = rehydrate(m)
    accn = str(m.get("accn") or "")
    if not valid_accession(accn):
        return None

    dims = [d for d in (m.get("dimensions") or []) if isinstance(d, dict)]
    out = {
        "issuer": _clean(m.get("issuer")),
        "ticker": (ticker or m.get("ticker") or "").upper() or None,
        "cik": _clean(m.get("cik")),
        "filing_form": _clean(m.get("form")),
        "filing_date": _clean(m.get("filed")),
        "accession": accn,
        "fiscal_year": _clean(m.get("fiscal_year")),
        "fiscal_quarter": _clean(m.get("fiscal_quarter")),
        "period_start": _clean(m.get("period_start")),
        "period_end": _clean(m.get("period_end")),
        "xbrl_concept": _clean(m.get("tag")),
        # Axis and member travel apart as well as together: a citation states
        # "Data Center", an auditor needs `srt:ProductOrServiceAxis`.
        "dimension": _clean([d.get("axis") for d in dims if d.get("axis")]),
        "dimension_value": _clean([d.get("member") for d in dims if d.get("member")]),
        "unit": _clean(m.get("unit")),
        "value": _clean(m.get("value")),
        "verification_status": _clean(m.get("verification_status")),
        "source_url": _clean(m.get("source_url")),
        "filing_url": _clean(m.get("filing_url")),
        "evidence_location": _clean(evidence_location(m)),
        "extraction_method": _clean(m.get("extraction_method")),
        "parser_version": _clean(m.get("parser_version")),
        "scope": "segment" if dims else "consolidated",
        "restated": bool(m.get("restated")),
        "is_amendment": bool(m.get("is_amendment")),
        "superseded": _clean(m.get("superseded")),
    }
    out["provenance_chain"] = _chain(out)
    return {k: v for k, v in out.items() if v is not None}


# `financials` provenance key -> live-result metadata key. The two shapes exist
# because one is a database column budget and the other is a fetch result; this
# is the single place that reconciles them.
_STORED_KEYS = {
    "accn": "accn",
    "cik": "cik",
    "issuer": "issuer",
    "concept": "tag",
    "fy": "fiscal_year",
    "fq": "fiscal_quarter",
    "start": "period_start",
    "end": "period_end",
    "unit": "unit",
    "form": "form",
    "filed": "filed",
    "ver": "verification_status",
    "pv": "parser_version",
    "meth": "extraction_method",
    "ctx": "context_id",
}


def rehydrate(row: dict) -> dict:
    """
    A stored `financials` row back into the metadata shape a live SEC result
    carries, so one provenance builder serves both paths.

    Returns the row unchanged when it holds no provenance of ours — the legacy
    companyfacts backfill and the table scrapes, which have no accession and
    therefore no citation provenance to recover.
    """
    from app.core.retrieval.evidence_gate import decode_provenance

    prov = decode_provenance(str(row.get("source_section") or ""))
    if not prov:
        return row

    out = dict(row)
    for src, dst in _STORED_KEYS.items():
        if prov.get(src):
            out[dst] = prov[src]
    if prov.get("dim"):
        # The axis is not stored — the column budget is one text field — so the
        # member is carried alone rather than paired with a fabricated axis.
        out["dimensions"] = [{"member": prov["dim"]}]
    if row.get("value_float") is not None:
        out["value"] = row["value_float"]
    out["restated"] = prov.get("restated") == "1"

    cik, accn = prov.get("cik"), prov.get("accn")
    if cik and valid_accession(accn):
        from app.ingestion.sources.sec_quarterly import filing_url

        out["filing_url"] = filing_url(cik, accn)
        # Only the instance filename is stored; CIK and accession reconstruct
        # the rest of the archive path exactly.
        if valid_instance_name(prov.get("loc")):
            out["document_url"] = (
                f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/"
                f"{accn.replace('-', '')}/{prov['loc']}"
            )
        out.setdefault("source_url", out.get("document_url") or out["filing_url"])
    return out


def evidence_location(metadata: dict) -> str:
    """
    Where inside the source artefact this figure was read.

    For a dimensional fact that is the instance document plus the XBRL context
    element that pins the period and the members — the two together are what
    make the reading reproducible by hand. For a consolidated fact it is the
    companyconcept response, which has no internal address.
    """
    doc = metadata.get("document_url") or ""
    ctx = metadata.get("context_id") or ""
    if doc and ctx:
        return f"{doc}#{ctx}"
    return doc or ctx or ""


def _chain(p: dict) -> list[str]:
    """
    The resolution path, in the order it was walked, for a citation that has to
    be defensible without re-running the query.
    """
    steps = [
        ("issuer", p.get("issuer") or p.get("ticker")),
        ("cik", p.get("cik")),
        ("fiscal_period", _period_label(p)),
        ("form", p.get("filing_form")),
        ("accession", p.get("accession")),
        ("filing", p.get("filing_url")),
        ("xbrl_concept", p.get("xbrl_concept")),
        ("dimension", _dim_label(p)),
        ("value", _value_label(p)),
        ("verification", p.get("verification_status")),
    ]
    return [f"{k}={v}" for k, v in steps if v]


def _period_label(p: dict) -> str:
    fy, fq = p.get("fiscal_year"), p.get("fiscal_quarter")
    if not fy:
        return ""
    return f"FY{fy}" + (f"Q{fq}" if fq else "")


def _dim_label(p: dict) -> str:
    axes, members = p.get("dimension") or [], p.get("dimension_value") or []
    if not members:
        return "consolidated"
    pairs = [f"{a}={m}" for a, m in zip(axes, members)] or list(members)
    return ",".join(str(x) for x in pairs)


def _value_label(p: dict) -> str:
    v, u = p.get("value"), p.get("unit")
    if v is None:
        return ""
    return f"{v} {u}".strip()


def citation_url(prov: dict | None, fallback: str = "") -> str:
    """
    The URL a citation should point at.

    The exact filing index page when the filing is known, the authoritative URL
    the SEC resolver returned otherwise, and only then whatever generic fallback
    the caller supplies. Never the generic one while an exact one exists.
    """
    if prov:
        for key in ("filing_url", "source_url"):
            if prov.get(key):
                return str(prov[key])
    return fallback
