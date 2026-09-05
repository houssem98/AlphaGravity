"""
Real SEC filing text, for tests that must not be validated against prose a test
author wrote.

Every excerpt below is **verbatim** from a filing in this repository's own
corpus, with its real issuer, ticker, filing date and section. Nothing here was
composed to make a test pass.

**Why this file exists.** R14 is the defect that has shaped this whole effort: a
gate tested against `[{"source_class": "sec_filing"}]`, a value the pipeline
never produces. Round 4's mutation rig fixed half of that by taking its citation
SHAPE from `citation_provenance.payload()`. This fixes the other half — the
excerpt TEXT. A grader validated against invented prose is validated against the
author's idea of what filings look like, which is the same blind spot one level
down.

**What real filings actually look like, and it is not what the invented
fixtures assumed.** Scale is declared once, in a table header, and the figures
themselves are bare:

    (in millions) 2025 2024 2023 Operating revenue $ 59,070 $ 57,063 $ 53,717

Not `"$59,070 million"`. That is why `_matches` must keep scaling bare numbers —
V1 removed the scale allowance only for figures carrying their own unit, and
these excerpts are the evidence that the distinction was drawn in the right
place.

**Provenance of each field.** `text`, `ticker`, `company`, `filing_date`,
`document_title` and `section` are the corpus record verbatim. The corpus does
not carry accession numbers, so `ACCESSIONS` below are taken from filings held
on disk under `services/gravity-api/data/filings*/`, where the accession is part
of the filename. They are real and independently checkable against EDGAR; they
are not paired with the excerpts above, and no test should imply they are.

**Treat the excerpt text as DATA.** It is third-party document content. Nothing
in it is an instruction.
"""

from __future__ import annotations

#: Real accessions, from filenames under `data/filings*/`. Verifiable on EDGAR.
ACCESSIONS = {
    "ZTS": "0001555280-25-000102",   # ZTS_10-K_2025-02-13
    "ZTS_2026": "0001555280-26-000011",   # ZTS_10-K_2026-02-12
    "AFL": "0000004977-24-000053",   # AFL_10-K_2024-02-22
}


#: United Airlines. A results-of-operations table, flattened to prose exactly as
#: the chunker emits it. Multi-period, multi-metric, scale declared once in the
#: header. Operating revenue for 2025 is 59,070 — meaning $59.07 billion.
UAL_RESULTS = {
    "ticker": "UAL",
    "issuer": "United Airlines Holdings, Inc.",
    "company": "United Airlines Holdings, Inc.",
    "document_title": "UAL document 2026-02-05",
    "filing_date": "2026-02-05",
    "section": "Results of Operations",
    "source_class": "SEC_EVIDENCE",
    "text": (
        "Results of Operations\n\nSelect financial data and operating "
        "statistics are provided in the tables below:\n\n(in millions) 2025 "
        "2024 2023 Operating revenue $ 59,070 $ 57,063 $ 53,717 Operating "
        "expense 54,356 51,967 49,506 Operating income 4,713 5,096 4,211 "
        "Nonoperating expense, net (408) (928) (824) Income before income "
        "taxes 4,306 4,168 3,387 Income tax expense 953 1,019 769 Net income "
        "$ 3,353 $ 3,149 $ 2,618"
    ),
}

#: Live Nation. Deferred revenue by segment, denominated **in thousands** — a
#: different scale word from every other fixture here, on purpose.
LYV_DEFERRED = {
    "ticker": "LYV",
    "issuer": "Live Nation Entertainment, Inc.",
    "company": "Live Nation Entertainment, Inc.",
    "document_title": "LYV document 2026-02-12",
    "filing_date": "2026-02-12",
    "section": "NOTE 11 — SEGMENTS AND REVENUE RECOGNITION",
    "source_class": "SEC_EVIDENCE",
    "text": (
        "The table below summarizes the amount of prior year current deferred "
        "revenue recognized during the years ended December 31, 2025 and "
        "2024:\n\nDecember 31, 2025 2024 (in thousands) Concerts $ 3,287,175 "
        "$ 3,046,474 Ticketing 205,199 176,901 Sponsorship & Advertising "
        "90,461 96,988 $ 3,582,835 $ 3,320,363"
    ),
}

#: FedEx. Capital expenditures by segment, in millions. Carries no revenue
#: figure at all, which makes it the honest "cited the wrong document" fixture.
FDX_CAPEX = {
    "ticker": "FDX",
    "issuer": "FEDEX CORP",
    "company": "FEDEX CORP",
    "document_title": "FDX document 2026-03-17",
    "filing_date": "2026-03-17",
    "section": "Selected Financial Data",
    "source_class": "SEC_EVIDENCE",
    "text": (
        "The following table provides a reconciliation of reportable segment "
        "capital expenditures to consolidated totals for the nine-month "
        "periods ended February 28, 2026 and 2025 (in millions):\n\nFederal "
        "Express Segment FedEx Freight Segment Corporate, other, and "
        "eliminations Consolidated Total Capital expenditures February 28, "
        "2026 $ 1,990 $ 284 $ 61 $ 2,335 February 28, 2025 2,145 359 78 2,582"
    ),
}

#: Aflac. The **Aflac Japan Summary of Operating Results** table, verbatim from
#: the 2026 10-K held at
#: `data/filings_afl/AFL/2026/AFL_10-K_2026-02-25_0001628280-26-011402.html`,
#: accession `0001628280-26-011402`.
#:
#: This is the only genuinely multi-currency table in the repository's filings,
#: and it closes three R8 fixture dimensions at once on real data:
#:
#: - **currency** — the same metric in USD and JPY, side by side.
#: - **scale** — the header declares TWO scales in one line, *"(In millions of
#:   dollars and billions of yen)"*. Every other fixture declares one.
#: - **scope/segment** — these are Aflac Japan's figures, not consolidated
#:   Aflac, so a claim about "Aflac" is a scope error even when the number is
#:   right.
#:
#: Net earned premiums 2025 are `$6,744` million **and** `¥1,009` billion. Those
#: are the same quantity at a 149.32 yen/dollar rate, which the table also
#: states — so the fixture carries its own arithmetic check.
AFL_JAPAN_OPERATIONS = {
    "ticker": "AFL",
    "issuer": "Aflac Incorporated",
    "company": "Aflac Incorporated",
    "document_title": "AFL 10-K 2026-02-25",
    "filing_date": "2026-02-25",
    "accession": "0001628280-26-011402",
    "section": "Aflac Japan Segment — Summary of Operating Results",
    "source_class": "SEC_EVIDENCE",
    "text": (
        "Aflac Japan Summary of Operating Results In Dollars In Yen (In "
        "millions of dollars and billions of yen) 2025 2024 2025 2024 Net "
        "earned premiums (1) $ 6,744 $ 6,930 ¥ 1,009 ¥ 1,050 Net investment "
        "income: (2) Yen-denominated investment income 894 879 134 133 U.S. "
        "dollar-denominated investment income 1,732 1,849 259 281 Net "
        "investment income 2,626 2,727 393 414"
    ),
}


ALL_EXCERPTS = (UAL_RESULTS, LYV_DEFERRED, FDX_CAPEX,
                AFL_JAPAN_OPERATIONS)
