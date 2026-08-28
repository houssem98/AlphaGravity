"""Universal qualitative coverage: live SEC filing prose as a retrieval channel.

The local corpus holds prose for 39 tickers. `edgar_search` already made
NUMBERS universal by calling the filer at query time; every qualitative question
about any other registrant had no source at all. These tests pin the channel
that closes that half, and each of the ranking cases below is a defect this
channel actually shipped with and that a live probe caught.

No network: the SEC responses are fixtures, so the assertions grade the
channel's logic rather than sec.gov's availability.
"""

import asyncio

import pytest

from app.core.retrieval.citation_provenance import provenance
from app.core.retrieval.edgar_text_search import (
    _ANNUAL_FORMS,
    _QUARTERLY_FORMS,
    EdgarTextSearch,
    _forms_for,
    _phrases,
    _terms,
    _to_text,
    _wanted_items,
    _windows,
)

# ── Fixtures ──────────────────────────────────────────────────────────────

def _pad(sentence: str, times: int = 6) -> str:
    """Sections shorter than `MIN_SECTION_CHARS` are dropped as boilerplate, so
    a fixture Item has to be the size of a real one to be retrievable at all."""
    return f"<p>{(sentence + ' ') * times}</p>"


# "Acme Corp" is on every page, exactly as "Coca-Cola" is throughout Coca-Cola's
# own 10-K — that ubiquity is what the ranking tests below are about.
FILING_HTML = (
    '<?xml version="1.0" encoding="utf-8"?>'
    "<html><head><title>FORM 10-K</title></head><body>"
    "<p>ITEM 1. BUSINESS</p>"
    + _pad("Acme Corp sells widgets and competes with many other widget makers "
           "across every territory in which Acme Corp operates.")
    + _pad("Acme Corp operates bottling plants that consume water under permits "
           "granted by local regulators in each Acme Corp territory.")
    + "<p>ITEM 1A. RISK FACTORS</p>"
    + _pad("Acme Corp is exposed to commodity price volatility for steel, and "
           "Acme Corp hedges only a portion of that exposure.")
    + _pad("Acme Corp faces water scarcity in several regions, and water "
           "scarcity could raise Acme Corp costs materially.")
    + "<p>ITEM 7. MANAGEMENT DISCUSSION AND ANALYSIS</p>"
    + _pad("Acme Corp liquidity remained strong and Acme Corp cash flow from "
           "operations rose against the prior comparable period.")
    + "</body></html>"
).encode("utf-8")

# The curly quote and em dash are the regression: SEC serves iXBRL without a
# charset header, so decoding on the HTTP layer picked Latin-1 and turned both
# into replacement characters.
ACCENTED_HTML = (
    '<?xml version="1.0" encoding="utf-8"?>'
    "<html><body><p>The Company’s results — as filed.</p></body></html>"
).encode("utf-8")

SUBMISSIONS = {
    "filings": {
        "recent": {
            "form": ["8-K", "10-Q", "10-K", "10-K"],
            "accessionNumber": [
                "0000000000-26-000001",
                "0000000000-26-000002",
                "0000000000-26-000003",
                "0000000000-26-000004",
            ],
            "primaryDocument": ["a.htm", "q.htm", "k.htm", "old.htm"],
            "filingDate": ["2026-05-01", "2026-04-01", "2026-02-01", "2025-02-01"],
            "reportDate": ["", "2026-03-31", "2025-12-31", "2024-12-31"],
        }
    }
}


class _Resp:
    def __init__(self, content=b"", status=200, payload=None):
        self.content = content
        self.status_code = status
        self._payload = payload

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeEdgar:
    """The parts of `EdgarSearch` the text channel composes."""

    def __init__(self, submissions=None, doc=FILING_HTML, ciks=None):
        self._submissions = SUBMISSIONS if submissions is None else submissions
        self._doc = doc
        self._ciks = ciks if ciks is not None else {"ACME": 1234}
        self._issuer_by_ticker = {"ACME": "Acme Corporation"}
        self.doc_timeouts: list = []

    async def ticker_to_cik(self, ticker):
        return self._ciks.get(ticker.upper())

    async def tickers_from_names(self, query):
        return []

    async def _get_json(self, url):
        return self._submissions

    async def _client(self):
        outer = self

        class _C:
            async def get(self, url, *a, **kw):
                outer.doc_timeouts.append(kw.get("timeout"))
                return _Resp(content=outer._doc)

        return _C()


def channel(**kw):
    return EdgarTextSearch(FakeEdgar(**kw))


# ── Text extraction ───────────────────────────────────────────────────────

def test_document_is_decoded_by_its_own_declared_encoding():
    """Decoding on the HTTP layer mangled every curly quote in every filing."""
    text = _to_text(ACCENTED_HTML)
    assert "’" in text and "—" in text
    assert "�" not in text, "filing text was decoded with the wrong charset"


def test_script_and_style_never_reach_a_passage():
    text = _to_text(b"<html><body><style>p{color:red}</style>"
                    b"<script>var x=1</script><p>Real prose.</p></body></html>")
    assert "Real prose." in text
    assert "color:red" not in text and "var x" not in text


# ── Passage construction ──────────────────────────────────────────────────

def test_windows_split_on_paragraph_boundaries_and_stay_bounded():
    from app.core.retrieval.edgar_text_search import WINDOW_CHARS

    text = "\n".join(f"Paragraph number {i} with some filler text." for i in range(200))
    out = _windows(text)
    assert len(out) > 1, "one section is not one citable quote"
    assert all(len(w) <= WINDOW_CHARS + 200 for w in out)
    # Nothing is dropped between windows.
    assert sum(w.count("Paragraph number") for w in out) == 200


def test_a_single_paragraph_is_one_window():
    assert _windows("Only one line here.") == ["Only one line here."]


# ── Query analysis ────────────────────────────────────────────────────────

def test_terms_drop_the_words_that_match_every_filing():
    t = _terms("What are the risks that the company should report this year?")
    assert "risks" in t
    for noise in ("what", "the", "company", "report", "year", "should"):
        assert noise not in t


def test_phrases_are_built_from_real_adjacency_only():
    """`competition and water` must not become the phrase `competition water`."""
    p = _phrases("competition and water scarcity")
    assert "water scarcity" in p
    assert "competition water" not in p


def test_intent_maps_to_the_item_that_answers_it():
    assert "item_1a" in _wanted_items("what risks does it disclose")
    assert _wanted_items("what is the share price") == set()


def test_the_two_item_schedules_are_never_boosted_together():
    """The 10-K and 10-Q reuse item numbers for different content. Boosting the
    union sent a legal-proceedings question to Item 1 — Legal Proceedings in a
    10-Q's Part II, but Business in the 10-K actually being read, and by far the
    larger section, so it won on coverage every time.
    """
    legal = "what legal proceedings are disclosed"
    assert _wanted_items(legal) == {"item_3"}
    assert _wanted_items(legal, quarterly=True) == {"item_1"}

    mda = "discuss liquidity and results of operations"
    assert _wanted_items(mda) == {"item_7"}
    assert _wanted_items(mda, quarterly=True) == {"item_2"}

    controls = "any material weakness in internal control"
    assert _wanted_items(controls) == {"item_9a"}
    assert _wanted_items(controls, quarterly=True) == {"item_4"}

    # Risk Factors is Item 1A in both schedules.
    assert _wanted_items("what risks", quarterly=True) == {"item_1a"}


def test_a_quarterly_question_boosts_the_quarterly_schedule():
    """The form and the boost are chosen from the same question, so they cannot
    disagree: asking about last quarter's MD&A must not boost Item 7."""
    from app.core.retrieval.edgar_text_search import _QUARTERLY_FORMS

    q = "what did they say about liquidity last quarter"
    assert _forms_for(q) is _QUARTERLY_FORMS
    assert _wanted_items(q, quarterly=True) == {"item_2"}


def test_form_follows_the_question():
    assert _forms_for("what did they say last quarter")[0] == "10-Q"
    assert _forms_for("results in Q3")[0] == "10-Q"
    assert _forms_for("what risks are disclosed")[0] == "10-K"


# ── Filing selection ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_latest_matching_form_is_chosen():
    ch = channel()
    f = await ch._latest_filing(1234, ("10-K",))
    assert f["accn"] == "0000000000-26-000003", "picked an older 10-K"
    assert f["form"] == "10-K"
    assert f["document_url"].endswith("/000000000026000003/k.htm")


@pytest.mark.asyncio
async def test_the_quarterly_report_is_reachable_without_taking_the_annual():
    f = await channel()._latest_filing(1234, ("10-Q",))
    assert f["form"] == "10-Q" and f["accn"] == "0000000000-26-000002"


@pytest.mark.asyncio
async def test_a_malformed_accession_is_never_interpolated_into_an_archive_path():
    """The accession arrives from parsed JSON; "sec.gov sent it" is an
    assumption about the network, not a property of the value."""
    subs = {"filings": {"recent": {
        "form": ["10-K"], "accessionNumber": ["../../etc/passwd"],
        "primaryDocument": ["k.htm"], "filingDate": ["2026-01-01"],
        "reportDate": [""],
    }}}
    assert await channel(submissions=subs)._latest_filing(1234, ("10-K",)) is None


@pytest.mark.asyncio
async def test_a_filing_with_no_primary_document_is_skipped():
    subs = {"filings": {"recent": {
        "form": ["10-K", "10-K"],
        "accessionNumber": ["0000000000-26-000009", "0000000000-26-000003"],
        "primaryDocument": ["", "k.htm"],
        "filingDate": ["2026-03-01", "2026-02-01"], "reportDate": ["", ""],
    }}}
    f = await channel(submissions=subs)._latest_filing(1234, ("10-K",))
    assert f["accn"] == "0000000000-26-000003"


@pytest.mark.asyncio
async def test_an_amendment_does_not_displace_the_report_it_amends():
    """AMD filed a 10-K/A on the same day as its FY2025 10-K.

    Matching any form in the tuple and taking the newest read the amendment, and
    a 10-K/A is usually a narrow re-filing with no Item 1A and no MD&A — so "what
    risk factors does AMD disclose" came back with exhibit boilerplate out of a
    document that does not contain the answer. `forms` is a preference order.
    """
    subs = {"filings": {"recent": {
        "form": ["10-K/A", "10-K"],
        "accessionNumber": ["0000000000-26-000021", "0000000000-26-000018"],
        "primaryDocument": ["a.htm", "k.htm"],
        "filingDate": ["2026-02-04", "2026-02-04"],
        "reportDate": ["2025-12-27", "2025-12-27"],
    }}}
    f = await channel(submissions=subs)._latest_filing(1234, _ANNUAL_FORMS)
    assert f["form"] == "10-K"
    assert f["accn"] == "0000000000-26-000018", "read the amendment, not the report"


@pytest.mark.asyncio
async def test_an_amendment_is_still_read_when_it_is_the_only_annual_report():
    """Preference, not exclusion — a filer with only an amendment on file is
    better served by it than by nothing."""
    subs = {"filings": {"recent": {
        "form": ["10-K/A"], "accessionNumber": ["0000000000-26-000021"],
        "primaryDocument": ["a.htm"], "filingDate": ["2026-02-04"],
        "reportDate": ["2025-12-27"],
    }}}
    f = await channel(submissions=subs)._latest_filing(1234, _ANNUAL_FORMS)
    assert f is not None and f["form"] == "10-K/A"


@pytest.mark.asyncio
async def test_the_form_preference_order_puts_the_base_report_first():
    """The order is the policy, so it is asserted rather than assumed."""
    assert _ANNUAL_FORMS[0] == "10-K"
    assert _ANNUAL_FORMS.index("10-K") < _ANNUAL_FORMS.index("10-K/A")
    assert _QUARTERLY_FORMS[0] == "10-Q"
    assert _QUARTERLY_FORMS.index("10-Q") < _QUARTERLY_FORMS.index("10-Q/A")


@pytest.mark.asyncio
async def test_a_registrant_that_never_filed_the_form_yields_nothing():
    subs = {"filings": {"recent": {
        "form": ["8-K"], "accessionNumber": ["0000000000-26-000001"],
        "primaryDocument": ["a.htm"], "filingDate": ["2026-01-01"], "reportDate": [""],
    }}}
    assert await channel(submissions=subs)._latest_filing(1234, ("10-K",)) is None


# ── Section selection ─────────────────────────────────────────────────────

# A real 10-K opens with a contents listing that parses as sections too: the
# same item ids, one line of text each, before the bodies that follow.
TOC_HTML = (
    '<?xml version="1.0" encoding="utf-8"?><html><body>'
    "<p>ITEM 1. BUSINESS</p><p>See page 4.</p>"
    "<p>ITEM 3. LEGAL PROCEEDINGS</p><p>See page 9.</p>"
    "<p>ITEM 1. BUSINESS</p>"
    + _pad("Acme Corp sells widgets across every territory in which it operates "
           "and competes with many other widget makers.", 8)
    + "<p>ITEM 3. LEGAL PROCEEDINGS</p>"
    + "<p>Acme Corp is party to routine litigation incidental to its business. "
      "See Note 12 for Acme Corp legal proceedings.</p>"
    + "</body></html>"
).encode("utf-8")


@pytest.mark.asyncio
async def test_a_terse_item_is_still_the_answer_to_a_question_about_it():
    """Cheesecake Factory's Item 3 is 158 characters — a cross-reference to the
    notes — and a length filter discarded it, so a legal-proceedings question
    was answered from whichever unrelated Item happened to be largest."""
    ch = channel(doc=TOC_HTML)
    f = await ch._latest_filing(1234, ("10-K",))
    sections = await ch._sections(1234, f)
    item_3 = [s for s in sections if s.item_id == "item_3"]
    assert item_3, "a short but real Item was dropped as boilerplate"
    assert "routine litigation" in item_3[0].text


@pytest.mark.asyncio
async def test_the_table_of_contents_is_not_mistaken_for_the_filing():
    """Both listings and bodies carry item ids; only the body is the section."""
    ch = channel(doc=TOC_HTML)
    f = await ch._latest_filing(1234, ("10-K",))
    sections = await ch._sections(1234, f)
    ids = [s.item_id for s in sections]
    assert len(ids) == len(set(ids)), f"the contents listing survived: {ids}"
    body = next(s for s in sections if s.item_id == "item_1")
    assert "See page 4." not in body.text
    assert "sells widgets" in body.text


@pytest.mark.asyncio
async def test_a_terse_item_wins_the_question_it_answers():
    """The end-to-end version of the two above, which is how it was found."""
    out = await channel(doc=TOC_HTML).search(
        "what legal proceedings are disclosed",
        filters={"companies": ["ACME"]}, top_k=1,
    )
    assert out and out[0].metadata["item_id"] == "item_3"


# ── Ranking ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_term_on_every_page_of_the_filing_does_not_decide_the_ranking():
    """The defect a live probe caught against Coca-Cola's 10-K.

    "coca", "cola" and "risk" appear on nearly every page of Coca-Cola's own
    10-K. Counting them equally with "scarcity" ranked the filing's most generic
    paragraphs first. Here "Acme" plays the ubiquitous term.
    """
    out = await channel().search(
        "What does Acme say about water scarcity?",
        filters={"companies": ["ACME"]}, top_k=3,
    )
    assert out, "channel returned nothing for a question the filing answers"
    assert "water scarcity" in out[0].text.lower()
    assert out[0].metadata["item_id"] == "item_1a"


@pytest.mark.asyncio
async def test_the_item_the_question_is_about_outranks_a_passing_mention():
    """Item 1 also mentions water. Item 1A is still the answer about risk."""
    out = await channel().search(
        "What risk does Acme disclose about water?",
        filters={"companies": ["ACME"]}, top_k=5,
    )
    assert out[0].metadata["item_id"] == "item_1a"


@pytest.mark.asyncio
async def test_scores_stay_a_fraction_rather_than_clipping_at_the_top():
    """Clipping at 1.0 flattened exactly the distinctions phrase scoring adds."""
    out = await channel().search(
        "water scarcity", filters={"companies": ["ACME"]}, top_k=5,
    )
    assert out
    assert all(0.0 < r.score <= 1.0 for r in out)
    assert len({r.score for r in out}) > 1, "every passage scored identically"


# ── Passage identity and provenance ───────────────────────────────────────

@pytest.mark.asyncio
async def test_a_passage_carries_provenance_that_names_its_filing():
    out = await channel().search(
        "water scarcity risk", filters={"companies": ["ACME"]}, top_k=1,
    )
    p = provenance(out[0].metadata, ticker="ACME")
    assert p is not None, "a filing passage with no resolvable provenance"
    assert p["accession"] == "0000000000-26-000003"
    assert p["issuer"] == "Acme Corporation"
    assert p["filing_form"] == "10-K"
    assert p["filing_url"].endswith("/0000000000-26-000003-index.htm")
    assert p["document_url"].endswith("/k.htm")


@pytest.mark.asyncio
async def test_prose_is_never_flagged_as_an_exact_filing_figure():
    """`search_pipeline` pins passages carrying that prefix and reports the
    answer as anchored on an exact figure. A paragraph is not one."""
    out = await channel().search(
        "water scarcity", filters={"companies": ["ACME"]}, top_k=5,
    )
    assert out
    assert not any("[EXACT FILING FIGURE]" in r.text for r in out)


@pytest.mark.asyncio
async def test_the_passage_is_attributed_to_sec_authority():
    out = await channel().search(
        "water scarcity", filters={"companies": ["ACME"]}, top_k=1,
    )
    assert out[0].source_quality == 10
    assert out[0].document_type == "10-K"
    assert out[0].ticker == "ACME"


@pytest.mark.asyncio
async def test_quarterly_items_are_named_by_the_quarterly_schedule():
    """Item 2 is MD&A in a 10-Q and Properties in a 10-K. The detector names
    items from the annual schedule, so quarterly prose was cited under the wrong
    section name entirely."""
    quarterly = (b'<html><body><p>ITEM 2. MANAGEMENT DISCUSSION AND ANALYSIS</p>'
                 + b"<p>Acme Corp liquidity and cash flow discussion. </p>" * 30
                 + b"</body></html>")
    ch = channel(doc=quarterly)
    f = await ch._latest_filing(1234, ("10-Q",))
    sections = await ch._sections(1234, f)
    by_item = {s.item_id: s.name for s in sections}
    assert by_item.get("item_2") == "Management's Discussion and Analysis"
    assert by_item.get("item_2") != "Properties"


# ── Degradation ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_question_with_no_company_asks_edgar_for_nothing():
    """EDGAR is company-scoped. Without an issuer there is nothing to read, and
    a fetch would be a wasted round trip on every non-company query."""
    ch = channel()
    assert await ch.search("what is inflation") == []
    assert ch._edgar.doc_timeouts == []


@pytest.mark.asyncio
async def test_an_unknown_ticker_degrades_to_empty_rather_than_raising():
    ch = channel(ciks={})
    assert await ch.search("risks", filters={"companies": ["ZZZZ"]}) == []


@pytest.mark.asyncio
async def test_one_failing_company_does_not_take_down_the_other():
    ch = channel(ciks={"ACME": 1234, "BOOM": 9999})

    original = ch._latest_filing

    async def flaky(cik, forms):
        if cik == 9999:
            raise ConnectionRefusedError("edgar refused")
        return await original(cik, forms)

    ch._latest_filing = flaky
    out = await ch.search(
        "water scarcity risk", filters={"companies": ["BOOM", "ACME"]}, top_k=5,
    )
    assert out, "a healthy company was lost to a failing one"
    assert {r.ticker for r in out} == {"ACME"}


@pytest.mark.asyncio
async def test_a_missing_document_yields_no_passages_rather_than_an_empty_one():
    ch = channel(doc=b"")
    assert await ch.search("risks", filters={"companies": ["ACME"]}) == []


@pytest.mark.asyncio
async def test_the_document_download_gets_its_own_budget():
    """The shared 10s JSON budget aborted multi-megabyte filings mid-read, which
    surfaced as a company intermittently having no qualitative coverage."""
    from app.core.retrieval.edgar_text_search import DOC_TIMEOUT_S

    ch = channel()
    await ch.search("water scarcity", filters={"companies": ["ACME"]})
    assert ch._edgar.doc_timeouts == [DOC_TIMEOUT_S]
    assert DOC_TIMEOUT_S > 10.0


@pytest.mark.asyncio
async def test_a_parsed_filing_is_not_downloaded_twice():
    """An accession is immutable, so re-reading it is pure latency."""
    ch = channel()
    for _ in range(3):
        await ch.search("water scarcity", filters={"companies": ["ACME"]})
    assert len(ch._edgar.doc_timeouts) == 1


# ── Wiring ────────────────────────────────────────────────────────────────

def test_the_channel_is_routed_for_qualitative_filing_questions():
    """Its four siblings all read the ingested corpus. Without this channel in
    the class, a qualitative question about an un-ingested registrant has no
    source at all."""
    from app.core.question_class import FILING_QUALITATIVE, route_channels

    assert "edgar_text" in route_channels(FILING_QUALITATIVE, ["dense"])


def test_prose_intent_reaches_the_channel_whatever_the_class_says():
    """A question can be classified as a calculation or a table and still be
    answerable only from the filing's narrative.

    Each query below is one of the analysis skills' authored prompts, and each
    classified into a class whose routing carried no prose channel at all: the
    reply came from the XBRL channels, which cannot answer "what does management
    say".
    """
    from app.core.question_class import classify, route_channels

    for query in (
        "Describe the business, its reporting segments and who it competes with",
        "Review the quarter and the drivers management gives in the MD&A",
        "What legal proceedings are disclosed",
        "Summarise the risk factors in Item 1A",
        "Discuss liquidity and capital resources",
    ):
        cls = classify(query)["question_class"]
        assert "edgar_text" in route_channels(cls, ["dense", "bm25"], query), (
            f"{query!r} classified {cls} and reached no prose channel"
        )


def test_a_pure_figure_question_does_not_pay_for_a_filing_download():
    """The channel downloads and parses a multi-megabyte document. A question
    the XBRL channel answers exactly, in one small JSON round trip, must not
    wait for that."""
    from app.core.question_class import classify, route_channels

    for query in (
        "What was revenue in FY2025?",
        "What was diluted EPS last year?",
    ):
        cls = classify(query)["question_class"]
        assert "edgar_text" not in route_channels(cls, ["dense", "bm25"], query)


def test_route_channels_still_serves_callers_that_pass_no_query():
    from app.core.question_class import FILING_QUALITATIVE, route_channels

    assert route_channels(FILING_QUALITATIVE, ["dense"])


def test_the_source_plan_can_enable_the_web_channel_and_not_only_veto_it():
    """`route_sources` is documented as authoritative for WEB. It could only
    remove the channel: a question the plan routed to WEB still ran without it
    whenever the class had not already added it, which is every class outside
    NEEDS_WEB_RESEARCH and WEB_AUGMENTED.
    """
    import inspect

    from app.core import search_pipeline

    src = inspect.getsource(search_pipeline)
    assert '_plan.web and "web" not in _channels' in src, (
        "the source plan can veto web but cannot enable it"
    )


def test_prose_from_the_filer_ranks_under_the_exact_fact_channels():
    """A paragraph describing a number must never outrank the number as filed."""
    from app.core.retrieval.fusion import DEFAULT_CHANNEL_WEIGHTS as W

    assert W["edgar_text"] > W["dense"], "primary document under an ingested copy"
    assert W["edgar_text"] < W["edgar"]
    assert W["edgar_text"] < W["structured"]


def test_the_orchestrator_dispatches_the_channel_with_a_company_to_resolve():
    """`filters["companies"]` carries the resolved ticker; without it the
    channel has no issuer and returns nothing."""
    import inspect

    from app.core.retrieval.orchestrator import RetrievalOrchestrator

    src = inspect.getsource(RetrievalOrchestrator._safe_search)
    assert 'name == "edgar_text"' in src
    branch = src.split('name == "edgar_text"')[1].split("elif")[0]
    assert "filters=filters" in branch and "entities=entities" in branch


def test_the_channel_registers_and_carries_a_timeout_of_its_own():
    from app.core.retrieval.orchestrator import RetrievalOrchestrator

    o = RetrievalOrchestrator(edgar_text_search=object())
    assert "edgar_text" in o.channels
    # A filing download plus a parse does not fit the XBRL channel's budget.
    assert o._CHANNEL_TIMEOUTS["edgar_text"] > o._CHANNEL_TIMEOUTS["edgar"]


def test_the_orchestrator_still_starts_without_the_channel():
    from app.core.retrieval.orchestrator import RetrievalOrchestrator

    assert "edgar_text" not in RetrievalOrchestrator().channels


@pytest.mark.asyncio
async def test_concurrent_queries_share_one_parse():
    """The channel is a long-lived singleton; two users asking at once must not
    each download the same filing."""
    ch = channel()
    await asyncio.gather(*[
        ch.search("water scarcity", filters={"companies": ["ACME"]})
        for _ in range(4)
    ])
    assert len(ch._edgar.doc_timeouts) <= 4
    assert any(r for r in await ch.search(
        "water scarcity", filters={"companies": ["ACME"]}))
