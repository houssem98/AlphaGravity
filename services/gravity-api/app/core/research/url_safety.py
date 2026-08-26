"""
Whether a URL may be fetched at all, and what its canonical identity is.

Two jobs that sound unrelated and are not: both are "reduce an untrusted string
to something we are willing to act on".

**The SSRF guard.** Before this module, nothing in `app/` validated a fetch
target. `web_pdf_fetcher.fetch_and_extract()` calls `httpx.get(url,
follow_redirects=True)` on whatever it is handed. That was survivable only
because no attacker-controlled URL reached it — every URL came from SEC or from
the local corpus. Web search *creates* that path: a search result is a URL
chosen by a third-party index in response to text that a user typed. So the
guard lands in the same change as the search provider, not after it.

The guard is a deny-by-default IP check, not a hostname blocklist. Blocklisting
`localhost` and `127.0.0.1` catches nothing: `127.1`, `0177.0.0.1`,
`2130706433`, `[::1]`, `localtest.me`, and any attacker-controlled DNS name with
an A record pointing at `169.254.169.254` all reach loopback or link-local while
matching no blocklist. Resolving the name and rejecting on the *resolved
address* is the only check that holds, because it tests the thing that actually
gets connected to.

Redirects are the other half. A URL that passes the guard can 302 to one that
would not, so `safe_get()` disables automatic redirects and re-validates each
hop by hand. A guard applied only to the URL the caller supplied is not a guard.

**Canonicalization.** Deduplication (spec section 17) needs "same article"
to be decidable. Tracking parameters, fragment identifiers, `www.`, default
ports and trailing slashes all vary between two links to one page, and a
citation list with the same Reuters story in it four times is the failure the
spec names.
"""

from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import structlog

logger = structlog.get_logger()

# The only two schemes worth fetching. `file:`, `data:`, `javascript:`, `ftp:`,
# `gopher:` and the rest are refused by omission rather than by blocklist, so a
# scheme nobody thought of is refused too.
ALLOWED_SCHEMES = frozenset({"http", "https"})

# Ports that are not HTTP. Fetching `http://internal:22/` will not speak SSH,
# but it does prove the port is open, and that turns a fetcher into a port
# scanner. The list is the small set of protocols where a plaintext HTTP
# preamble is known to be interpretable as a command by the listening service.
BLOCKED_PORTS = frozenset({
    22,     # ssh
    23,     # telnet
    25, 465, 587,   # smtp
    110, 143, 993, 995,  # pop3 / imap
    445,    # smb
    3306,   # mysql
    5432,   # postgres
    6379,   # redis
    9200,   # elasticsearch
    11211,  # memcached
    27017,  # mongodb
})

# Query parameters that identify a campaign, not a document. Stripped so two
# links to one article dedupe against each other.
_TRACKING_PARAMS = frozenset({
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "utm_id", "utm_name", "utm_cid", "utm_reader", "utm_swu",
    "gclid", "dclid", "fbclid", "msclkid", "twclid", "igshid", "mc_cid",
    "mc_eid", "yclid", "_hsenc", "_hsmi", "hsCtaTracking", "ref", "referrer",
    "source", "spm", "at_medium", "at_campaign", "cmpid", "ncid", "ito",
    "__twitter_impression", "guccounter", "guce_referrer",
    "guce_referrer_sig", "amp", "smid", "partner",
})


class UnsafeURLError(ValueError):
    """A URL that must not be fetched. The message names the specific reason."""


@dataclass(frozen=True)
class URLVerdict:
    """The outcome of one safety check, kept so telemetry can say why."""

    url: str
    allowed: bool
    reason: str = ""
    host: str = ""
    resolved_ips: tuple[str, ...] = ()

    def raise_if_blocked(self) -> None:
        if not self.allowed:
            raise UnsafeURLError(f"{self.url}: {self.reason}")


def _is_forbidden_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> str:
    """
    The reason this address is off-limits, or "" when it is routable public
    space.

    Written as an allow-nothing-special list rather than a deny list of ranges:
    every category the `ipaddress` module can name as non-global is refused, so
    a range that is carved out after this code was written (as 0.0.0.0/8 and
    100.64.0.0/10 were) is refused without an edit here.
    """
    # Most specific category first, so the stated reason is the most useful one.
    # `0.0.0.0` is both unspecified and (by Python's classification) private;
    # reporting "private" for it is true but tells an operator less.
    if ip.is_unspecified:
        return "unspecified address"
    if ip.is_loopback:
        return "loopback address"
    if ip.is_link_local:
        # 169.254.169.254 — the cloud instance metadata service. The single
        # highest-value SSRF target there is; on an unpatched IMDSv1 host it
        # hands out role credentials to anything that can issue a GET.
        return "link-local address (cloud metadata range)"
    if ip.is_private:
        return "private address"
    if ip.is_reserved:
        return "reserved address"
    if ip.is_multicast:
        return "multicast address"
    if ip.is_unspecified:
        return "unspecified address"
    # IPv4-mapped and 6to4 IPv6 forms carry a v4 address inside them; an
    # attacker writing `[::ffff:127.0.0.1]` is asking for loopback in a costume.
    v4 = getattr(ip, "ipv4_mapped", None) or getattr(ip, "sixtofour", None)
    if v4 is not None:
        return _is_forbidden_ip(v4) or ""
    if not ip.is_global:
        return "non-global address"
    return ""


def _as_ipv4_shorthand(host: str) -> ipaddress.IPv4Address | None:
    """
    The address a non-dotted-quad IPv4 host string denotes, if it denotes one.

    `inet_aton` (and therefore most resolvers, and therefore an actual socket)
    accepts far more than `a.b.c.d`: `2130706433`, `0x7f000001`, `017700000001`
    and `127.1` all reach 127.0.0.1. `ipaddress.ip_address` accepts none of them,
    so without this every one of those strings fell through to DNS resolution —
    and whether it was then caught depended on the platform's resolver rather
    than on this guard. Four of them were confirmed bypasses before this
    function existed.

    Implements inet_aton's actual grammar: 1-4 parts, each decimal / 0x-hex /
    0-octal, where the final part absorbs all remaining low-order bytes.
    """
    text = host.strip()
    if not text or any(c not in "0123456789abcdefABCDEFx." for c in text):
        return None
    parts = text.split(".")
    if not 1 <= len(parts) <= 4:
        return None

    values: list[int] = []
    for part in parts:
        if not part:
            return None
        try:
            if part.lower().startswith("0x"):
                value = int(part, 16)
            elif part.startswith("0") and len(part) > 1:
                value = int(part, 8)
            else:
                value = int(part, 10)
        except ValueError:
            return None
        if value < 0:
            return None
        values.append(value)

    # Every part but the last is one byte; the last fills the remainder.
    *leading, final = values
    if any(v > 0xFF for v in leading):
        return None
    remaining_bytes = 4 - len(leading)
    if final >= (1 << (8 * remaining_bytes)):
        return None

    packed = 0
    for v in leading:
        packed = (packed << 8) | v
    packed = (packed << (8 * remaining_bytes)) | final
    try:
        return ipaddress.IPv4Address(packed)
    except ipaddress.AddressValueError:
        return None


def _resolve(host: str) -> list[str]:
    """
    Every address this hostname currently resolves to.

    All of them are checked, not just the first: a DNS name with both a public
    and a private A record would otherwise pass on one lookup and connect to the
    private one on the next.
    """
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except (socket.gaierror, UnicodeError, OSError) as e:
        raise UnsafeURLError(f"{host}: DNS resolution failed ({e})") from e
    return sorted({info[4][0] for info in infos})


def check_url(url: str, *, resolver=None) -> URLVerdict:
    """
    Whether this URL may be fetched.

    `resolver` exists so the tests can prove the *address* logic without a
    network and without depending on what a public DNS name happens to resolve
    to today. Production passes nothing and gets `socket.getaddrinfo`.
    """
    raw = str(url or "").strip()
    if not raw:
        return URLVerdict(raw, False, "empty URL")
    # A control character in a URL is a request-splitting attempt, and `urlsplit`
    # will happily carry one through into a header.
    if any(ord(c) < 0x20 or ord(c) == 0x7F for c in raw):
        return URLVerdict(raw, False, "URL contains control characters")

    try:
        parts = urlsplit(raw)
    except ValueError as e:
        return URLVerdict(raw, False, f"unparseable URL ({e})")

    scheme = (parts.scheme or "").lower()
    if scheme not in ALLOWED_SCHEMES:
        return URLVerdict(raw, False, f"scheme {scheme or '(none)'!r} is not http/https")

    host = (parts.hostname or "").lower()
    if not host:
        return URLVerdict(raw, False, "URL has no host")

    # Credentials in a fetch target are either an attempt to authenticate to an
    # internal service or an attempt to confuse the host parser. Neither is
    # something a research fetch needs.
    if parts.username or parts.password:
        return URLVerdict(raw, False, "URL carries embedded credentials", host=host)

    try:
        port = parts.port
    except ValueError:
        return URLVerdict(raw, False, "URL has an invalid port", host=host)
    if port is not None and port in BLOCKED_PORTS:
        return URLVerdict(raw, False, f"port {port} is not an HTTP service", host=host)

    resolve = resolver or _resolve
    # A literal address skips DNS but takes exactly the same address check.
    # `_as_ipv4_shorthand` covers the forms `ip_address` rejects and a socket
    # accepts — without it those strings reached the resolver and their fate
    # depended on the platform rather than on this guard.
    try:
        literal = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        literal = _as_ipv4_shorthand(host)

    try:
        addresses: list[str] = (
            [str(literal)] if literal is not None else [str(a) for a in resolve(host)]
        )
    except UnsafeURLError as e:
        return URLVerdict(raw, False, str(e), host=host)

    if not addresses:
        return URLVerdict(raw, False, "host resolved to no addresses", host=host)

    for addr in addresses:
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            return URLVerdict(raw, False, f"unparseable resolved address {addr!r}",
                              host=host, resolved_ips=tuple(addresses))
        reason = _is_forbidden_ip(ip)
        if reason:
            # Logged at warning: on a public deployment this is either a
            # misconfigured source or someone probing the fetcher.
            logger.warning("ssrf_blocked", url=raw[:200], host=host,
                           resolved=addr, reason=reason)
            return URLVerdict(raw, False, f"resolves to a {reason} ({addr})",
                              host=host, resolved_ips=tuple(addresses))

    return URLVerdict(raw, True, "", host=host, resolved_ips=tuple(addresses))


def is_safe_url(url: str, *, resolver=None) -> bool:
    """`check_url(...).allowed`, for call sites that do not need the reason."""
    return check_url(url, resolver=resolver).allowed


# ── Canonicalization ──────────────────────────────────────────────────────

def canonicalize(url: str) -> str:
    """
    One URL reduced to the identity of the page it points at.

    Lowercases scheme and host, drops `www.`, drops the fragment, drops the
    default port, strips tracking parameters, sorts the survivors, and removes a
    trailing slash from a non-empty path. Two links to the same article
    canonicalize to the same string; two links to different articles do not.

    Returns the input unchanged when it cannot be parsed — a caller deduping on
    an unparseable URL should still see it as distinct from other unparseable
    ones, rather than having them all collapse to "".
    """
    raw = str(url or "").strip()
    if not raw:
        return ""
    try:
        parts = urlsplit(raw)
    except ValueError:
        return raw
    if not parts.scheme or not parts.hostname:
        return raw

    host = parts.hostname.lower()
    if host.startswith("www."):
        host = host[4:]

    netloc = host
    port = None
    try:
        port = parts.port
    except ValueError:
        port = None
    default = {"http": 80, "https": 443}.get(parts.scheme.lower())
    if port is not None and port != default:
        netloc = f"{host}:{port}"

    query = urlencode(
        sorted(
            (k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
            if k.lower() not in _TRACKING_PARAMS
        )
    )

    path = parts.path or "/"
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/")

    return urlunsplit((parts.scheme.lower(), netloc, path, query, ""))


def registrable_domain(url: str) -> str:
    """
    The domain a source card should display and the quality table should key on.

    Not a public-suffix implementation — this repo has no PSL dependency and
    adding one to render a label is not proportionate. Strips `www.` and returns
    the host, which is right for every domain in `fusion._DOMAIN_QUALITY` and
    wrong only in the direction of being too specific (`news.bbc.co.uk` rather
    than `bbc.co.uk`), which cannot promote an untrusted source.
    """
    try:
        host = (urlsplit(str(url or "")).hostname or "").lower()
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


# A title long and specific enough to identify an article on its own. Below this
# a title is a label ("Q3 Earnings", "Investor Relations") that many distinct
# pages share, and merging on it would drop real sources.
_TITLE_IS_IDENTIFYING_CHARS = 25
_TITLE_IS_IDENTIFYING_WORDS = 4


def dedup_key(url: str, title: str = "") -> str:
    """
    The key two results must share to be the same source.

    Canonical URL alone does not detect syndication, and syndication is the
    common case: the identical wire story appears on reuters.com, on Yahoo
    Finance and on a dozen aggregators under completely different URLs, and
    citing all of them is the redundant citation list spec §17 forbids.

    So a *substantive* title is the identity when there is one, and the
    canonical URL is the identity otherwise. The length and word-count floor is
    what stops the other failure: "Q3 Earnings" is not a unique article, and
    merging every page that shares a generic heading would silently drop real
    sources. Long, specific headlines are effectively unique; short ones are not
    trusted to be.
    """
    canon = canonicalize(url)
    norm_title = " ".join(str(title or "").lower().split())
    identifying = (
        len(norm_title) >= _TITLE_IS_IDENTIFYING_CHARS
        and len(norm_title.split()) >= _TITLE_IS_IDENTIFYING_WORDS
    )
    return f"title:{norm_title}" if identifying else canon
