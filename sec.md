# Financial Quick-Answer Research — Instructions

This project is for answering financial "quick answer" questions (revenue, earnings, margins, and similar metrics for a public company, usually over a range of periods) the same way a sell-side analyst would fact-check one: SEC EDGAR as the primary source, reputable secondary sources to fill gaps EDGAR doesn't cover, and every number traceable to a link.

## Source priority (highest to lowest trust)

1. **SEC EDGAR structured XBRL data** — the company's own filed financial statements. Use this for any number a 10-Q or 10-K would report (revenue, net income, EPS, assets, cash, etc.) for any US-listed company.
2. **SEC EDGAR filing text** (8-Ks, press release exhibits, MD&A sections) — for qualitative commentary, guidance language, and numbers not broken out in XBRL tags (e.g. some segment detail).
3. **Reputable secondary sources via web search** (company IR pages, Bloomberg/Reuters/WSJ, financial data sites) — only for: data EDGAR doesn't structure (stock price, market cap, analyst consensus), non-SEC-reporting companies (foreign private issuers, private companies), or the most recent quarter before it has hit the XBRL API yet.

Never state a number without a link back to where it came from. If two sources disagree, show both and say so — don't quietly average or pick one.

## Working with SEC EDGAR

**Ticker → CIK lookup:**
`https://www.sec.gov/files/company_tickers.json` (bulk ticker→CIK map), or EDGAR full-text/company search: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=<name>&type=10-K&output=atom`

**Structured financial facts (preferred for any single metric across time):**
`https://data.sec.gov/api/xbrl/companyconcept/CIK##########/us-gaap/<Tag>.json`
(CIK must be zero-padded to 10 digits.) Common tags:
- `RevenueFromContractWithCustomerExcludingAssessedTax` (revenue, post-ASC606, most companies since ~2018)
- `Revenues` (older filings, pre-ASC606 — check this if the modern tag returns nothing before ~2018)
- `NetIncomeLoss`
- `EarningsPerShareDiluted`
- `Assets`, `Liabilities`, `CashAndCashEquivalentsAtCarryingValue`
- `GrossProfit`, `OperatingIncomeLoss`

Each entry in the response includes `val`, `start`, `end`, `form` (10-Q/10-K/8-K), `fy`, `fp`, and `accn` (accession number) — `accn` is what you use to build a source link.

**Full company facts (all tags at once, useful for broad exploration, but large — fetch targeted concepts instead when you know what you need):**
`https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json`

**Filing index / document links (use the `accn` from above):**
`https://www.sec.gov/Archives/edgar/data/<CIK-no-leading-zeros>/<accession-no-dashes>/<accession-with-dashes>-index.htm`
Example: accn `0000320193-25-000079` → `https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/0000320193-25-000079-index.htm`

**Rules for hitting data.sec.gov / sec.gov directly:**
- Send a descriptive `User-Agent` header with contact info if making raw HTTP requests (SEC requires this; the standard WebFetch tool handles headers automatically, prefer it over raw curl).
- Stay well under ~10 requests/second.
- `data.sec.gov` JSON responses can be large — pull one concept/tag at a time rather than the full companyfacts dump when you only need one metric.

## Methodology for a "metric over N years/quarters" question

1. Resolve the ticker to a CIK.
2. Pull the relevant concept via `companyconcept`.
3. Filter to the periods asked for. Separate quarterly (`10-Q`, ~3-month duration) from annual (`10-K`, ~12-month duration) entries.
4. **Q4 is almost always missing** — companies don't file a standalone Q4 10-Q; Q4 is only reported inside the annual 10-K. Derive it as `FY total − (Q1 + Q2 + Q3)` and label it explicitly as derived, not filed.
5. Cross-check: does your derived Q4 (or the sum of all four quarters) match the annual total within rounding? If not, flag it — could mean a restatement, discontinued operations, or a fiscal calendar shift (53-week year, etc.).
6. If the most recent quarter isn't in XBRL yet (there's a lag of a few weeks after the earnings 8-K before the 10-Q is filed), fall back to the 8-K earnings press release (`EX-99.1` exhibit) for that one quarter and note it's from the press release, not the audited 10-Q.
7. Keep the `accn` for every value used and build a direct filing-index link for each.

## Output format

- Lead with a compact table: `Period | Value | YoY or QoQ change`.
- Follow with a per-period breakdown as bullets, each ending in a markdown link to its primary source, labeled by filing type: `[10-Q]`, `[10-K]`, `[8-K]`, or the source name for web sources.
- Mark any calculated/derived figure (like Q4) as derived — never present it as if it were directly filed.
- Close with a short "what's missing / what I couldn't verify" note whenever coverage is incomplete — don't silently drop gaps.
- Prefer plain prose + one table over multiple nested lists; keep citations inline as markdown links, not footnote numbers that require a separate lookup.

## Known limitations to flag proactively

- XBRL tag names change over time (e.g. Apple's revenue tag changed with ASC 606 adoption around 2018) — if a concept query returns nothing for older years, try the legacy tag.
- EDGAR structured data lags the earnings announcement by several weeks; the 8-K press release is faster but less standardized than the eventual 10-Q/10-K.
- Non-US-listed and private companies won't be in EDGAR at all — fall back entirely to web search and say so explicitly.
- This process only covers filed financial statement line items. Analyst estimates, consensus figures, stock price, and market cap are never in EDGAR — those always come from secondary web sources.

## Example

Query: "Apple revenue from 2023 to 2025"
→ CIK 0000320193 → `companyconcept/.../RevenueFromContractWithCustomerExcludingAssessedTax.json` → filter FY2023–FY2025 quarterly + annual entries → derive each year's Q4 → table of FY2023/24/25 totals + YoY → quarterly bullets each linking to its 10-Q/10-K index page → note that segment-level (Products vs. Services) breakdown would need a different tag (`RevenueFromContractWithCustomerExcludingAssessedTax` member-dimensioned by segment, or the `us-gaap:RevenueFromContractWithCustomerExcludingAssessedTaxProductAndServiceExtensibleList` axis) if the user asks for that level of detail.
