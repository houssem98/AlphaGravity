# REPORT_QA_SPEC.md — Make Deep Research Reports World-Class

**For:** Claude Code, working on the Gravity deep-research report pipeline
**Derived from:** audit of the 2026-07-10 report *"Thematic Research: BlackRock, Vanguard, State Street — Q4 2024 / FY2025 outlook"* (31pp, Producer: react-pdf)
**How to use:** drop this file in the repo root. Work through **P0 → P1 → P2** in order. Every item has a Bug (evidence from the shipped report), a Fix, and Acceptance criteria. Do not mark an item done until its acceptance criteria pass and its regression test (Section 4) is green.

**Core principle:** the pipeline already *measures* quality (grounding %, mis-attribution count, staleness, Revisor flags) but never *enforces* it. The fix is not better prose — it is wiring the verifier into publication, adding entity/time discipline to every numeric claim, and putting the renderer under automated QA.

---

## Pipeline components referenced (names from the report's own Methodology page)

- **Query intake** — title/subtitle generation
- **Contextual Retrieval** (web search) + **Gravity RAG** (internal filings/transcripts corpus)
- **Reader/Extractor** (per-source fact extraction)
- **Section fanout writer** (10 sections written concurrently, Gemini)
- **Grounding verifier** (numeric claim → source matching)
- **Citation attribution (NLI-lite)** (cited sentence → specific source check)
- **Revisor** (self-revision / surgical edits)
- **Renderer** (react-pdf)

---

# P0 — CREDIBILITY KILLERS (block release until all pass)

## P0-1 — Query/title hygiene

**Bug:** the raw user query `ai in asset managment` (typo, lowercase) was rendered verbatim as the cover subtitle of the finished report.

**Fix:**
- Never render the raw query. Add a normalization step at intake: spellcheck → title-case → LLM rewrite into a display subtitle (e.g., "AI in Asset Management").
- Keep the raw query in metadata/logs only.

**Acceptance:**
- Cover subtitle passes a spellcheck pass in CI.
- Snapshot test: input `ai in asset managment` → cover renders `AI in Asset Management`.

---

## P0-2 — Temporal sanity layer

**Bugs (all in one report dated July 10, 2026):**
- Title and trade theses framed as **"FY2025 outlook"** with price targets built on *"our FY2025 EPS estimate"* — you cannot "estimate" a fiscal year that has already ended.
- Trade table claims *"Prices as of market close June 1, 2026"* while the pipeline's own telemetry says **166/166 web sources are stale (>1y), archival (>3y), or undated** — those prices cannot have come from those sources. The price-date string is fabricated provenance.
- Leads with Q4 2024 earnings prints as current (18 months stale at publication; Q1 2026 was out, Q2 2026 imminent).
- Presents JPMorgan's LOXM as a live AI edge — the citation is a **2017** Business Insider article.
- Presents Goldman's Marcus as a growth vector for "credit underwriting and customer acquisition" — GS largely exited consumer lending in 2023–24.

**Fix:**
1. Thread `report_date` through every stage. Every extracted fact gets an `as_of` date (source publication date or period the fact refers to).
2. **Fiscal-period resolver:** if `report_date` > end of period P, the pipeline must not emit "estimate"/"outlook"/"forecast" language for P. Auto-shift the outlook window forward (July 2026 report → FY2026/FY2027 outlook) and reframe elapsed periods as reported results.
3. **Freshness budgets per claim type** (fail → drop the claim or badge it stale):
   - Market prices / entry levels: `< 24h`, and only from a live quote API. If no live feed, omit entry/target price columns entirely — never print a price date string that isn't tool-sourced.
   - Earnings/financials: latest reported quarter for the entity, else label the vintage explicitly ("as of Q4 2024").
   - Strategic/product facts: `< 18 months`, else the writer must frame them as historical ("launched in 2017", "before its 2023 consumer retreat").
4. Recency-weight the Contextual Retrieval queries (append current year, penalize undated pages). The date extractor currently dates **0/166** sources — that is a Reader bug, not a property of the web; debug it (look for `<meta>` dates, JSON-LD `datePublished`, URL date patterns).

**Acceptance:**
- Temporal linter over final draft: zero "outlook/estimate/forecast" references to elapsed fiscal periods; zero price/date strings without tool provenance.
- ≥ 60% of web sources successfully dated after the Reader fix.

---

## P0-3 — Entity-attribution gate (kills entity swaps and RAG mismatch)

**Bugs:**
- **Entity swap:** Trade Expressions credits *Goldman Sachs* with *"Q4 2024 EPS of $2.22, beating consensus by $0.52"* — those are **Morgan Stanley's** prints, which the same report correctly attributes to MS twice earlier. (GS quarterly EPS runs ~$11–12; $2.22 is off by 5×.)
- **RAG mis-mapping:** Aladdin revenue cited to `[RAG-6]` = an **Ares Management** document; JPMorgan claims cited to `[RAG-2]` = a **Bank of America** earnings transcript; the entire State Street "Underperform" thesis rests (twice) on `[RAG-5]` = **PAYX 10-K Item 9C** (foreign-jurisdiction inspection boilerplate — a section that structurally cannot contain executive-departure information).
- **Metric conflation:** Medallion's "capacity capped at approximately $106 billion" conflates firm-wide regulatory AUM with the fund's famous ~$10–15B cap; JPM's $29.8B Markets revenue placed under the "asset and wealth management division" (it sits in the CIB); NVDA "Q4 FY2025 data center revenue of $35.6B, up 112%" mixes Q4's revenue with Q3's growth rate.

**Fix:**
1. Every numeric claim becomes a structured tuple **before** it can appear in prose:
   ```ts
   type NumericClaim = {
     entity: string;        // canonical ticker/name, e.g. "MS"
     metric: string;        // from a controlled ontology: eps, revenue, aum, margin, ...
     period: string;        // "Q4-2024", "FY2025", "2024"
     value: number;
     unit: string;          // usd_b, pct, x, bps
     source_id: string;     // canonical citation id
     as_of: string;         // ISO date
   }
   ```
2. Extend the existing **NLI-lite attribution** with a hard entity check: `claim.entity` must match the entity tag of the cited source passage (Gravity RAG passages are already entity-tagged — MRSH/BAC/PAYX/ARES tags exist in the reference list). Mismatch → reject the citation and quarantine the claim.
3. **Duplicate-attribution detector:** same `(metric, period, value)` attributed to two different entities in one report — flag both for review (this alone catches the GS/MS $0.52 swap).
4. **Metric/segment ontology check:** e.g., `markets_revenue` cannot bind to an `AWM` segment; `fund_capacity` → `firm_aum`.

**Acceptance:**
- Publication requires `mis_attributed_citations == 0` (the shipped report logged 8 and published anyway).
- Regression tests 3–5 in Section 4 pass.

---

## P0-4 — Publication gates wired to verifier telemetry

**Bug:** the verifier found **26 ungrounded numbers**, **8 mis-attributed citations**, **72% citation density**, **100% stale sources**, and the Revisor applied **0/15** fixes — and the report still shipped as confident, unhedged sell-side prose with price targets and stop-losses. Confidence ("Medium") appears only on page 27; the cover says "CONFIDENTIAL" and the exec summary hedges nothing. The telemetry is decorative.

**Fix — hard gates (config-driven thresholds):**

| Gate | Threshold | On fail |
|---|---|---|
| Mis-attributed citations | == 0 | Block render |
| Ungrounded numbers in body | == 0 unbadged | Inline-badge `⚠ unverified` or cut the number — appendix-only disclosure is not enough |
| Citation density (factual sentences) | ≥ 90% | Uncited factual sentences get an inline `analyst inference` tag or are rewritten |
| Stale-source ratio | ≤ 40% (tune) | Confidence auto-drops to **Low** |
| Revisor edits | if flags > 0 and accepted == 0 | Block render, alert (component failure) |

- Confidence must render **on the cover and at the top of the Executive Summary** (badge + one-line reason), not only in the back pages.
- The Limitations section must list **all** flagged items or an explicit count ("…and 20 more") — the shipped report claims 26 unsupported numbers and silently lists 6.

**Acceptance:** a draft violating any gate cannot produce a PDF labeled Medium/High confidence; the confidence badge appears on cover + exec summary.

---

## P0-5 — Compliance lint

**Bugs:**
- Trade table footer reads ***"Source: Goldman Sachs Research estimates"*** — a fabricated third-party attribution on AI-generated price targets. This is a regulatory hazard, not a typo.
- "CONFIDENTIAL" stamped on a report built entirely from public web sources.
- Explicit price targets + stop-losses sit next to a "does not provide financial advice" disclaimer with no framing.

**Fix:**
- Pre-render lint with a banned-pattern list: any `"<third-party firm> Research estimates"` / `"per <bank> research"` attribution fails the build. Standardize the table source line to: `Source: Market Intelligence AI estimates; company filings; cited sources.`
- Put the CONFIDENTIAL stamp behind a config flag, default off.
- Add a standard framing line above any trade table ("Illustrative expressions, not investment advice; see disclaimer") and ensure the disclaimer language matches what the report actually contains.

**Acceptance:** the exact string from the shipped report fails CI; no third-party research attributions in output.

---

## P0-6 — Citation rendering (visually confirmed broken)

**Bugs:**
- Web-source citation markers were **stripped at render**, leaving orphaned gaps before punctuation on nearly every page: `44.5% .` / `0.06% ,` — while `[RAG-5]`-style brackets *do* render in prose and tables use `[6]`/`[12]`. Three citation regimes in one document, no key.
- `RAG-n` numbering does not map to the reference list (RAG-5 = reference #55).
- Internal pipeline tag **`[TIER 2b]`** leaked into a body paragraph.

**Fix:**
1. **One canonical citation ID space.** Merge RAG sources into the main 1–N numbering; kill the `[RAG-n]` scheme in prose (keep source type as metadata shown in References).
2. Simplest robust render: **unify on bracketed `[n]` citations everywhere** (react-pdf has no native superscript; nested small-font `<Text>` baselines are fiddly — brackets match the tables and always survive rendering). If superscripts are a hard design requirement, build a tested `<Sup>` component and snapshot-test it.
3. Strip all internal tags (`[TIER 2b]`, tier/debug markers) before the writer output reaches the renderer; regex allowlist on bracket contents (digits only).
4. **Post-render QA:** run `pdftotext` on the output; fail the build if `/\s[.,;]/` orphans are found or if any `[n]` doesn't resolve to a References entry.

**Acceptance:** extracted text has zero space-before-punctuation orphans; every bracket ID resolves; no `TIER`/debug tokens in output.

---

## P0-7 — Renderer structural bugs

**Bugs (all visually confirmed):**
- **Page 3 is a broken duplicate:** literal `##` markdown rendered on-page, exec summary truncated mid-sentence (*"…the primary determinant of"*), then the full summary repeats on page 4. The summary-card component takes a fixed char-slice and re-renders the same stat row from the cover.
- **Trade table is unusable:** header cells render literal `**- EXPRESSION**` asterisks (markdown table passed through un-parsed); columns crushed to one word per line; the MSFT row splits across the page break mid-cell.
- Winners/Losers table splits the State Street row across pages mid-cell.
- References #35/#36 numbering collides into one line; URLs truncate without ellipsis.
- Methodology contains a garbled string: `compressed 10/256 ' 4/195 chars` (broken arrow glyph + wrong counters).

**Fix:**
1. **Markdown → AST → typed components.** Never regex-strip or char-slice model output. Parse with a proper MD parser; unhandled node types fail loudly in dev.
2. Table component: parse MD tables into a `<Table>` with `wrap={false}` on rows + `minPresenceAhead` so a row never splits across pages; column widths by content class (ticker/direction narrow, thesis wide); long-cell text wraps by word with a min column width.
3. Exec-summary card: render the LLM-generated **abstract** (2–3 complete sentences, generated as its own field), not a truncated slice of section 1; or delete the page-3 card entirely — one exec summary per report.
4. Escape test: any literal `#`, `**`, `__` reaching the text layer fails CI.
5. Fix the telemetry formatter (proper `→` glyph, correct counters) and add "+N more" truncation to all capped lists.

**Acceptance:** snapshot tests for cover, TOC, summary card, both tables, references; no markdown literals in `pdftotext` output; no table row spans a page break.

---

# P1 — QUALITY

## P1-1 — Retrieval scope guard (coverage universe × corpus)

**Bug:** coverage universe = BlackRock / Vanguard / State Street, but the 6 Gravity RAG passages retrieved were **MRSH, BAC ×3, PAYX, ARES — zero coverage overlap**. The writer then force-fit analogies (Mercer risk factors as the bear-case keystone; PAYX as State Street evidence) instead of admitting the gap.

**Fix:**
- Post-retrieval coverage check: for each coverage entity, does the RAG corpus contain ≥1 primary doc? If not: (a) auto-fetch from EDGAR full-text (10-K/10-Q/8-K/transcripts are free) into the corpus for this run, or (b) insert an explicit disclosure: *"No internal documents available for <entity>; analysis relies on web sources."*
- Analog usage must be labeled inline: *"analog: Mercer's risk factors (MMC 10-K) as a proxy for asset-servicer risk"* — never presented as direct evidence about the coverage entity.

**Acceptance:** regression test 11 passes; no unlabeled cross-entity analogies survive the entity gate (P0-3 enforces the hard part).

## P1-2 — Source quality tiering

**Bug:** an Instagram reel, a Reddit thread, a YouTube video, LinkedIn posts, and SEO market-report farms sit in the citable set with the same standing as 10-Ks — and the $8–12B market-size figure leans on the SEO farms.

**Fix:**
- Tier map: **T1** = EDGAR/regulators/IR pages/earnings transcripts; **T2** = quality press (Bloomberg, FT, Reuters, WSJ, CNBC…); **T3** = social/SEO/aggregators.
- T3 may never support a numeric claim (color/quotes only, clearly attributed). Market-size numbers require T1/T2 or bottom-up shown work.
- Prefer-primary re-ranking in Contextual Retrieval.

**Acceptance:** regression test 12 passes; References section shows tier per source.

## P1-3 — Fix the Revisor

**Bug:** `Self-revision: reviewer examined 15 flagged issues but produced no accepted surgical edits — original draft retained.` A component that flags 15 and fixes 0 is dead weight — likely the edit-diff application or the acceptance threshold is broken.

**Fix:** log a rejection reason per proposed edit; build a test harness with a known-bad draft (use this report's section 9) and assert edits apply; if `flags > 0 && accepted == 0`, treat as component failure (see P0-4 gate).

## P1-4 — Scope adherence

**Bug:** the title promises three firms; State Street gets ~2 thin paragraphs, half the report covers JPM/GS/MS/quants, and **3 of 6 trade expressions are MSFT/NVDA/GOOGL** — outside the universe, with numbers the pipeline's own verifier flagged as ungrounded.

**Fix:** generate a coverage plan at intake (min share of analysis per named entity); adjacent entities allowed but labeled ("ecosystem read-throughs"); trade expressions restricted to the coverage universe unless explicitly sectioned as *"Adjacent expressions"* — and those still pass all P0 gates.

## P1-5 — Shown work for estimates

**Bug:** invented precision with zero method throughout: "$400–600M Aladdin ACV uplift," "300–500bps cost hit for quants," "50–80bps dual-compliance margin drag," "AI strategies = 15–20% of top-20 AUM."

**Fix:** every "we estimate" must carry a one-line method footnote (inputs + arithmetic) or be tagged `illustrative`. Maintain an estimate registry rendered in the appendix (estimate → basis → sensitivity).

## P1-6 — Telemetry consistency

**Bugs:** cover claims "172 sources" but only **52 of 80 dispatched Readers succeeded** (28 returned nothing) — effective evidence base = 52; Methodology says **"0 SEC filings"** while the References are full of sec.gov 10-Ks (type classifier bug); "166/166 undated" contradicts the ">1y / >3y" staleness classes; cited-sentence counters disagree (92 vs 159/167).

**Fix:** single source of truth for counters; report *"sources contributing facts"* alongside *"sources analyzed"*; classify `sec.gov/Archives/edgar` URLs as SEC filings; reconcile the citation counters.

**Acceptance:** cover stats = methodology stats = actual reference count, mechanically derived from one struct.

---

# P2 — WORLD-CLASS POLISH

1. **Auto-exhibits.** The report is 31 pages with zero charts; institutional notes are exhibit-led. Generate 3–5 per report from the `NumericClaim` store: revenue/AUM trend bar, coverage comp table, scenario tree (bull/base/bear targets), price-target upside chart. Render as SVG–PNG embedded in react-pdf; every exhibit cites its claims.
2. **Confidence surfaced properly.** Cover badge + exec-summary banner (from P0-4) plus per-section confidence chips (grounding % per section is already computable from the fanout).
3. **Trade table upgrades.** Pairs/shorts for named losers (report calls STT "Underperform" but offers no short — e.g., Long BLK / Short STT); add a catalysts column; live-price sanity check on entry levels (entry must be within ±10% of live quote or the row is flagged).
4. **Narrative consistency check.** Vanguard's 0.06% ER is used simultaneously as loser-evidence, a competitive weapon, and an automation win, never reconciled. Add a cross-section contradiction pass (same fact, opposing valence — force one reconciliation sentence).
5. **De-duplicate and de-fill.** Kill the mid-report "Web Sources" dump inside section 10 (duplicates References). The "Key Finding" callout currently re-quotes exec-summary sentence 3 verbatim — select the highest-information grounded claim not already in the summary.
6. **Relevance scorer per paragraph.** Catches orphan facts like the random "ECB EUR/USD 1.1518" line inside the regulatory section.
7. **Branding/config.** "Powered by Gemini" behind a whitelabel flag; timestamp with timezone; consistent fiscal-frame labels (the report whiplashes between "Q4 2024" and "Q4 FY2025" data with no vintage markers — every financial figure gets its period label from the claim tuple).

---

# 3. SELF-IMPROVEMENT HARNESS (Section 7: Loop → World-Class)

**Purpose:** Before publishing a report, auto-loop performDeepResearch until judge scores all ≥7/10 across 4 dimensions, OR exhaust budget.

**When to use:**
- All P0 gates pass (credibility okay)
- Report scores < 7 on any dimension (comprehensiveness, insight, instruction_following, readability)
- Automated retry with feedback loop instead of manual re-write

**How it works:**

1. **Iteration 1:** Run performDeepResearch on the query, judge-score the report (DeepSeek).
2. **Score check:** If min(comprehensiveness, insight, instruction_following, readability) ≥ 7, PASS. Else continue.
3. **Iteration 2+:** Extract judge rationales (what's missing), append to query as feedback context, re-run performDeepResearch, judge again.
4. **Loop termination:**
   - **Pass:** min score ≥ 7 (select this iteration's report as winner)
   - **Fail:** max iterations exhausted (default 3) — select best iteration by avg score, publish with **Low confidence** badge (P0-4)

**Loop structure (from `selfImprovementHarness.ts`):**

```
for iter in 1..maxIter:
  if iter > 1:
    queryWithFeedback = query + "\n--- FEEDBACK FROM PRIOR ITERATIONS ---\n" + priorRationales
  else:
    queryWithFeedback = query
  
  report = performDeepResearch(queryWithFeedback, model)
  judge = judgeCall(report)  // 4 scores + rationales
  citationSpot = citationCheck(report.citations)  // plausibility verdicts
  
  if min(judge.scores) >= minScoreThreshold:
    return report  // PASS
  
  if citationSpot.dubious > 2:
    feedback += "prioritize peer-reviewed sources"

return bestByAvgScore(allIterations)  // FAIL: publish with Low confidence
```

**Feedback per iteration:**

Appended to query for next iteration:

```
--- FEEDBACK FROM PRIOR ITERATIONS ---
Iteration 1 (avg=6.75, min=6.0):
  - comprehensiveness: Missing forward guidance and capex implications
  - insight: Competitive benchmarking vs AMD lacking
  - instruction_following: Focused on FY2026 but lacks multi-year context
  - readability: Well-structured but tables truncated
  ⚠ 3 dubious citations — prioritize peer-reviewed sources.
```

**Usage:**

```bash
# Set up market-server locally
npm -w market-server run dev  # :3002

# Run loop in another terminal
bash LOOP_SELF_IMPROVE.sh "Nvidia data center revenue growth and key risks FY2026" deepseek-chat

# or directly via npm
cd apps/market-ui
LOOP_QUERY="..." LOOP_MODEL="deepseek-chat" npm run eval:loop
```

**Output:**

Writes `loop-out/YYYYMMDD-HHMMSS.json`:

```json
{
  "query": "...",
  "model": "deepseek-chat",
  "iterations": [
    { "iteration": 1, "ok": true, "wallMs": 35000, "judge": { "comprehensiveness": 7, "insight": 6, ... }, ... },
    { "iteration": 2, "ok": true, "wallMs": 38000, "judge": { "comprehensiveness": 8, "insight": 8, ... }, ... }
  ],
  "winner": { /* iteration 2 */ },
  "summary": {
    "passedOnIter": 2,
    "bestAvgScore": 8.0,
    "reason": "Passed on iteration 2",
    "totalWallMs": 73000,
    "totalCost": 0.20
  }
}
```

Plus `loop-winner-TIMESTAMP.md` with the winning report markdown.

**Cost & timing:**

- Per iteration: ~$0.10 (performDeepResearch ~$0.08 + judge call ~$0.02)
- Per loop: ~$0.30 (3 iterations × $0.10)
- Wall time: ~35s + 35s + 35s = ~2 min total
- Max budget: override `LOOP_MAX_ITER=2` to cap cost at $0.20

**Judge criteria (from `rubric.ts`):**

- **Comprehensiveness (1–10):** Major angles (financials, competition, risks, catalysts, quantified). Competent = 5–7. Exceptional = 9–10.
- **Insight (1–10):** Non-obvious analysis; mispricings, second-order effects, contrarian checks. Generic summary = 3–4.
- **Instruction-following (1–10):** Answers the specific request (entities, timeframe, focus), not a boilerplate report.
- **Readability (1–10):** Structure, tables, scannable, no filler.

**Citation spot-check (title-level plausibility only):**

Samples up to 10 cited sentences; judge scores each as "plausible" | "dubious" | "unresolved". If dubious > 2, feedback for next iteration includes a warning to prioritize peer-reviewed/institutional sources.

**Config:**

```bash
LOOP_QUERY=<string>                # Required
LOOP_MODEL=deepseek-chat           # Default
LOOP_MAX_ITER=3                    # Default; cost = $0.10 × iter
LOOP_MIN_SCORE=7.0                 # Default; adjust for quality bar (e.g., 8.0 for stricter gate)
VITE_API_URL=http://localhost:3002 # market-server endpoint
```

**Files:**

- `LOOP_SELF_IMPROVE.sh` — entry point shell script
- `apps/market-ui/eval/loopSelfImprove.test.ts` — Vitest harness
- `apps/market-ui/src/services/selfImprovementHarness.ts` — loop logic
- `LOOP_PROMPT.md` — feedback injection doc

**Integration with pipeline (IMPLEMENTED 2026-07-11, QA-17):**

`maybeRunQualityLoop(report, query, model)` wraps every SearchPage research run (both direct-pipeline and research-graph paths) — AFTER performDeepResearch, BEFORE the report reaches state/render/PDF. The already-produced report is judged as iteration 1 (no wasted regeneration); below the bar → feedback re-runs up to maxIter; winner ships. Never passed → `metadata.confidence = 'Low'`. Outcome recorded in `metadata.qualityLoop`.

```bash
VITE_DR_QUALITY_LOOP=true            # off by default — each extra iteration ≈ $0.10 + ~35s
VITE_DR_QUALITY_LOOP_MAX_ITER=2      # produced report counts as iteration 1
VITE_DR_QUALITY_LOOP_MIN_SCORE=7
```

---

# 4. REGRESSION TEST SUITE (all derived from real failures in the shipped report)

| # | Input / condition | Must |
|---|---|---|
| 1 | Query `ai in asset managment` | Cover renders `AI in Asset Management`; spellcheck passes |
| 2 | `report_date=2026-07-10`, draft contains "our FY2025 EPS estimate" | Temporal linter fails the draft |
| 3 | Claim `{GS, eps, Q4-2024, 2.22}` cited to an MS-tagged source | Entity gate rejects |
| 4 | `(eps_beat, Q4-2024, 0.52)` attributed to both MS and GS | Duplicate-attribution detector flags |
| 5 | Claim about STT cited to PAYX Item 9C passage | Entity gate rejects |
| 6 | Rendered PDF text contains `44.5% .` | Orphan-punctuation scan fails build |
| 7 | Table row landing near page bottom | No mid-cell split (visual regression) |
| 8 | Draft contains `Source: Goldman Sachs Research estimates` | Compliance lint fails build |
| 9 | Writer output contains literal `## ` or `**` | Markdown-escape test fails |
| 10 | Body number absent from grounding index, unbadged | Publication gate fails |
| 11 | RAG corpus has zero docs for a coverage entity | EDGAR fetch triggered OR disclosure inserted |
| 12 | Numeric claim supported only by instagram.com/reddit.com URL | Tier gate rejects |
| 13 | `[RAG-5]` or any bracket ID with no matching References entry | Citation-resolution test fails |
| 14 | Price row without live-quote provenance | Row dropped or `stale` badge; no fabricated "as of" date |
| 15 | Limitations list capped below flagged count | Renders explicit `+N more` |
| 16 | Loop iteration 1 scores min=6.0 | Iteration 2 query includes feedback; re-run ≥7 for PASS |
| 17 | Loop max 3 iterations, all score <7 | Winner = highest avg score; report badge = Low confidence |
| 18 | Citation spot-check finds 5 dubious verdicts | Feedback includes "prioritize peer-reviewed sources" |

---

# 5. RELEASE CHECKLIST (Definition of Done — gate the render job on this)

- [ ] Cover/subtitle spellchecked and title-cased (P0-1)
- [ ] Temporal linter clean: no elapsed-period "estimates/outlook"; all figures carry period labels (P0-2)
- [ ] Entity gate: 0 mis-attributed citations; 0 duplicate attributions (P0-3)
- [ ] Ungrounded numbers: 0 unbadged in body; Limitations lists all with counts (P0-4)
- [ ] Confidence badge on cover + exec summary (P0-4)
- [ ] Compliance lint clean: no third-party research attributions (P0-5)
- [ ] Citation scan: no orphaned punctuation; single ID space; all brackets resolve (P0-6)
- [ ] Render QA: no markdown literals; no split table rows; no duplicate/truncated exec summary (P0-7)
- [ ] Coverage check: RAG gap disclosed or backfilled from EDGAR (P1-1)
- [ ] No T3 source supports a numeric claim (P1-2)
- [ ] Every "we estimate" has a method note or `illustrative` tag (P1-5)
- [ ] Cover stats == methodology stats == references count (P1-6)
- [ ] ≥ 3 exhibits rendered and cited (P2-1)
- [ ] Self-improvement loop: report passed loop with min score ≥ 7, OR published with Low confidence badge (Section 3)

---

# 6. SUGGESTED ORDER

- **Sprint 1 (P0):** P0-3 entity gate + P0-4 publication gates first (they neutralize the worst hallucinations even before render fixes), then P0-6/P0-7 renderer + citation QA, then P0-1/P0-2/P0-5 linters.
- **Sprint 2 (P1):** retrieval scope guard + tiering + Revisor debug + telemetry reconciliation.
- **Sprint 3 (Section 3 — Loop):** wire self-improvement harness into pre-render pipeline; test with known-bad drafts from production reports.
- **Sprint 4 (P2):** exhibits, confidence UX, trade-table upgrades, consistency/relevance passes, whitelabel config.

**Notes for implementation:**
- Renderer is react-pdf (per PDF metadata): use `wrap={false}` + `minPresenceAhead` for row keep-together; prefer bracketed `[n]` citations over superscripts; output is currently untagged PDF 1.3 — tagged/accessible PDF is out of scope for react-pdf, don't chase it.
- The entity/metric/period tuple store built for P0-3 is the same structured-facts foundation the exhibits (P2-1) and live-price checks (P2-3) consume — build it once, reuse everywhere.
- Same zero-hallucination discipline as the audit agents: a claim without a verifiable source-entity match is not a finding, it's a liability.
- Loop harness (`selfImprovementHarness.ts`) is model-agnostic; judge is always DeepSeek (only live provider as of 2026-07-10). If other judge models become available, add them to `rubric.ts::buildJudgePrompt()` and make judge model configurable.
- Cost per loop: ~$0.10/iteration. For aggressive quality (minScore=8.0, maxIter=4), budget ~$0.40/report. For fast-track (minScore=7.0, maxIter=2), budget ~$0.20/report.

---

# 7. TASK LEDGER (execution state — the QA_LOOP works through this top-to-bottom)

Order follows Section 6. One task per loop iteration. A task flips to `[x]` only when its **Verify** command(s) pass and a Progress-log line with real numbers is appended to Section 8.

**Codebase anchors** (verified 2026-07-11): pipeline = `apps/market-ui/src/services/deepResearchService.ts` (4,866 lines; verifiers already exist: `verifyNumericConsistency`, `verifyEntailment` L3773, `verifyCitationDensity` L3125, `verifyFactInferenceSeparation` L3187, `deriveConfidence` L3584, `reviseReport` L3462, `buildLimitationsSection` L3870, final assembly L4531–4817). Renderer = `apps/market-ui/src/components/research/PdfDocument.tsx` (1,013 lines). Source scoring = `apps/market-ui/src/services/tavilyService.ts` (`classifyAuthority` L73, `classifyRecency` L108). RAG sources carry `ticker` tags (`gravitySearchService.ts::GravityRAGSource`). Eval = `apps/market-ui/eval/` (rubric.ts, drEval.test.ts). Loop harness = `apps/market-ui/src/services/selfImprovementHarness.ts` + `eval/loopSelfImprove.test.ts` (written, never run — `eval:loop` npm script does NOT exist yet).

**Environment constraints** (from repo memory, 2026-07-11): only DeepSeek + Firecrawl keys alive; Tavily quota-dead (432) → live end-to-end pipeline runs are BLOCKED; verify with unit tests + frozen fixtures, and defer live-run-only acceptance criteria with an explicit ledger note (house precedent: W2a). Loop-harness runs need market-server local on :3002 with DEV_AUTH_BYPASS=1. No new market-ui dependencies unless already in package.json — check before importing.

- [x] **QA-1 (P0-3)** Entity-attribution gate: new `apps/market-ui/src/services/reportQaGates.ts` — `extractNumericClaims(markdown, citations)` → NumericClaim tuples; entity check (claim ticker vs cited RAG source `ticker` / web source title tokens); duplicate-attribution detector (same metric+period+value, two entities). Wire result into report metadata as `entityGate`. **Verify:** regression tests 3, 4, 5 in `reportQaGates.test.ts` green; `npx tsc --noEmit` 0 errors in market-ui.
- [x] **QA-2 (P0-4)** Publication gates: `evaluatePublicationGates(metadata)` in reportQaGates.ts consuming EXISTING telemetry (verification, entailment, citationDensity, recency, revisions, entityGate) with the P0-4 threshold table; gate failures cap confidence (never Medium/High on violation) and prepend a confidence badge line to the exec summary in the final markdown; Limitations section lists full counts (`+N more`). **Verify:** regression tests 10, 15, 17 green; tsc 0.
- [x] **QA-3 (P0-6)** Citation ID space: merge RAG citations into the single 1–N numbering at assembly (kill `[RAG-n]` in prose — map during `assembleSectionedReport`/final markdown pass); strip internal tags (`[TIER …]`, debug markers) with a digits-only bracket allowlist; orphan-punctuation scan (`/\s[.,;]/`) + bracket-resolution check as a post-assembly QA function. **Verify:** regression tests 6, 13 green; tsc 0.
- [x] **QA-4 (P0-7)** Renderer: PdfDocument.tsx — MD tables parsed to `<Table>` rows with `wrap={false}` + `minPresenceAhead`; exec-summary card renders `report.summary` (complete sentences, no char-slice) or is removed; escape check — literal `##`/`**`/`__` reaching the text layer fails a unit test on the markdown→component transform. **Verify:** regression test 9 green + table/no-slice unit tests on the transform functions; tsc 0. (Test 7 mid-cell page-split is visual — verify by generating one PDF locally when possible, else ledger-note the deferral.)
- [x] **QA-5 (P0-1)** Title hygiene: display subtitle normalization at intake (title-case + typo cleanup via existing blueprint LLM call — the blueprint stage already rewrites the query; surface `displaySubtitle` from it); raw query only in metadata. **Verify:** regression test 1 green (deterministic fallback path: title-case transform); tsc 0.
- [x] **QA-6 (P0-2)** Temporal sanity: `lintTemporal(markdown, reportDate)` in reportQaGates.ts — flags "estimate/outlook/forecast" on elapsed fiscal periods, and price-date strings lacking tool provenance; recency-weight retrieval (append current year to blueprint search queries); date-extractor fallback (URL date patterns `/20\d{2}[/-]\d{2}/`, meta-date already in `publishedDate`). **Verify:** regression tests 2, 14 green; tsc 0. (≥60%-dated acceptance needs live Tavily — defer with ledger note.)
- [x] **QA-7 (P0-5)** Compliance lint: `lintCompliance(markdown)` — banned third-party-attribution patterns (`/<firm> Research estimates/`, `per <bank> research`); CONFIDENTIAL stamp behind config flag default-off in PdfDocument; framing line auto-inserted above trade-expression tables. **Verify:** regression test 8 green; tsc 0.
- [x] **QA-8 (P1-1)** Retrieval scope guard: post-RAG coverage check per blueprint ticker — zero RAG docs for a coverage entity → try `searchFilings` (secEdgarService) else inject the explicit disclosure line into evidence + Limitations. **Verify:** regression test 11 green (mock both branches); tsc 0.
- [x] **QA-9 (P1-2)** Source tiering: extend tavilyService with T3 social/SEO host list (instagram, reddit, youtube, linkedin, tiktok, medium, quora + SEO-farm patterns); `tierOf(url)` → T1/T2/T3; numeric-claim-supported-only-by-T3 → entity-gate reject; References render tier per source. **Verify:** regression test 12 green; tsc 0.
- [x] **QA-10 (P1-3)** Revisor debug: add per-edit rejection reason to `applyRevisionEdits`/`reviseReport` stats; known-bad-draft fixture test asserting ≥1 edit applies; `flags>0 && accepted==0` recorded as component failure feeding the QA-2 gate. **Verify:** new revisor harness test green; tsc 0.
- [x] **QA-11 (P1-4)** Scope adherence: coverage-plan share check (each blueprint entity ≥ min share of body mentions) + trade expressions restricted to coverage universe unless under an "Adjacent expressions" heading — lint in reportQaGates.ts, feeds Limitations. **Verify:** unit tests green; tsc 0.
- [x] **QA-12 (P1-5)** Estimate discipline: lint "we estimate/our estimate" sentences lacking a method footnote or `illustrative` tag; count feeds Limitations + QA-2 gate. **Verify:** unit test green; tsc 0.
- [x] **QA-13 (P1-6)** Telemetry consistency: one stats struct (derived from `report.metadata` + `citations.length`) feeds cover, methodology, and references counts; classify `sec.gov/Archives/edgar` URLs as SEC filings in the source-type counter; reconcile cited-sentence counters. **Verify:** unit test asserting cover==methodology==references counts from one struct; tsc 0.
- [x] **QA-14 (Section 3)** Loop wiring: add `eval:loop` script to `apps/market-ui/package.json` (`vitest run eval/loopSelfImprove.test.ts`); fix any compile errors in `selfImprovementHarness.ts` (duplicate import of deepResearchService, unused imports); regression tests 16/17/18 as unit tests with a mocked judge + mocked performDeepResearch; document that live loop runs stay blocked on Tavily. **Verify:** `npx vitest run eval/loopSelfImprove.test.ts` green (mocked); tsc 0.
- [x] **QA-15 (P2 cheap)** De-dup + config polish: Key Finding callout must not repeat an exec-summary sentence; kill any duplicate mid-report source dump; whitelabel flag for "Powered by" line. **Verify:** unit tests green; tsc 0.
- [x] **QA-16 (P2-1 stretch)** Auto-exhibits from the NumericClaim store (QA-1): 1–3 SVG exhibits (trend bar, comp table) embedded in PdfDocument, each citing its claims. **Verify:** exhibit-generation unit test green; tsc 0; skip if NumericClaim coverage in real fixtures is too thin — ledger-note honestly.

- [x] **QA-17 (Section 3 integration, follow-up)** Pre-render quality loop: `maybeRunQualityLoop` in selfImprovementHarness (env-gated VITE_DR_QUALITY_LOOP, initialReport = iteration 1), wired into SearchPage before setReport — covers PDF export path. **Verify:** 3 integration tests green (flag-off passthrough, pass-on-initial no regeneration, fail→feedback→Low); tsc 0.

- [x] **QA-18 (Design loop, follow-up)** Self-Improving Design Loop: `pdfDesigner.ts` — LLM design director reads the report and proposes a BOUNDED DesignSpec (tone, whitelisted accent, density, cover kicker, 2–3-sentence abstract, ≤2 VERBATIM-only pull quotes, exhibit titles); deterministic validator clamps everything + rejects non-verbatim quotes; LLM critic scores (hierarchy/tone_fit/scannability/restraint) → feedback → revise (maxIter 2, minScore 8); PdfDocument honors the spec; wired into `generatePdfBlob` before render, fail-safe to house default, `VITE_PDF_DESIGN_LOOP=false` to disable. **Verify:** 9 mocked tests green (verbatim enforcement, palette clamp, sanitization, feedback revision, best-of-budget, LLM-dead fallback); tsc 0.

- [x] **QA-19 (Design loop: tables + graphics, follow-up)** Table design in the loop: `tableDesign` (headerAccent / zebra / ≤2 highlightColumns matched by header name) + deterministic `computeColumnFlex` content-class column widths (P0-7: ticker narrow, thesis wide) applied to every rendered table. Graphic design in the loop: `exhibitStyle` monochrome-vs-categorical bars + `exhibitPick` LLM selection/ordering of which exhibits ship (bounds-checked, ≤3). **Verify:** 13/13 designer tests green; tsc 0.

- [x] **QA-20 (Post-render QA, follow-up)** P0-6 fix 4 at the OUTPUT layer: `pdfPostRenderQa.ts` — pdfjs-dist extracts the rendered PDF's text layer, `auditRenderedText` fails on orphan punctuation / unresolved bracket ids / markdown literals / internal tags; wired into `generatePdfBlob` after render (advisory log, `VITE_PDF_RENDER_QA=false` disables). **Verify:** 6/6 auditor tests; tsc 0. BLOCKED: pixel-level VISION critique needs a vision-capable key — DeepSeek has none; slot in behind the same PostRenderQaResult shape when Gemini quota / an Anthropic key is live.

- [x] **QA-21 (Live E2E, follow-up)** Real end-to-end designed export verified: 45KB baseline NVDA report → LIVE DeepSeek design loop (2 iterations, 13–17s, 2–4 validator violations fixed) → react-pdf render (18 pages, 87KB, `eval/out/designed-nvda.pdf`) → post-render QA (caught 2 real legacy orphans from the pre-QA baseline markdown — correct catches). Visually confirmed: designed cover kicker + confidence badge + FY-normalized subtitle, LLM abstract on exec card, verbatim pull quote with accent border on Investment Thesis, accent-tinted zebra tables with parsed cells. Fixes from the run: pull quotes anchor to the section CONTAINING their verbatim text (label mismatch-proof); attached fiscal tokens uppercase (fy2026 → FY2026). **Verify:** e2e test green live (`RUN_PDF_E2E=1`); 123 vitest; tsc 0.

- [x] **QA-22 (Structural PDF QA via opendataloader-pdf, follow-up)** Closes regression test 7 (mid-cell page split) at the GEOMETRY level — the check deferred at QA-4 as visual-only. `pdfStructuralQa.ts`: pure `auditStructure(json)` over opendataloader-pdf's JSON tree (per-element page numbers + bounding boxes) flags any table row whose cells land on two pages, plus skipped heading levels (h1→h3); optional `extractStructure`/`structuralQa` wrapper shells out to opendataloader (Java CLI) and returns null (never throws) when Java/JRE absent. Wired into the e2e harness after render — runs when Java 11+ present, skips clean otherwise. **Verify:** 7/7 auditor tests (fixture JSON, Java-free); e2e ran live and skipped structural step (no JRE on box); `npm -w market-ui run build` green; 130 vitest total. ACTIVATION: `winget install EclipseAdoptium.Temurin.21.JRE` → structural QA runs live, no code change. Browser export path can't use it (no Java/filesystem in browser) — harness/CI-side only, by design.

# 8. PROGRESS LOG

(One line per completed task: `YYYY-MM-DD QA-n: what shipped — real test/verify numbers.`)

- 2026-07-11 QA-1: reportQaGates.ts (222 lines: NumericClaim extraction, entity check, duplicate-attribution detector, source-entity index) + wired `entityGate` into ResearchReport metadata — regression tests 3/4/5 pass, 13/13 new tests green, 18/18 existing pipeline tests green, tsc 0 errors.
- 2026-07-11 QA-2: evaluatePublicationGates (5 gate rules from P0-4 table) + capConfidence + buildConfidenceBanner prepended to final markdown (cover + exec-summary top); Limitations "+N more" full-count disclosure; `publicationGates` in metadata — regression tests 10/15/17-cap pass, 23/23 tests green, 18/18 existing green, tsc 0.
- 2026-07-11 QA-3: remapRagCitations ([RAG-n] → merged [offset+n], offset = min(web,50)+SEC), stripInternalTags ([TIER…]/[DEBUG…] + orphan-heal), scanCitationIntegrity (orphan punctuation + unresolved bracket ids, tables/quotes exempt) — wired into finalMarkdown assembly; regression tests 6/13 pass, 32/32 green, tsc 0.
- 2026-07-11 QA-22: opendataloader-pdf (Apache-2.0, npm @opendataloader/pdf dev-dep) wired as structural PDF QA — auditStructure detects split table rows (regression test 7, was visual-deferred) + heading-level skips from the rendered PDF's geometry JSON; Java-optional wrapper (skips clean, no JRE on box); 7/7 fixture tests, build green, 130 vitest. Live extraction needs `winget install EclipseAdoptium.Temurin.21.JRE` — harness-side only (no Java in browser export).
- 2026-07-11 QA-22b: JRE INSTALLED (Temurin 21) + structural QA now VERIFIED LIVE on the real 18pp PDF — 32 headings, 0 heading-skips, 0 split rows, ok=true; full e2e (design loop → render → text QA → structural QA) passes. Two real fixes from the live run: (1) opendataloader `toStdout` returns empty — wrapper now writes to a temp outputDir + reads the emitted .json; (2) `isJavaAvailable` auto-resolves Java from PATH OR standard Adoptium/Java/Microsoft-jdk install dirs and injects bin into process.env.PATH, so structural QA "just works" post-install with zero PATH fiddling (winget doesn't refresh a running shell's PATH). Honest limitation surfaced: react-pdf renders tables as positioned Views, so opendataloader classifies them as paragraphs (0 semantic tables) — split-row detection is armed but won't fire on our PDFs until we emit Tagged-PDF tables; heading-hierarchy audit is fully live.
- 2026-07-11 QA-21: LIVE e2e verified — DeepSeek design loop 2 iters/13-17s on real 18-page report; spec chose compact density, accent table headers, DC-revenue/margin highlight columns, verbatim pull quote (rendered p5), grounded abstract; post-render QA flagged 2 legacy orphans; visual inspection of 5 pages confirms design decisions on paper — 123 vitest, tsc 0.
- 2026-07-11 QA-20: post-render PDF QA shipped — pdfjs-dist (new dep, dynamic-imported at export time only) text-layer extraction + auditRenderedText (orphans/unresolved-ids/md-literals/internal-tags) after every render, advisory console report — 6/6 tests, 122 vitest total, tsc 0. Vision pixel critique explicitly deferred: no live vision provider.
- 2026-07-11 QA-19: table + graphic design added to the design loop — tableDesign knobs (accent header, zebra, highlight columns) honored per table; computeColumnFlex deterministic content-class widths (0.6/1/2 by max cell length); exhibitStyle monochrome/categorical + exhibitPick selection honored by the exhibits page — 13/13 designer tests, 116 vitest total, tsc 0.
- 2026-07-11 QA-18: Self-Improving Design Loop shipped — pdfDesigner.ts (designer→validator→critic→revise, DeepSeek via market-server), DesignSpec honored by PdfDocument (accent rotation, density, kicker, abstract, pull quotes w/ accent border, exhibit titles), generatePdfBlob runs the loop before every render (default ON, fail-safe, VITE_PDF_DESIGN_LOOP=false kills it) — 9/9 new tests, 112 vitest total, tsc 0. Live design runs blocked on nothing (DeepSeek alive) but unverified end-to-end in browser.
- 2026-07-11 QA-17: maybeRunQualityLoop wired pre-render in SearchPage (judge produced report as iter 1 → feedback re-runs → winner ships, Low confidence when never passed; metadata.qualityLoop records outcome; env-gated, default off) — 6/6 mocked tests green, tsc 0. Live runs still blocked on Tavily 432.
- 2026-07-11 QA-16: buildExhibits (metric+unit groups w/ ≥2 entities → comparison-bar specs, sorted desc, per-bar [n] citations, cap 3) + `numericClaims` (≤40) persisted in metadata + View-based Exhibit component on the exec-summary page (wrap={false}) — 68/68 green, tsc 0. Honest ceiling: exhibits render only when the entity gate extracts ≥2-entity comparable claims; thin single-entity reports get none.
- 2026-07-11 QA-15: Key Finding now prefers grounded claims from NON-summary sections (exec-summary re-quote killed, fallback to section 1 only when nothing later qualifies); mid-report "### Web Sources" dump removed (duplicated References); "Powered by" line behind poweredBy prop (default hidden) — phase2 suite repaired to 1490 ok / 0 FAIL (crash at capturedPrompts[0] + 4 stale checks were PRE-EXISTING since 1ff42cc 2026-06-16 no-sources guard: fixtures lacked searchWeb; seed-prompt count 6→7; workflow count 5→6), 98/98 vitest green, tsc 0.
- 2026-07-11 QA-14: `eval:loop` npm script added; regression tests 16/17/18 green in eval/loopHarness.mock.test.ts (mocked judge fetch-queue + mocked performDeepResearch — feedback injection, best-avg winner selection, dubious-citation warning all verified); harness compiles (tsc 0). BLOCKED-LIVE: real loop runs need Tavily quota restore + market-server :3002 DEV_AUTH_BYPASS.
- 2026-07-11 QA-13: deriveReportStats one-struct (sourcesAnalyzed + sourcesCited + web/sec/rag breakdown; sec.gov URLs classified SEC regardless of label) consumed by PdfDocument cover + exec card + SEC ref badges; "Sources Cited" now rendered alongside "Sources Analyzed" — 66/66 green, tsc 0. (totalSources already = web+sec+rag mechanically, verified L4405.)
- 2026-07-11 QA-12: lintEstimates ("we/our estimate" without method markers based-on/assuming/calculated/illustrative) → estimates_without_method warn gate (cap Medium) — 63/63 green, tsc 0.
- 2026-07-11 QA-11: checkScopeAdherence (per-entity mention share, minShare 0.15; trade-row universe check with "Adjacent expressions" exemption + NOT_TICKERS filter) + buildScopeDisclosure into finalMarkdown — 60/60 green, tsc 0.
- 2026-07-11 QA-10: applyRevisionEdits returns per-edit rejections (not_found|ambiguous|length_ratio|invented_citation), reviseReport logs each + aggregates rejectionReasons into RevisionResult; known-bad-draft harness asserts ≥1 edit applies+accepted with mocked callLLM; component-failure gate already wired (QA-2) — 57/57 green, tsc 0.
- 2026-07-11 QA-9: tierOf in tavilyService (T1=primary/IR, T2=premium+mainstream press, T3=social/SEO/aggregator/unknown, 12 social hosts added); buildSourceTierIndex + findT3OnlyClaims → t3_numeric_support block gate; References render tier per source (PdfDocument) — regression test 12 pass, 55/55 green, tsc 0.
- 2026-07-11 QA-8: checkRagCoverage (coverage tickers vs RAG ticker tags vs SEC company names via alias match) + buildCoverageDisclosure wired into finalMarkdown — regression test 11 pass (both branches mocked), 52/52 green, tsc 0. NOTE: pipeline already fetches EDGAR per blueprint secTargets; "fetch triggered" branch = SEC coverage detected, no new fetch path added.
- 2026-07-11 QA-7: lintCompliance (third-party "Research estimates"/"per <bank> research" regex, Market Intelligence exempt) → block gate; addTradeTableFraming (framing line auto-inserted above Expression/Entry/Target/Stop-Loss tables, no double-frame) in render chain; CONFIDENTIAL stamp behind showConfidential prop default OFF — regression test 8 pass (exact shipped string caught), 49/49 green, tsc 0.
- 2026-07-11 QA-6: lintTemporal (elapsed-period estimate detection via periodEnd vs report date; unprovenanced price-date scan, [live] marker exempt) wired into publication gates (price-provenance=block/Low, elapsed-estimate=warn/Medium); recencyWeightQueries applied to blueprint searchQueries; extractDateFromUrl fallback recovers URL-dated sources before recency bucketing; blueprint prompt now carries TODAY'S DATE + dynamic FY example (was hardcoded "Q4 2024 / FY2025 outlook" — root cause) — regression tests 2/14 pass, 43/43 green, tsc 0. DEFERRED: ≥60%-dated live acceptance needs Tavily quota restore.
- 2026-07-11 QA-5: normalizeDisplaySubtitle (typo dict + title-case + acronym/small-word rules) wired into PdfDocument cover — raw query never renders; regression test 1 pass ("ai in asset managment" → "AI in Asset Management"), 35/35 green, tsc 0.
- 2026-07-11 QA-4: pdfMarkdown.ts pure parser module (parseMarkdown/parseInlineSegments/parseSections/findMarkdownLiterals); PdfDocument now RENDERS [n] citations (was stripping → the orphan-gap root cause), table cells go through the inline parser (kills raw "**- EXPRESSION**"), rows wrap={false}+minPresenceAhead, cover confidence badge, refUrl maxLines=1, summary clampToSentence(500) at pipeline source — regression test 9 pass, 43/43 green (11 new), tsc 0. DEFERRED: test 7 mid-cell page-split visual check needs a real PDF render in browser (react-pdf); mechanism (wrap={false}+minPresenceAhead 24/40) is implemented + unit-covered.
