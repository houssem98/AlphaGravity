# FIX SOURCE CLICK — EXACT SEC FILING URL

The AlphaGravity UI currently has a serious citation/source navigation bug.

When a user clicks a source for an SEC filing, the browser opens a
generic EDGAR company browse URL such as:

https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=EOG&type=10-K...

This is NOT acceptable.

The source click MUST open the exact authoritative SEC filing/document
that produced the evidence.

Do not merely change the displayed text.
Fix the complete provenance → API → citation → UI navigation chain.

============================================================
1. REPRODUCE THE BUG
============================================================

Use the EOG Resources example.

The source currently shown is an EOG 10-K.

Accession:

0000821189-25-000011

CIK:

821189

The exact filing URL should resolve to:

https://www.sec.gov/Archives/edgar/data/821189/000082118925000011/0000821189-25-000011-index.htm

First locate where the current generic browse-edgar URL is created.

Trace:

SEC resolver
→ evidence
→ citation provenance
→ SearchMetadata
→ API response
→ frontend source object
→ source click handler
→ browser URL

Do not patch only the frontend.

============================================================
2. CANONICAL SOURCE URL
============================================================

The canonical SEC filing URL MUST come from verified provenance.

Priority:

1. Exact SEC filing/document URL returned by authoritative SEC
2. Safely constructed exact filing URL from verified CIK + accession
3. Other authoritative SEC evidence URL

NEVER prefer:

browse-edgar?action=getcompany...

when an exact accession is known.

Never allow an LLM-generated URL to override canonical provenance.

============================================================
3. EXACT FILING URL CONSTRUCTION
============================================================

For:

CIK = 821189
accession = 0000821189-25-000011

the canonical filing URL must be:

https://www.sec.gov/Archives/edgar/data/821189/000082118925000011/0000821189-25-000011-index.htm

Implement this generically.

Do not hardcode EOG.

Normalize accession for the SEC Archives path:

0000821189-25-000011
→ 000082118925000011

Keep the hyphenated accession for the visible filing identity.

Use the existing citation_provenance implementation if available.

Do not create a second provenance model.

============================================================
4. DOCUMENT URL VS FILING URL
============================================================

Preserve both where available:

filing_url
document_url

Example:

filing_url:
.../0000821189-25-000011-index.htm

document_url:
.../0000821189-25-000011.htm

OR the actual primary filing document returned by SEC.

Do NOT assume the primary document filename.

Use the actual SEC filing metadata when available.

The UI source click should open the most precise authoritative URL
available.

============================================================
5. API CONTRACT
============================================================

Inspect the API response returned to the UI.

Ensure the source/citation object contains:

ticker
issuer
CIK
form
filing_date
fiscal_period
accession_number
filing_url
document_url
source_url
verification_status

The frontend must never need to reconstruct the SEC URL from an
untrusted string.

Canonical URL should already be present in the API response.

============================================================
6. FRONTEND SOURCE CLICK
============================================================

Find the exact React/TypeScript component responsible for clicking
sources.

The click handler must use:

citation.filing_url

or:

citation.document_url

according to the canonical source policy.

It must NOT use:

citation.url

if citation.url is a model-generated/generic browse URL.

If legacy data contains a generic browse-edgar URL but verified
accession + CIK exist, resolve the canonical URL from provenance.

Do not silently open a generic company page when exact provenance exists.

============================================================
7. SECURITY
============================================================

Do not turn arbitrary model-generated URLs into clickable external
links.

Only allow trusted SEC URLs derived from verified provenance.

Validate:

hostname:
www.sec.gov
or the approved SEC authoritative host already used by the project.

Reject:

javascript:
data:
file:
localhost
private IPs
untrusted domains

Preserve the existing SSRF protections.

============================================================
8. REQUIRED TESTS
============================================================

Add a regression test using:

EOG
CIK 821189
accession 0000821189-25-000011

Assert:

citation.filing_url ==
https://www.sec.gov/Archives/edgar/data/821189/000082118925000011/0000821189-25-000011-index.htm

Also assert:

generic browse-edgar URL is NOT used.

============================================================
9. FRONTEND TEST
============================================================

Test the actual source-click component.

Given:

accession:
0000821189-25-000011

CIK:
821189

filing_url:
exact SEC Archives URL

Click source.

Assert the navigation target is the exact SEC filing URL.

Do not only test the citation object.

Test the actual UI click behavior.

============================================================
10. BOTH PATHS
============================================================

Test both:

A. SEC → exact filing → answer → citation → source click

B. persisted local evidence → answer → citation → source click

The local-hit path MUST retain the exact provenance originally
persisted from SEC.

This is critical.

Do not allow:

SEC path:
exact URL

but:

local path:
generic browse-edgar URL

============================================================
11. RESILIENCE PATH
============================================================

Test the degraded/resilience answer path too.

Previously the project had a second citation builder that bypassed
provenance.

Verify that:

normal answer
resilience answer
local answer
SEC answer

ALL use the same canonical provenance.

No citation path may fall back to generic EDGAR if exact provenance
exists.

============================================================
12. UI DISPLAY
============================================================

The source card should ideally display something like:

EOG Resources
10-K — FY2025
Filed Feb. 27, 2025
Accession: 0000821189-25-000011

Clicking it opens the exact SEC filing.

Do not display a misleading generic "SEC filing" link.

============================================================
13. EVIDENCE LOCATION
============================================================

If the evidence contains an exact document/section location, preserve
it.

For example:

filing
→ document
→ XBRL concept
→ context/dimension

Do not pretend that the generic filing index itself is the exact
location of the fact if a more precise document/evidence location is
available.

============================================================
14. REQUIRED E2E TEST
============================================================

Run the actual AlphaGravity flow:

query
→ retrieval
→ evidence
→ citation
→ API response
→ UI source click

Use the EOG example.

Expected:

local miss / SEC retrieval
→ exact EOG 10-K
→ accession 0000821189-25-000011
→ exact SEC URL
→ source click opens exact SEC filing

Then repeat from persisted local evidence.

Expected:

VERIFIED_LOCAL_HIT
→ same exact accession
→ same exact filing URL
→ source click opens exact filing

============================================================
15. SEARCH FOR ALL GENERIC EDGAR URL GENERATORS
============================================================

Search the entire repository for:

browse-edgar
getcompany
CIK=
sec.gov/cgi-bin
source_url
citation.url
filing_url
document_url

Find every place capable of generating a generic EDGAR company URL.

Classify each:

SAFE
LEGACY
BUG
INTENTIONAL

Fix every incorrect citation path.

Do not stop after fixing the EOG example.

============================================================
16. VALIDATION
============================================================

Run:

pytest
frontend tests
SEC evidence tests
citation provenance tests
SearchPipeline E2E
gate-guard
graph-lint
governance

Do not weaken existing assertions.

============================================================
17. FINAL REPORT
============================================================

Create:

SEC_SOURCE_CLICK_AUDIT.md

Report:

IMPLEMENTATION:
exact files/functions changed

BACKEND:
canonical URL result

API:
citation payload result

FRONTEND:
source-click result

EOG:
CIK
accession
filing URL

NORMAL PATH:
PASS/FAIL

LOCAL PERSISTED PATH:
PASS/FAIL

RESILIENCE PATH:
PASS/FAIL

SECURITY:
PASS/FAIL

TESTS:
actual numbers

REGRESSIONS:
actual numbers

COMMIT:
SHA

BRANCH:
name

Do not say "fixed" unless the actual UI click test proves that the
browser target is the exact SEC filing.

============================================================
18. ACCEPTANCE CRITERION
============================================================

This task is DONE only when:

User clicks source
        ↓
AlphaGravity source object
        ↓
canonical verified provenance
        ↓
exact accession
        ↓
exact SEC filing URL
        ↓
browser opens exact filing

NOT:

User clicks source
        ↓
generic EDGAR company page