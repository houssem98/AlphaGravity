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
    # V33. The accession is the discriminator, but a REGEX MATCH is a claim
    # about a string, not about a document. `9999999999-99-999999` is
    # well-formed and names nothing that was ever filed, and a news article
    # that quotes Aflac's real accession is still a news article.
    #
    # The test is COHERENT FILING IDENTITY, not the declared source class. A
    # filing is filed by someone, on a date, in a form; a passage that cannot
    # say who filed it names a document nobody can be shown to have filed.
    #
    # Deliberately NOT a veto on `source_class`. A passage carrying real EOG
    # identity AND web fields is still that filing -- an accession names a
    # document that can be opened and audited, and a URL beside it does not
    # weaken that. `test_sec_wins_when_a_passage_somehow_carries_both` has
    # asserted exactly this since round 2, and a class veto would have broken
    # it while catching nothing the identity check does not already catch:
    # every negative case here fails for want of a filer, not for its label.
    if not _clean(m.get("cik")):
        return None
    if not (_clean(m.get("form")) or _clean(m.get("filed"))):
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
        # The document the figure was actually read from, kept alongside the
        # filing index rather than collapsed into it: the index is what a source
        # click opens, this is where the number lives.
        "document_url": _clean(m.get("document_url")),
        # The filing's own primary document, named by SEC's submissions API and
        # never inferred. Absent here means "View filing" is not offered — see
        # `filing_links` below.
        "period_of_report": _clean(m.get("period_of_report") or m.get("report_date")),
        "primary_document": _clean(m.get("primary_document")),
        "primary_document_url": _clean(m.get("primary_document_url")),
        "filing_index_url": _clean(m.get("filing_index_url")),
        # Why the resolver could not name the primary document, so the UI can
        # say which of "SEC was unreachable" and "this filing has none" it is
        # looking at instead of showing a bare missing link.
        "primary_unresolved_reason": _clean(m.get("primary_unresolved_reason")),
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


def payload(prov: dict | None) -> dict:
    """
    The flat provenance fields a source or citation object carries, so the
    frontend never has to reconstruct a SEC URL from an untrusted string.

    Empty for a passage that is not an authoritative filing fact, so prose
    chunks and news are unaffected and nothing is invented for them.
    """
    if not prov:
        return {}
    links = filing_links(prov)
    return {
        # Names the source class explicitly rather than leaving the consumer to
        # infer it from which fields happen to be present. The web payload
        # carries the same key, so a frontend branches on one field instead of
        # probing for an accession.
        "source_class": "SEC_EVIDENCE",
        "issuer": prov.get("issuer", ""),
        "cik": prov.get("cik"),
        "form": prov.get("filing_form", ""),
        "filing_date": prov.get("filing_date", ""),
        "fiscal_period": _period_label(prov),
        "accession": prov["accession"],
        # The specification names this field `accession_number`; the shipped
        # `Citation` model already calls it `accession`. Both are emitted rather
        # than renaming a field other tests and clients already depend on.
        "accession_number": prov["accession"],
        "filing_url": prov.get("filing_url", ""),
        "document_url": prov.get("document_url", ""),
        "source_url": prov.get("source_url", ""),
        "evidence_location": prov.get("evidence_location", ""),
        "verification_status": prov.get("verification_status", ""),
        # The canonical click target, decided on the backend. A client that
        # honours this never needs the priority rules.
        "canonical_url": source_click_url(prov),
        # The two links the UI offers, decided here so the frontend never
        # constructs a SEC URL. `view_filing_url` is empty exactly when the
        # primary document could not be read from authoritative metadata, and
        # the UI must then offer "Filing details" alone.
        "period_of_report": prov.get("period_of_report", ""),
        "primary_document": links["primary_document"],
        "view_filing_url": links["view_filing_url"],
        "filing_details_url": links["filing_details_url"],
        "primary_unresolved_reason": links["unresolved_reason"],
        # ── The financial half of the object (E1) ──────────────────────
        #
        # This function used to stop above, and that omission is the single
        # sentence underneath most of the defects rounds 1-6 numbered. It
        # emitted identity and URLs, so the citation reaching
        # `verdict_for_citation` carried an accession, a link and some prose —
        # and both that verifier and `eval/head_to_head/rubric.py` had no way
        # to know what the figure MEANT except to run regexes over the passage
        # and hope. Measured on an Apple FY2025 revenue fact, ten of ten
        # financial fields were dropped here; only `fiscal_period` survived,
        # and only as the rendered label "FY2025".
        #
        # Copied, never computed. Every value below is the one `provenance()`
        # read from the filing or the stored row, which is the entire point: a
        # field that arrived re-derived would be the same defect wearing the
        # fix's clothes. Absent stays absent — a consolidated fact names no
        # segment, and an empty `dimension` is the truth about it.
        #
        # `scale` is deliberately not here. XBRL values are absolute, so there
        # is no declared multiplier to carry, and inventing a 1 for facts that
        # never needed one would put a field on the citation that means
        # something different from the `(in millions)` header V14 and V19 read
        # off prose.
        #
        # The keys are always present, with `None` where `provenance()` omitted
        # the field — it drops empties, and a citation whose SHAPE changed with
        # its content would make every consumer probe for keys instead of
        # reading them.
        "value": prov.get("value"),
        "unit": prov.get("unit"),
        "xbrl_concept": prov.get("xbrl_concept"),
        "scope": prov.get("scope"),
        "dimension": prov.get("dimension"),
        "dimension_value": prov.get("dimension_value"),
        "period_start": prov.get("period_start"),
        "period_end": prov.get("period_end"),
        "fiscal_year": prov.get("fiscal_year"),
        "fiscal_quarter": prov.get("fiscal_quarter"),
    }


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


# The only hosts a citation link may point at. SEC serves filings from
# www.sec.gov, the structured APIs from data.sec.gov, and full-text search from
# efts.sec.gov; nothing else is authoritative for a filing citation.
SEC_HOSTS = frozenset({"www.sec.gov", "sec.gov", "data.sec.gov", "efts.sec.gov"})


def is_trusted_sec_url(url) -> bool:
    """
    Whether this URL is safe to turn into a clickable external citation link.

    A citation link is rendered from data that has passed through an LLM and a
    database, so the check is a host allow-list rather than a scheme check: a
    `https://` URL pointing anywhere else is exactly as wrong as a `javascript:`
    one for something labelled "the SEC filing this number came from".
    """
    from urllib.parse import urlparse

    try:
        p = urlparse(str(url or ""))
    except ValueError:
        return False
    return p.scheme == "https" and p.hostname in SEC_HOSTS


def filing_links(prov: dict | None) -> dict:
    """
    The two links a SEC source card offers, and which of them exists.

        view_filing_url     the primary document itself — the 10-K you read
        filing_details_url  `<accession>-index.htm`, EDGAR's manifest

    They are never the same URL. "Filing details" is deterministic from a
    validated CIK and accession, so it exists whenever the filing can be named
    at all. "View filing" exists only when the primary document was named by
    SEC's own submissions metadata AND the resulting URL is inside this exact
    filing's archive directory — the second check is what stops a stale or
    mismatched `primary_document_url` from being presented as this filing.

    `unresolved_reason` is set exactly when `view_filing_url` is empty, so a
    caller can say why the link is missing instead of silently dropping it.

    Nothing here fetches. The primary document name arrives on the provenance
    from `sec_filing_resolver`, whose sole authority is the submissions API;
    this function only validates and assembles.
    """
    from app.core.retrieval import sec_filing_resolver as sfr

    p = prov or {}
    cik, accession = p.get("cik"), p.get("accession")
    details = sfr.filing_index_url(cik, accession)
    if not details:
        # Fall back to a stored index URL only when it is a real EDGAR archive
        # URL for a filing we could not otherwise name.
        stored = p.get("filing_index_url") or p.get("filing_url") or ""
        parsed = sfr.parse_archive_url(stored) if is_trusted_sec_url(stored) else None
        if parsed:
            cik, accession = parsed["cik"], parsed["accession"]
            details = sfr.filing_index_url(cik, accession)
    if not details:
        return {
            "view_filing_url": "",
            "filing_details_url": "",
            "primary_document": "",
            "unresolved_reason": "filing has no valid CIK and accession",
        }

    candidate = p.get("primary_document_url") or ""
    name = p.get("primary_document") or ""
    if not candidate and name:
        candidate = sfr.archive_document_url(cik, accession, name)

    if candidate and is_trusted_sec_url(candidate) and sfr.belongs_to_filing(
        candidate, cik, accession
    ):
        parsed = sfr.parse_archive_url(candidate) or {}
        doc = parsed.get("document") or name
        if sfr.valid_primary_document(doc) and candidate != details:
            return {
                "view_filing_url": candidate,
                "filing_details_url": details,
                "primary_document": doc,
                "unresolved_reason": "",
            }

    return {
        "view_filing_url": "",
        "filing_details_url": details,
        "primary_document": "",
        "unresolved_reason": str(
            p.get("primary_unresolved_reason")
            or ("primary document does not belong to this filing" if candidate
                else "primary document not named by SEC filing metadata")
        ),
    }


def source_click_url(prov: dict | None) -> str:
    """
    The URL a source card should open, given verified provenance.

    Priority, and the reasoning for it:

    1. **`filing_url`** — the exact filing index page, built from the verified
       CIK and accession. This is the landing point that names the filing and
       links its documents, and it is the URL the specification asserts.
    2. **`document_url`**, when SEC itself served it out of `/Archives/` — the
       actual document the figure was read from.
    3. **`source_url`**, any remaining authoritative SEC URL.

    The exact evidence location is never *lost* by preferring (1): it stays on
    the provenance object as `document_url` and `evidence_location`. What (1)
    avoids is opening a 1.2 MB raw XBRL instance in a browser tab and calling
    that "the filing".

    Returns "" when nothing trusted is available, which is what stops a generic
    company listing from being substituted for a filing that is actually known.
    """
    if not prov:
        return ""
    for key in ("filing_url", "document_url", "source_url"):
        url = prov.get(key)
        if url and is_trusted_sec_url(url):
            return str(url)
    return ""


# ── Web sources ───────────────────────────────────────────────────────────
#
# A web citation is a different dialect of the same object, not a different
# object. It is built here, beside the SEC one, for the reason the specification
# gives in §11 and §32: two citation architectures means two places where a URL
# can be wrong, two schemas the frontend has to branch on, and eventually two
# answers to "what does this number come from".
#
# What it does NOT share is the trust rule. `is_trusted_sec_url` is a host
# allow-list because a filing citation may only ever point at SEC. A web
# citation points at the open web by definition, so the check is that the URL is
# a well-formed https/http URL that survived the SSRF guard at fetch time —
# a source that was never fetched has no evidence and therefore no citation.


def is_renderable_web_url(url) -> bool:
    """
    Whether this URL may be rendered as a clickable web citation.

    Not the SSRF guard — that governs what the server fetches and has already
    run by the time a citation exists. This governs what goes into an `href` in
    a browser, where the risk is `javascript:` and `data:` rather than internal
    network access.
    """
    from urllib.parse import urlparse

    try:
        p = urlparse(str(url or ""))
    except ValueError:
        return False
    return p.scheme in ("https", "http") and bool(p.hostname)


def web_payload(prov: dict | None) -> dict:
    """
    The flat provenance fields a web source or citation carries.

    Mirrors `payload()`: stated fields only, empties omitted, nothing invented.
    Every field §11 requires of a web citation is here — URL, title, domain,
    publication date when available, retrieval timestamp, source type, evidence
    location — plus the claim linkage the caller attaches.

    Returns `{}` when the URL is not renderable, so a malformed URL produces a
    source with no link rather than a broken or dangerous one.
    """
    p = prov or {}
    url = p.get("url") or p.get("canonical_url") or ""
    if not is_renderable_web_url(url):
        return {}
    out = {
        "source_class": "WEB_EVIDENCE",
        "url": url,
        "canonical_url": p.get("canonical_url", ""),
        "title": p.get("title", ""),
        "domain": p.get("domain", ""),
        "published_at": p.get("published_at", ""),
        "retrieved_at": p.get("retrieved_at", ""),
        "source_type": p.get("source_type", "web_page"),
        "evidence_location": p.get("evidence_location", ""),
        "fetch_provider": p.get("fetch_provider", ""),
        "search_provider": p.get("search_provider", ""),
    }
    return {k: v for k, v in out.items() if v not in ("", None)}


def local_payload(metadata: dict | None) -> dict:
    """
    Where a local corpus passage came from, and nothing more.

    R8 QA-6 measured the corpus this serves: 478,433 prose chunks, of which
    ZERO carry an accession in any identity field and which have no `metadata`
    field at all. `provenance()` therefore returned `None` for every one of
    them and `source_payload()` returned `{}`, so a prose citation reached the
    UI and the grader with no idea what document it was read from -- though the
    row itself knows the company, the form, the date, the section and the page.

    Roadmap SS2.2 draws the line this function must not cross: source identity,
    financial fact identity and verification strength are three separate
    things. So this carries identity ONLY. No accession, no CIK, no
    `xbrl_concept`, no value, no filing URL, and the class stays
    `LOCAL_EVIDENCE`, which `is_primary_class` refuses. It lets a citation say
    where it came from; it does not let it claim a filing's authority.
    """
    m = metadata or {}
    out = {
        "source_class": "LOCAL_EVIDENCE",
        "issuer": _clean(m.get("company") or m.get("issuer")),
        "ticker": _clean((m.get("ticker") or "").upper() or None),
        "form": _clean(m.get("filing_type") or m.get("form")),
        "filing_date": _clean(m.get("filing_date") or m.get("filed")),
        "document_title": _clean(m.get("document_title")),
        "section": _clean(m.get("section")),
        "page": m.get("page") if m.get("page") is not None else None,
    }
    out = {k: v for k, v in out.items() if v is not None}
    # A row that says nothing about its source must not produce an object
    # asserting that it does. `source_class` alone is not identity.
    if len(out) == 1:
        return {}
    return out


def source_payload(metadata: dict | None, *, ticker: str = "") -> dict:
    """
    The provenance payload for one passage, whichever kind of source it is.

    The single entry point the pipeline calls, so a new source class is added in
    one place rather than at every call site. SEC provenance is tried first: a
    passage carrying an accession is a filing fact regardless of what else is on
    its metadata, and that is the stronger claim.
    """
    m = metadata or {}
    sec = payload(provenance(m, ticker=ticker))
    if sec:
        return sec
    if m.get("web_evidence") or m.get("source_class") == "WEB_EVIDENCE":
        return web_payload(m)
    # R8 QA-6. A local corpus passage still knows which document it was read
    # from, and said nothing at all before this. Last, so an accession or a
    # web URL always wins: this is the weakest claim, not a default.
    return local_payload(m)


def click_url(metadata: dict | None, *, ticker: str = "", fallback: str = "") -> str:
    """
    The URL a source card opens, for any source class (§24).

    SEC sources resolve to the exact filing and never to a generic company
    listing; web sources resolve to the exact canonical page they were read
    from. A passage with neither gets the caller's fallback, which for a local
    corpus chunk is correctly empty.
    """
    m = metadata or {}
    exact = source_click_url(provenance(m, ticker=ticker))
    if exact:
        return exact
    web = web_payload(m) if (m.get("web_evidence")
                             or m.get("source_class") == "WEB_EVIDENCE") else {}
    if web:
        return web.get("url", "") or fallback
    return fallback


def citation_url(prov: dict | None, fallback: str = "") -> str:
    """
    The URL a citation should point at.

    The exact filing index page when the filing is known, the authoritative URL
    the SEC resolver returned otherwise, and only then whatever generic fallback
    the caller supplies. Never the generic one while an exact one exists.
    """
    exact = source_click_url(prov)
    return exact or fallback
