"""
One filing, two URLs, and the difference between them.

A source card offers two things and they are not the same page:

    View filing      -> the primary document itself, the 10-K you read
    Filing details   -> `<accession>-index.htm`, EDGAR's manifest for that filing

Before this module only the second existed. `filing_url()` builds the index page
from CIK + accession and every SEC citation pointed at it, so "View filing"
landed on a list of thirty documents — exhibits, XBRL fragments, an R-file — and
left the reader to guess which one held the number that was just quoted. Guessing
is exactly what the specification forbids, and it forbids the obvious shortcuts
too: not the first `.htm` in the archive listing (that is routinely an exhibit
or the correspondence cover), not `<ticker>-<date>.htm` (a naming convention
several filers do not follow and none guarantee), not the largest file.

The primary document has an authoritative name and SEC publishes it. The
submissions API carries, per accession, `primaryDocument` — the filename EDGAR
itself considers the filing — alongside `primaryDocType`, `form`, `filingDate`
and `reportDate`. That is the only source this module will accept. When it
cannot be read, `primary_document_url` stays empty and the caller shows only
"Filing details": a missing link is a true statement, an invented one is not.

Everything above the network boundary is a pure function over the parsed JSON,
so the regression matrix runs offline against recorded filing shapes and the
live path adds nothing but the fetch.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, asdict

import structlog

logger = structlog.get_logger()

SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
SUBMISSIONS_PAGE_URL = "https://data.sec.gov/submissions/{name}"
ARCHIVE_DIR = "https://www.sec.gov/Archives/edgar/data/{cik}/{nodash}"

# `0000821189-25-000011`. Redeclared rather than imported so this module's rule
# for what may enter a URL path does not move when another module's does.
ACCESSION_RE = re.compile(r"\A\d{10}-\d{2}-\d{6}\Z")

# `nvda-20260126.htm`, `a10-kq42026.htm`, `tm2429925d1_10k.htm`. A bare
# filename: no separator, no scheme, no parent hop, and an HTML extension,
# because "View filing" opens a document in a browser tab. Filers do use
# `.txt` for the complete submission, but that is the concatenated dump of
# every document in the filing, not the filing.
PRIMARY_DOC_RE = re.compile(r"\A[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(?:htm|html)\Z", re.I)

# `.../Archives/edgar/data/320193/000032019325000073/aapl-20250927.htm` and the
# `-index.htm` form of the same. `data/` may carry the zero-padded CIK or the
# bare one; EDGAR serves both.
_ARCHIVE_RE = re.compile(
    r"/Archives/edgar/data/(\d{1,10})/(\d{18})(?:/(?P<doc>[^/?#]+))?",
    re.I,
)
_INDEX_NAME_RE = re.compile(r"\A(\d{10}-\d{2}-\d{6})-index\.html?\Z", re.I)


def valid_accession(accn) -> bool:
    return bool(ACCESSION_RE.match(str(accn or "")))


def valid_primary_document(name) -> bool:
    """Whether this is a bare HTML filename safe to append to an archive URL."""
    n = str(name or "")
    return bool(PRIMARY_DOC_RE.match(n)) and ".." not in n


def normalize_cik(cik) -> int | None:
    """`'0000320193'`, `320193`, `'320193'` -> `320193`. `None` when it is not a CIK."""
    try:
        n = int(str(cik).strip().lstrip("0") or "0")
    except (TypeError, ValueError):
        return None
    return n if 0 < n <= 9_999_999_999 else None


def nodash(accession: str) -> str:
    return str(accession or "").replace("-", "")


def filing_index_url(cik, accession) -> str:
    """
    The EDGAR filing-detail page — what "Filing details" opens.

    Deterministic from a validated CIK and accession; no network, no guessing.
    Returns "" rather than a malformed URL when either input fails validation.
    """
    n = normalize_cik(cik)
    if n is None or not valid_accession(accession):
        return ""
    return f"{ARCHIVE_DIR.format(cik=n, nodash=nodash(accession))}/{accession}-index.htm"


def archive_document_url(cik, accession, document) -> str:
    """The URL of one named document inside one filing's archive directory."""
    n = normalize_cik(cik)
    if n is None or not valid_accession(accession) or not valid_primary_document(document):
        return ""
    return f"{ARCHIVE_DIR.format(cik=n, nodash=nodash(accession))}/{document}"


def parse_archive_url(url) -> dict | None:
    """
    The filing identity carried by an EDGAR Archives URL, or `None`.

    Handles the case the specification calls out — a legacy source that stored
    only the index URL — and also a stored document URL, from which the same
    CIK and accession can be recovered. The accession is rebuilt from the
    18-digit path segment and then validated in its hyphenated form, so a
    truncated or padded segment is rejected instead of being reshaped into
    something that merely looks like an accession.
    """
    m = _ARCHIVE_RE.search(str(url or ""))
    if not m:
        return None
    cik = normalize_cik(m.group(1))
    raw = m.group(2)
    accession = f"{raw[:10]}-{raw[10:12]}-{raw[12:]}"
    if cik is None or not valid_accession(accession):
        return None
    doc = m.group("doc") or ""
    idx = _INDEX_NAME_RE.match(doc)
    return {
        "cik": cik,
        "accession": accession,
        # An `-index.htm` name is the manifest, never a document of the filing.
        "document": "" if (idx or not doc) else doc,
        "is_index": bool(idx),
    }


def belongs_to_filing(url, cik, accession) -> bool:
    """
    Whether this URL is a document of exactly this filing.

    The assertion the regression matrix makes about every resolved primary URL:
    a document from a different accession, a different registrant, or a
    different host is not this filing's primary document however plausible its
    filename looks.
    """
    from urllib.parse import urlparse

    try:
        p = urlparse(str(url or ""))
    except ValueError:
        return False
    # The scheme is checked as well as the host: `http://www.sec.gov/...` is a
    # real SEC path served over a downgradeable connection, and a citation link
    # that can be rewritten in flight is not evidence of anything.
    if p.scheme != "https" or p.hostname not in ("www.sec.gov", "sec.gov"):
        return False
    parsed = parse_archive_url(url)
    if not parsed:
        return False
    return (
        parsed["cik"] == normalize_cik(cik)
        and parsed["accession"] == str(accession or "")
    )


@dataclass(frozen=True)
class FilingIdentity:
    """
    Canonical provenance for one filing — the object the specification names.

    `primary_document_url` is empty when the primary document could not be read
    from authoritative metadata. That is a supported state, not a failure:
    `filing_index_url` is still exact, and the UI shows "Filing details" alone.
    """

    cik: int
    accession: str
    accession_nodash: str
    form_type: str = ""
    filing_date: str = ""
    period_of_report: str = ""
    primary_document: str = ""
    primary_document_url: str = ""
    filing_index_url: str = ""
    # Why the primary is absent, for logs and for the UI's disabled tooltip.
    # Empty when it was resolved.
    unresolved_reason: str = ""

    @property
    def has_primary(self) -> bool:
        return bool(self.primary_document_url)

    def as_dict(self) -> dict:
        return asdict(self)


def identity(
    cik,
    accession,
    *,
    form_type: str = "",
    filing_date: str = "",
    period_of_report: str = "",
    primary_document: str = "",
    unresolved_reason: str = "",
) -> FilingIdentity | None:
    """
    Build the canonical object from already-authoritative parts.

    `None` when the filing cannot even be named — an invalid CIK or accession
    has no index page either, and returning a half-built identity would let a
    malformed accession reach a URL. A `primary_document` that fails the
    filename rule is dropped with a reason rather than interpolated.
    """
    n = normalize_cik(cik)
    if n is None or not valid_accession(accession):
        return None

    doc, doc_url, reason = "", "", unresolved_reason
    if primary_document:
        if valid_primary_document(primary_document):
            doc = primary_document
            doc_url = archive_document_url(n, accession, primary_document)
        else:
            reason = reason or "primary document name is not a bare HTML filename"
            logger.info(
                "sec_primary_document_rejected",
                cik=n, accession=accession, name=str(primary_document)[:80],
            )
    elif not reason:
        reason = "filing metadata carries no primaryDocument"

    return FilingIdentity(
        cik=n,
        accession=str(accession),
        accession_nodash=nodash(accession),
        form_type=str(form_type or ""),
        filing_date=str(filing_date or ""),
        period_of_report=str(period_of_report or ""),
        primary_document=doc,
        primary_document_url=doc_url,
        filing_index_url=filing_index_url(n, accession),
        unresolved_reason="" if doc_url else (reason or "primary document unresolved"),
    )


def _rows(block: dict) -> list[dict]:
    """One submissions block's parallel arrays zipped into rows.

    SEC serves these as column arrays of equal length. `zip` truncating to the
    shortest is the behaviour we want: a short column means a malformed page,
    and pairing an accession with another filing's document would be worse than
    dropping the tail.
    """
    b = block or {}
    return [
        {
            "form": f,
            "accession": a,
            "primary_document": d,
            "filing_date": fd,
            "period_of_report": rd,
        }
        for f, a, d, fd, rd in zip(
            b.get("form") or [],
            b.get("accessionNumber") or [],
            b.get("primaryDocument") or [],
            b.get("filingDate") or [],
            b.get("reportDate") or [],
        )
    ]


def find_in_submissions(submissions: dict, accession: str) -> dict | None:
    """
    The row for one accession inside a parsed submissions document.

    Pure, so the whole matching rule is tested without a network. Reads
    `filings.recent` when given the top-level document and the bare block when
    given one of the older paged files, which have the same column shape.
    """
    if not valid_accession(accession):
        return None
    doc = submissions or {}
    block = ((doc.get("filings") or {}).get("recent")) or doc
    for row in _rows(block):
        if row["accession"] == accession:
            return row
    return None


def older_pages(submissions: dict) -> list[str]:
    """The archive page filenames a registrant's older filings live in."""
    files = ((submissions or {}).get("filings") or {}).get("files") or []
    return [
        str(f["name"])
        for f in files
        if isinstance(f, dict) and isinstance(f.get("name"), str) and "/" not in f["name"]
    ]


def identity_from_submissions(cik, accession, submissions: dict) -> FilingIdentity | None:
    """
    Canonical identity for one accession, from that registrant's submissions doc.

    `None` when the accession is not in this document at all — the caller then
    tries the older pages. An accession that IS present but carries no
    `primaryDocument` returns an identity with the index URL and no primary,
    which is the honest answer rather than a reason to keep searching.
    """
    row = find_in_submissions(submissions, accession)
    if row is None:
        return None
    return identity(
        cik,
        accession,
        form_type=row["form"],
        filing_date=row["filing_date"],
        period_of_report=row["period_of_report"],
        primary_document=row["primary_document"],
    )


class SecFilingResolver:
    """
    CIK + accession -> canonical filing identity, over SEC's submissions API.

    One registrant's submissions document answers every filing that registrant
    has made in roughly the last thousand filings, so it is cached per CIK: a
    page of citations from one company costs one fetch. Older filings fall
    through to the archive pages, which are cached under their own names.

    The resolver never fabricates. Every failure path — a bad CIK, an accession
    the registrant never filed, a filing with no primary document, a network
    error — returns an identity whose `filing_index_url` is exact and whose
    `primary_document_url` is empty, or `None` when the filing cannot be named.
    """

    def __init__(self, http_client=None, *, ttl_s: float = 3600.0):
        from app.config import settings

        self._ua = settings.sec_user_agent
        self._http = http_client
        self._ttl = ttl_s
        self._cache: dict[str, tuple[float, dict]] = {}

    async def _client(self):
        if self._http is None:
            import httpx

            self._http = httpx.AsyncClient(
                headers={"User-Agent": self._ua}, timeout=10.0
            )
        return self._http

    async def _get_json(self, url: str) -> dict | None:
        import time

        hit = self._cache.get(url)
        if hit and (time.time() - hit[0]) < self._ttl:
            return hit[1]
        try:
            c = await self._client()
            r = await c.get(url)
            if r.status_code != 200:
                return None
            data = r.json()
        except Exception as e:  # noqa: BLE001 — a fetch failure is "no primary", not a crash
            logger.warning("sec_submissions_fetch_failed", url=url, error=str(e)[:160])
            return None
        if isinstance(data, dict):
            self._cache[url] = (time.time(), data)
            return data
        return None

    async def resolve(self, cik, accession, **known) -> FilingIdentity | None:
        """
        The canonical identity for one filing.

        `known` carries anything the caller already had — `form_type`,
        `filing_date`, `period_of_report` — which is used only to fill fields
        the fetch could not supply. It is never allowed to supply
        `primary_document`: that comes from SEC or not at all, which is the
        whole point of the module.
        """
        n = normalize_cik(cik)
        if n is None or not valid_accession(accession):
            return None
        known.pop("primary_document", None)

        top = await self._get_json(SUBMISSIONS_URL.format(cik=n))
        if top is None:
            return identity(
                n, accession, unresolved_reason="submissions metadata unavailable", **known
            )

        found = identity_from_submissions(n, accession, top)
        if found is not None:
            return found

        for name in older_pages(top):
            page = await self._get_json(SUBMISSIONS_PAGE_URL.format(name=name))
            if page is None:
                continue
            found = identity_from_submissions(n, accession, page)
            if found is not None:
                return found

        logger.info("sec_accession_not_in_submissions", cik=n, accession=accession)
        return identity(
            n,
            accession,
            unresolved_reason="accession is not among this registrant's filings",
            **known,
        )

    async def resolve_url(self, url) -> FilingIdentity | None:
        """
        The canonical identity behind an EDGAR Archives URL.

        The Phase-2 case where a legacy source stored only an index URL: the
        identity is extracted from the path, validated, and then resolved from
        authoritative metadata exactly as any other filing is.
        """
        parsed = parse_archive_url(url)
        if not parsed:
            return None
        return await self.resolve(parsed["cik"], parsed["accession"])


# The metadata keys an enriched passage carries. Named once so the pipeline,
# the provenance builder and the tests agree on the contract.
IDENTITY_KEYS = (
    "primary_document",
    "primary_document_url",
    "filing_index_url",
    "period_of_report",
    "primary_unresolved_reason",
)


def identity_metadata(ident: FilingIdentity | None) -> dict:
    """The metadata fields one resolved identity contributes to a passage."""
    if ident is None:
        return {}
    return {
        "primary_document": ident.primary_document,
        "primary_document_url": ident.primary_document_url,
        "filing_index_url": ident.filing_index_url,
        "period_of_report": ident.period_of_report,
        "primary_unresolved_reason": ident.unresolved_reason,
    }


async def attach_filing_identity(results, *, resolver: SecFilingResolver | None = None):
    """
    Fill in each SEC passage's canonical filing identity, in place.

    Resolution is per distinct (CIK, accession), and a registrant's submissions
    document answers every accession it filed, so a page of citations from one
    company costs one fetch. A passage that already carries a primary document
    is left alone — `edgar_text` read the filing itself and already knows.

    Failures are absorbed: the caller's results are returned either way, with
    the identity fields missing rather than wrong. An enrichment step must not
    be able to fail a search that already succeeded.
    """
    import asyncio

    pending: dict[tuple[int, str], list] = {}
    for r in results or []:
        m = getattr(r, "metadata", None)
        if not isinstance(m, dict) or m.get("primary_document_url"):
            continue
        cik, accn = normalize_cik(m.get("cik")), str(m.get("accn") or "")
        if cik is None or not valid_accession(accn):
            continue
        pending.setdefault((cik, accn), []).append(m)

    if not pending:
        return results

    res = resolver or get_resolver()
    try:
        idents = await asyncio.gather(
            *[res.resolve(cik, accn) for cik, accn in pending],
            return_exceptions=True,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("sec_identity_enrichment_failed", error=str(e)[:160])
        return results

    for (key, metas), ident in zip(pending.items(), idents):
        if not isinstance(ident, FilingIdentity):
            logger.info("sec_identity_unresolved", cik=key[0], accession=key[1])
            continue
        fields = identity_metadata(ident)
        for m in metas:
            # `setdefault` per field: a channel that already knew the period of
            # report keeps its own value rather than having it restated.
            for k, v in fields.items():
                if v and not m.get(k):
                    m[k] = v
    return results


_resolver: SecFilingResolver | None = None


def get_resolver() -> SecFilingResolver:
    global _resolver
    if _resolver is None:
        _resolver = SecFilingResolver()
    return _resolver
