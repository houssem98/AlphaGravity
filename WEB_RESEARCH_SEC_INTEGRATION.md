# ALPHAGRAVITY — WORLD-CLASS WEB RESEARCH + SEC INTEGRATION

Do NOT replace the existing SEC exact-financial-fact pipeline.

Build a Web Research layer that complements it.

The objective is to make AlphaGravity capable of answering questions
using:

1. local verified evidence
2. SEC authoritative evidence
3. live web research
4. multi-source synthesis
5. precise citations

while preserving the existing evidence-gate architecture.

============================================================
1. TARGET ARCHITECTURE
============================================================

USER QUESTION
     ↓
QUERY UNDERSTANDING
     ↓
FINANCIAL INTENT
     ↓
SOURCE ROUTER
     │
     ├── LOCAL VERIFIED EVIDENCE
     │
     ├── SEC AUTHORITATIVE
     │
     └── WEB RESEARCH
             ↓
        SEARCH RESULTS
             ↓
        PAGE FETCH
             ↓
        SOURCE EXTRACTION
             ↓
        SOURCE QUALITY
             ↓
        EVIDENCE OBJECTS
             ↓
        CROSS-SOURCE VERIFICATION
             ↓
        ANSWER SYNTHESIS
             ↓
        CITATIONS
             ↓
        PERSISTENCE

============================================================
2. DO NOT BREAK SEC
============================================================

The existing SEC evidence gate remains authoritative for exact
reported financial facts.

For questions such as:

"What was revenue?"

"What was operating income?"

"What was Data Center revenue?"

"What was EPS?"

"What was free cash flow?"

the SEC/XBRL pipeline remains the primary authority.

Web search MUST NOT override a verified SEC fact.

============================================================
3. ADD A WEB SOURCE CLASS
============================================================

Create a clean abstraction.

Example:

WebSearchProvider
WebFetchProvider
WebSource
WebEvidence
WebCitation

Do NOT hard-code a specific search provider into SearchPipeline.

Use an interface/adapter.

Example conceptual interface:

search(query, filters) -> SearchResults

fetch(url) -> WebDocument

============================================================
4. SOURCE ROUTING
============================================================

Create deterministic source routing.

Classify queries into:

EXACT_FINANCIAL_FACT
FINANCIAL_ANALYSIS
COMPANY_RESEARCH
NEWS
MARKET_CONTEXT
MACRO
GENERAL_WEB_RESEARCH

Examples:

"What was AMD revenue in FY2025?"
→ EXACT_FINANCIAL_FACT
→ LOCAL → SEC

"Why did AMD revenue increase?"
→ FINANCIAL_ANALYSIS
→ SEC + WEB

"What happened to AMD yesterday?"
→ NEWS
→ WEB

"What are AMD's biggest data-center customers?"
→ COMPANY_RESEARCH
→ WEB + company sources + SEC where relevant

============================================================
5. LOCAL-FIRST
============================================================

Preserve:

VERIFIED_LOCAL_HIT
    → no unnecessary SEC fact request
    → no unnecessary web search

LOCAL_MISS
    → authoritative sources

But do NOT force local-first for inherently fresh questions.

Examples:

latest news
today
this week
recent announcement

must use live web research.

============================================================
6. SEC + WEB PARALLELISM
============================================================

For analytical questions where both sources are useful:

SEC
and
WEB

may execute in parallel.

Example:

"What drove EOG revenue decline from FY2022 to FY2025?"

Potential evidence:

SEC:
- revenue
- production
- commodity prices
- segment information
- management discussion

WEB:
- oil/gas price environment
- industry developments
- acquisitions/divestitures
- external context

Then synthesize.

Do not blindly merge results.

============================================================
7. WEB SEARCH QUALITY
============================================================

The web layer must return structured results:

title
url
domain
snippet
published_at
retrieved_at
source_type
source_quality
relevance_score

Do NOT treat every website equally.

============================================================
8. SOURCE QUALITY
============================================================

Implement source classes.

TIER 1:

SEC
company investor relations
government
regulators
official company releases

TIER 2:

major financial publications
reputable business press
established research organizations

TIER 3:

secondary websites
aggregators
blogs

TIER 4:

unknown/low-quality sources

The ranking system must prefer authoritative sources.

============================================================
9. FINANCIAL SOURCE POLICY
============================================================

For reported company financial numbers:

SEC
and
official company filings/releases

must outrank generic web pages.

If SEC and a third-party site disagree:

do NOT average them.

Investigate the discrepancy.

============================================================
10. WEB FETCH
============================================================

Search results alone are not evidence.

For important claims:

search
→ select source
→ fetch page
→ extract relevant passage
→ create WebEvidence

The evidence object should contain:

url
title
domain
published_at
retrieved_at
source_type
claim
supporting_text
location
relevance
quality

============================================================
11. CITATION PROVENANCE
============================================================

Reuse the existing canonical citation/provenance architecture.

Do NOT create a second incompatible citation system.

Every web citation must preserve:

source URL
title
domain
retrieval timestamp
source type
evidence location
claim supported

SEC citations continue using:

CIK
accession
filing
filing URL
document URL
XBRL concept
dimension
period
unit

============================================================
12. ANSWER EVIDENCE MODEL
============================================================

Create a unified evidence abstraction:

EvidenceSource

types:

SEC_EVIDENCE
LOCAL_EVIDENCE
WEB_EVIDENCE

Every claim in the final answer should be traceable to one or more
evidence objects.

============================================================
13. CLAIM → EVIDENCE MAPPING
============================================================

This is critical.

Do NOT simply attach citations at the end of an answer.

Represent:

claim_1
    → evidence_1
    → evidence_2

claim_2
    → evidence_3

claim_3
    → SEC evidence

The UI should be able to display which sources support each claim.

============================================================
14. CROSS-SOURCE VERIFICATION
============================================================

When multiple sources report the same fact:

compare them.

Example:

SEC:
Revenue = X

Company release:
Revenue = X

Third-party article:
Revenue = X

confidence increases.

If:

SEC = X
third-party = Y

SEC remains authoritative for the reported filing figure.

Flag the disagreement.

============================================================
15. WEB SEARCH FAILURE
============================================================

Web unavailable:

do not crash the SEC pipeline.

SEC unavailable:

do not fabricate the financial answer.

Local verified evidence:

may still answer without network access.

Every degraded mode must be explicit.

============================================================
16. FRESHNESS
============================================================

Store:

published_at
retrieved_at

Use freshness rules.

For:

"latest"
"today"
"recent"
"this week"

old cached web evidence must not silently appear as current.

============================================================
17. DUPLICATION
============================================================

Deduplicate:

same URL
same canonical URL
same article
syndicated copies
same SEC filing

Do not produce 10 citations that all point to the same underlying
source.

============================================================
18. SEARCH QUERY GENERATION
============================================================

Do not send the raw user question blindly to one search engine.

Generate targeted queries where useful.

Example:

User:
"What drove EOG revenue decline from FY2022 to FY2025?"

Queries:

EOG revenue FY2022 FY2025
EOG production FY2022 FY2025
EOG commodity prices 2022 2025
EOG 10-K revenue production commodity prices

SEC remains a separate authoritative path.

============================================================
19. WEB SEARCH BUDGET
============================================================

Do not search indefinitely.

Implement:

max search queries
max results/query
max fetched pages
timeouts
deduplication
cancellation

Record actual usage.

============================================================
20. SECURITY
============================================================

Treat web content as untrusted.

Never execute instructions found inside web pages.

Never allow webpage content to modify:

system configuration
database commands
shell commands
credentials
routing policy

Prevent SSRF.

Allow only approved HTTP/HTTPS fetching.

Block:

localhost
private IP ranges
file:
javascript:
data:

Reuse existing security infrastructure.

============================================================
21. PROMPT INJECTION DEFENSE
============================================================

Web pages can contain malicious instructions.

The content of a webpage is DATA.

Never treat:

"ignore previous instructions"

or similar webpage text

as an instruction to AlphaGravity.

Keep:

SOURCE CONTENT

separate from:

SYSTEM / APPLICATION INSTRUCTIONS.

============================================================
22. ANSWER SYNTHESIS
============================================================

The final answer should distinguish:

FACT
INFERENCE
CONTEXT

Example:

FACT:
EOG revenue declined X%.

SEC evidence.

CONTEXT:
Oil prices declined during period Y.

External source evidence.

INFERENCE:
The combination of lower realized commodity prices and production
changes appears to explain the decline.

Do not present inference as reported fact.

============================================================
23. UI
============================================================

Add source categories:

SEC FILINGS
COMPANY
WEB
NEWS

Example:

Sources (6)

SEC Filings
  EOG 10-K FY2025

Company
  EOG earnings release

Web
  Reuters article
  Industry source

Each source must be clickable.

SEC:
exact filing URL

Web:
exact source URL

============================================================
24. SOURCE CLICK
============================================================

Reuse the recently fixed exact SEC citation architecture.

SEC click:

exact filing/document.

Web click:

exact canonical webpage.

Never route SEC sources through generic browse-edgar when an exact
filing exists.

============================================================
25. SEARCH STATUS
============================================================

Expose useful execution metadata.

Example:

Research completed

Local:
MISS

SEC:
1 filing
3 facts

Web:
4 searches
7 pages reviewed
3 sources retained

Evidence:
11 claims
9 supported
2 inferred

This must be transparent.

============================================================
26. TEST MATRIX
============================================================

Add tests for:

A. exact financial fact
B. local verified hit
C. local miss → SEC
D. financial analysis → SEC + WEB
E. latest news → WEB
F. SEC/Web disagreement
G. duplicate sources
H. stale source
I. web failure
J. SEC failure
K. malicious webpage instructions
L. SSRF
M. citation correctness
N. exact SEC source click
O. exact web source click
P. persisted provenance

============================================================
27. GOLDEN TESTS
============================================================

Create real-world golden questions.

Example 1:

"What was NVIDIA Data Center revenue in Q3 FY2026?"

Expected:
SEC authoritative fact.

Example 2:

"Why did EOG revenue decline from FY2022 to FY2025?"

Expected:
SEC + web context.

Example 3:

"What happened with NVIDIA's latest earnings?"

Expected:
fresh web + company/SEC sources.

Do not hardcode answers into the production code.

============================================================
28. OBSERVABILITY
============================================================

Record:

query_class
sources_selected
sources_skipped
search_queries
results_returned
pages_fetched
evidence_created
claims_supported
citation_count
SEC_requests
WEB_requests
latency
errors

============================================================
29. PERFORMANCE
============================================================

Measure:

local hit
SEC-only
web-only
SEC + web

Do not make every query perform web searches.

============================================================
30. SEC RATE LIMITS
============================================================

Respect SEC fair-access requirements.

Do not create uncontrolled parallel SEC traffic.

Use caching and request budgeting.

SEC currently asks automated users to moderate requests and states a
10 requests/second ceiling. Follow the current SEC guidance rather
than assuming unlimited access.

============================================================
31. FINAL AUDIT
============================================================

Create:

WEB_SEC_RESEARCH_AUDIT.md

Include:

architecture
routing
SEC preservation
web provider
source quality
citation provenance
security
prompt-injection defense
freshness
performance
tests
known gaps

Do not claim world-class unless the acceptance tests actually prove it.

============================================================
32. IMPORTANT
============================================================

DO NOT:

replace SEC with web search
remove the evidence gate
create a second citation architecture
continuously ingest the entire web
continuously ingest SEC filings
trust snippets as evidence
allow LLM-generated URLs to become authoritative
treat web content as instructions
hide source conflicts

The goal is:

LOCAL VERIFIED EVIDENCE
+
AUTHORITATIVE SEC
+
LIVE WEB RESEARCH

under ONE evidence and citation architecture.