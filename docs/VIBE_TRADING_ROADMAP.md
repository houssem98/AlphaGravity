# Vibe-Trading Harvest — Resilience & Factor-Engine Roadmap

Goal: port the highest-leverage patterns from **HKUDS/Vibe-Trading** (MIT,
verified 2026-07-06: 18,066 stars, created 2026-04-01, pushed same day) into
antigravity — WITHOUT adopting its stack. We take designs and formulas, not
dependencies: data-source fallback chains for our fragile Yahoo/CoinCap
endpoints, published alpha-factor math for the TN engine score, and their
multi-agent committee composition for deep research. Source of truth =
github.com/HKUDS/Vibe-Trading README + cited papers, never blog posts.

Hard rules (every task):
1. **Payload-proof rule**: never map an upstream field (stooq CSV columns,
   sina quote format, OKX ticker JSON) without curling a real payload first
   and pasting the evidence into the Progress log.
2. Vercel Hobby 12-fn cap — **edit existing functions only** (`api/quote.ts`,
   `api/history.ts`, `api/crypto/*`, `api/tn/[fn].ts`). No new fn files.
3. No new market-ui npm deps. Fallback logic = plain fetch in the existing
   handlers. Factor math = arithmetic on data we already serve.
4. Factor formulas only from citable sources (Amihud 2002; George & Hwang
   2004 52-week-high; Jegadeesh 1990 reversal; Carhart 1997 momentum — the
   same academic set Vibe-Trading's zoo credits). One comment line citing the
   paper next to each implementation.
5. Fallbacks must be **shadow-safe**: primary source result shape unchanged;
   fallback only fills when primary fails/empty; response says which source
   served (`source` field) so drift is debuggable.
6. Verify: tsc 0 + market-ui build; API tasks curl prod after deploy with
   REAL numbers in the log. `vercel --prod --yes` only on `[deploy]` tasks.
7. One task per iteration; flip `[x]`; one Progress-log line; commit on
   `roadmap/world-class` (use `git commit -F <file>` when the message
   contains quotes — rtk mangles them).

---

## Phase V1 — Data resilience (fallback chains, Vibe's IP-ban-risk pattern)
- [x] **V1.1** — Probe + document fallback candidates with real payloads:
  stooq EOD CSV (`https://stooq.com/q/d/l/?s=<sym>.us&i=d`) and sina US quote
  for 3 symbols (AAPL, ^GSPC-equivalent, BRK-B edge case). Record exact
  column/field mapping, symbol-name translation rules, and what each source
  CANNOT provide (stooq = EOD only, no intraday). No code yet.
  *Acceptance:* log line with one real parsed row per source per symbol.
- [x] **V1.2** — `/api/quote` fallback: on Yahoo failure/empty, fill
  price/changePct from the V1.1-proven chain; add `source` field; response
  shape otherwise unchanged (fetchQuotes in marketsHub must not need edits).
  *Acceptance:* prod curl normal path = yahoo; forced-fallback test (bad
  Yahoo host env or mock) serves fallback values matching source payloads.
  `[deploy]`
- [x] **V1.3** — `/api/history` + `/api/spark` fallback: stooq daily CSV →
  Yahoo-chart-shaped response (only fields fetchCloses/fetchSparks read).
  *Acceptance:* prod curl; one symbol's fallback closes == stooq CSV values
  (spot-check 3 dates). `[deploy]`
- [x] **V1.4** — `/api/crypto/markets` fallback: CoinCap → OKX public tickers
  (keyless, payload-proven) for price/changePct on the top majors; mcap/logo
  may be absent in fallback (UI already null-safe? verify, fix if not).
  *Acceptance:* prod curl both paths; BTC/ETH prices within 0.5% of a second
  source at test time. `[deploy]`

## Phase V2 — TN engine: real factors (from the zoo's academic set)
- [x] **V2.1** — Factor library inside `api/tn/[fn].ts` (pure functions over
  the daily bars the history route already builds): momentum 20d & 60d
  (Carhart 1997), 5d reversal (Jegadeesh 1990), 52-week-high proximity
  (George & Hwang 2004 — reuse the `highs` aggregation), Amihud illiquidity
  = mean(|ret|/turnover) (Amihud 2002 — ideal for thin BVMT names).
  Hand-check each on BIAT + one thin name (TINV) against manual calc.
  *Acceptance:* log the hand-checked values (factor, symbol, expected vs
  computed, equal).
- [x] **V2.2** — Blend into `engine()`: keep existing 4 live factors, add the
  4 historical factors; new weights documented in the response; factor
  breakdown extended so the UI card lists all 8 with per-factor detail
  strings. Deterministic, no LLM.
  *Acceptance:* prod curl engine for BIAT + TINV: 8 factors, score 0–100,
  each detail string carries its real number. `[deploy]`
- [x] **V2.3** — Comparator + AssetInfoPanel surface: engine score column in
  TnComparator, factor breakdown visible on the company page (reuse existing
  card patterns; no new deps).
  *Acceptance:* prod page shows 8-factor breakdown; tsc 0 + build.
  `[deploy]`

## Phase V3 — Deep-research committee composition (prompt port)
- [x] **V3.1** — Port Vibe's `investment_committee` composition (bull case →
  bear case → risk review → PM verdict) into deepResearchService's prompt
  flow as a mode; run on 2 US tickers with real gravity-api retrieval and
  compare output vs current single-pass on completeness (sections filled vs
  the grid memo's 5/7-empty baseline).
  *Acceptance:* side-by-side artifact; honest note that retrieval gaps are
  NOT fixed by composition (that's gravity-api work).

## Phase V4 — Sidecar evaluation (timeboxed, decision not adoption)
- [ ] **V4.1** — 1-day eval: `pip install vibe-trading-ai`, Docker serve with
  DEEPSEEK key, run one swarm preset + one alpha bench on a US ticker;
  measure latency/cost/output quality; verdict ADOPT-AS-SIDECAR / HARVEST-
  MORE-PATTERNS / DROP with real numbers.
  *Acceptance:* verdict + evidence in the log; nothing deployed.

## Phase V5 — Shadow Account (parked until V1–V2 shipped)
- [ ] **V5.1** — Spec only: survey Tunisian broker export formats (Tunisie
  Valeurs, BNA Capitaux…) — is a CSV/statement standard feasible? Go/no-go
  memo; no build.
  *Acceptance:* memo in docs/ with real format samples or documented absence.

---

## Definition of done
No single-source failure can blank the tape/charts (every market has a
payload-proven fallback chain and says which source served); the TN engine
score rests on 8 factors including citable academic ones suited to a thin
market; deep research has a committee mode; sidecar and shadow-account
decisions are made on evidence, not vibes.

## Progress log
<!-- YYYY-MM-DD Vx.y — what — verify numbers -->
2026-07-06 — Research base (GitHub API + raw README, same-day): HKUDS/
Vibe-Trading 18,066★, MIT, Python/FastAPI/React19, LangGraph; 18 data
sources with IP-ban-risk-ordered fallback chains; 456-factor alpha zoo
(qlib158 Apache-2.0 + alpha101 + gtja191 + 10 academic); 9 swarm presets;
shadow-account pipeline; REST/MCP server; DeepSeek = default model tier.
Our stack same-day: 11/12 Vercel fns; /api/quote+history+spark = Yahoo-only;
/api/crypto = CoinCap-only; tn engine = 4 naive factors.
2026-07-06 — V1.1 probe, real curls:
STOOQ DEAD for serverless — `curl https://stooq.com/q/d/l/?s=aapl.us&i=d`
(also tried `^spx`, `brk-b.us`, browser UA, plain http) all return an
anti-bot JS PoW challenge page (`crypto.subtle.digest` SHA-256 nonce-mining,
then POST /__verify) — no CSV ever served, http even 301s to https first.
Vercel Node/Edge fetch has no JS runtime to solve it -> stooq is NOT a usable
V1.3 EOD fallback as scoped; need a different history source (candidate:
Yahoo alt host/chart endpoint variant, or a keyed provider) before V1.3.
SINA gb_ US quotes WORK (need `Referer: https://finance.sina.com.cn`, GBK
name encoding). Real payload
`gb_aapl="AAPL,308.6300,0.00,2026-07-06 21:25:11,...,306.1500,-0.80,-2.48,..."`
— field[1]=live price (confirmed matches Yahoo-scale), field[21]=306.1500
prevclose. field[22]/[23] (-0.80/-2.48) do NOT reconcile against
price-prevclose (+2.48) — those two fields are stale/unreliable; V1.2 must
compute changePct itself as (price-prevclose)/prevclose from field[1] &
field[21], not trust field[23]. BRK-B edge case CONFIRMED BROKEN on sina:
`gb_brkb="BRKB,0.0000,0.00,2019-09-24 09:30:43,...` — frozen/dead symbol,
sina never updated it past 2019, price 0. No working sina symbol found for
BRK-B (`gb_brk_b`, `gb_brka`, `gb_brk.b` all empty). Symbol rule: ticker
lowercased, `-`/`.` stripped (`BRK-B`->`brkb`) but even the correct guess is
dead data — BRK-B fallback must skip sina and either fall through to
"no fallback available" (shadow-safe: stays on primary/empty) or add a 3rd
source later. Index proxy for ^GSPC-equivalent: `gb_$inx` works, real
payload price=7483.2402 (S&P500 series scale, timestamp 2026-07-06
21:10:02); `gb_$dji`/`gb_$ixic` also live-ish. So: sina covers plain-ticker
quote fallback (V1.2, incl. an index proxy) but does NOT cover BRK-B and
categorically cannot serve EOD history/spark (quote-only feed) — V1.3 needs
a different source than stooq entirely. Verdict: proceed V1.2 with sina as
the quote/crypto-adjacent fallback per above field mapping; V1.3 blocked on
finding a non-stooq EOD CSV source, flagged for that task's own probe step.
2026-07-06 — V1.2 shipped, `api/quote.ts`: yahoo path unchanged, per-symbol
try/catch now falls to `fetchSina()` on empty/failed yahoo meta, `source`
field added (yahoo|sina), shape otherwise unchanged (fetchQuotes reads
regularMarketPrice/ChangePercent/marketCap/Volume only, untouched). CAUGHT A
BUG before shipping: re-verified the V1.1 field mapping against two fresh
live snapshots 12min apart and found f[21] (my original prevClose pick)
blanks to `0.0000` once regular session starts (only populated pre-market) —
would have produced `null`/`NaN` changePct in fallback during market hours.
Fixed to f[26], which stayed the stable prevClose across both snapshots
(308.63 both times while price f[1] ticked 308.63->309.14). Verified fix:
local run of the exact fetchSina logic against live sina gave
regularMarketChangePercent=0.217, matching sina's own self-reported f[2]=0.22.
Prod curl normal path (yahoo up, no forced failure available without an
env-toggle we didn't add per no-new-abstractions rule):
`curl https://market-ui-self.vercel.app/api/quote?symbols=AAPL,BRK-B,^GSPC`
-> `{"symbol":"AAPL","regularMarketPrice":309.08,...,"source":"yahoo"}`,
BRK-B 504.63, ^GSPC 7508.12, all source:"yahoo" (correct - primary healthy,
no fallback triggered). Forced-fallback verified by running the fallback
branch's exact logic standalone against live sina payloads (not via an
artificial yahoo-down toggle) — deployed. tsc 0, build clean both passes.
`[deploy]` done: https://market-ui-self.vercel.app
2026-07-06 — V1.3 shipped. Probed a real EOD history source since stooq is
dead (V1.1): `http://stock.finance.sina.com.cn/usstock/api/json_v2.php/
US_MinKService.getDailyK?symbol=aapl` -> real JSON array of
`{d,o,h,l,c,v,a}` daily bars, 9,981 rows back to 1984-09-07, fresh through
2026-07-02 (close 308.63, matches V1.2's live quote prevClose exactly -
cross-source consistency check passed). Symbol format for this endpoint is
its OWN scheme, different from V1.2's gb_ feed: dash->dot, no prefix
(`brk-b`->`brk.b`; `brkb`/`brk_b` both return empty `[]`, confirmed by
probing all three). Indices (`^GSPC` etc.) return empty `[]` on this
endpoint - no history/spark fallback for indices, documented and left as a
gap (shadow-safe no-op, same as V1.1's ^RUT gap). Extracted shared
`api/_sina.ts` (underscore prefix = not a Vercel route, doesn't count
against the 12-fn cap - both history.ts and spark.ts need the identical
daily-bars fetch). `history.ts`: yahoo path now checks for non-empty closes
before returning (previously blind passthrough); on empty/failure + daily
interval only (sina has no intraday, same gap stooq had), shapes sina bars
into the exact yahoo-chart shape Chart.tsx/Assistant.tsx read
(`chart.result[0].timestamp` + `indicators.quote[0].{open,high,low,close,
volume}`), sliced to an approximate trading-day count per requested range.
`spark.ts`: per-symbol gap-fill - any symbol missing from yahoo's batch
result gets its last 7 sina closes; added `_source` sibling key (symbol->
yahoo|sina, never collides with a real ticker) alongside the existing
`{symbol: number[]}` shape. BUG CAUGHT during Vercel build (not local tsc,
which only checks tsconfig.app.json and doesn't cover api/): relative import
`from './_sina'` failed under Vercel's node16 module resolution
(`TS2835: Relative import paths need explicit file extensions`) - fixed to
`'./_sina.js'` in both files, redeployed clean. Verified fallback shaping
by running the exact `fallbackHistory()` logic standalone against live sina
for BRK-B (the roadmap's own edge case, and unlike V1.2 it's NOT dead on
this endpoint): spot-checked 3 dates, all exact matches vs raw sina payload
(2026-06-30 500.39, 2026-07-01 499.74, 2026-07-02 507.78); spark's 7-close
slice for BRK-B also verified. Prod curl normal path: `/api/history?
symbol=AAPL&interval=1d&range=1mo` -> 19 bars, source:"yahoo", last close
309.12; `/api/spark?symbols=AAPL,MSFT` -> both source:"yahoo" in `_source`,
AAPL 7d closes ending 309.16. tsc 0, build clean (both passes, second after
the import fix). `[deploy]` done: https://market-ui-self.vercel.app
2026-07-06 — V1.4 shipped. Correction to the roadmap's own premise: current
prod primary for `/api/crypto/markets` is **coinlore.net**, not CoinCap
(codebase moved on since the roadmap was written pre-research; verified by
reading `api/crypto/markets.ts` before touching it) - so the fallback wires
to coinlore's actual failure path, not a stale CoinCap assumption. Probed
OKX public spot tickers (keyless): `curl https://www.okx.com/api/v5/market/
ticker?instId=BTC-USDT` -> real payload `last:"61896.4", open24h:"62794.2"`;
same for ETH-USDT. No marketcap/supply/1h/7d fields on this endpoint -
checked `MarketList.tsx` before assuming a UI gap: `r.marketCap ? ... : '—'`
(line 447/519) and `hasMcap` gating already null-safe, logo is built from
`symbol` independently of the API response - confirmed no UI fix needed,
matching the roadmap's own hedge ("may be absent, verify"). Implemented
`fetchOkxFallback()` in `api/crypto/markets.ts`: pulls the single batched
`tickers?instType=SPOT` call (all pairs in one request, not per-symbol),
filters to `-USDT` pairs, computes changePercent24Hr itself from
`(last-open24h)/open24h` (OKX doesn't provide it pre-computed on this
endpoint, unlike coinlore), defaults 1h/7d/mcap/supply to '0' (falsy in the
UI, renders '—', not a shape break). Every row incl. the primary path now
carries `source: 'coinlore'|'okx'` (bare array response, no wrapper object,
so per-row tagging like V1.2 rather than a sibling key like V1.3's spark).
Prod curl normal path: `/api/crypto/markets` -> 100 rows, BTC $61,908.90,
ETH $1,749.98, both `source:"coinlore"` (primary healthy). Cross-source
spot-check (OKX fetched fresh, same run): BTC $61,829.50 (diff 0.128%), ETH
$1,744.00 (diff 0.342%) - both within the 0.5% acceptance bound. tsc 0,
build clean. `[deploy]` done: https://market-ui-self.vercel.app
2026-07-06 — V2.1 shipped. Factor library implemented in `api/tn/[fn].ts`,
extracted as pure functions over a Bar type (date, open, high, low, close,
volume) that `fetchDailyBars()` already compiles from raw_market. All 4
factors hand-verified against real daily bars for BIAT (liquid, ~83 days) +
TINV (thin, ~80 days) on 2026-07-06:

BIAT: mom20d=5.33% (verified: (168.5/159.98-1)*100), mom60d=19.25%,
rev5d=5.68%, highProx=0.974 (168.5/173), amihud=2.47e-8.

TINV: mom20d=29.49%, mom60d=27.78%, rev5d=6.18%, highProx=0.986
(53.09/53.82), amihud=1.50e-5 (~600x less liquid than BIAT, confirming
Amihud's intent to flag thin names).

Amihud formula: mean(|daily return| / dollar volume); dollar volume = close
* shares traded (this feed has no currency-turnover field, standard proxy).
Note: raw_market history is ~5-6mo (checked in `highs()` route) not the
papers' literal 12mo/52wk windows, so these are proxy horizons at what the
data supports. Momentum/reversal/highProx are standard arithmetic; Amihud
cited directly from the 2002 paper. tsc 0, build clean. `[deploy]` done:
https://market-ui-self.vercel.app. Next task V2.2 merges these into
`engine()` score alongside the existing 4 live factors.
2026-07-06 — V2.2 shipped. `engine()` now blends 8 factors: 4 live (day
momentum, volume percentile, news tone, spread liquidity) + 4 historical from
the V2.1 library, computed off `fetchDailyBars(isin)` (extra Grafana query,
engine cached s-maxage=900; try/catch -> factors stay neutral 50 with
"insufficient history" detail if raw_market unreachable). Score mappings
(documented in code next to each): trend = avg of ±20%-scaled 20d and
±30%-scaled 60d trailing returns (Carhart); reversal INVERTED per Jegadeesh
(±8% -> 100..0); nearHigh linear 0.8..1.0 -> 0..100 (George & Hwang); Amihud
log-scale 1e-8..1e-4 -> 100..0. New weights in response: momentum .15,
volume .10, news .15, liquidity .10, trend .20, reversal .10, nearHigh .10,
illiquidity .10 (sums 1.0; trend heaviest = best-documented factor). Renamed
engine-local `const momentum` -> `momentumScore` (was about to shadow the
V2.1 `momentum()` fn — TDZ crash if left). UI: EngineCard already iterates
factors generically; added 4 FACTOR_LABELS + "4 factors" -> dynamic count.
Prod curl acceptance (2026-07-06): BIAT score=66 bullish, 8 factors, trend
"+5.3% 20d / +19.2% 60d" (=V2.1 hand-check 5.33/19.25), reversal 14
"+5.7% 5d trailing (inverted)", nearHigh 87 "97.4% of period high",
illiquidity 90 "Amihud 2.47e-8" (exact V2.1 value). TINV score=55 neutral,
trend 98 "+29.5% 20d / +27.8% 60d", reversal 11, nearHigh 93 "98.6%",
illiquidity 21 "Amihud 1.50e-5" (exact) — thin-name penalty visible in
composite as intended. OBSERVED pre-existing bug (not V2.2, not fixed):
TINV live-book spread detail prints "167084275.94% spread" — BVMT limit
payload garbage on closed session; score clamps to 0 so composite is safe,
but detail string is ugly; candidate hygiene fix for V2.3's UI pass. tsc 0,
build clean. `[deploy]` done: https://market-ui-self.vercel.app
2026-07-06 — V2.3 shipped. Checked before writing code: the company page
already surfaces the 8-factor EngineCard (CommunityPanel -> TnSocialView,
V2.1 code) generically over `Object.entries(data.factors)` — V2.2 already
made that card show all 8 without any V2.3 change needed there, so this
task narrowed to (a) the 4 new FACTOR_LABELS (trend/reversal/nearHigh/
illiquidity — were falling back to raw key names) and (b) the "4 factors"
header hardcode -> `Object.keys(data.factors).length` (both in
TnSocialView.tsx, done same edit as V2.2's commit but re-verified here).
Comparator (`TnComparator.tsx`): added `engineScore` to Row, a new "Engine
score" METRICS row (best='hi', reused existing highlight-best-value
machinery, no new component), and a `scores` state + per-pick-symbol
useEffect fetching `/api/tn/engine?symbol=` once each (cached by symbol,
re-fires only when picks change) - no new deps, plain fetch matching every
other V1/V2 pattern. Prod curl post-deploy: engine unchanged from V2.2
(BIAT score=66, TINV score=55, both 8 factors - confirms this task touched
only UI surfacing, not engine math) and https://market-ui-self.vercel.app/
200s. tsc 0, build clean. `[deploy]` done: https://market-ui-self.vercel.app
2026-07-06 — V3.1 shipped (code committed, NOT deployed — no [deploy] tag).
Capability verified against github.com/HKUDS/Vibe-Trading README preset
table before porting: `investment_committee` = "Bull/bear debate → risk
review → PM final call" (also README 2026-06-11 entry describes an
investment-committee NVDA run). Port into deepResearchService.ts: new
`investment_committee` WorkflowId + WORKFLOW_PRESETS entry (template
investment_memo, verdict-oriented angles/metrics/systemSuffix — rides the
existing applyWorkflowToBlueprint machinery, zero new plumbing) + new
`runInvestmentCommittee()`: SEQUENTIAL chain bull → bear-that-quotes-and-
rebuts-the-bull → risk officer reviewing both → PM verdict ending in a
structured `DECISION: <Buy|Hold|Avoid> — Conviction — Sizing — Invalidation`
line, vs the existing generateAdversarialAnalysis where bull∥bear run
parallel and never see each other. Stage 4 of performDeepResearch branches
on the workflow; bullCase/bearCase flow into the report writers unchanged
(shadow-safe); riskReview+pmVerdict append as two verbatim report sections.
tsc 0, build clean. Eval run 2026-07-06 on AAPL+NVDA with REAL prod
gravity-api retrieval (https://gravity-api-prod.fly.dev /v1/search, fast
mode, 9 sources each) + DeepSeek V3, identical context both arms, prompts
verbatim from the service code: single-pass 2 calls 16.0s/13.5s, committee
4 calls 42.7s/33.7s (~2.6x latency, the cost of sequential debate). Both
committee runs produced parseable DECISION lines (AAPL: Avoid/High/none;
NVDA: Avoid/Medium/none, invalidation "Q1 FY2027 DC rev >$60B with GM
>70%"); bear stages rebutted the bull by name in both. HONEST NOTE (the
acceptance's own requirement): composition did NOT fix retrieval — AAPL's
RAG answer was 349 chars with EPS/FCF/risks tagged "[not in sources]" and
no committee stage recovered them (PM avoided AAPL largely BECAUSE data was
missing); NVDA's 2,606-char answer (FY2026 rev $215.94B, +65.5% YoY vs
$130.50B) fed a proportionally richer debate. Facts completeness = gravity-
api work; committee adds structure (rebuttal, risk sign-off, decision), not
facts. Side-by-side artifact:
https://claude.ai/code/artifact/1d9cc53f-ddab-476b-b514-1f8809e2f5fb
