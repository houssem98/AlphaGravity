# TN Coverage Max — push every column to its honest ceiling

Census 2026-07-17 (prod, 75 board rows):

| Column | Now | Honest ceiling | Gap driver |
|---|---|---|---|
| per/eps/pb/netIncome/equity | 42/75 | **~60/75** | 60 issuers publish statements (`raw_publications` types Individuels/Consolidés/Etats Financiers); 18 unextracted incl. BH, ATB, CITY (fresh 2026 filings). PGH/CC/SPDIT publish nothing → `—` forever. |
| divYield | 25/75 | ~30/75 | post-AGO title match too narrow; TJARI/BIAT/CIL have no doc on the matched node but may publish under other post-AGM phrasings/press releases; BTE/ATB ambiguous → retry with fuller text. Approved-only rule holds (never pre-AGM proposals). |
| spark / 7d % | 69/75 | 75/75-ish | 6 thin names (BHASS SOTEM ALKIM PLTU UADH AETEC) had no trade inside the 21d closes window — widen window, keep last-7 *traded* sessions. A name untraded 60d+ stays `—`. |
| volume/turnover/open/high/low | 65/75 | **65/75 = ceiling** | untraded session ⇒ no data; inventing = fake. No task. |
| price/chg/mcap/sector/isin/shares + Signal ×6 | 75/75 | done | — |

## Doctrine (hard rules)

- TRUTH: extraction grounded in exchange documents only (statement PDFs,
  post-AGO PDFs); DeepSeek pinned to document text, never parametric recall;
  sanity guards stay (yield ≤15%, P/B 0.2–12, STPIL-style garbage rejected).
  Missing source ⇒ honest `—`, ceiling documented, never faked.
- No scraping beyond one hop (feed link → node → its document). No new
  serverless files; blob writes via local build scripts only. No new deps.
- Crypto byte-identical. Verify per task: audit_tn_columns.mjs REAL numbers +
  TN 200s + crypto spot 200/200 MISMATCH 0 + typecheck/deploy only if UI/api
  changed + flip [x], Progress-log line, commit on roadmap/world-class.

## Ledger

- [x] TNM-1 **Fundamentals 42→~60**: list issuers with statements pubs but no
  blob entry (join raw_publications × board × blob). Feed those tickers through
  the existing `scripts/tn_fundamentals.py` pipeline (PDF → LLM → ratios,
  sanity-guarded, blob PATCH). Names that fail extraction or publish
  garbage stay `—` (log each). Verify: prod fundamentals count grows (target
  ≥52; paste real count), spot-check 2 new tickers' EPS vs their PDFs by hand.
- [x] TNM-2 **Closes 69→75**: widen `fetchRecentCloses` window 21d→60d but cap
  at last 7 TRADED sessions per isin (same shape); measure query time ≤15s
  budget (paste timing). Names still without 2 trades in 60d stay `—`. Verify:
  prod board closes>1 count (target ≥73), spark renders for BHASS/ALKIM if they
  traded; timing pasted.
- [ ] TNM-3 **Dividends 25→~30**: widen post-AGO harvest — additional title
  phrasings + `Communiqué de presse` rows that reference AGO results for names
  still missing; retry BTE/ATB with fuller text slices (24k chars). APPROVED
  dividends only — pre-AGM proposals rejected. Rerun build_tn_dividends.mjs
  --write. Verify: divYield count (paste), any new value spot-checked by hand
  vs its PDF.
- [ ] TNM-4 **Sweep**: rerun audit — paste full table; per-column ceiling
  notes final; TN 200s; crypto spot 200/200 MISMATCH 0; memory; commit.

## Progress log

(append one line per completed task, real numbers only)

- **TNM-1 live** (2026-07-17): ran tn_fundamentals.py on 18 candidates → 7 new
  (BH 0.84 EPS / CC 0.12 / CITY 1.81 / MAG 0.33 / MPBS 0.36 / SITS 0.08 /
  SOKNA 0.24), blob 52 cos, audit per/eps **42→49/75 (65%)**. Hand-checked:
  CITY NI 32,554,821 + BH 39,769 both exact in source PDFs. 9 rejects = loss-
  makers (negative NI → PER scale-check can't validate; ATB/BTE/PLAST/SCB/
  SIMPA/STPAP/STPIL/TAIR/TGH) — honest ceiling; follow-up idea: P/B-based scale
  validation would recover negative-EPS names. BHASS extraction empty, TJL no
  statement PDF. Audit script now cache-busts fundamentals (s-maxage 3600 was
  serving stale counts). Crypto spot 200/200 MISMATCH 0.
- **TNM-2 live** (2026-07-17): closes window 21d→60d (query 2.9s measured, 200
  isins, 15s budget); JS still slices last 7 TRADED sessions. Prod: closes>1
  **69→70/75**; BHASS recovered (7 closes). Honest ceiling reached: SOTEM/
  ALKIM/PLTU/UADH/AETEC have ≤1 trade in 60 days (ALKIM exactly 1) — dead
  listings can't have a price line; roadmap's ≥73 estimate was wrong, real
  ceiling ~70. TN intraday 200; crypto spot 200/200 MISMATCH 0.
