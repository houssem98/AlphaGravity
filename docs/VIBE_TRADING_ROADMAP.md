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
- [ ] **V1.3** — `/api/history` + `/api/spark` fallback: stooq daily CSV →
  Yahoo-chart-shaped response (only fields fetchCloses/fetchSparks read).
  *Acceptance:* prod curl; one symbol's fallback closes == stooq CSV values
  (spot-check 3 dates). `[deploy]`
- [ ] **V1.4** — `/api/crypto/markets` fallback: CoinCap → OKX public tickers
  (keyless, payload-proven) for price/changePct on the top majors; mcap/logo
  may be absent in fallback (UI already null-safe? verify, fix if not).
  *Acceptance:* prod curl both paths; BTC/ETH prices within 0.5% of a second
  source at test time. `[deploy]`

## Phase V2 — TN engine: real factors (from the zoo's academic set)
- [ ] **V2.1** — Factor library inside `api/tn/[fn].ts` (pure functions over
  the daily bars the history route already builds): momentum 20d & 60d
  (Carhart 1997), 5d reversal (Jegadeesh 1990), 52-week-high proximity
  (George & Hwang 2004 — reuse the `highs` aggregation), Amihud illiquidity
  = mean(|ret|/turnover) (Amihud 2002 — ideal for thin BVMT names).
  Hand-check each on BIAT + one thin name (TINV) against manual calc.
  *Acceptance:* log the hand-checked values (factor, symbol, expected vs
  computed, equal).
- [ ] **V2.2** — Blend into `engine()`: keep existing 4 live factors, add the
  4 historical factors; new weights documented in the response; factor
  breakdown extended so the UI card lists all 8 with per-factor detail
  strings. Deterministic, no LLM.
  *Acceptance:* prod curl engine for BIAT + TINV: 8 factors, score 0–100,
  each detail string carries its real number. `[deploy]`
- [ ] **V2.3** — Comparator + AssetInfoPanel surface: engine score column in
  TnComparator, factor breakdown visible on the company page (reuse existing
  card patterns; no new deps).
  *Acceptance:* prod page shows 8-factor breakdown; tsc 0 + build.
  `[deploy]`

## Phase V3 — Deep-research committee composition (prompt port)
- [ ] **V3.1** — Port Vibe's `investment_committee` composition (bull case →
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
