# Company Intelligence V2 — Evidence-First

Branch: `feat/web-research-sec-integration`. Follows COMPANY_FIX_ROADMAP.md (23 rows, closed).

Source: an external audit (`companyfix -v2.md`). **Every P0 below was verified against
the source before it was written down** — the audit was right on all of them, and two
are mine: CF-21 widened V2-1, and CF-20 fixed metric substitution in `company_skill`
while walking past the identical bug in `longitudinal_tracker` (V2-2).

Ordering principle, unchanged: **fix what makes the feature lie before what makes it
slow, and before what makes it richer.** A wrong number with a confident unit is worse
than a missing one.

## Phase A — correctness and trust (defects, all verified)

| # | Task | Gate (binary) | Status |
|---|------|---------------|--------|
| V2-1 | A chart renders the unit the server sent | `OverviewTab.tsx:61,63` hardcode `` `$${(v/1e9).toFixed(0)}B` ``, so every series is drawn as USD billions. CF-21 made this worse: the card now renders net income, operating income — and would render a margin or EPS as `$0.00B`. The server already returns `unit`. Gate: one `formatFinancialValue(value, unit, metric)` used by axis, tooltip and label; a `%` series renders `45.0%`, an EPS series `$7.46`, a USD series `$391.04B`; asserted per unit type. | DONE |
| V2-2 | A metric is never substituted by position | `longitudinal_tracker.py:481` does `next(iter(output.ratios.values()))` and returns it as the requested metric — asking for revenue can return gross margin. Identical in kind to CF-20, which was fixed only in `company_skill`. Gate: the RatioEngine path returns a value only when the returned key IS the requested metric; a mismatch returns absent with a stated reason; asserted with a stub returning the wrong key. | DONE |
| V2-3 | YoY compares to the right period | `_compute_changes` is documented "(4-period lag)" and does `points[i-4]` — correct for quarterly, wrong for the annual FY series this page requests. FY2024's YoY currently points at FY2020. Gate: for an annual series YoY compares consecutive fiscal years; for a quarterly series it compares the same quarter a year earlier; the lag is derived from the period labels, not the array index. | DONE |
| V2-4 | CAGR uses elapsed years, not row count | `n_years = len(values) / 4  # assuming quarterly data`. Eight annual points span ~7 years; this calls it 2, inflating CAGR roughly 3.5x. Gate: CAGR over FY2019–FY2026 equals `(last/first)**(1/7)-1` within 1e-6, checked against a hand-computed value. | DONE |
| V2-5 | Period selection is semantic, not lexical | `LatestQuarterCard.tsx:36` sorts period strings and takes the top two, so a mixed set can compare `Q4 2025` against `FY2025` and print a meaningless delta. Gate: annual, quarterly and TTM are separated before comparison; a mixed set never produces a cross-basis delta; asserted with a deliberately mixed fixture. | DONE |
| V2-6 | `/api/llm/chat` is not an open spend endpoint | The route takes caller-supplied `provider`, `model`, `prompt`, `max_tokens` and invokes server-side provider credentials with **no inbound auth at all** (the only `Authorization` in the file, line 452, is the outbound provider header). Anyone who can reach market-server can spend your credits and choose the model. Gate: an unauthenticated request is refused; an authenticated one is metered per viewer like `/api/gravity/search`; `max_tokens` is capped server-side. | DONE |
| V2-7 | An internal key is subject to entitlements | CF-12 metered the **proxy**, which was the option chosen — but `auth.py:99` still grants `deep-research-internal` and `eval-unlimited-fb-2026` `tier: unlimited` while deliberately skipping `_apply_entitlement`. Any caller reaching gravity-api directly with that string still bypasses billing. The audit is correct that CF-12 is narrower than its title. Gate: a request carrying an internal key resolves a stated tier and rate limit, or the key is scoped to named service routes only. **Owner chose the finite service tier over route scoping, 2026-09-11.** | DONE |
| V2-8 | Every figure names the filing it came from | `GravityMetric.document_id` holds `xbrl:<TICKER>`, not a filing identity, so `DataTab` renders the null marker for source on every row. Gate: each fact carries form, filing date, accession and period; clicking a figure opens that filing; a fact that genuinely has no single filing says so rather than rendering a bare dash. | DONE |

## Phase B — analyst product (features, scope before gating)

Not defects. Each needs its own gate written when it is picked up; listed so the
direction is recorded rather than rediscovered.

- **What Changed** — quarter-over-quarter deltas with evidence links. The audit's
  strongest product point: the page shows facts but never says what moved.
- **Guidance vs actuals** — `GuidanceActualsTracker` exists and reads
  `consensus_estimates`, a table that does not exist. Needs a source before a surface.
- **Transcript intelligence** — CEO/CFO/Q&A split, changed language. Needs a vendor;
  SEC does not publish transcripts.
- **Estimate revisions** — needs a consensus data source.
- **Dynamic peers** — replace the hardcoded 68-ticker list with sector/size derivation.
- **Filing UX** — form, fiscal period, accession, amendment, read/ask/evidence actions.
- **Command-center search** — the entry form as a launcher, not a text input.

## Stop conditions

- **Target** — every Phase A gate green, each verified by running it.
- **Budget** — 20 iterations.
- **Stall** — 3 ticks with no row flipping and no new failure mode named.

## Escalation — halt and ask

- Any deploy, push to `main`, key rotation, or spend (a consensus/transcript vendor
  is a purchase, not a task).
- V2-7's resolution: scoping or revoking the internal key breaks the eval harnesses
  that use it. Grep the consumers and report before changing what it grants.
- Any gate that cannot be verified this iteration.

## Gate integrity

Gates may grow, never shrink. Before any commit claiming a row green:

```bash
node ~/.claude/scripts/gate-guard.mjs
```

Strip comments before any source-shape assertion — three gates in the previous
ledger matched their own explanatory text describing the thing they forbid.
