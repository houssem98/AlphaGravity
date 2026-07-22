# Tunisian market — column truth audit

Every column offered on `/trading` → Tunisian Market, audited for two failures:
**empty** (the column paints nothing) and **fabricated** (the column paints a
confident number that no underlying data supports). Fabricated is the worse of
the two: an empty cell tells the user nothing is known, a made-up one lies.

## §0 Doctrine

1. **Never invent a number to fill a cell.** If the source has no datum, the
   cell is `—`. A score computed from zero inputs is a fabrication even when
   the arithmetic is sound.
2. **Absence of data is data.** "This stock did not trade today" is a true,
   useful answer. It is not a bug, and must not be patched by substituting a
   neutral default.
3. **Degrade loudly.** A source that fails must not be indistinguishable from a
   source that legitimately returned nothing, and must never cache its own
   failure as if it were an answer.
4. **Measure, do not assert.** Every claim in §3 carries a number produced by
   `e2e/tnColumnAudit.spec.ts` or a direct API read. No adjectives.
5. **A column beside another column is a claim about both.** PER rendered next
   to Price asserts they were computed from the same price.

## §1 Anchors — read before changing anything

| Concern | File |
|---|---|
| Column defs, cell renderers, lazy fetches | `apps/market-ui/src/components/trading/MarketList.tsx` |
| Board / fundamentals / engine / intraday endpoints | `apps/market-ui/api/tn/[fn].ts` |
| Row mapping, formatters | `apps/market-ui/src/services/marketsHub.ts` |
| Measuring instrument | `apps/market-ui/e2e/tnColumnAudit.spec.ts` |
| Null-feed contract (do not regress) | `apps/market-ui/e2e/tnNullFeed.spec.ts` |

## §2 Hard constraints

- No new npm deps; check `package.json` first.
- `/api/tn/*` is blob-cached (`cached()`, 120–180 s SWR). A fix is not verified
  until the blob has rolled — re-read the endpoint, do not trust one call.
- Deploy is `vercel --prod` from **repo root** (project root is `apps/market-ui`).
- `apps/market-ui/public/**` must stay exempt in `.vercelignore` (bare `*.png`).
- Verification per task: `npx tsc -b` clean, `npx vitest run` no new failures,
  `npx playwright test tnColumnAudit tnNullFeed` — and the audit numbers quoted
  in the progress log must come from an actual run.

## §3 Measured state — 2026-07-22, prod, 77-row board

Fill = rows painting a value rather than `—`. Distinct = unique values, which is
how a constant-emitting factor gives itself away.

| Column | Fill | Distinct | Verdict |
|---|---|---|---|
| Name, Price, 24h %, ISIN, Sector, Market Cap, Circulating | 77/77 | high | **OK** |
| 7d % | 70/75 (93%) — was 0/75 for the whole of the 2026-07-22 re-measure | 67 | **FIXED** — TNC-1 |
| Volume, Turnover | 75/75 known (54 traded, **21 a real 0**) | 55 | **FIXED** — 0 no longer reads as `—`, TNC-7 |
| Open, High, Low | 54/75 each, **21 render `·`**, 0 render `—` | 54/53/53 | **FIXED** — TNC-4, TNC-7 |
| PER, EPS, Net Income, Equity | 49/75 (65%) | 49 | **FIXED** — PER now exact vs Price, TNC-3 |
| P/B | 46/75 (61%) | 46 | **FIXED** — bound applies on every route, TNC-5 |
| Div Yield | 32/77 (42%) | 31 | **OK, honest** — declared at AGM only |
| Score, Signal, Momentum, Vol Factor, Liq/Trend | 69/75, 69/75, 54/75, 75/75, 64/75 | 40/3/27/55/44 | **FIXED** — TNC-2 |
| News | **0/75** | 0 | **FIXED** — TNC-2, and the feed itself returns nothing |

### Evidence

- **News factor**: all 75 scored **exactly 50**, every one with detail
  `0 bull / 0 bear of 0 sources (7d)`. The factor has never had an input; 50 is
  a hardcoded neutral presented as a measurement.
- **Momentum**: 20 symbols whose detail is `+0.00% today` (i.e. did not trade)
  scored **exactly 50**.
  **Corrected 2026-07-22 (TNC-2)**: `+0.00% today` does not by itself mean the
  stock did not trade — 13 of the 21 flat rows carry real board volume (BL
  20 479 shares, ASSAD 20 471, MPBS 1 127), i.e. they traded and closed
  unchanged, which is a measurement. The evidence test is board `volume > 0`,
  not a zero change: on that test 21/75 are null and every one of them has
  `volume = 0`.
- **Liquidity**: 8 symbols with detail `no live book` still scored **25**.
- **Zero-evidence rows**: 7 symbols (AST, SITS, ALKIM, STIP, PLTU, UADH, AETEC)
  have no real input on news *and* liquidity *and* momentum, yet carry scores
  33–49 and labels `bearish`/`neutral`.
  **Corrected 2026-07-22 (TNC-2)**: "no score" is right for only 4 of the 7.
  Those three live factors are 0.40 of the model; the other 0.60 is historical,
  and AST/SITS/STIP have real bars behind it — AST `+8.9% 20d / +51.0% 60d`
  trend, a measured `4.77% spread`, `Amihud 6.85e-5`; SITS `+23.7% 20d`,
  `99.0% of period high`; STIP `-12.8% 5d`, `75.4% of period high`. They keep a
  score at coverage 0.70 / 0.60 / 0.75. ALKIM (0.40), PLTU (0.30), UADH (0.40)
  and AETEC (0.10) fall under half the model and now carry neither score nor
  label. Forcing the other three to null would have meant deleting real
  measurements to satisfy this bullet, so the bullet is what changed.
- **Vol Factor** detail reads `top 100% of board by turnover` for 11 symbols —
  these are the *bottom* of the board; the phrasing inverts the meaning.
  **Corrected 2026-07-22 (TNC-6)**: **21** symbols, not 11, and every one of
  them has `turnover == 0`. The percentile was not in fact inverted — AB, the
  board's heaviest name, read `top 1%` and STIP, the thinnest that traded, read
  `top 98%`, both arithmetically right. The two real faults are that `top 98%`
  is true of the *worst* name on the board and reads like praise, and that a
  stock which never traded is not in the ranked set at all, so `top 100%` was a
  vacuous statement wearing a percentile's clothes. Replaced with an ordinal,
  which cannot be misread in either direction: `#1 of 54 by turnover` for AB,
  `#54 of 54` for STIP, `no turnover today` for the 21.
- **7d %**: `/api/tn/board` returned `closes: []` and `change7d: null` for
  **75/75** rows on three consecutive reads at 09:5x, then 71/77 populated at
  10:0x. `fetchRecentCloses()` (`[fn].ts:745`) already carries a comment that a
  timeout "silently empt[ies] every row's closes"; the 60-day bound did not end
  it. The empty result is then written to the blob and served for its full TTL.
  There is no fallback: `/api/spark` is never called for TN.
  **Corrected 2026-07-22 (TNC-1)**: not intermittent — the 60-day aggregation
  costs **22.0 s** over raw_market's 684 096 rows (30 d 14.2 s, 14 d 5.6 s;
  filtering on the indexed `ingested_at` instead of the `dateSeance` string is
  no cheaper — 21.8 s — so the cost is the per-row jsonb extraction, not the
  predicate). The roadmap's "2.9 s measured 2026-07-16" no longer holds, so the
  15 s bound aborted *every* call and the 71/77 read was the last good blob
  still inside its TTL. Fixed by giving the closes map its own blob and a 45 s
  bound; row count is **75**, not 77 — `board()` drops rows with no `last`.
- **PER**: recomputed server-side as `price / eps` (`[fn].ts:733`), yet **23 of
  49** disagree with `boardPrice / eps` by >5% (AL 11.94 vs 12.90; AMV 8.75 vs
  11.29; ASSMA 18.33 vs 23.05). The two endpoints are pricing off different
  snapshots, so PER contradicts the Price cell rendered beside it.
  **Corrected 2026-07-22 (TNC-3)**: the reprice at `[fn].ts:755` runs *only* in
  the `?symbol=` branch, and the table fetches the **bulk** payload
  (`MarketList.tsx:508`, no symbol) — so the table's PER was never repriced at
  all; it was the offline extraction's own value. Re-measured: **24/49** off by
  >5%, **37/49** off by >1%, worst ATL `15.64` vs `21.05` (25.7%). The
  per-symbol branch was always correct (BIAT 18.85, TJARI 17.63, SFBT 14.87 all
  equal `boardPrice/eps`). Fixed by computing the cell from `r.price / eps`, so
  it cannot drift from the Price beside it whatever the two caches do.
  Same root cause governs **TNC-5**: the P/B sanity bound at `[fn].ts:757` also
  sits inside the `?symbol=` branch and so never reaches the bulk payload.
- **Div Yield** carries the same shape PER did: bulk serves the extraction-time
  `yield` on **32** rows with no reprice. Not covered by any §4 task — measured
  here so it is not lost.
- **P/B**: `[fn].ts:735` claims to null anything outside 0.2–12, but the served
  payload contains **STB = 152 348.21** and renders **TJARI = 14.59**. The guard
  is not reaching the response.
  **Corrected 2026-07-22 (TNC-5)**: the 14.59 is **SFBT**, not TJARI — TJARI's
  P/B is 3.42 and was always in bound. Exactly **3** of 49 breached it: STB
  152 348.21, SFBT 14.59, ATL 12.25. The guard was real but sat inside the
  `?symbol=` branch — the one route the table never calls (same root cause as
  TNC-3). It is now a rule about the datum rather than about a route: both
  branches pass the record through one `sane()` on the way out. Served range is
  now 0.591–8.287 across 46 symbols, **0** out of bound, and the three dropped
  names render `—`. P/B fill is 46/75, three below `eps`, which is the honest
  cost of refusing an extraction failure.
- **Open/High/Low**: sourced from `/api/tn/intraday`, price from the board. On
  the 64-symbol sample where both existed, **19** had the board price outside
  `[low, high]` (ATB 3.88 vs [4.24, 4.28]; TJARI 97.5 vs [100.32, 102]).
  **Corrected 2026-07-22 (TNC-4)**: re-measured post-close the same day and the
  contradiction was **0/54** — the two sources agree once the session settles,
  so the 19/64 was mid-session cache skew (intraday 60 s vs board 180 s), not a
  standing error. A reading taken after the close cannot clear this, so it was
  fixed by construction instead of by measurement: the BVMT board row already
  carries `high`/`low` beside `last`, and on that row `last` is inside
  `[low, high]` for **0/75** violations. High/Low now travel on the board row.
  Two things the row cannot do: `open` is **0 on all 75 rows** in this feed, so
  Open still comes from `/api/tn/intraday` (52/75, the session's real first
  traded price); and the 21 untraded rows arrive as `high == low == last ==
  close` — yesterday's close carried forward, which would paint a day range
  that never happened, so they are `null`. Range coverage is exactly the traded
  set: **54/75**.

Not measured, not claimed: the **Last 7 Days** sparkline is an SVG with no text,
so the harness cannot read it. Its data source is the same `closes` array as
7d %, so TNC-1 governs it, but no independent fill number is asserted here.

## §4 Ledger — one task per loop pass, in order

- [x] **TNC-1 — `board` must not serve, or cache, an empty 7-day history.**
  `fetchRecentCloses()` returning `{}`/partial must be treated as a failure:
  do not write that result to the blob, keep serving the previous good blob,
  and mark the payload so the UI can say "history unavailable" instead of `—`.
  Accept: force the closes query to fail; `/api/tn/board` still returns rows
  with populated `closes` from cache, and never persists the empty shape.
- [x] **TNC-2 — the engine must not score a factor it has no evidence for.**
  News with 0 sources, momentum on an untraded session, liquidity with no book:
  emit `null`, not 50/50/25. A factor that is null is excluded from the
  composite and its weight redistributed; if too few factors survive, `score`
  and `label` are null and the columns render `—`.
  Accept: `News` distinct > 1 or fill < 100%; the 7 zero-evidence symbols carry
  no score or label; `tnColumnAudit` constant-factor assertion passes.
- [x] **TNC-3 — PER must be computed from the price the table displays.**
  Either serve PER from the same snapshot as the board, or return `eps` only and
  compute PER client-side from `r.price`.
  Accept: for all rows with both, `|PER − price/eps| / (price/eps) ≤ 0.01`.
- [x] **TNC-4 — Day range must not contradict the price.** Reconcile the
  intraday source with the board session, or drop O/H/L when they disagree.
  Accept: 0 rows with board price outside `[low, high]`.
- [x] **TNC-5 — make the P/B sanity bound actually apply.** Find why `[fn].ts:735`
  does not reach the served payload; STB must be `—`, not 152 348.
  Accept: no served `pb` outside 0.2–12; STB renders `—`.
- [x] **TNC-6 — fix the inverted Vol Factor wording** (`top 100%` → the correct
  bottom/percentile phrasing) and verify against a known thin name.
- [x] **TNC-7 — distinguish "did not trade" from "unknown"** for Volume,
  Turnover and O/H/L: a stock with a real 0 should not render the same `—` as a
  stock whose data failed to load.
- [ ] **TNC-8 — wire `tnColumnAudit` into the repeatable check** and record a
  baseline row in §5 each pass, so regressions in fill or distinctness surface.

## §5 Progress log

| Date | Task | Result (real numbers) |
|---|---|---|
| 2026-07-22 | audit | Baseline captured: 77 rows; News 75/77 fill, distinct=1 (=50); 7d% 0/75 → 71/77 within 12 min; PER 23/49 inconsistent; P/B STB=152348; O/H/L 19/64 contradict price. `tnColumnAudit` fails on `News=50` as designed. |
| 2026-07-22 | TNC-1 | Closes query measured at 22.0 s / 60 d (30 d 14.2 s, 14 d 5.6 s, `ingested_at` variant 21.8 s) over 684 096 raw_market rows — the 15 s bound aborted every call, so prod served `closes:[]` on 3/3 cache-busted reads at 15.8 s each. Closes moved to their own `tn_closes.json` blob (1800 s, never written empty), bound raised to 45 s, `historyOk` added to the payload. Prod after deploy: 75 rows, `historyOk=true`, closes>1 **70/75**, closes==0 **2**, 7d% fill **70** distinct **67**, closes lengths {0,1,7}; first call 12.5 s (blob seed), then 1.56 s / 1.10 s / 0.98 s. 3 new unit tests in `tnBoard.test.ts` (dead query + cached closes → served, not overwritten; dead query + no blob → `historyOk:false`, 0 blob writes; live query → both blobs written, untraded AST stays null). `npx tsc -b` clean; `npx vitest run` 220 pass / 0 fail / 5 skipped; `tnNullFeed` pass; `tnColumnAudit` still fails only on `News=50` (TNC-2). |
| 2026-07-22 | TNC-2 | Every factor now emits `null` with no input and drops out of the composite; below 0.5 surviving weight `score` and `label` are null too, and the payload carries `covered`. Prod, 75/75 engines: News fill **0/75** (was 75/77 all exactly 50) — Firecrawl answers HTTP 200 with an empty result set, so "0 sources" is honest, and a real failure now reads `news source unavailable`. Momentum **54/75** distinct 27 (21 null, all with board `volume = 0`); liquidity **64/75** distinct 44; trend **68/75** d40; reversal **72/75** d44; nearHigh **74/75** d44; illiquidity **73/75** d45; volume **75/75** d55; score **69/75** distinct 40; label **69/75** distinct 3. Of §3's 7 zero-evidence rows, ALKIM/PLTU/UADH/AETEC (covered 0.40/0.30/0.40/0.10) now carry no score or label; AST/SITS/STIP (0.70/0.60/0.75) keep one on real historical bars — §3 corrected rather than the threshold bent. `npx tsc -b` clean; `npx vitest run` 224 pass / 0 fail / 5 skipped (4 new in `tnEngine.test.ts`); `npx playwright test tnColumnAudit tnNullFeed` **2 pass / 0 fail** — the constant-factor assertion that has failed since the baseline now passes. |
| 2026-07-22 | TNC-3 | The reprice at `[fn].ts:755` only ever ran in the `?symbol=` branch, while the table reads the bulk payload — so its PER was the offline extraction value, never repriced. Measured before: **37/49** rows off the board's own `price/eps` by >1%, **24/49** by >5%, worst ATL 15.64 vs 21.05 (25.7%); the per-symbol branch already matched exactly (BIAT 18.85, TJARI 17.63, SFBT 14.87). Bulk now ships `eps` and no `per` (prod: **0/53** symbols carry `per`, **49** carry `eps`), and the cell computes `r.price / eps`, so disagreement is 0 by construction. `audit_tn_columns.mjs` measured `per` off the removed field and read 0/75 — the instrument was corrected to the same price/eps rule and reads **49/75**, equal to `eps` coverage. `npx tsc -b` clean; `npx vitest run` 227 pass / 0 fail / 5 skipped (3 new in `tnFundamentals.test.ts`); `npx playwright test tnColumnAudit tnNullFeed` 2 pass / 0 fail. |
| 2026-07-22 | TNC-4 | Re-measured post-close: board price outside `[low, high]` was **0/54**, not the baseline's 19/64 — that was mid-session skew between a 60 s intraday blob and a 180 s board blob. A quiet-market reading cannot clear this, so it was fixed by construction: BVMT's board row carries `high`/`low` beside `last`, where `last` sits inside the range on **0/75** violations. High/Low now ride that row; prod after the blob rolled: 75 rows, **54** with a range, **0** outside it, and range coverage equals the traded set exactly (54 traded). The 21 untraded rows send `high == low == last == close` (yesterday's close carried forward) and are now `null` rather than a day range that never happened. `open` is **0 on all 75 rows** in this feed, so Open stays on `/api/tn/intraday` at **52/75**. `audit_tn_columns.mjs` high/low moved to the board row to match. `npx tsc -b` clean; `npx vitest run` 230 pass / 0 fail / 5 skipped (3 new in `tnDayRange.test.ts`); `npx playwright test tnColumnAudit tnNullFeed` 2 pass / 0 fail. |
| 2026-07-22 | TNC-5 | The bound was never broken, it was unreachable: it sat in the `?symbol=` branch, which the table does not call (the TNC-3 root cause again). Measured before: **3/49** served P/B outside 0.2–12 — STB 152 348.21, SFBT 14.59, ATL 12.25. §3 credited the 14.59 to TJARI; TJARI is 3.42 and was always in bound, corrected. Both branches now pass the record through one `sane()`, so the rule belongs to the datum and not to a route. Prod after deploy: **46** symbols with a numeric P/B, **0** out of bound, served range **0.591–8.287**, STB/SFBT/ATL all `null`; `pb` fill 46/75 against `eps` 49/75 — the three-row gap is the extraction failures being refused. `npx tsc -b` clean; `npx vitest run` 232 pass / 0 fail / 5 skipped (2 new in `tnFundamentals.test.ts`, one of which pins that a per-symbol read no longer writes through to the shared blob); `npx playwright test tnColumnAudit tnNullFeed` 2 pass / 0 fail. |
| 2026-07-22 | TNC-6 | Re-measured: **21** rows carried `top 100% of board by turnover`, not 11, and all 21 have `turnover == 0`. The percentile itself was never inverted — AB (turnover 1 273 815) read `top 1%` and STIP (9.37) read `top 98%`, both correct — so §3's diagnosis is corrected: the faults are that `top 98%` describes the board's worst name in words that read like praise, and that an untraded stock is not in the ranked set at all. Now an ordinal: prod sweep of all 75, **0** rows still saying `top N%`, **54** ranked (every one with turnover > 0, ordinals 1..54 unique and monotonic against turnover) and **21** reading `no turnover today` (every one with turnover = 0). Known thin name verified: STIP `#54 of 54 by turnover`; heaviest AB `#1 of 54`. Verification note: the engine route is CDN-cached `s-maxage=900, SWR 3600`, so a sweep without a cache-buster replayed the old body for 7 rounds while the blob was already fresh — re-read with `&cb=`. `npx tsc -b` clean; `npx vitest run` 233 pass / 0 fail / 5 skipped (1 new in `tnEngine.test.ts`); `npx playwright test tnColumnAudit tnNullFeed` 2 pass / 0 fail. |
| 2026-07-22 | TNC-7 | The collapse was in the row mapper: `volume: r.volume \|\| undefined` in `marketsHub.ts` turned a real 0 into "unknown", so a stock that did not trade rendered the same `—` as one whose feed failed. Volume and Turnover now keep the 0 and render it (title `did not trade today`); Open/High/Low render `·` for a session that had no trade, reserving `—` for an absent datum. Measured in the rendered DOM, 75 rows: Volume **75/75** known with **21** a real 0, Turnover **75/75** with **21** zeros, Open/High/Low **54/75** values plus **21** `·` and **0** dashes — every cell on the board now says which of the two it means. The instrument was taught the difference in the same pass: `tnColumnAudit` no longer counts `·` as filled and reports `noTrade`/`zeros` per column, so the distinction cannot silently inflate a fill number. `npx tsc -b` clean; `npx vitest run` 234 pass / 0 fail / 5 skipped (1 new in `marketsHub.test.ts`); `npx playwright test tnColumnAudit tnNullFeed` 2 pass / 0 fail. |
