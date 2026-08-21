# quickanswerfix.md

## What this is

Two things merged into one ledger: the EDGAR-first methodology in the `sec.md` I gave you (how *I* answer a financial quick-answer question — SEC EDGAR primary, every number linked, gaps stated, Q4 derived and labeled), checked line-by-line against what `services/gravity-api`'s actual Quick Answer pipeline does *today*, as read from the real code and the real `houssem98/AlphaGravity` git history — not the roadmap's aspirations, not what the commit messages claim, what's actually there. Every claim below cites a file, a line range, or a commit SHA I read directly. Where I couldn't verify something from this session (no GitHub API/PR/Actions access, no live server logs), I've said so instead of guessing.

Repo state this is checked against: `roadmap/world-class` @ `a44dee7` (2026-08-18), plus five unmerged branches sitting on top of it as of 2026-08-21 (`sync/edgar-multi-quarter-fix`, `feat/edgar-filer-profile`, `fix/edgar-timeout-fallback`, `fix/cache-key-reasoning-depth`, `fix/local-dev-stack`). `main` is a separate, disconnected history frozen at `a44d463` (2026-07-12). Production (`gravity-api-prod.fly.dev`) is frozen at the 2026-07-07 image — Fly billing is overdue (commit `06af871`) — so **none of the branches below are live anywhere right now**, including the one that already merged my own fix.

---

## The standard, compressed

From `sec.md`: SEC EDGAR XBRL (`data.sec.gov/api/xbrl/companyconcept/...`) is the primary source for any number a 10-Q/10-K reports. Q4 is derived as `FY total − (Q1+Q2+Q3)` and labeled as derived, never presented as filed. Every number links to a real filing. When a source doesn't have what was asked, the answer says so instead of guessing. Multi-entity and multi-period questions return *every* entity and period asked for, not a truncated subset.

---

## Stage by stage: what the pipeline actually does

**Entity resolution** (`app/core/query_understanding.py`). A single LLM call (Gemini 2.5 Flash) extracts `entities.companies` from the raw query text. The prompt's only worked example (`QUERY_UNDERSTANDING_SYSTEM`, lines 322-324) is single-company (`{"name": "Apple Inc", "ticker": "AAPL"}`). There is no deterministic table anywhere in the codebase mapping a named group ("FAANG", "Magnificent Seven", "the banks") to its constituent tickers — I grepped for `FAANG|MAG7|Magnificent|group.?alias|company_alias|ticker_alias` across every `.py` file; the only hits are a routing-complexity test string (`test_llm_router.py:38`) and a skill-loader docstring example, neither of which resolves anything at runtime. Whether a group query gets 0, 1, or 5 tickers back depends entirely on what the LLM decides to do, unengineered.

**Timeout fallback** (`query_understanding.py`, `DEFAULT_QUERY_PLAN`). If the classification call doesn't return inside its 5s budget, `analyze()` never runs, and the pipeline falls back to this dict verbatim. As of `roadmap/world-class` @ `a44dee7`, that dict's `retrieval_channels` is `["dense", "bm25", "splade"]` — no `edgar`, no `structured`, and `entities.companies` is empty. **Fixed** on `fix/edgar-timeout-fallback` (`4a741c9`) — adds `edgar` to the fallback list — with a captured prod log proving the failure mode is real, on a query from this same conversation ("Yorkville International Capital Corp. Units revenue"):
```
query_understanding_timeout  latency_ms=5005.0
retrieval_complete  channels_queried=['dense','bm25','structured','tree_nav']
```
**Not merged into `roadmap/world-class`.**

**Live EDGAR channel** (`app/core/retrieval/edgar_search.py`). Wired into `orchestrator.py` (registration line 103-104, dispatch line 256), `dependencies.py` (construction lines 228-234), `fusion.py` (weight `"edgar": 1.2`, line 208). `extract_tickers()` (lines 118-133) correctly handles *multiple* tickers from `entities.companies` or `filters.companies`, capped at 3 (`tickers[:3]`, line 236 — a deliberate, documented ceiling, not a bug). Q4 derivation is real: `app/ingestion/sources/sec_quarterly.py` docstring, line 84 — "Per-quarter values for flow concepts, with Q4 derived where the issuer files" — and `ANNUAL_MIN_DAYS = 330` (line 26) gates what counts as a full-year period. I hand-verified this logic against real Apple dates earlier in this conversation; it's correct. The multi-year quarterly truncation bug (`top_k` never sized to periods requested) — **fixed by me**, tested (27/27), and **actually merged to the real repo** as `sync/edgar-multi-quarter-fix` (`d6be7e8`), confirmed identical to my patch by diffing it against my own commit. The SPAC/no-revenue-filer fallback (a filer that reports no revenue getting "ingest the filing" instead of its real trust-account figures) — **fixed**, on `feat/edgar-filer-profile` (`2a4ffe7`, `84ca707`, `d3ccbd9`), verified end-to-end against live SEC in that commit's own message. **Not merged into `roadmap/world-class`.**

**Deterministic ratio pre-pass** (`app/core/search_pipeline.py`, lines 954-985; `app/core/finance/ratio_engine.py`, lines 1024 and 1123). `RatioEngine.compute()` and `.compute_from_query()` both take `ticker: str` — singular. The call site hardcodes `ticker=tickers[0]` (line 971) — only the *first* resolved company, ever. For any comparison query naming more than one company, this stage can only ever produce one company's ratio. This is what produced "the pre-computed ratio for Meta is marked N/A" in the live FAANG test — Meta was apparently `tickers[0]`, its real financials weren't in the Supabase `financials` table this engine reads, so it returned nothing, and Amazon/Netflix/Alphabet/Apple never got a ratio-engine attempt at all. **Unfixed. No branch touches this.**

**Structured/dense retrieval and demo corpus** (`app/core/retrieval/structured_search.py`, `scripts/seed_data.py`). Unlike the ratio engine, `structured_search.py`'s `_tickers()` (lines 206-211) and its SQL filter (`in.(...)`, line 87) genuinely support multiple companies — this stage is not the bottleneck. But the synthetic seed corpus it (and dense/BM25) falls back on when nothing's really ingested has real, concrete gaps: `scripts/seed_data.py` has a "Profitability" passage (operating income + margin) for AAPL, MSFT, NVDA, AMZN, and GOOGL — **not for META** (Meta only got two "Revenue" passages, FY2024 and FY2022, never profitability) — and **Netflix has zero entries under any category**; the string `NFLX` doesn't appear in the file at all. **Unfixed. No branch touches this.**

**Answer synthesis / citation enforcement** (`app/core/reasoning/prompts.py`, `FINANCIAL_ANALYST_SYSTEM`). This is the one layer that already matches the standard. Rule 11, "GROUNDED-OR-REFUSE" (lines 71-81): every figure must be quoted from a provided source; if the entity+metric+period isn't in the sources, the model must say so plainly, confidence LOW/NONE, no invented number. I watched this work correctly, live: the FAANG query got almost no real data upstream, and the model refused rather than fabricate a comparison table. The refusal was correct; only the empty context feeding it wasn't.

---

## Full gap ledger, ranked by actual impact, status-tagged

1. **BLOCKING, unfixed** — Production frozen on the 2026-07-07 image; Fly.io billing overdue (`06af871`). Nothing below this line is live anywhere until that's paid or the Render fallback (`9f86f40`, `224a78d`) finishes. Not a code problem.
2. **Unfixed, no branch** — `RatioEngine` hard-capped to `tickers[0]` (`search_pipeline.py:971`; `ratio_engine.py:1024`,`1123`). Blocks every multi-company comparison from getting deterministic ratios for more than one name.
3. **Unfixed, no branch** — No group/acronym → ticker-list expansion anywhere in the codebase. "FAANG," "Magnificent Seven," and similar never resolve deterministically.
4. **Fixed, unmerged** — EDGAR channel dropped silently on classification timeout (`fix/edgar-timeout-fallback`, `4a741c9`).
5. **Unfixed, no branch** — Demo/seed corpus (`scripts/seed_data.py`) has no Netflix entries and no Meta profitability entry.
6. **Fixed, unmerged** — SPAC / no-revenue-filer answers wrongly blamed "ingestion" instead of stating the real trust-account figures (`feat/edgar-filer-profile`, `2a4ffe7`).
7. **Fixed, unmerged, verified merged into the real repo (separate branch)** — EDGAR `top_k` truncation on multi-year quarterly queries (my fix; `sync/edgar-multi-quarter-fix`, `d6be7e8`).
8. **Open, flagged by your own team, not yet fixed** — Duplicate/conflicting financials rows with mismatched units: `NVDA_CostOfRevenue_FY2026_xbrl = 62,475,000,000` beside `NVDA_Cost_of_revenue_2026-05-20_backfill = 39.5` (commit `66580c7`, logged as "GS-4, an accuracy task").
9. **Fixed, merged (on `roadmap/world-class` already)** — CI suite gate silently reporting green with zero tests collected (`c4c822c`).
10. **Structural, unaddressed** — `main` (GitHub's default branch) shares no git history with `roadmap/world-class`, is 5+ weeks stale, and nobody has reconciled them.
11. **Stranded, month-old** — `security/dep-lead-fixes` (`be79b4d`): Postgres TLS certificate verification disabled (`CERT_NONE`) — a real MITM exposure — on a branch connected to `main`'s old lineage, merged into neither active line of work.
12. **Integration risk, unaddressed** — Five branches unmerged off `roadmap/world-class`; `sync/edgar-multi-quarter-fix` and `feat/edgar-filer-profile` both edit `edgar_search.py` independently from the same base with no rebase between them.
13. **Unresolved question, not a verified bug** — Four `hermes/*` branches share this repo with no history connecting to either `main` or `roadmap/world-class`; commit subjects reference an unrelated-looking trading/market-data project (BVMT order-book semantics, a GEPA prompt-optimization harness). I don't know if this is an intentional monorepo or misplaced branches — needs you to say, not me to guess.

---

## What to actually change to make the pipeline match the sec.md standard

Two things belong ahead of everything else in the earlier roadmap for exactly this failure class, because they're the two gaps no existing branch addresses:

**Give `RatioEngine` a ticker list.** Change `compute()`/`compute_from_query()` to accept `tickers: list[str]` and loop internally, same pattern `structured_search.py` already uses for its `in.(...)` SQL filter. Update the call site at `search_pipeline.py:970-974` to pass every resolved ticker, not `tickers[0]`.

**Add a deterministic group-alias table.** A small dict — FAANG, Magnificent Seven, mega-cap tech, major banks, whatever comes up — resolved *before* the query reaches the LLM classifier, not left to Gemini to maybe-remember. Cheaper and far more reliable than prompting.

Everything else in this ledger — merging the five pending branches in a sane order (rebase `feat/edgar-filer-profile` onto `sync/edgar-multi-quarter-fix` first, since it touches the same file with the larger diff), reconciling `main`, landing the stranded TLS fix, filling the seed-data gaps or retiring seed data in favor of real ingestion — was already in the roadmap and WIRING doc I sent earlier and still stands. Paying the Fly invoice (or finishing the Render migration) is the one item on this list that isn't mine or sec Code's to fix.

---

## What I have not verified from here

No GitHub API, PR, or Actions access this session (`gh` isn't installed, and the GitHub API call returned "GitHub access to this repository is not enabled for this session") — I can't tell you review status, CI results, or whether any of these five branches even have open PRs; that's a straight look at github.com for you. No live server logs beyond the ones already captured in commit messages — I can't confirm whether the classification-timeout failure mode fires often or rarely in practice. And I don't know the intent behind the `hermes/*` branches; everything I said about them is a read of commit subjects, not a claim about what that project is.
