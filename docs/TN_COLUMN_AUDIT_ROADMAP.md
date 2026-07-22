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
| 7d % | 71/77 (92%) — **but 0/75 measured 12 min earlier** | 70 | **INTERMITTENT** — TNC-1 |
| Volume, Turnover | 43/77 (56%) | 43 | **OK, honest** — 43 stocks traded |
| Open, High, Low | 41/77 (53%) | 41/40/41 | **SUSPECT** — TNC-4 |
| PER, EPS, Net Income, Equity | 49/77 (64%) | 49 | **OK coverage**, PER inconsistent — TNC-3 |
| P/B | 49/77 (64%) | 45 | **BROKEN VALUES** — TNC-5 |
| Div Yield | 32/77 (42%) | 31 | **OK, honest** — declared at AGM only |
| Score, Signal, Momentum, Vol Factor, Liq/Trend | 75/77 (97%) | 38/3/37/61/69 | **OVERSTATED** — TNC-2 |
| News | 75/77 (97%) | **1** | **FABRICATED** — TNC-2 |

### Evidence

- **News factor**: all 75 scored **exactly 50**, every one with detail
  `0 bull / 0 bear of 0 sources (7d)`. The factor has never had an input; 50 is
  a hardcoded neutral presented as a measurement.
- **Momentum**: 20 symbols whose detail is `+0.00% today` (i.e. did not trade)
  scored **exactly 50**.
- **Liquidity**: 8 symbols with detail `no live book` still scored **25**.
- **Zero-evidence rows**: 7 symbols (AST, SITS, ALKIM, STIP, PLTU, UADH, AETEC)
  have no real input on news *and* liquidity *and* momentum, yet carry scores
  33–49 and labels `bearish`/`neutral`.
- **Vol Factor** detail reads `top 100% of board by turnover` for 11 symbols —
  these are the *bottom* of the board; the phrasing inverts the meaning.
- **7d %**: `/api/tn/board` returned `closes: []` and `change7d: null` for
  **75/75** rows on three consecutive reads at 09:5x, then 71/77 populated at
  10:0x. `fetchRecentCloses()` (`[fn].ts:745`) already carries a comment that a
  timeout "silently empt[ies] every row's closes"; the 60-day bound did not end
  it. The empty result is then written to the blob and served for its full TTL.
  There is no fallback: `/api/spark` is never called for TN.
- **PER**: recomputed server-side as `price / eps` (`[fn].ts:733`), yet **23 of
  49** disagree with `boardPrice / eps` by >5% (AL 11.94 vs 12.90; AMV 8.75 vs
  11.29; ASSMA 18.33 vs 23.05). The two endpoints are pricing off different
  snapshots, so PER contradicts the Price cell rendered beside it.
- **P/B**: `[fn].ts:735` claims to null anything outside 0.2–12, but the served
  payload contains **STB = 152 348.21** and renders **TJARI = 14.59**. The guard
  is not reaching the response.
- **Open/High/Low**: sourced from `/api/tn/intraday`, price from the board. On
  the 64-symbol sample where both existed, **19** had the board price outside
  `[low, high]` (ATB 3.88 vs [4.24, 4.28]; TJARI 97.5 vs [100.32, 102]).

Not measured, not claimed: the **Last 7 Days** sparkline is an SVG with no text,
so the harness cannot read it. Its data source is the same `closes` array as
7d %, so TNC-1 governs it, but no independent fill number is asserted here.

## §4 Ledger — one task per loop pass, in order

- [ ] **TNC-1 — `board` must not serve, or cache, an empty 7-day history.**
  `fetchRecentCloses()` returning `{}`/partial must be treated as a failure:
  do not write that result to the blob, keep serving the previous good blob,
  and mark the payload so the UI can say "history unavailable" instead of `—`.
  Accept: force the closes query to fail; `/api/tn/board` still returns rows
  with populated `closes` from cache, and never persists the empty shape.
- [ ] **TNC-2 — the engine must not score a factor it has no evidence for.**
  News with 0 sources, momentum on an untraded session, liquidity with no book:
  emit `null`, not 50/50/25. A factor that is null is excluded from the
  composite and its weight redistributed; if too few factors survive, `score`
  and `label` are null and the columns render `—`.
  Accept: `News` distinct > 1 or fill < 100%; the 7 zero-evidence symbols carry
  no score or label; `tnColumnAudit` constant-factor assertion passes.
- [ ] **TNC-3 — PER must be computed from the price the table displays.**
  Either serve PER from the same snapshot as the board, or return `eps` only and
  compute PER client-side from `r.price`.
  Accept: for all rows with both, `|PER − price/eps| / (price/eps) ≤ 0.01`.
- [ ] **TNC-4 — Day range must not contradict the price.** Reconcile the
  intraday source with the board session, or drop O/H/L when they disagree.
  Accept: 0 rows with board price outside `[low, high]`.
- [ ] **TNC-5 — make the P/B sanity bound actually apply.** Find why `[fn].ts:735`
  does not reach the served payload; STB must be `—`, not 152 348.
  Accept: no served `pb` outside 0.2–12; STB renders `—`.
- [ ] **TNC-6 — fix the inverted Vol Factor wording** (`top 100%` → the correct
  bottom/percentile phrasing) and verify against a known thin name.
- [ ] **TNC-7 — distinguish "did not trade" from "unknown"** for Volume,
  Turnover and O/H/L: a stock with a real 0 should not render the same `—` as a
  stock whose data failed to load.
- [ ] **TNC-8 — wire `tnColumnAudit` into the repeatable check** and record a
  baseline row in §5 each pass, so regressions in fill or distinctness surface.

## §5 Progress log

| Date | Task | Result (real numbers) |
|---|---|---|
| 2026-07-22 | audit | Baseline captured: 77 rows; News 75/77 fill, distinct=1 (=50); 7d% 0/75 → 71/77 within 12 min; PER 23/49 inconsistent; P/B STB=152348; O/H/L 19/64 contradict price. `tnColumnAudit` fails on `News=50` as designed. |
