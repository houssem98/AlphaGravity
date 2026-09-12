I re-audited the current feat/web-research-sec-integration branch, reading the source itself rather than relying on the V3 description. I did not run the application or test suite in this pass, so the gates below are executable conditions that should fail against today's source; I am not claiming runtime results.

I also did not re-report the 31 closed rows.

V3 ledger
#	Task	Gate (binary)	Status
V3-1	Latest-quarter P&L must never label a margin as Gross Profit. LatestQuarterCard.tsx:14 defines Gross Profit with match: /^Gross Profit|Gross margin/i, then LatestQuarterCard.tsx:55-58 formats every non-EPS result as USD.	FAIL today: feed computeQuarterRows() [{metric:"Gross margin",value:45,unit:"%",period:"Q2 FY2026"},{metric:"Gross margin",value:40,unit:"%",period:"Q1 FY2026"}]. Expected: no Gross Profit row, or a correctly labelled percentage row. Current code produces Gross Profit, $45, $40, +12.5%.	OPEN — P0
V3-2	An XBRL fact with no unit must remain unit-unknown, not silently become USD. company.py:169 uses "unit": r.get("unit") or "USD".	FAIL today: mock sb_select_all("financials") with a valid exact-XBRL row whose unit=None. Expected API output: unit=null/explicit unavailable provenance. Current output: "unit":"USD".	OPEN — P0
V3-3	A figure must be attributable to the filing that actually supplied that fact, not merely a filing covering the same period. The financials route dedupes on (metric_name, period) and keeps the first row; its ordering uses filing_date, but the code itself states that this field is actually the period end, not the filing date (company.py:150-169). The filing resolver then explicitly says the resolved filing can be the original even when a later filing restated the fact (company.py:475+).	FAIL today: fixture two XBRL rows with identical ticker/metric/period but different values and different filing identities, representing an original filing and a later restatement. Expected: the API either selects using actual filing identity/restatement policy or marks the fact ambiguous. Current selection has no accession/restatement identity in the dedupe key and silently returns one row.	OPEN — P0
V3-4	SEC fallback must use semantic period equality, not substring containment. _fetch_from_edgar() accepts a result whenever period in got or got in period (longitudinal_tracker.py:~887).	FAIL today: request FY2024; mock EDGAR result metadata with period="FY2024 Q4" and a value. Expected: reject as a non-identical period. Current condition accepts it.	OPEN — P0
V3-5	A failed trend request must be shown as a failure, not silently converted into an empty chart. useCompanyData.ts:103-107 sends failure detection for overview, quote, filings and XBRL financials, but not lon, even though trend is part of the same Promise.allSettled.	FAIL today: make /v1/company/AAPL/trend return 503 while the other four surfaces succeed. Expected failedSurfaces contains Revenue trend — server error (503) and the UI says the trend is unavailable. Current code can produce longitudinal=[], with no trend failure added to failedSurfaces.	OPEN — P1
V3-6	Failure of company resolution must not be silently treated as permission to open an unverified ticker. TickerEntry.tsx:51-54 catches resolver failure and directly calls onOpen(q.toUpperCase()).	FAIL today: make /v1/company/resolve fail by network error/timeout for input APPL. Expected: explicit resolver failure state with no company navigation. Current code navigates to /companies/APPL.	OPEN — P1
V3-7	Devil's Advocate must only claim to use verified filing evidence when its input and citations are actually bound to filing sources. The prompt says Using ONLY the verified filing data below and demands [1] citations (DevilsAdvocate.tsx:~29-35), but the code feeds the model rag.answer, not the RAG source passages/citation objects (DevilsAdvocate.tsx:~55-60).	FAIL today: return a RAG result with available=true, an answer containing a financial claim, but no valid source citation mapping. Expected Devil's Advocate to refuse/unavailable because no evidence can be bound. Current code accepts the answer as facts and sends it to the LLM as VERIFIED DATA.	OPEN — P1
V3-8	The LLM provider health probe must not expose an unauthenticated, force-refreshable path that spends provider credits. /api/llm/health has no authMiddleware; refresh=1 bypasses the five-minute cache and invokes probeProvider() for DeepSeek, Anthropic and Gemini.	FAIL today: send unauthenticated GET /api/llm/health?refresh=1 repeatedly with provider keys configured. Expected: authentication/authorization or a non-billable cached health mechanism before provider calls. Current route can initiate three live provider calls per forced refresh.	OPEN — P1 / spend exposure
V3-9	The secondary financial-metrics chart must not put heterogeneous financial units on one shared axis. CompanyPage.tsx:~64 takes the first eight numeric metrics regardless of unit and converts each only to {name,value,label}; OverviewTab.tsx then plots them together as one bar series.	FAIL today: fixture same-period metrics {revenue: $100B, EPS:$5/share, gross_margin:45%}. Expected separate unit-aware charts/rows or refusal to combine. Current chartData puts all three on the same bar chart/Y-axis.	OPEN — P1
What I deliberately did not report
V2-1 unit-aware trend formatter — closed.
V2-2 RatioEngine metric identity — closed.
V2-3 annual/quarterly YoY semantics — closed.
V2-4 CAGR elapsed-period calculation — closed.
V2-5 comparable-period separation — closed.
V2-6 LLM /chat authentication/metering/token cap — closed.
V2-7 finite service tier — closed.
V2-8 basic figure → SEC filing resolution — closed as a capability, but V3-3 is a different defect: the remaining resolution can still identify the wrong filing when the underlying fact was restated because the XBRL row does not retain the filing identity.
Escalations
1. Restatement/provenance policy — V3-3

This requires an owner decision about what “source filing” means when the same period has:

original 10-K
10-K/A
later comparative filing
restated fact

Possible choices:

Original observation: preserve the original filing.
Latest authoritative observation: select the latest applicable filing.
Ambiguous: refuse to attach one filing unless the XBRL observation itself identifies it.

The current data model cannot reliably distinguish these cases because the route is operating on (metric, period) plus a field explicitly treated as period-end. The choice is accounting/product policy, not merely an implementation detail.

2. Devil's Advocate evidence contract — V3-7

You need to decide whether Devil's Advocate is allowed to produce:

only filing-grounded conclusions, or
a broader AI opinion based on retrieved synthesis.

If it is the first, the current "facts = rag.answer" contract is insufficient. Removing unsupported PM-style conclusions would also change an existing capability, so that needs owner approval.

3. LLM health endpoint — V3-8

Locking /health behind authentication changes who can inspect provider availability.

Alternatively, keep it public but make health checks non-billable/cached/server-scheduled. That is an infrastructure/vendor-spend decision.

Unverified

These are things I saw that deserve inspection but I will not promote them to OPEN defects without the missing evidence:

GravityMetric type vs DataTab provenance fields. DataTab reads accession, cik, filing_type, filed, period_end, and source_reason, while the GravityMetric interface previously inspected did not declare all of those fields. I did not run TypeScript, so I am not calling this a build failure.
Need: apps/market-ui/tsconfig.json + actual tsc result.
Whether x-forwarded-for can be spoofed in the deployed Express topology. gravity.ts derives anonymous metering from the first x-forwarded-for value, but whether the production proxy overwrites that header was not in the files I audited.
Need: Express/server deployment configuration and trusted-proxy configuration.
Whether the Devil's Advocate citation numbers actually get mapped to the RAG sources elsewhere. The component itself does not perform that mapping, which is enough to flag V3-7's input contract, but I did not inspect the complete queryGravityRAG()/citation implementation deeply enough to claim the final [1] UI citation is definitely fabricated on every path.
Need: apps/market-ui/src/services/gravitySearchService.ts plus the exact RAG response/citation contract.
Whether the Gross margin metric actually reaches LatestQuarterCard for a real company in the current production dataset. The source-level behavioral gate definitely fails, but I did not run it against the database, so I am not claiming a specific live ticker currently displays $45 Gross Profit.
Bottom line

This V3 pass finds 9 source-proven issues, with 4 genuinely P0 correctness/provenance problems:

V3-1 → wrong metric label/unit
V3-2 → missing unit becomes USD
V3-3 → restatement can be attributed to the wrong filing
V3-4 → SEC period matching is still non-exact

Those are the ones I would fix before adding another Company Intelligence feature. The page is now considerably better defended against the bugs from V1/V2, but these remaining defects still violate the central promise:

“This number is the exact figure, for this period, from this filing.”

That promise is not yet mechanically true for every path.

Yes — if your goal is “make Company Intelligence world-class”, here is the table I would use as the master target.

Priority	Area	Current problem	World-class target	Success condition
P0	Financial truth	A fact can still have ambiguous provenance/semantics	Every number = metric + value + unit + period + filing + evidence	100% displayed financial figures trace to one canonical fact
P0	Period correctness	Periods can be confused across annual/quarterly/TTM	Structured fiscal-period engine	Zero FY/Q/TTM cross-comparisons
P0	Filing provenance	XBRL rows don't inherently retain filing identity	Accession + form + filed date + period + SEC URL on every fact	Click any number → exact SEC filing
P0	Restatements	“Newest row” isn't enough	Explicit original/amended/restated fact policy	Same fixture always resolves deterministically
P0	Units/scales	Unit semantics can still be lost	Canonical unit/currency/scale system	No $ shown for %, EPS, ratios, etc.
P0	AI evidence	AI can receive synthesized RAG answer rather than atomic evidence	Claim → exact fact/passage → filing	Every material AI claim has supporting evidence
P0	Security/billing	Provider paths need hard boundaries	Auth + entitlement + metering at every paid-provider boundary	Anonymous user cannot spend provider credits
P1	Company header	Looks like a search form	Bloomberg/AlphaSense-style research header	Company identity, price, market cap, sector, key actions immediately visible
P1	What Changed	No strong quarter-over-quarter intelligence layer	Automatic material-change detection	User understands what changed in <10 sec
P1	Financial dashboard	Mostly individual cards/charts	Revenue, margins, EPS, FCF, ROIC, growth in coherent dashboard	Analyst can assess financial trajectory immediately
P1	Guidance vs Actual	Not a major first-class surface	Guidance → actual → beat/miss → history	Every quarter shows outcome where data exists
P1	Estimate revisions	Missing	Consensus before/after + revision direction	User sees whether Street expectations are changing
P1	Earnings intelligence	Transcript summary is basic	CEO/CFO/Q&A + new language + changed language	Ask “what changed on the call?”
P1	Risk intelligence	Devil's Advocate is mostly a generated answer	Risks tied to evidence + developments + invalidation signals	Every major risk has source evidence
P1	Catalysts	No integrated catalyst timeline	Earnings, products, regulatory, events, guidance	Forward-looking company calendar
P1	Peer comparison	Peer set is largely predefined	Dynamic industry/business-model peers	Compare company against relevant peers automatically
P1	Valuation	Basic valuation cards	Historical + peer valuation	P/E, EV/EBITDA, FCF yield vs history/peers
P1	Segments	Limited company decomposition	Revenue/profit by segment + growth + mix	User can see what's actually driving growth
P1	Filings	Filing list is basic	Filing timeline + forms + periods + amendments + AI summaries	Filing is readable/askable in one click
P1	Evidence drawer	Citation can be too shallow	Claim → exact passage → page/section → SEC filing	Evidence verification takes seconds
P1	Search	Ticker/company input	Universal company command/search	Name, ticker, CIK and aliases resolve correctly
P1	Failure states	Some failures can still look empty	EMPTY ≠ FAILED ≠ UNAVAILABLE	User always knows whether data exists
P2	Company AI	Fixed six-prompt brief	Persistent company research agent	Ask arbitrary company questions with evidence
P2	Management signals	Basic sentiment	Tone + language changes + commitments + uncertainty	Detect meaningful management changes
P2	Competitive intelligence	Basic peers	Product/segment/customer/market comparison	Explain why competitors are winning/losing
P2	Historical intelligence	Mostly point-in-time	3–10 year longitudinal company model	Trends, inflections and regime changes
P2	News/events	Separate from core company intelligence	News → event → financial impact → evidence	User sees why an event matters
P2	Investor workflow	Mostly read-only	Save, compare, annotate, export, share	Full analyst workflow inside AlphaGravity
P2	Speed	Multiple backend layers	Prefetched company snapshot + parallel retrieval	Initial company view feels instant
P2	Freshness	Data freshness isn't prominent	“As of” timestamp everywhere	User knows exactly how fresh each dataset is
P2	Confidence	Confidence isn't consistently visible	Evidence quality/status, not fake confidence	Uncertain facts visibly marked
P2	Benchmarking	Internal tests dominate	Independent analyst-task benchmark	Accuracy + evidence + latency + cost measured
The world-class Company page should ultimately look like this
Section	What the analyst should get
1. Header	Company identity + price + market cap + sector + latest filing
2. Investment Snapshot	30-second evidence-backed company overview
3. What Changed	Biggest changes since previous quarter/year
4. Financials	Revenue, margins, EPS, FCF, ROIC + historical trends
5. Expectations	Consensus + estimate revisions + guidance
6. Guidance vs Actuals	Beat/miss history
7. Earnings	Latest call + transcript + Q&A + changed language
8. Risks	Material risks + evidence + new developments
9. Catalysts	Upcoming events and potential business drivers
10. Segments	Segment revenue/profit/growth/mix
11. Valuation	Current vs historical vs peers
12. Peers	Dynamic competitive comparison
13. Filings	10-K / 10-Q / 8-K timeline
14. AI Research	Ask anything about the company
15. Evidence	Exact source behind every important claim
The key product test

A world-class version should let an analyst type:

NVDA

and within seconds answer:

“What changed, why did it change, what does management say about it, what does the Street expect, what are the risks, and show me the exact evidence.”

If Company Intelligence can do those six things accurately, quickly, and with source-level evidence, then you're no longer building a company dashboard.

You're building a real financial research terminal.

i want note on 10 

If you mean “give me a note/score out of 10 for the current Company Intelligence feature”:

Current score: 6.5 / 10
Category	Score /10	Note
Financial data correctness	6/10	Strong exact-XBRL foundation, but unit, restatement and period edge cases remain
SEC provenance	7/10	Much improved; exact filing linkage exists, but identity handling needs strengthening
AI research quality	6/10	Useful, but evidence binding is not yet strong enough for institutional research
Company overview	6/10	Functional, but still more dashboard than research terminal
Financial analysis	7/10	Good foundation for trends and exact figures
Risk / sentiment	6/10	Present, but not yet deeply evidence-driven
Filings intelligence	7/10	Solid SEC foundation; needs stronger analysis around filings
Error / failure handling	6/10	Some failures can still become effectively empty states
UX / analyst workflow	6/10	Usable, but not yet at professional research-terminal level
Overall product intelligence	6/10	Good infrastructure, but missing the higher-level “what changed / why / so what?” layer
My verdict

6.5/10 today.

I would not call it world-class yet.

The important thing is that I would not rewrite the architecture. The underlying SEC/XBRL work is good enough to build on. The biggest gap is moving from:

“Here are company data + charts + AI summaries.”

to:

“Here is what changed, why it changed, what management said, what expectations imply, what the risks are, and the exact evidence for every important claim.”

If you fix the remaining P0 correctness/provenance issues first, I’d expect the feature to have a credible path toward 8–9/10.