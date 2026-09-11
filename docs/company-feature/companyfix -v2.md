Yes. I checked the current feat/web-research-sec-integration branch and the screenshot.

My blunt verdict:

The Company Intelligence feature is much better engineered than the screenshot suggests, but it is not world-class yet.

The biggest remaining problem is no longer “does the page load?” It is financial semantics + provenance + analyst workflow. A world-class company page cannot merely show numbers and AI cards; every number must have the right period/unit/source, and the user should be able to go from company → what changed → why → evidence → filing in seconds.

I inspected the current source. I did not execute the repository/tests in this turn, so I am not going to pretend runtime validation happened.

1. Current score
Area	Current	World-class target
Visual foundation	6.5/10	9.5
Company discovery	6/10	9.5
Financial data	6/10	9.5
Period correctness	4/10	10
Source/provenance	5/10	10
Filings UX	5.5/10	9.5
AI company brief	7/10	9.5
Earnings/transcripts	5/10	9.5
Sentiment	6.5/10	9
Analyst workflow	5.5/10	10
Coverage	7/10	10
Security/billing boundary	4/10	10
Overall: ~6/10

The good news: the architecture is salvageable. I would not rewrite the feature.

2. The screenshot itself: not world-class

Your empty state is:

Company Intelligence
Enter a ticker or company name — filings, financials and sentiment.

It is clean, but it feels like a utility form, not an institutional research terminal.

A professional analyst landing experience should immediately communicate:

Instead of this
             Company Intelligence

       Enter a ticker or company name

 [ NVDA, or lululemon                 ] [View]

       AAPL   NVDA   TSLA   MSFT   AMZN
You want something closer to
┌─────────────────────────────────────────────────────────────┐
│ Company Intelligence                                       │
│                                                             │
│ Search any company, ticker, CIK or filing                  │
│                                                             │
│ 🔎  NVIDIA, Apple, Microsoft...                     ⌘ K    │
│                                                             │
│ Recent                                                    │
│ NVIDIA       Apple       Microsoft       Tesla             │
│                                                             │
│ ───────────────────────────────────────────────────────── │
│                                                             │
│ Explore                                                     │
│ • What changed this quarter?                               │
│ • Revenue & margin trajectory                              │
│ • Latest earnings + guidance                               │
│ • Risks / catalysts                                        │
└─────────────────────────────────────────────────────────────┘

The search box should be the command center, not a form.

Your TickerEntry.tsx already has an important foundation: server-side company resolution and name → ticker support.

But visually and functionally, it needs to become a research launcher.

3. P0 — Financial chart can display the wrong unit

This is the first thing I would fix.

apps/market-ui/src/components/company/OverviewTab.tsx

The trend chart accepts:

trendMetric
trendLabel
unit

but the renderer hardcodes:

(v / 1e9).toFixed(0)
$...

So the UI effectively assumes:

every trend is USD absolute dollars.

That is incompatible with your own backend design, which can return:

revenue
operating income
net income
EPS
margins
ratios

The backend explicitly returns unit, but OverviewTab doesn't use it for the chart formatting.

Failure

If the backend says:

{
  "metric_used": "gross_margin",
  "unit": "%"
}

the chart formatter still behaves like:

$0.45B

instead of:

45.0%
Why this is dangerous

This isn't cosmetic.

A financial researcher can interpret:

45

as:

$45B
45%
$45/share
45x

Those are completely different facts.

Smallest correct fix

Create one canonical formatter:

formatFinancialValue(value, unit, metric)

and never let a chart invent its own scale.

4. P0 — Your YoY calculation is still structurally wrong for annual data

This is a serious one.

Your company UI requests annual periods:

FY2019 ... FY2026

but LongitudinalTracker._compute_changes() defines:

YoY = 4-period lag
QoQ = 1-period lag

That makes sense for quarterly observations.

It does not make sense for:

FY2019
FY2020
FY2021
FY2022
FY2023
FY2024
FY2025
FY2026

For FY2024, a 4-row lag points to FY2020.

The tracker source explicitly implements the 4-period YoY assumption.

Correct semantics
Series	YoY
Annual	previous fiscal year
Quarterly	same quarter previous year
Monthly	same month previous year
LTM	previous LTM period
TTM	previous TTM

This needs to be period-aware, not array-position-aware.

5. P0 — CAGR is also mathematically wrong for your company chart

The tracker currently does:

n_years = len(values) / 4

because it assumes quarterly observations.

But Company Intelligence explicitly asks for an annual FY series.

Eight annual observations:

FY2019 → FY2026

are approximately 7 years apart, not 2 years.

So:

8 / 4 = 2

is wrong.

Correct implementation

CAGR should use actual period endpoints:

(last_value / first_value) ^ (1 / elapsed_years) - 1

where elapsed_years comes from fiscal period dates.

This is exactly the sort of bug that can produce a plausible but materially wrong investment conclusion.

6. P0 — RatioEngine fallback can fabricate a metric

This is probably the most dangerous backend issue.

In _fetch_metric():

exact financials
SEC
RatioEngine
old DB
PostgREST

The RatioEngine fallback does:

first_val = next(iter(output.ratios.values()))

and returns that value.

That's not a valid metric identity guarantee.

Imagine:

requested = revenue
RatioEngine returns:
{
    "gross_margin": 0.73,
    "operating_margin": 0.42
}

next(iter(...)) can return:

0.73

and the caller gets a numeric answer for revenue.

That's unacceptable in Company Intelligence.

Rule

No metric identity → no number.

Delete this as a raw-fact fallback.

Derived metrics should have:

metric_id
formula
inputs
input_sources
period
unit
calculation_version

and be explicitly typed as:

reported_fact
derived_fact
estimate
guidance
market_data
7. P0 — Source provenance is still not analyst-grade

Your own types show the problem.

GravityMetric has:

document_id?: string

but the code comments acknowledge that the XBRL rows currently carry xbrl:<ticker> rather than an actual filing identity.

Then DataTab has to display:

—

when it cannot resolve the filing.

That's not good enough for a professional financial product.

World-class figure

Click:

Revenue
$391.04B
FY2024
+2.0%

and immediately get:

Source
Apple Inc. 2024 Form 10-K
Filed: 2024-11-01
Period: FY2024
Accession: 0000320193-24-...
SEC Filing

[Open filing]
[Open exact evidence]

Not:

Source: —
Required data model

Every financial fact should carry something like:

interface EvidenceFact {
  entity;
  ticker;
  metric;
  value;
  unit;
  currency;

  periodStart;
  periodEnd;
  fiscalYear;
  fiscalPeriod;

  form;
  filingDate;
  accession;
  primaryDocument;

  sourceType;
  sourceUrl;

  dimensions;
  amended;
  confidence;
}

This is one of the biggest differences between a dashboard and a research platform.

8. P0 — Latest Quarter Card can mix incompatible periods

LatestQuarterCard finds the two latest periods by sorting strings:

.sort().reverse()

and then compares those two periods.

That becomes dangerous if metrics contains both:

FY2025
Q4 2025

because lexical ordering does not equal financial-period semantics.

You could end up with:

Latest Reported Period
Q4 2025 vs FY2025

and calculate:

Revenue +X%

which is meaningless.

World-class solution

Separate datasets:

Annual
Quarterly
TTM
LTM

Then explicitly choose:

Latest quarter
Prior-year quarter
Previous quarter
Latest FY
Prior FY

Never infer period semantics from strings.

9. P1 — Your filing UX is too weak

Current filing rows essentially give:

10-K
2025-02-...
NVIDIA 10-K ...
             Search

The "Search" action navigates to a generic search query.

That's not a filing intelligence experience.

You need:

10-K
FY2025
Feb 21, 2025

NVIDIA Corporation

[Read filing] [Ask filing] [View evidence]

And for each filing:

form
filing date
fiscal period
accession
filing status
amendment indicator
document length
indexed/not indexed
SEC source
transcript if applicable
AI summary
key changes

Your backend already returns SEC accession information for non-indexed filings.

You should promote that all the way into the UI.

10. P1 — Company page is missing the most important analyst concept: WHAT CHANGED?

This is the biggest product gap.

Your current Overview has:

latest metrics
trend
transcript summary
AI brief
Devil's Advocate
description
financial metrics

That's useful.

But an analyst opening:

NVDA

usually wants:

What changed since last quarter?
NVIDIA — What Changed

Revenue                 +12% QoQ
Data Center             +18%
Gross margin             +80 bps
Operating income         +14%
FCF                      +21%

New guidance             ↑
China risk               ↑
CapEx commentary         ↑
Blackwell demand         ↑

3 material changes detected

Then:

Why?

1. Data Center growth accelerated...
   [10-Q] [Earnings Call]

2. Gross margin expanded...
   [10-Q]

3. Management raised...
   [Earnings Call]

That becomes decision support, not a prettier filing browser.

11. P1 — You're missing Guidance vs Actuals as a first-class surface

Your backend actually has:

GuidanceActualsTracker

but the Company page doesn't turn that into a major user-facing product.

This should become:

GUIDANCE VS ACTUAL

Revenue
Guidance: $56.0–57.0B
Actual:   $57.1B
Result:   BEAT

Gross Margin
Guidance: 74–75%
Actual:   75.1%
Result:   BEAT

Then historical:

Q1    Beat
Q2    Beat
Q3    In line
Q4    Beat

That is extremely valuable to equity analysts.

12. P1 — Transcript intelligence needs to become a real product

You currently detect a transcript and launch one RAG query:

ticker earnings call summary

The code itself admits an important weakness: the document_types filter is not enforced strongly enough on the structured channel, so it can fall back to 10-K content; the current protection is essentially a disclaimer-string guard.

That's not robust enough.

World-class transcript intelligence should have:

Latest Earnings Call

CEO
CFO
Analyst Q&A

Key topics
────────────
AI demand             ↑
Margins               ↑
China                 ↓
CapEx                 ↑
Pricing               →

And:

Management commentary

"What changed?"
"What did management newly say?"
"What did management stop saying?"
"What questions did analysts repeatedly ask?"

The Q&A section is especially valuable.

Fintool's public company pages demonstrate the value of combining company reports with earnings transcripts and an AI agent that can answer questions about those sources.

13. P1 — AI Brief is good infrastructure, but not yet a world-class tearsheet

This part is actually one of your stronger areas.

You already have:

per-cell state
live progress
citations
caching
model health
background jobs
six fixed prompts
RAG
export

That's solid.

But the output needs to become more investment structured.

Instead of six generic cards, I would make the default company brief:

INVESTMENT SNAPSHOT

┌───────────────────────────────────────────┐
│ Thesis                                    │
│ 3–5 sentence evidence-backed summary      │
└───────────────────────────────────────────┘

WHAT CHANGED
• ...
• ...
• ...

GROWTH
Revenue
Margins
FCF
Segments

CATALYSTS
• ...
• ...

RISKS
• ...
• ...

MANAGEMENT SIGNAL
• ...

VALUATION
P/E
EV/EBITDA
FCF yield
vs historical

COMPETITIVE POSITION
...

EVIDENCE
[1] 10-K
[2] Earnings Call
[3] 10-Q

Then let users expand the evidence.

14. P1 — Your AI citations need to be richer

CompanyBrief currently turns [1] into a clickable citation and shows the citation title/text.

Good.

But world-class citation UX should answer:

What exactly supports this sentence?

Clicking [1] should show:

NVIDIA FY2025 10-K
Filed Feb 2025

Page 74
Risk Factors

"..."

[Open source]
[Open filing]

And ideally:

Claim supported
Confidence
Source type
Filing period

The user should never have to wonder whether [1] is a generic search result or the actual filing.

15. P1 — Market data and filing data are visually mixed

Your top cards currently combine:

Market Cap
P/E
EPS
Analyst Target
52W High
52W Low
Operating Margin
Revenue

That's okay for a retail dashboard.

For an institutional research product, separate:

Market
Price
Market Cap
EV
P/E
EV/EBITDA
FCF Yield
52W range
Financial performance
Revenue
Gross margin
Operating margin
EPS
FCF
ROIC
Expectations
Consensus EPS
Consensus revenue
Next quarter
FY guidance
Research signals
Momentum
Estimate revisions
Management tone
Risk changes

The current architecture has room for this, but the information hierarchy isn't there yet.

16. P1 — Missing "estimate revisions"

This is a major gap if you want to compete with professional research products.

You need:

EPS estimate
                 Before     Now
FY2026            $5.40     $5.62 ↑
FY2027            $6.30     $6.48 ↑

And:

Revenue estimates
Next quarter      +3.2%
FY2026             +1.8%
FY2027             -0.4%

That lets the user see:

Is the Street changing its mind?

Much more valuable than another static P/E card.

17. P1 — Missing catalyst/risk timeline

You already have Devil's Advocate.

Turn that into an actual research timeline:

NEXT 90 DAYS

Sep 18
Product event

Oct 28
Earnings

Nov
Regulatory decision

Dec
Investor conference

With:

Catalyst
Probability / confidence
Potential impact
Evidence

Don't fabricate probabilities. If unavailable:

Impact: Unknown
Evidence: 10-K / management commentary
18. P1 — Peer comparison should not be only a hardcoded ticker list

Your page already has:

peersFor(symbol)

and a Compare in Grid button.

That's a good interaction.

But world-class peers should be dynamically constructed from:

sector
industry
business model
revenue exposure
market cap
geography

Then:

NVDA

                 NVDA    AMD    AVGO    MRVL
Revenue growth    78%     24%    20%     11%
Gross margin      75%     54%    64%     51%
FCF margin        ...
P/E               ...
EV/EBITDA         ...

And importantly:

Why is this company being compared to these peers?

19. P1 — Trend endpoint is still doing too much work per period

You fixed serial fetching with:

asyncio.gather(...)

That's a legitimate improvement.

But the architecture remains:

8 periods
   ↓
8 _fetch_metric calls
   ↓
financials
   ↓
SEC
   ↓
possibly RatioEngine

The correct world-class architecture is:

ONE company + ONE metric + PERIOD RANGE
                    ↓
             Financial Fact Resolver
                    ↓
        local canonical facts
                    ↓
          SEC batch fallback
                    ↓
           complete time series

Don't ask SEC:

FY2020?
FY2021?
FY2022?
FY2023?
...

Ask once:

Give me Revenue facts for NVDA
FY2020–FY2026

Then select deterministically.

This will improve both latency and correctness.

20. P0 security issue remains inconsistent with the roadmap

Your roadmap marks the billing/internal-key work as DONE, but the current auth.py still contains:

deep-research-internal
eval-unlimited-fb-2026

as hardcoded accepted keys, returning:

tier = unlimited

without the subscription entitlement path.

So I would not certify CF-12 as truly closed based on the current source.

Also, /api/llm/chat accepts caller-supplied:

provider
model
prompt
max_tokens

and directly invokes the server-side provider credentials. There is no visible authentication/entitlement gate in the route itself.

For Company Brief, that matters because the browser directly uses:

/api/llm/chat

That must be treated as a server-side billing/security boundary, not a UI feature.

21. What I would build as the final Company Intelligence architecture

This is the target.

                         COMPANY INTELLIGENCE
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
             COMPANY RESOLVER              SEARCH / COMMAND
                    │                           │
             CIK / ticker / name          "What changed?"
                    │                           │
                    └─────────────┬─────────────┘
                                  │
                         COMPANY KNOWLEDGE GRAPH
                                  │
       ┌──────────────┬──────────┼──────────┬──────────────┐
       │              │          │          │              │
     FILINGS        FACTS     TRANSCRIPTS  NEWS       MARKET DATA
       │              │          │          │              │
     10-K            XBRL       CEO/CFO    Events       Price
     10-Q            Facts      Q&A        Releases     Valuation
     8-K             Periods               News         Estimates
       │              │
       └──────────────┴──────────────┐
                                     │
                             EVIDENCE GRAPH
                                     │
                     claim ↔ fact ↔ filing ↔ page
                                     │
                  ┌──────────────────┴──────────────────┐
                  │                                     │
             DETERMINISTIC                         AI RESEARCH
             ANALYTICS                             SYNTHESIS
                  │                                     │
        growth / margins / FCF                 thesis / risks
        valuation / estimates                  catalysts / changes
        guidance vs actual                     management signals
        peer comparison                        Q&A intelligence
                  │                                     │
                  └──────────────────┬──────────────────┘
                                     │
                              COMPANY TEARSHEET
22. The final UI I would target
Header
NVIDIA CORPORATION                                      NVDA
Semiconductors · Technology

$183.21   +2.41%       Market Cap $4.4T

[Ask Company] [Latest Filing] [Latest Earnings] [Compare]
Immediate analyst summary
┌──────────────────────────────────────────────────────────┐
│ AI INVESTMENT SNAPSHOT                                   │
│                                                          │
│ NVIDIA's growth remains driven by Data Center demand,   │
│ while margin expansion and Blackwell adoption... [1][2] │
│                                                          │
│ BULL CASE                         RISKS                   │
│ • AI infrastructure demand       • China restrictions   │
│ • Blackwell ramp                 • Customer concentration│
│ • Margin leverage                • Supply constraints    │
└──────────────────────────────────────────────────────────┘
What changed
WHAT CHANGED SINCE LAST QUARTER

Revenue             +12.4%      ↑
Gross Margin        +80 bps     ↑
FCF                 +21.1%      ↑
Guidance             Raised     ↑
China commentary     More risk   ↓

[View evidence]
Financials
Revenue
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FY22  FY23  FY24  FY25  FY26E

$27B  $27B  $60B  $130B $...
       ↑ exact filing evidence
Expectations
STREET ESTIMATES

FY26 Revenue      $...
FY27 Revenue      $...

Estimate revisions
██████████ ↑ 8%
Earnings
LATEST EARNINGS CALL

CEO highlights
CFO highlights
Analyst Q&A
New language
Changed language

[Ask this call]
Filings
10-K   FY2025   Feb 21, 2026
10-Q   Q1 2026  May 28, 2026
10-Q   Q2 2026  Aug 27, 2026

[Read] [Ask] [Evidence]
Peers
                 NVDA    AMD    AVGO
Revenue growth    ...     ...    ...
Gross margin      ...     ...    ...
FCF margin        ...     ...    ...
P/E               ...     ...    ...
23. Your priority order

Do not spend the next iteration polishing gradients, icons, or animations.

I would execute in this exact order:

Phase 1 — Trust / correctness
Canonical financial fact model
Exact period semantics
Exact units/scales
Fix YoY
Fix CAGR
Remove arbitrary RatioEngine fallback
Deterministic restatement/amendment selection
Filing accession/source attached to every fact
Exact SEC evidence links
Separate reported / derived / estimate / guidance facts
Phase 2 — Company intelligence
What Changed engine
Guidance vs Actuals
Earnings/transcript intelligence
Estimate revisions
Catalyst/risk timeline
Dynamic peer analytics
Valuation history
Segment intelligence
Phase 3 — AI
Structured investment thesis
Claim → evidence binding
Citation → exact filing/page
Ask-the-company agent
Ask-the-filing agent
Contradiction detection
Management language change detection
Phase 4 — UX
Command-center search
Professional company header
Information hierarchy
Evidence drawer
Financial chart redesign
Filing reader
Responsive/mobile
Keyboard navigation
Phase 5 — production
LLM authentication/entitlements
Internal key removal
WS/proxy boundary
Cost controls
observability
latency budgets
independent analyst benchmark
24. Most important conclusion

You do not need to throw away Company Intelligence.

The current branch already has several good foundations:

server-side company resolution
SEC fallback
explicit failure states
exact-XBRL population
filing coverage beyond the local corpus
background AI jobs
per-cell AI progress
sentiment abstention semantics
filing deduplication
parallel trend fetching

Those are real improvements.

But the remaining gap is fundamental:

AlphaGravity currently behaves like a collection of company widgets. A world-class product needs to behave like a coherent financial knowledge system.

Fintool's public company pages are a useful benchmark here: they combine company reports with earnings, guidance updates, transcripts, categorized events and an AI agent that can answer questions over the company corpus.

Your next major milestone should therefore be:

Company Intelligence V2 — Evidence-First Institutional Company Page

Not “make the page prettier.”

Make every financial fact correct, period-safe, source-addressable, and connected to an analyst workflow.

That is the path from the current ~6/10 to 9+/10 world-class.