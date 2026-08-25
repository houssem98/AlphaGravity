"""
What we actually asked sec.gov for, counted at the socket and split by kind.

The verified-evidence gate's whole claim is "a verified local hit does not ask
the filer". That claim was previously checked by matching substrings against a
list of URLs inside one test — which proves it for that test and for nothing
else, and gives an operator running the real service no way to see it at all.

The distinction that matters is not "did we talk to sec.gov" but *what for*:

  ``identity``  the ticker -> CIK map (`company_tickers.json`). Not a fact about
                a period; it is the phone book. Cached for a day on a long-lived
                channel, so steady-state traffic is zero, and a verified local
                hit is still allowed to consult it.
  ``fact``      `data.sec.gov` companyconcept / companyfacts. This is asking the
                filer for a number, and it is what must be zero on a verified
                local hit.
  ``filing``    the filing archive's `index.json` — resolving which document in
                the accession is the XBRL instance.
  ``archive``   any other `/Archives/` document, i.e. the instance itself.

`fact`, `filing` and `archive` are the three the hardening document requires to
be zero on a verified local hit. `identity` is reported separately rather than
folded in, because rounding it to zero would be a lie and folding it into the
fact count would fail a true invariant.

The counter is a `ContextVar` so one pipeline run counts its own requests even
when several run concurrently in the same process; `asyncio` child tasks inherit
a copy of the context and therefore see the same mutable counter object.
"""

from __future__ import annotations

from contextvars import ContextVar

IDENTITY = "identity"
FACT = "fact"
FILING = "filing"
ARCHIVE = "archive"
OTHER = "other"

# The three kinds that constitute "asking the filer", as opposed to looking up
# who the filer is.
AUTHORITATIVE = (FACT, FILING, ARCHIVE)


def classify(url: str) -> str:
    """Which kind of SEC request this URL is."""
    u = str(url or "")
    if "company_tickers" in u:
        return IDENTITY
    if "data.sec.gov" in u:
        return FACT
    if "/Archives/" in u:
        return FILING if u.endswith("index.json") else ARCHIVE
    return OTHER


class SecRequestLog:
    """Counts per kind, plus the URLs, for one unit of work."""

    __slots__ = ("counts", "urls")

    def __init__(self):
        self.counts: dict[str, int] = {}
        self.urls: list[str] = []

    def record(self, url: str) -> str:
        kind = classify(url)
        self.counts[kind] = self.counts.get(kind, 0) + 1
        self.urls.append(url)
        return kind

    def __getitem__(self, kind: str) -> int:
        return self.counts.get(kind, 0)

    @property
    def authoritative(self) -> int:
        """Requests that asked the filer for evidence, not for identity."""
        return sum(self.counts.get(k, 0) for k in AUTHORITATIVE)

    def telemetry(self) -> dict:
        return {
            "sec_identity_requests": self[IDENTITY],
            "sec_fact_requests": self[FACT],
            "sec_filing_requests": self[FILING],
            "sec_archive_requests": self[ARCHIVE],
        }

    def __repr__(self) -> str:
        return f"<SecRequestLog {self.counts}>"


_LOG: ContextVar[SecRequestLog | None] = ContextVar("sec_request_log", default=None)


def start() -> SecRequestLog:
    """Begin counting for this context. Returns the log to read afterwards."""
    log = SecRequestLog()
    _LOG.set(log)
    return log


def current() -> SecRequestLog | None:
    return _LOG.get()


def record(url: str) -> None:
    """Note one request. A no-op when nothing asked to be counted."""
    log = _LOG.get()
    if log is not None:
        log.record(url)


class CountingClient:
    """
    An httpx-shaped client that records every URL before delegating.

    Wrapping the client rather than instrumenting each call site is what makes
    the count trustworthy: `sec_dimensions` is handed the raw client and issues
    its own `get`s, so a counter that lived in `EdgarSearch._get_json` would
    silently miss every Archives request — the exact ones the invariant is about.
    """

    __slots__ = ("_inner",)

    def __init__(self, inner):
        self._inner = inner

    async def get(self, url, *a, **kw):
        record(url)
        return await self._inner.get(url, *a, **kw)

    def __getattr__(self, name):
        return getattr(self._inner, name)
