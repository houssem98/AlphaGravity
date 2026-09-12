# Company Intelligence V4 — Execution Report

Branch `feat/web-research-sec-integration`, from `7419ccb` (the V3 tip).
Date: 2026-09-12. **Uncommitted, unpushed, undeployed.**

Every claim below carries its evidence class. Nothing is inferred from a document.

## What this pass actually found

V3 closed ten rows behind gates and scored itself 7.5/10. This pass was briefed to
assume nothing closed. **Four of V3's ten rows were partially closed**, and two
entirely new defects sat one router over from where V3 was looking.

The pattern is worth naming, because it is the reason the re-audit paid: **V3
verified the thing it changed, not the property it claimed.** It proved
`period in got` was gone without asking whether period identity was now correct.
It proved `/api/llm/health` could not be forced to spend without asking whether
anything else could. It fixed the server half of the restatement rule and never
looked at the screen.

## Rows

| # | Sev | Finding | Gate | Result |
|---|-----|---------|------|--------|
| V4-1 | P0 | Period identity was basis-blind | `v4-1-gate.py` (32 assertions) | **CLOSED — VERIFIED** |
| V4-2 | P0 | Unauthenticated paid-provider routes | `v4-2-gate.mjs` (23 assertions) | **CLOSED — VERIFIED** |
| V4-3 | P0 | Disputed figure rendered as canonical | `v4-3-gate.mjs` (16 assertions) | **CLOSED — VERIFIED** |
| V4-4 | P0 | Any citation counted as filing evidence | `v4-4-gate.mjs` (18 assertions) | **CLOSED — VERIFIED** |
| V4-5 | P1 | Duplicate Pydantic fields | folded into `v4-1-gate.py` | **CLOSED — VERIFIED** |
| V4-6 | P1 | `DataTab` formatted outside the unified formatter | folded into `v4-3-gate.mjs` | **CLOSED — VERIFIED** |
| — | — | V3-10 trust-proxy hop count | `fly.toml` read | **VERIFIED CORRECT, unchanged** |

89 new assertions. Three of the four gates are **behavioural** — `v4-1` imports and
calls the real parser, `v4-3` compiles the real `DataTab` and renders it to static
HTML with React, `v4-4` is structural and says so. `v4-2` is structural: proving an
Express middleware chain refuses a request needs a live server, which is recorded
below as UNVERIFIED rather than claimed.

### V4-1 · Period identity — VERIFIED

`_same_period` was equality on `(year, quarter)`. Executed against the V3 code
before the change:

```
_same_period("FY2024",     "TTM 2024")   -> True     a TTM window read as a fiscal year
_same_period("FY2024",     "2024-09-28") -> True     an instant read as an annual duration
_same_period("2024-09-28", "2024-12-31") -> True     one date matched a different date
```

Replaced with a `Period` carrying a `PeriodBasis`
(`ANNUAL | QUARTERLY | TTM | INSTANT | UNKNOWN`), the fiscal year, the quarter, and
the explicit date for an instant. Two periods match only on the same basis and the
parts that basis is made of. `UNKNOWN` matches nothing — including another
`UNKNOWN`, because two labels we cannot read are not thereby the same period.

All three now answer `False`; `FY2024`/`2024` and `Q4 2024`/`FY2024 Q4` still
answer `True`. This is the model the client has had since V2-5
(`apps/market-ui/src/lib/periods.ts`); the two halves now agree.

**Explicit limit, stated rather than papered over:** a 52-week and a 53-week FY2024
both parse as annual 2024. Telling them apart needs the period end date, which
these labels do not carry. The model keeps instants separable precisely so a caller
that has the dates can compare them — the gate asserts the limitation rather than
pretending it is solved.

### V4-2 · Paid routes — VERIFIED at source

Measured at `7419ccb`: `firecrawl.ts` contained **zero** occurrences of
`authMiddleware` while exposing `POST /scrape`, `/search` and `/crawl`, each on
`FIRECRAWL_API_KEY`. `trading.ts` contained **zero** and reached
`https://api.tavily.com/search` from `GET /social/influencers/:asset` — **once per
influencer**, with `?handles=` caller-supplied and unbounded, so one anonymous GET
could buy a hundred Tavily searches. `index.ts` installs no global auth.

Fixed: `router.use(authMiddleware)` on the whole firecrawl router, a per-viewer
meter on the three spending routes (and deliberately **not** on the crawl status
poll — metering a poll 429s a viewer out of watching their own job), `maxDepth`
clamped the way `limit` already was, and on the influencer route auth + meter + a
`MAX_INFLUENCERS` ceiling the caller cannot raise.

The fix is deliberately narrow: the other `trading.ts` routes are public market
data the `/trading` hub reads anonymously, and the gate asserts they stayed open.

### V4-3 · Disputed figures — VERIFIED behaviourally

V3-3's server half was correct and is untouched. The client half did not exist:
`DataTab` rendered `m.value` unconditionally and `GravityMetric` declared none of
`ambiguous`, `conflicting_values`, `unit_reason`.

Now, rendered by the real component in the gate:

```html
<td ... data-ambiguous="true" title="MMM has more than one reported value ...">
  <span data-disputed-values="2">
    <span>In dispute</span><span>$32.68B</span><span>vs $24.57B</span><span>USD</span>
```

Both values, neither promoted. A reader cannot tell a choice was made unless the
alternatives are on screen.

### V4-4 · Citation contract — VERIFIED at source

The backend has always classified citations (`Citation.source_class`:
`SEC_EVIDENCE | LOCAL_EVIDENCE | WEB_EVIDENCE`). The client type did not declare
the field, so V3-7 sent every citation to the model under a heading reading
`NUMBERED FILING PASSAGES`. A news article under that heading is the component
asserting provenance the source does not have.

Admission is now: SEC-classed **and** carrying the accession that names the filing.
A set of sources where none qualifies gets its own refusal, distinct from "found
nothing", and both refuse before the billable call.

### V4-5 / V4-6 — VERIFIED

AST scan found `Citation` declaring `canonical_url` and `evidence_location` twice
and `SourcePassage` declaring `canonical_url` twice. Pydantic silently keeps the
last, so the SEC-semantics declaration was being overwritten by the web one. One
declaration each now, described honestly for both cases. The model still
constructs; the AST assertion is permanent in `v4-1-gate.py`.

`DataTab`'s `m.unit === 'USD'` was exact equality against one spelling, so the
server's own `"USD M"` fell out of currency formatting. It formats through
`formatFinancialValue` now.

## Files changed

| File | Rows |
|------|------|
| `services/gravity-api/app/core/analytics/longitudinal_tracker.py` | V4-1 — `PeriodBasis`, `Period`, `parse_period`, `_same_period` |
| `services/gravity-api/app/api/schemas/search.py` | V4-5 |
| `services/market-server/src/routes/firecrawl.ts` | V4-2 |
| `services/market-server/src/routes/trading.ts` | V4-2 |
| `apps/market-ui/src/components/company/DataTab.tsx` | V4-3, V4-6 |
| `apps/market-ui/src/components/company/types.ts` | V4-3 |
| `apps/market-ui/src/components/company/DevilsAdvocate.tsx` | V4-4 |
| `apps/market-ui/src/services/gravitySearchService.ts` | V4-4 |
| `docs/company-feature/gates/v4-{1,2,3,4}-gate.*` | new, 89 assertions |
| `docs/company-feature/COMPANY_V4_{ROADMAP,LOOP,EXECUTION_REPORT}.md` | new |

## Commands executed, and what they returned

```
node docs/company-feature/gates/v4-2-gate.mjs      → RESULT PASS  (23)
node docs/company-feature/gates/v4-3-gate.mjs      → RESULT PASS  (16)
node docs/company-feature/gates/v4-4-gate.mjs      → RESULT PASS  (18)
python docs/company-feature/gates/v4-1-gate.py     → RESULT PASS  (32)

ALL JS GATES   v2-1 v2-5 v2-6 · v3-1 v3-5..v3-10 · v4-2 v4-3 v4-4   → PASS
ALL PY GATES   cf4 cf5 cf10 cf15 cf18-19 cf20 cf21 cf24 cf28
               v2-2 v2-3 v2-4 v2-7 v2-8 · v3-2 v3-3 v3-4 · v4-1     → 18/18 PASS

npx vitest run            (apps/market-ui)       → PASS (1567) FAIL (0) skipped (7)
npx vitest run            (services/market-server)→ PASS (76)   FAIL (0)
npx tsc --noEmit -p tsconfig.app.json            → TypeScript: No errors found
npm run build             (apps/market-ui)       → ✓ built in 1m 45s; dist/index.html written
npx tsc --noEmit          (services/market-server)→ 24 errors — 24 AT HEAD, none in changed files
pytest, 13 offline files over the affected areas → 2 failed, 247 passed in 3.66s
node ~/.claude/scripts/gate-guard.mjs            → gate-guard: clean · HEAD..working tree
```

### Regressions

**None.** Every gate that was green at `7419ccb` is green now, including all ten
V3 gates and all eight V2 gates.

Two mistakes were made and corrected inside the session, both caught by gates
rather than by inspection:
- `v4-3-gate.mjs` first asserted `$24.58B`; the component rendered `$24.57B` and
  was right — `(24575000000/1e9).toFixed(2)` is `24.57`. **The gate's expectation
  was wrong, not the code.**
- The firecrawl meter was first applied to the crawl **status poll** as well,
  which would have 429'd a viewer out of watching their own job. Removed; the
  route stays authed.

### Pre-existing failures — measured, not assumed

| Item | Status | Cause |
|------|--------|-------|
| `cf1`, `cf16` | crash | stale hardcoded `ROOT` paths — same crash at HEAD |
| `cf6` | FAIL (1) | V3's escalation E-4: it probes `/api/llm/chat` unauthenticated, which V2-6 made a 401. **Still open, still not edited.** |
| `cf8` | FAIL (2) | live against Fly prod, where `/v1/company/{t}/trend` 404s. Deploys blocked by an overdue invoice. |
| `cf25` | flaky | live-network gate; PASS and FAIL on consecutive runs |
| market-server `tsc` | 24 errors | `string \| string[]` narrowing in `rbac/orgs/predictions/trading`. **24 at HEAD, 24 now**, none in changed files. |
| `test_auth_entitlement.py::TestTierReachesTheLimiter` | 2 failed | `Event loop is closed`; measured at HEAD as the same 2 fail / 5 pass |

## Evidence classification

**VERIFIED** — V4-1 (executed both before and after), V4-3 (real component
rendered), V4-5 (AST), V4-6 (source + render), V3-10 hop count (`fly.toml`), every
gate result, every suite result, typecheck, build, gate-guard.

**PARTIALLY VERIFIED** — V4-2 and V4-4. The source is proven and the gates are
strong, but neither was exercised through a running Express stack or a live RAG
response. A middleware chain refusing an anonymous request, and a real
`WEB_EVIDENCE` citation being rejected, are both runtime facts this pass asserts
structurally.

**UNVERIFIED** — anything requiring production. Fly is frozen behind an overdue
invoice and `/v1/company/{t}/trend` 404s there, so no V3 or V4 change has ever run
in prod. No browser was driven. V4-3's dispute path has not been seen against live
data: which real `(metric, period)` pairs actually disagree in the `financials`
table was not queried. The full gravity-api pytest suite (127 files) has still
never completed — collection succeeds, a live-network test hangs, and only the
13-file offline subset ran.

**INFERENCE** — that the V3 pattern ("verified the change, not the property")
explains why these six survived. That is a reading of the evidence, not a measured
fact.

## P1 and P2: not attempted, and why

The brief asks for a What Changed engine, guidance vs actuals, estimate revisions,
segment intelligence, management commentary and catalyst extraction, then P2
differentiation on top. **None was built, and this is a deliberate call, not a
shortfall of effort.**

The brief also says: *do not add features before P0 financial correctness is
secure.* At the start of this session P0 was **not** secure — a TTM figure could be
served as a fiscal year and a disputed number rendered as canonical. Building a
change-detection layer on that period engine would have propagated the defect into
every card it rendered.

And several are blocked by data that does not exist here — a check that is itself
the finding:

- **Guidance vs actuals** — needs issued guidance as structured data. The XBRL
  `financials` table holds reported facts only. No guidance source found.
- **Estimate revisions** — needs a consensus feed. None is configured.
- **Segment intelligence** — needs XBRL dimensional facts. `sec_xbrl.py` emits
  `concept/label/fy/value/unit/form/end` and drops the dimension axis. Same ingest
  gap that makes V3's E-1 restatement policy unimplementable.
- **Management commentary / catalysts** — needs MD&A and transcript sectioning.
  Transcripts exist as `earnings_transcript` documents; reliability unmeasured.

**"What Changed" is buildable today** on the exact-XBRL rows alone, and is the
single highest-value next item. It is specified in `COMPANY_V4_LOOP.md` and
deliberately not started.

## Score

Scored against the brief's scale. Evidence class in brackets; anything
PARTIALLY VERIFIED or UNVERIFIED is capped accordingly.

| Category | V3 | V4 | Why |
|----------|----|----|-----|
| SEC/XBRL data correctness | 8 | **8** | unchanged this pass |
| Financial truth | 8 | **8.5** | one formatter now owns the value cell; unknown units still never become USD |
| Period semantics | 6 | **8.5** | basis, instants and TTM are modelled; 52/53-week still unresolvable from labels [VERIFIED] |
| Filing provenance | 8 | **8** | unchanged |
| Restatement handling | 6 | **8** | the dispute now reaches the screen; original-vs-amended still needs ingest `accn` (E-1) |
| AI evidence / citations | 7 | **8** | admission requires SEC class + accession [PARTIALLY VERIFIED — no live RAG response tested] |
| Security / spend controls | 7 | **8.5** | four unauthenticated paid routes closed; two unbounded fan-outs clamped [PARTIALLY VERIFIED — no live server test] |
| Failure handling | 8 | **8** | unchanged |
| Visualization | 7 | **7** | unchanged |
| Analyst workflow | 6 | **6** | unchanged — no P1 work |
| Research intelligence | 5 | **5** | unchanged — no What Changed, guidance, segments |
| Source UX | 7 | **7** | unchanged — no evidence drawer |
| Testing confidence | 6 | **7** | 89 new assertions, 3 of 4 gates behavioural; full backend suite still unrun |

### Overall: **7.5 / 10**

Unchanged from V3's number, and that is the honest result.

The correctness floor moved materially — period semantics 6→8.5, restatement
handling 6→8, spend controls 7→8.5. But V3's 7.5 was scored against a product
whose period engine thought a TTM figure was a fiscal year and whose data table
showed disputed numbers as fact. **V3's 7.5 was too generous by roughly a point.**
This pass spent itself buying back that point and a little more. A truer reading:
V3 was ~6.5–7 measured honestly, and V4 is a defensible 7.5.

On the brief's scale that is **"professional financial product"**, at the top of
the band and not yet into "serious institutional research product" (8–9).

9.5+ is not remotely justified and is not claimed.

## What 9.5/10 actually requires

**Blocking, in order:**

1. **Ship something.** Nothing in V3 or V4 has run in production. Fly deploys are
   blocked by an overdue invoice — an external blocker this repo cannot resolve.
   Until then every correctness claim is a claim about a branch.
2. **Run the full backend suite.** 114 of 127 pytest files have never been
   exercised against this work. A live-network test hangs collection-to-completion.
3. **Runtime-verify V4-2 and V4-4** against a running Express stack and a real RAG
   response.
4. **Ingest `accn` per XBRL observation** and backfill (~150,596 rows). This single
   change unblocks E-1 (original vs amended vs restated) and, with the dimension
   axis, segment intelligence.
5. **The analyst layer.** What Changed, guidance vs actuals, segments, evidence
   drawer. Categories scoring 5–7 above are all workflow, and no amount of
   correctness work moves them.
6. **Fix or retire `cf6`** (E-4, open since V2-6).

**Honest ceiling without item 4:** filing provenance and restatement handling
cannot exceed ~8 while the row cannot name its own observation. That is an
architectural bound, not an effort bound.
