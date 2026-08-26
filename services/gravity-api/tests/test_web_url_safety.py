"""
SSRF guard and URL canonicalization (spec sections 17 and 20; matrix items G, L).

The audit found no host validation anywhere in `app/`: `web_pdf_fetcher`
followed redirects to any URL it was handed. That was survivable only while
every URL came from SEC. Web search makes the fetch target attacker-influenced —
a search result is a URL chosen by a third-party index in response to text a
user typed — so these tests pin the guard that had to land in the same change.

The bypasses below are the real ones, not illustrative ones. Every decimal,
octal and IPv6-mapped form of loopback here reaches 127.0.0.1 through a socket
while matching no string blocklist, which is why the guard resolves the name and
judges the address instead.
"""
import pytest

from app.core.research.url_safety import (
    BLOCKED_PORTS,
    UnsafeURLError,
    canonicalize,
    check_url,
    dedup_key,
    is_safe_url,
    registrable_domain,
)


def _resolves_to(*addresses):
    """A stub resolver, so address logic is tested without a network."""
    return lambda host: list(addresses)


PUBLIC = _resolves_to("93.184.216.34")


class TestSchemeAndShape:
    @pytest.mark.parametrize("url", [
        "file:///etc/passwd",
        "file://C:/Windows/win.ini",
        "javascript:fetch('/admin')",
        "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
        "ftp://internal.example.com/secrets",
        "gopher://127.0.0.1:6379/_FLUSHALL",
        "dict://127.0.0.1:11211/stat",
        "ldap://internal/",
        "//evil.example.com/path",
        "",
        "   ",
    ])
    def test_non_http_schemes_are_refused(self, url):
        assert not is_safe_url(url, resolver=PUBLIC), url

    def test_the_reason_is_stated_not_just_the_refusal(self):
        v = check_url("file:///etc/passwd", resolver=PUBLIC)
        assert not v.allowed
        assert "http" in v.reason.lower()

    def test_control_characters_are_refused(self):
        # CRLF in a URL is a request-splitting attempt; `urlsplit` carries it
        # through into a header untouched.
        assert not is_safe_url("http://example.com/\r\nX-Injected: 1",
                               resolver=PUBLIC)
        assert not is_safe_url("http://example.com/\x00", resolver=PUBLIC)

    def test_embedded_credentials_are_refused(self):
        v = check_url("http://admin:hunter2@example.com/", resolver=PUBLIC)
        assert not v.allowed
        assert "credential" in v.reason

    def test_a_normal_public_url_is_allowed(self):
        v = check_url("https://www.reuters.com/business/some-article",
                      resolver=PUBLIC)
        assert v.allowed, v.reason
        assert v.host == "www.reuters.com"

    def test_raise_if_blocked_raises_for_a_blocked_url(self):
        with pytest.raises(UnsafeURLError):
            check_url("file:///etc/passwd", resolver=PUBLIC).raise_if_blocked()

    def test_raise_if_blocked_is_silent_for_an_allowed_url(self):
        check_url("https://example.com/", resolver=PUBLIC).raise_if_blocked()


class TestPrivateAndLoopbackAddresses:
    """The category the guard exists for."""

    @pytest.mark.parametrize("literal,why", [
        ("http://127.0.0.1/",              "loopback"),
        ("http://127.0.0.53/",             "loopback"),
        ("http://[::1]/",                  "loopback"),
        ("http://10.0.0.5/",               "private"),
        ("http://192.168.1.1/admin",       "private"),
        ("http://172.16.0.1/",             "private"),
        ("http://172.31.255.254/",         "private"),
        ("http://169.254.169.254/latest/meta-data/", "link-local"),
        ("http://[fd00::1]/",              "private"),
        ("http://[fe80::1]/",              "link-local"),
        ("http://0.0.0.0/",                "unspecified"),
        # Python classifies the broadcast address as private; the category
        # matters less than the refusal, but the reason must be one of ours.
        ("http://255.255.255.255/",        "private"),
        ("http://224.0.0.1/",              "multicast"),
    ])
    def test_literal_private_addresses_are_refused(self, literal, why):
        v = check_url(literal, resolver=PUBLIC)
        assert not v.allowed, f"{literal} was allowed"
        assert why.split()[0] in v.reason.lower(), v.reason

    def test_cloud_metadata_is_called_out_by_name(self):
        # The single highest-value SSRF target: on IMDSv1 it hands role
        # credentials to anything that can issue a GET.
        v = check_url("http://169.254.169.254/latest/meta-data/iam/", resolver=PUBLIC)
        assert not v.allowed
        assert "metadata" in v.reason.lower()

    @pytest.mark.parametrize("obfuscated", [
        "http://2130706433/",        # decimal 127.0.0.1
        "http://0x7f000001/",        # hex
        "http://017700000001/",      # octal
        "http://127.1/",             # short form
        "http://[::ffff:127.0.0.1]/",   # IPv4-mapped IPv6
        "http://[0:0:0:0:0:ffff:7f00:1]/",
    ])
    def test_obfuscated_loopback_forms_are_refused(self, obfuscated):
        """
        Each of these reaches 127.0.0.1 through a socket while matching no
        hostname blocklist. They are refused because the guard judges the
        resolved address, not the string.
        """
        assert not is_safe_url(obfuscated, resolver=PUBLIC), obfuscated

    def test_a_public_name_resolving_to_a_private_address_is_refused(self):
        """
        The DNS-rebinding shape: the name is public and innocuous, the A record
        points inside. A hostname blocklist passes this; an address check does
        not.
        """
        v = check_url("https://totally-normal-news.example/",
                      resolver=_resolves_to("10.0.0.7"))
        assert not v.allowed
        assert "private" in v.reason

    def test_every_resolved_address_is_checked_not_only_the_first(self):
        """
        A name with one public and one private record must be refused: which one
        a connection lands on is not ours to decide.
        """
        v = check_url("https://mixed.example/",
                      resolver=_resolves_to("93.184.216.34", "127.0.0.1"))
        assert not v.allowed

    def test_dns_failure_is_a_refusal_not_a_crash(self):
        def _boom(host):
            raise UnsafeURLError(f"{host}: DNS resolution failed")

        v = check_url("https://nxdomain.invalid/", resolver=_boom)
        assert not v.allowed
        assert "DNS" in v.reason

    def test_a_host_resolving_to_nothing_is_refused(self):
        assert not is_safe_url("https://empty.example/", resolver=_resolves_to())


class TestNonHttpPorts:
    @pytest.mark.parametrize("port", sorted(BLOCKED_PORTS))
    def test_service_ports_are_refused(self, port):
        # A fetcher that will connect to any port is a port scanner: the
        # response distinguishes open from closed even when nothing is spoken.
        assert not is_safe_url(f"http://example.com:{port}/", resolver=PUBLIC)

    @pytest.mark.parametrize("port", [80, 443, 8080, 8443, 3000])
    def test_http_ports_are_allowed(self, port):
        assert is_safe_url(f"http://example.com:{port}/", resolver=PUBLIC)


class TestCanonicalization:
    """Spec section 17: ten citations must not point at one underlying source."""

    def test_tracking_parameters_are_stripped(self):
        assert canonicalize(
            "https://www.reuters.com/a?utm_source=x&utm_campaign=y&id=7"
        ) == "https://reuters.com/a?id=7"

    def test_fragment_www_and_trailing_slash_are_normalized(self):
        a = canonicalize("https://www.example.com/article/#section-2")
        b = canonicalize("https://example.com/article")
        assert a == b == "https://example.com/article"

    def test_default_ports_are_dropped_and_others_kept(self):
        assert canonicalize("https://example.com:443/x") == "https://example.com/x"
        assert canonicalize("http://example.com:80/x") == "http://example.com/x"
        assert ":8080" in canonicalize("http://example.com:8080/x")

    def test_query_parameter_order_does_not_change_identity(self):
        assert canonicalize("https://e.com/a?b=2&a=1") == canonicalize(
            "https://e.com/a?a=1&b=2")

    def test_different_articles_stay_different(self):
        assert canonicalize("https://e.com/a") != canonicalize("https://e.com/b")

    def test_an_unparseable_url_is_returned_unchanged_not_collapsed_to_empty(self):
        # Two malformed URLs must not dedupe against each other.
        assert canonicalize("not a url") == "not a url"
        assert canonicalize("also not a url") != canonicalize("not a url")

    def test_registrable_domain_strips_www(self):
        assert registrable_domain("https://www.bloomberg.com/news/x") == "bloomberg.com"
        assert registrable_domain("https://ir.nvidia.com/x") == "ir.nvidia.com"
        assert registrable_domain("garbage") == ""


class TestDedupKey:
    def test_the_same_article_under_two_tracked_urls_shares_a_key(self):
        assert dedup_key("https://www.reuters.com/x?utm_source=a", "EOG Q4") == \
               dedup_key("https://reuters.com/x/", "EOG Q4")

    def test_syndicated_copies_share_a_key_through_the_title(self):
        """
        The identical wire story on two hosts. Without the title in the key these
        are two sources; with it they are one, which is what stops a citation
        list being four copies of one article.
        """
        headline = "EOG Resources reports fourth quarter 2025 results"
        a = dedup_key("https://finance.yahoo.com/news/eog-q4", headline)
        b = dedup_key("https://www.reuters.com/business/eog-q4", headline)
        assert a == b

    def test_a_generic_headline_does_not_merge_distinct_articles(self):
        """
        The other failure: "Q3 Earnings" is a label many pages share, and
        merging on it would silently drop real sources.
        """
        assert dedup_key("https://a.com/x", "Q3 Earnings") !=                dedup_key("https://b.com/y", "Q3 Earnings")

    def test_different_articles_on_one_host_do_not_share_a_key(self):
        assert dedup_key("https://e.com/a", "Story A") != dedup_key("https://e.com/b", "Story B")
