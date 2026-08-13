# PLANS — a paywall that actually holds, from /search to /trading

**Ledger.** Tasks `PL-1..PL-12`, gaps `E1-E6` / `S1-S4`, acceptance rows `R1-R14`.
Commit scope `plans`.

**The request.** A TradingView-style tiered pricing surface for AlphaGravity — an
upgrade button and a per-feature matrix spanning the search surface and the trading
surface — plus the harness and the loop to build it.

**The correction this ledger makes to that request.** The pricing table is the *last*
task, not the first. AlphaGravity already sells three plans and **enforces none of
them**. A prettier table on top of an unenforced paywall sells a promise the server
does not keep. §1 is the measurement; §7 puts the spine before the paint.

**And the checkout it would feed is half-off.** Live `GET /v1/billing/config` on
`gravity-api-prod.fly.dev`, fetched 2026-08-13, returns **`paypal:true payoneer:true`
and nothing else** — Paddle (card) and crypto are configured in code but disabled in
production. Four providers exist in `billing.py`; two are reachable by a buyer. §1f.

---

## 1. What TradingView does, and what is actually true here

TradingView's plan table (the reference the request supplied, four columns
Essential / Plus / Premium / Ultimate at $12.95 / $29.95 / $59.95 / $199.95 per month
billed annually) is not a list of adjectives. Three properties make it work:

1. **Every row is the same question asked of every tier.** "Charts per tab" is
   2 / 4 / 8 / 16. "Price alerts" is 20 / 100 / 400 / 1,000. The row exists in all
   four columns; only the number changes.
2. **Absence is rendered, not omitted.** `✗ Volume footprint` sits greyed and
   struck-through in Essential and Plus. The buyer sees the ceiling they are under.
3. **The number is the product's real limit.** The table is a rendering of the
   entitlement the server enforces, not marketing copy maintained separately.

Measured against this tree on 2026-08-13, all three are false here.

**1a — Our plan schema cannot express a matrix.** `billing.py:88-120` defines each
plan as `features: list[str]` (prose bullets: `"Unlimited searches"`,
`"Deep Research mode"`) plus `limits: {"searches_per_day": int, "seats": int}`.
Two numeric dimensions exist for the entire product. `BillingPage.tsx:205` renders
them with `plan.features.map(...)` — three independent bullet lists side by side.
There is no row that exists in every column, so there is nothing to compare and
nothing to grey out. A TradingView table is not a restyle of this component; it is a
different data shape.

**1b — The tier vocabularies disagree, and the disagreement fails silently.**

| source | file | tiers |
|---|---|---|
| billing config | `billing.py:88-125` | `free`, `pro`, `team` |
| rate limiter | `rate_limit.py:30-36, 61-67` | `free`, `individual`, `team`, `enterprise`, `unlimited` |
| org table | `20260430_rbac.sql:36` | `free`, `pro`, `enterprise` |

`rate_limit.py:98` reads `MINUTE_LIMITS.get(tier, 10)`. A user on the `pro` plan is
not a key in that dict, so the lookup takes the default: **10 requests/minute — the
free-tier limit.** The monthly table at `rate_limit.py:61` has the same hole. Nobody
raises, nobody logs; the paying customer is throttled at the free rate and the
symptom is indistinguishable from normal.

**1c — The subscription is never read on the request path.** `auth.py:134-142`, the
Supabase branch of `_to_auth_dict`, returns a literal:

```python
"entitlements": ["public"],
"tier": "free",
```

Production market-ui authenticates through Supabase. So the tier every request
carries is the constant `"free"`, before 1b even gets a chance to mis-key. The only
symbol `billing.py` exports to the rest of the service is `ensure_billing_schema`
(`main.py:54`) — a DDL call. `billing_subscriptions` is written by the webhooks and
read by `/v1/billing/me` and the admin list. **No code path between a paid
subscription and a served request exists.**

**1d — The surface the request wants to sell is public, and confirmed so in
production.** `AppRouter.tsx:170` mounts `/trading` *outside* `ProtectedRoute` — the
whole trading terminal renders with no session. `trading.py:98` declares
`@router.post("/ask")` with no auth dependency at all, so the Hermes LLM call behind
it is unauthenticated and unmetered spend.

That was a code reading. `PL-1` then measured it live on 2026-08-13:

```
POST https://gravity-api-prod.fly.dev/api/trading/markets/ask
     {"asset":"BTC","question":"probe"}     →  200
```

No token, no session, no rate-limit header. **Note the path.** Every other route in
this service is `/v1/...`; this one is the router's own prefix `/trading/markets`
(`trading.py:12`) under the app prefix `/api` (`main.py:353`), so `/v1/trading/ask`
returns 404 and a probe written against it would have reported the endpoint as
harmless. `R10` carries the correct path.

**1e — The product has no paywall boundary.** Grepping `src/` for `upgrade` returns
eight files; the only one that is a real call-to-action is `BillingCancelPage.tsx`,
which you reach *after* abandoning a checkout. Zero gates, zero quota meters, zero
in-context upsells across `/search`, `/companies`, `/documents` and `/trading`.

**1f — There is no instant checkout in production.** Measured against the live API
2026-08-13, not read from the source defaults:

```
GET /v1/billing/config  →  200
free | $0   | {"searches_per_day":10,"seats":1} | 3 features
pro  | $49  | {"searches_per_day":-1,"seats":1} | 5 features
team | $499 | {"searches_per_day":-1,"seats":5} | 6 features
providers: paypal:true payoneer:true
```

Two consequences. First, the live plans are byte-identical to the `billing.py` defaults,
so nobody has ever customised pricing through the admin API and §1's line references
describe what is actually served. Second, **card checkout is off.** The remaining
non-PayPal path is Payoneer, which `BillingPage.tsx:157` correctly describes as
*"Plan activates within 24h after we confirm receipt"* — a manual transfer an
administrator confirms by hand. A TradingView-style "Start now" button implies a
30-second upgrade. Half of ours is a bank transfer and a wait. This is not a UI
problem and `PL-10` cannot fix it; see `S5` and §10 `E-C`.

**What is NOT a target.** TradingView's per-tier numbers (charts per tab, parallel
chart connections, alerts that don't expire) describe a charting product with a
multi-pane layout engine and a persistent server-side alert daemon. This tree has
neither. §4's matrix uses *our* capability rows, measured from the code in §2. A
roadmap that copies their row labels is describing someone else's product.

---

## 2. Anchors — the capability inventory

Every row in §4 must resolve to something in this table. Nothing else may be sold.

**What this table proves, and what it does not.** Each file below was confirmed to
exist on disk. **None of them was exercised.** A 16KB `sso.py` proves someone wrote
SSO, not that a SAML login completes. Treat this as a list of candidates to sell, not
a list of working features — §3 rule 6 forbids selling a row whose feature is dead,
and only `PL-12`'s sweep can tell the difference. Any row still unexercised when
`PL-12` runs is struck from §4 rather than shipped.

**Search surface** — `/search`, `/companies`, `/documents`, `/history` (protected,
`AppRouter.tsx:180-204`):

| capability | where it lives | today's gate |
|---|---|---|
| QA search | `SearchPage.tsx:47` mode `qa` | rate limit only, always free-tier |
| Research Grid | `SearchPage.tsx:47` mode `grid`; `grid_search.py` | none |
| Grid schedules | `grid_schedule.py`; `0005_grid_schedules.sql` | none |
| Company intelligence | `SearchPage.tsx:47` mode `company`; `CompanyPage.tsx` | none |
| Deep Research | `SearchPage.tsx:47` mode `research`; `deepResearchService.ts` | none |
| Document upload / ingest | `DocumentsPage.tsx`; `documents.py` | none |
| History + report viewer | `HistoryPage.tsx`; `ReportViewerPage.tsx` | none |
| Programmatic API keys | `apiKeys.ts` | none |
| Workspaces (seats) | `workspaces.py` | none |
| SSO / SAML | `sso.py` | none |
| MFA | `MfaSetupPage.tsx` | none |
| Audit log | `auditClient.ts` | none |

**Trading surface** — `/trading` (public, `AppRouter.tsx:170`):

| capability | where it lives | today's gate |
|---|---|---|
| Multi-market terminal | `MarketHub.tsx`; `Markets.tsx` | none, and no session |
| Chart + indicators | `Chart.tsx`; `TnChart.tsx` | none |
| Screener / column chooser | `MarketList.tsx` | none |
| Order book / depth | `OrderBook.tsx` | none |
| News terminal | `components/trading/tabs/` | none |
| Portfolio | `PortfolioPanel.tsx` | none |
| Comparator | `TnComparator.tsx` | none |
| Community / social | `CommunityPanel.tsx`; `TnSocialView.tsx` | none |
| Dexter AI agent | `dexterGraph.ts` + 20 sibling services | none |
| Ask Hermes | `trading.py:98` | **no auth at all** |

---

## 3. Doctrine — what makes this loop different

1. **The spine before the paint.** No task that changes a pixel of pricing UI may be
   checked `[x]` before `PL-5` is green. An upgrade button over an unenforced tier is
   a lie rendered at 60fps.
2. **One tier vocabulary, one resolver.** Every tier decision in the service reads
   the same function. A second `MINUTE_LIMITS`-shaped dict added anywhere is a
   regression, and `R3` is what catches it.
3. **A missing key is an error, never a default.** `1b` happened because `.get(tier, 10)`
   turned an unknown plan into the free plan. Resolvers raise on an unknown tier; the
   caller decides the fallback explicitly and logs it.
4. **Never widen a gate to make a test pass.** Enforcement code is gate code. Loosening
   a limit, deleting an assertion, or adding an early-return bypass is exactly what
   `gate-guard` exists to catch — run it before every commit that claims green.
5. **Prices and public surfaces are not the loop's to decide.** §4's numbers are
   PROPOSED. Rendering a price to a real user, or closing `/trading` to anonymous
   visitors, is an escalation under §10 — both are outward-facing and one of them
   moves money.
6. **Sell only §2.** If a row in §4 does not resolve to a file in §2, delete the row.
   The corpus is S&P 500 SEC filings, BVMT and ~200 crypto assets; no tier may imply
   coverage we do not have.

---

## 4. The proposed matrix — ⚠ PRICES UNCONFIRMED (§10 E-P)

Four tiers, ascending, mirroring the reference table's shape. The ladder the request
described — search first, trading unlocked above it — is encoded in the two
capability blocks: everything a tier gets in **Research** it also gets before any
**Terminal** row turns on.

| | **Free** | **Analyst** | **Professional** | **Institutional** |
|---|---|---|---|---|
| **price / mo, billed annually** | $0 | $39 | $99 | $399 |
| **billed monthly** | $0 | $49 | $129 | $479 |
| seats | 1 | 1 | 3 | 10 |

**Research — the /search surface**

| row | Free | Analyst | Professional | Institutional |
|---|---|---|---|---|
| QA searches / day | 10 | 500 | 2,000 | unlimited |
| requests / minute | 10 | 60 | 120 | 600 |
| Research Grid runs / day | 2 | 50 | 250 | unlimited |
| Grid columns per run | 5 | 20 | 50 | unlimited |
| Scheduled grids | ✗ | 3 | 25 | unlimited |
| Deep Research runs / day | ✗ | 10 | 50 | 250 |
| Document uploads / mo | 5 | 200 | 2,000 | unlimited |
| History retention | 7 days | 1 year | unlimited | unlimited |
| Report export (memo / PDF) | ✗ | ✓ | ✓ | ✓ |
| API keys | ✗ | 1 | 5 | 25 |
| Audit log | ✗ | ✗ | ✓ | ✓ |
| SSO (SAML) | ✗ | ✗ | ✗ | ✓ |

**Terminal — the /trading surface**

| row | Free | Analyst | Professional | Institutional |
|---|---|---|---|---|
| Markets | 1 (crypto) | all 6 | all 6 | all 6 |
| Watchlist symbols | 10 | 100 | 500 | unlimited |
| Chart indicators | 3 | 10 | 25 | 50 |
| Screener columns | 8 | 30 | all | all |
| Order book / depth | ✗ | ✓ | ✓ | ✓ |
| News terminal | headlines | full | full | full |
| Portfolio tracking | ✗ | ✓ | ✓ | ✓ |
| Comparator | ✗ | ✓ | ✓ | ✓ |
| Ask Hermes / day | 5 | 100 | 500 | unlimited |
| Dexter agent runs / day | ✗ | 10 | 100 | unlimited |
| Dexter debate + risk trio | ✗ | ✗ | ✓ | ✓ |
| Decision journal + replay | ✗ | ✗ | ✓ | ✓ |

**The Free row is held at today's live value on purpose.** `searches_per_day: 10` is
what production serves (§1f). Loosening the free tier is a growth decision with a
revenue cost, not a formatting choice, and this loop does not get to make it by typing
a bigger number into a table. Any change to the Free column is §10 `E-P`.

Legacy plan ids map forward, so no existing subscriber loses access:
`pro → professional`, `team → institutional`, `individual → analyst`,
`enterprise → institutional`. The map is data, asserted by `R3`.

---

## 5. Gaps

**Entitlement spine**

- **E1** — no resolver: nothing maps `user_id → plan → limits` on the request path (§1c).
- **E2** — vocabulary split three ways, failing silently to free (§1b).
- **E3** — `auth.py:142` hard-codes `tier: "free"` for every Supabase session (§1c).
- **E4** — plan schema holds two numbers; the matrix needs ~25 (§1a).
- **E5** — no usage counters readable by the UI, so a quota meter would be decorative.
- **E6** — no denial path: nothing anywhere returns "you are over your plan limit".

**Surface**

- **S1** — `/trading` renders with no session (§1d).
- **S2** — `/v1/trading/ask` accepts unauthenticated LLM spend (§1d).
- **S3** — plan cards are three bullet lists, not a matrix (§1a).
- **S4** — zero in-context upgrade CTAs (§1e).
- **S5** — no instant checkout: card and crypto disabled in prod, leaving PayPal and a
  manual 24h Payoneer transfer (§1f). The upgrade button's destination is the
  constraint on this whole ledger, and no §7 task removes it.

---

## 6. Acceptance rows

Each row is one binary check. `R1` is the gate: it runs first and a red `R1` halts the
loop whatever the task list says.

**Instruments.** `R1-R8` and `R15` are asserted by `scripts/entitlement-probe.mjs`
(`PL-1`). `R9-R14` are browser-observable and run in the existing Playwright harness
at `apps/market-ui/e2e/` — `npm run e2e`, with the signed-in fixture from
`auth.setup.ts`. A row whose instrument is not named is a wish; these are the two that
exist, and no third one may be invented to grade this loop.

| row | asserts | how it is measured |
|---|---|---|
| **R1** | the entitlement probe runs and every assertion is binary | `node scripts/entitlement-probe.mjs` exits 0 |
| **R2** | exactly one tier vocabulary is defined in the service | probe greps for a second limits dict; finds 0 |
| **R3** | every legacy plan id resolves forward | 4/4 of `pro`,`team`,`individual`,`enterprise` map |
| **R4** | an unknown tier raises, never silently defaults | probe asserts the raise |
| **R5** | a `professional` JWT is served `professional` limits | live request; header shows 120, not 10 |
| **R6** | every capability key names a source file that exists | probe reads `PL-5`'s capability declarations; 0 orphan `source=` paths |
| **R7** | every §4 row is defined for all 4 tiers | 0 holes in the matrix |
| **R8** | over-limit returns 402 naming the plan and the row | probe: `enforce.py` raises 402, wired at real call sites, denial body asserted by `test_enforce.py` |
| **R9** | `/trading` requires a session | anonymous fetch redirects to `/auth` |
| **R10** | `/v1/trading/ask` rejects an anonymous call | anonymous POST returns 401 |
| **R11** | the pricing table renders all §4 rows in all 4 columns | DOM count = rows × 4 |
| **R12** | unavailable rows render struck-through, not omitted | `✗` cells present in DOM |
| **R13** | a denied action shows an upgrade CTA naming the needed tier | click-through from the denial |
| **R14** | the quota meter's number equals the server's counter | UI value == `/v1/usage` value |
| **R15** | every tier the table sells has a reachable checkout | live `/v1/billing/config`; enabled providers > 0 and at least one is instant |
| **R17** | the plan meter reads the counter the gate writes | probe: `peek()` exists and never increments, `/plan/usage` uses `snapshot()`, boundary agreement tested |
| **R16** | the JWT path takes its tier from the subscription | probe: `require_auth` calls `_apply_entitlement`, no `"tier": "free"` literal survives, and a test reads the served limit off the header |

---

## 7. Tasks

- [x] **PL-1 — the gate.** Write `scripts/entitlement-probe.mjs`: the kill authority
      for this loop. It asserts `R2`, `R3`, `R4`, `R6`, `R7` statically against the
      source, and `R5`, `R8`, `R15` against a running API when one is reachable
      (skipping, and *saying* it skipped, when it is not — a skipped check is never a
      pass). Add it to the `loops` script chain. No later task may be checked before
      this one is green.

- [x] **PL-2 — one vocabulary.** Define the four tiers plus the legacy map in one
      module, server-side, and one mirrored constant in `packages/shared-types/`.
      Delete `MINUTE_LIMITS` / `MONTHLY_LIMITS` as independent tables — they become a
      projection of the matrix. `R2`, `R3`.

- [x] **PL-3 — the resolver.** `entitlements_for(user_id) → dict`, reading
      `billing_subscriptions` with a short cache. Unknown tier raises (§3 rule 3).
      `R4`.

- [x] **PL-4 — wire auth.** Replace the literal at `auth.py:142` with a resolver call
      so a Supabase session carries its real tier. `R16` in the diff; `R5` on deploy.

- [x] **PL-5 — the matrix schema.** Extend the plan config from
      `features: list[str]` to `capabilities: dict[str, int | bool | "unlimited"]`,
      keeping `features` for prose. Admin PUT accepts and validates it: every
      capability key must exist in all four tiers. `R6`, `R7`. **This is the spine —
      §3 rule 1 blocks PL-9 and PL-10 until it is green.**

- [x] **PL-6 — enforce: research.** Gate the §4 Research rows at their call sites.
      Over-limit returns 402 naming the plan and the row. `R8`.

- [x] **PL-7 — enforce: terminal.** Gate the §4 Terminal rows. `R8`.

- [ ] ⛔ **PL-8 — close the public surface.** *(PARKED — escalated to the owner as §10 `E-T`; the loop moves to `PL-9`.)*
      Original text: Move `/trading` inside `ProtectedRoute`
      and add auth to `trading.py:98`. `R9`, `R10`. **⚠ ESCALATION before merge —
      outward-facing, §10 E-T.**

- [x] **PL-9 — usage counters.** Expose per-capability consumption through
      `usage.py` so a meter can be honest. `R14`.

- [x] **PL-10 — the pricing table.** Rebuild the plan surface as a four-column matrix:
      every §4 row in every column, `✗` rendered struck-through, annual/monthly toggle
      showing the saving, one "Start now" per column. `R11`, `R12`. **⚠ prices stay
      placeholder until §10 E-P clears.**

- [x] **PL-11 — the upgrade moment.** At each denial point, an inline CTA naming the
      capability, the current usage, and the tier that lifts it. `R13`.

- [x] **PL-12 — the sweep.** Run every §6 row against both surfaces and all four
      tiers. **Additionally exercise every §4 row once** — §2 proved the files exist,
      not that the features run, and a row that cannot be demonstrated is struck from
      the table instead of sold. Paste the full matrix into §8, including the strike
      list. A red row here reopens its task rather than closing the ledger.

---

## 8. Log

Append one line per iteration: task, rows checked, **real numbers**, no adjectives.

| date | task | result |
|---|---|---|
| 2026-08-13 | — | ledger opened. Measured: 3 tier vocabularies, 0 enforcement paths, 1 public paid surface, 0 upgrade CTAs. |
| 2026-08-13 | STOP | **loop ended, and not on TARGET.** §9's target requires no `[ ]` in §7 *and* every row green; neither holds. `PL-8` is parked on §10 `E-T` and `R5`/`R9`/`R10` are blocked on a gravity-api deploy this loop may not perform. Every remaining item is a decision or an action that belongs to the owner, so per `docs/LOOP_CONVENTIONS.md` §6 the loop reports rather than ticks. **11 of 12 tasks done, 1 parked, 12 iterations of a 30 budget, 12 commits.** Continuing would mean inventing work to stay alive, which §2 forbids. Four escalations wait: `E-T` closing `/trading` (three changes, not two — `HermesQueryPanel.tsx` sends no token), `E-G` `POST /v1/grid` unauthenticated, `E-C` no instant checkout beyond PayPal, `E-P` the prices. One action unblocks the most: deploying gravity-api turns `R5`, `R9`, `R10` and the e2e run from pending into measurable. |
| 2026-08-13 | PL-12 | **the sweep, and one row struck.** Built as `scripts/plans-sweep.mjs` (7 self-check assertions) so it is repeatable after the deploy rather than a one-off reading. It reports, per capability, which executed test references it, and **fails the build when a server-enforced row has none** — those are the ceilings the product charges for; an untested one is a paywall nobody has seen work. First run: **10/11 server rows exercised, 1 STRIKE — `company_profiles`**. It read `✓` in all four columns, so it differentiated nothing, and no test referenced it. A row identical across every tier is marketing copy, not a pricing row. **Struck from `capabilities.py` and from §4** per §3 rule 6; the matrix is now **24 capabilities**, and the sweep reads **10/10 server rows exercised, 0 orphan sources**. Client rows: 11/14 referenced, the remaining 3 (`grid_columns_per_run`, `deep_research_per_day`, `report_export`) are advisory by declaration and do not fail the build. **Gate totals**: `npm run loops` green; `npm run loops:test` **119 assertions across 7 checkers** (loop-lint 29, graph-lint 9, governance 28, loop-prompt 17, gate-guard 21, entitlement-probe 15, plans-sweep 7); pytest **86 passed**; vitest **1282 passed / 0 failed**; `tsc` clean. `R1-R17`: **15 enforced, 0 failing, 1 pending, 1 skipped**. **Live prod re-measured this iteration** (`gravity-api-prod.fly.dev`): `/health` 200, `/v1/billing/config` 200 but **`capabilities: 0`** — the matrix endpoint is not deployed; `/v1/plan/usage` **404** — the meter endpoint is not deployed; `POST /api/trading/markets/ask` still **200 anonymous** — the metering is not deployed either. **Nothing built in these twelve iterations is live.** That is the honest closing number: the paywall holds in the repo and does not yet hold in production, and the single action that changes it is the gravity-api deploy §10 has been holding since PL-4. |
| 2026-08-13 | PL-11 | the upgrade moment exists, and it fixes a rendering bug nobody had reported. `DocumentsPage.tsx` did `new Error(errorData.detail)`, and a 402 detail is an **object** — so every plan denial would have rendered the literal string **`[object Object]`** in red. `parsePlanLimit()` keeps it structured; `PlanLimitNotice` renders the three things a CTA must carry or the user guesses: **what** they hit (the §4 row label), **where they are** (`6 of 5`), and **what fixes it** (`Upgrade to Analyst`, the tier the server named, not a generic prompt). When nothing above the tier raises the ceiling it says so instead of linking to a page that cannot help. `QuotaMeter` prints `used`/`limit`/`remaining` **exactly as the server sent them and derives nothing** — asserted by feeding it a `remaining` that disagrees with `limit - used` and checking it still prints the server's number, because a meter doing its own sums is how it drifts from the gate that actually refuses. **25 new vitest** (2 files), `tsc` clean. The two parked e2e rows are now real: `R13` and `R14` **stub the API with `page.route`** rather than driving a live one — deliberate, since both rows are claims about what the UI does *with* a server response, and stubbing tests exactly that contract while gravity-api is undeployed. `R13`/`R14` moved from *declared but skipped — not graded* to **graded**. **Gate 6 deliberately not run, with the reason recorded**: `playwright.config.ts:33` points `baseURL` at prod, and `R11`/`R12` cannot pass there until gravity-api returns `capabilities`. Deploying market-ui alone would verify half a feature and burn a prod release on inert code — the UI degrades to its previous rendering without the API. One coordinated release when the API ships, which is the deploy escalation already pending under §10. |
| 2026-08-13 | PL-10 | the four-column matrix ships. `components/billing/PlanMatrix.tsx` renders every capability for every tier from `/v1/billing/config` — the same `capabilities.py` the enforcer reads, so **the table cannot drift from what is enforced; there is no second copy of the numbers**. **11 vitest assertions passing**, rendered with `renderToStaticMarkup` per the tree's existing convention (`trustStrip.test.tsx`) — adding `@testing-library/react` would have been an §4 escalation and the assertions did not need it. `tsc --noEmit -p tsconfig.app.json` clean. Asserted: the grid is exactly rows × tiers with **no omissions**; an unavailable feature renders **struck-through and visible** rather than hidden, which is the property the bullet lists lacked; a **zero quota reads as `✗`, not as the number nought**; the 14 client-enforced rows carry a marker and a footnote so the table does not claim enforcement the product lacks; and the surfaces group separately. **No invented prices.** §4's proposed $39/$99/$399 are unconfirmed (§10 E-P) and production only has plans for free/pro/team, so a tier with no configured plan renders **"Not yet priced" with a dead button**. `planForTier` mirrors the server's legacy map so `pro`→professional and `team`→institutional show their real configured price. Two gate improvements, both strengthening: a test asserting `toContain('disabled')` was **passing on every button** because the Tailwind className carries `disabled:opacity-40` — it now matches the attribute; and `e2eOwns` accepted a row merely *mentioned* in the spec, so `test.skip` counted as owned. It now finds the test that names the row and **fails if it is skipped** — R13/R14 correctly read `declared but skipped — not graded`, which is what stops PL-11 ticking them with placeholders. **Honest limit**: the e2e spec exists and grades R11/R12, but it cannot be *run* green until gravity-api is deployed, because prod's `/v1/billing/config` does not yet return `capabilities`. The component is guarded on that field, so the page degrades to exactly its previous rendering — no broken deploy, and no verified one either. |
| 2026-08-13 | PL-9 | `GET /v1/plan/usage` returns this caller's consumption of all **25 capabilities**, served from **the same Redis keys `enforce()` increments** — not a second tally. That is the whole design constraint: a meter fed by its own count drifts from the gate that denies the request, and "3 of 5 used" next to a refusal is worse than showing nothing. **13 new pytest, 86 across the PLANS suite, 66s.** Proven rather than asserted: `peek()` called 5 times consumes nothing (the free ceiling of 2 survives), consumption made through `enforce()` shows up in the meter, and at the boundary `remaining` reads **0 on the same call the next request is refused with 402**. Each entry carries its `enforcement` field so the UI can mark which ceilings are real — **14 of 25 read `client`**. A bug the tests caught: `peek()` handled flags and quotas but not the categorical rows (`"7 days"`, `"headlines"`, `"1 (crypto)"`), and `snapshot()` walks every capability, so it hit `limit_for`'s deliberate `TypeError` and would have 500'd the endpoint. Now a third kind, `categorical`, reports the value as written. **Third instance of the misassigned-row pattern** first recorded under PL-4: `R14` claims "the UI meter equals the server counter" — a browser assertion owned by a server task. Added **R17** for what PL-9 actually delivers and left `R14` with the UI, where `PL-11` builds it. Three tasks in a row have needed this; the pattern is that §6 was written before §7 knew which side of the wire each claim lived on. **The ratchet caught the mistake rather than the log**: ticking PL-9 armed `R14` while it still named PL-9 as owner, `npm run loops` went to **1 failing**, and the loop could not have proceeded without either writing a Playwright test for a UI that does not exist or moving the row. Owner moved to `PL-11`; back to **17 rows / 10 enforced / 0 failing**. This is the gate working — a task tried to claim a row it had not satisfied and was stopped mechanically. |
| 2026-08-13 | PL-8 | **parked, not done — escalated.** This task changes a public surface, so it stops at the diff by design. The package is written into §10 `E-T` for review. Investigating it produced the finding that matters: it is **three changes, not two**. `HermesQueryPanel.tsx:50` sends **no `Authorization` header at all** — the `fetch` carries only `Content-Type` — so moving `/trading` behind `ProtectedRoute` and adding `Depends(require_auth)` to `ask_about_market` would return **401 to every user, signed in or not**, because the panel has never attached a token. The third change is `getAccessToken()` from `supabase.ts:515`. Discovering that after the merge is an outage; discovering it here is a bullet point. Also recorded as §10 `E-G`: `grid_search.py:98` `execute_grid` has the same shape — no auth dependency, so grid runs cannot be metered per user. **The urgency is gone either way**: `PL-7` already capped the endpoint at 5 asks/day per IP without closing it, so what remains is a product question, not a spend leak. `R9` reads **public — route at char 8466, guard opens at 9001**; `R10` reads **200, expected 401**. Both stay pending, honestly, until the owner decides. Loop proceeds to `PL-9` per `docs/LOOP_CONVENTIONS.md` §6. |
| 2026-08-13 | PL-7 | **the honest half of the ledger.** Of the 12 §4 Terminal rows, exactly **1 is server-enforced** (`hermes_asks_per_day`); the other **11 are enforced in the browser** and are therefore not chargeable — `markets`, `watchlist_symbols`, `chart_indicators`, `screener_columns`, `order_book`, `news_terminal`, `portfolio`, `comparator`, `dexter_runs_per_day`, `dexter_debate`, `dexter_journal`. Both numbers are pinned by assertions, not prose, so moving a row server-side becomes a visible change rather than a drift. **8 new pytest, 73 across the PLANS suite, 66s.** What was enforceable, was: `/api/trading/markets/ask` is now metered. It stays **open** — closing it is §10 E-T and not this loop's call — but open is not the same as free, since every call runs an LLM and the endpoint answered anonymous POSTs with 200 and no ceiling. A caller with a valid token is metered by user at their real tier; a caller without one is identified by IP and metered at the free tier's **5 asks/day**. IP is a weak identity (shared NATs undercount, a proxy pool defeats it) and that is stated in the code rather than implied away; a weak ceiling beats none on an open LLM budget. Measured: free denies on ask 6 of 5 with `label='Ask Hermes / day'` and `upgrade_to='analyst'`; two anonymous IPs meter separately (2.2.2.2 still reads 4 remaining after 1.1.1.1 exhausts); professional reads a 500 ceiling; a garbage `Bearer` token grants nothing better than anonymous. `R8` now reads **402 wired at 3 call sites**. |
| 2026-08-13 | PL-6 | the denial path exists. `app/billing/enforce.py` closes gap E6 — before it, nothing anywhere returned "you are over your plan limit", which is why §1e found zero upgrade prompts: there was no moment to show one at. **16 new pytest, 65 across the PLANS suite, passing in 66s.** Over-ceiling raises **402** (not 429, which means retry; not 500, which means we broke) with a body the UI can act on without parsing prose: `error`, `capability`, `label` matching the §4 row, `plan`, `plan_id`, `limit`, `used`, `period`, `upgrade_to`. Measured: free grid runs deny on call 3 of a ceiling of 2, `used=3 limit=2 upgrade_to='analyst'`; free uploads deny on call 6 of 5 with `Remaining` reaching 0 first; institutional returns `unlimited` and costs no counter; counters do not leak between users (u-b still reads 4 remaining after u-a exhausts). `upgrade_to` skips tiers that add nothing — `audit_log` on free offers **professional**, not analyst, because analyst does not have it either. Redis-down is tested by breaking Redis for the whole file: the in-memory fallback still counts, so the gate cannot fail open silently. Wired at 2 call sites that already had auth (`documents.py` ingest, metered before the file is parsed so an over-quota upload does not pay for the work; `grid_schedule.py` run-now). **Finding: `grid_search.py:98` `execute_grid` has no auth dependency at all** — like `/api/trading/markets/ask`, the Research Grid endpoint is unauthenticated, so it cannot be metered without changing a public contract. Not silently changed; recorded here and escalated alongside E-T. **Second instance of the unreachable-row defect first recorded under PL-4**: R8 was written as a live check needing a seeded account driven past its cap, which this loop cannot produce without a deploy. Its instrument is repointed to an executed test; the claim is unchanged and is now actually graded rather than skipped forever. Reads: **402 wired at 2 call sites, 7 body keys asserted**. |
| 2026-08-13 | PL-5 | the matrix exists as data. `app/billing/capabilities.py` declares **25 capabilities x 4 tiers = 100 cells, 0 holes, 0 orphan source paths**, and `/v1/billing/config` now returns `capabilities`, `matrix` and `tier_order` alongside the legacy `features` bullet lists. **49 pytest passed in 66s** across the three PLANS test files. The headline number this task produced: **14 of 25 rows are client-enforced** — `grid_columns_per_run`, `deep_research_per_day`, `report_export`, `markets`, `watchlist_symbols`, `chart_indicators`, `screener_columns`, `order_book`, `news_terminal`, `portfolio`, `comparator`, `dexter_runs_per_day`, `dexter_debate`, `dexter_journal`. Only 11 rows are held by the server today. Watchlist size is the clearest case: it lives in `localStorage` under `hub_watchlist_<market>`, so the ceiling is advisory and devtools removes it without a round trip. Every capability therefore carries an `enforcement` field, exposed through the API, so the pricing table cannot imply a ceiling that does not exist — and PL-6/PL-7 inherit that list as their work. Admin PUT now rejects a capability override that invents a key or leaves a tier out (422 with the problem list). Two defects found and fixed: capability `source` paths were resolved against cwd, which passes under pytest and fails in the API because it runs from `services/gravity-api` — they now anchor to `REPO_ROOT` off `__file__`, with a test that chdirs before asserting; and **R6 was passing vacuously**, reading `0 keys, 0 orphan` as green because it grepped for `source=` keyword arguments that the positional declarations never produced. It now fails when it finds nothing to check and cross-checks the declaration count against §4's row count, so table and code cannot drift apart. Reads: **25 capabilities, 25 paths, 0 orphan, matches §4**. |
| 2026-08-13 | PL-4 | the literal is gone and the subscription decides. `require_auth`'s JWT branch now calls `_apply_entitlement`, which reads the pool off `request.app.state` and replaces the tier the token *claims* with the one `entitlements_for` grants. API keys and the dev bypass deliberately do not pass through it — service keys are not subscribers. **26 pytest passed in 66s** across `test_auth_entitlement.py` (7 new) and `test_entitlements.py` (19). The defect in one assertion, driven through the real chain `require_auth → _apply_entitlement → entitlements_for → check_rate_limit` and read off the response header: a token claiming `free` with a `professional` subscription row now returns **`X-RateLimit-Limit: 120`** and `X-RateLimit-Daily-Limit: 2000`; it was 10 for every paying customer. Also asserted: legacy `pro` → 120, no row → 10, `canceled` → 10, `institutional` → 600 with no daily header at all, and an API key still → `unlimited`. **Ledger finding, per §1's rule about rows that do not exist.** `R5` grades a *deployed* API and needs a seeded account, so it could only ever go green after a gravity-api release — which `docs/LOOP_CONVENTIONS.md` §4 makes an escalation, since it is a deploy beyond `vercel --prod` on market-ui. PL-4 was written with an acceptance row this loop cannot reach. Added **R16** to grade what is actually in the diff (wiring present, literal gone, header asserted at 120) and left `R5` holding the deployment claim, still SKIP. Two things unblock `R5`: a gravity-api deploy, and `PLANS_PROBE_JWT` for a seeded professional account (§10 E-D). |
| 2026-08-13 | PL-3 | `app/billing/entitlements.py` joins `billing_subscriptions` to a tier — the read path §1c said did not exist. **19 pytest assertions, all passing in 0.14s** (`tests/test_entitlements.py`). Three leak directions closed and each one tested: a non-active status does not entitle (`canceled`, `past_due`, `none`, `incomplete`, `""` all → free, 5 parametrised cases); an expired `current_period_end` → free however good the status column reads, so a failed webhook cannot become a permanent upgrade; an unresolvable plan name → free with the name logged at error, never guessed. Legacy names map through (`pro`→professional, `team`→institutional). Cache 60s, verified by call-counting a fake pool: second read hits 1 query not 2, `invalidate()` forces 2, and a downgrade lands once the TTL passes. A database failure degrades to free instead of raising — verified with a pool that throws — because a limiter that 500s the search endpoint when Postgres blinks is worse than one that under-serves. **Deviation from the task text**: it specified `entitlements_for(user_id) → dict`; it returns the frozen `Tier` instead, which is what every caller needs and is typed. Row R4 was widened while claiming it — it scanned only `rate_limit.py`, so the next `.get(tier, …)` could land in `entitlements.py` unchallenged; it now scans 3 files and also catches `.get(plan, …)`. `R4` reads **no defaulting lookup in 3 files**. |
| 2026-08-13 | PL-2 | three tier vocabularies collapsed to one. `app/billing/tiers.py` holds 5 tiers (4 sold + `unlimited`, which `auth.py` issues to the dev bypass and internal service keys and which is therefore kept, not sold) and the 4 legacy aliases. `rate_limit.py` now owns **0** tier tables, down from 2 — verified by `hasattr`: `MINUTE_LIMITS` False, `MONTHLY_LIMITS` False. Rows: **R2 0 tier dicts** (was 2), **R3 4/4 mapped** (was 0/4), and R4 came green early as a side effect — `.get(tier, 10)` is gone, so it reads `no defaulting lookup` under `PL-3`, which still owns the DB resolver. Limits verified by execution, not by reading: free 10/min 10/day 100/mo · analyst 60/500/5000 · professional 120/2000/25000 · institutional 600/∞/∞ · unlimited 100000/∞/∞; all 4 legacy ids resolve; `resolve('platinum')` raises. **Nothing loosened**: free keeps its 100/month and gains a 10/day ceiling it never had, so every existing user is capped at least as tightly as before. One deliberate increase — `professional` was being served the free tier's 10/min through the §1b bug and now gets the 120 §4 sells it. `enterprise`, whose old 10000/min is above institutional's 600, has never been sellable (billing offers free/pro/team only), so no subscription can be sitting on it. Added a third enforcement layer (per-day) with its own 429 and `X-RateLimit-Daily-*` headers; TTLs measured 24085s to UTC midnight, 1579285s to 1 Sep. A `TierId` / `LEGACY_TIER_ALIASES` mirror lands in `packages/shared-types`; `tsc` build clean. One gate defect fixed: R4 was reading a docstring that *quoted* `.get(tier, 10)` and going red on prose — the detector now strips Python comments and docstrings (`stripPy`, 5 new self-check assertions proving code still matches and prose no longer does), because the alternative fix is rewording the comment, which teaches the loop to hide from its gate. Self-check total now counts itself: **15 assertions**, previously a hardcoded "10" that had drifted. |
| 2026-08-13 | PL-1 | gate built and armed. `R1` PASS, `R15` PASS, 11 pending, 2 skipped, 0 failing, exit 0; `--self-check` 10 assertions green. Enforcement is a ratchet off §7's checkboxes, so nothing is graded before its task is claimed and nothing can be un-graded after. Measured while building it: `R2` 2 tier dicts (`MINUTE_LIMITS`, `MONTHLY_LIMITS`), `R3` 0/4 legacy ids mapped, `R4` `.get(tier, 10)` still live, `R7` 28 rows × 4 tiers 0 holes, `R9` `/trading` route at char 8466 vs guard at 9001 = public, **`R10` anonymous POST → 200**, `R15` enabled `paypal,payoneer` / instant `paypal`. Three defects found and fixed during the build, two of them mine: `R2` counted `_MEM_COUNTERS` (a Redis fallback cache, not a vocabulary); `R10` was written against `/v1/trading/ask` which 404s — the real path is `/api/trading/markets/ask` and the wrong one would have reported the hole as closed; and `process.exit()` over an open fetch pool aborted the process, reaching the shell as **127**, so the gate's own verdict was untrustworthy — now `process.exitCode`. `R6` was restated from "every §4 row resolves to a §2 file" (not mechanically checkable — §4 rows are prose labels) to "every capability key names a source file that exists", checkable once `PL-5` lands. Full `vitest` not run: the diff is one root script, one `package.json` line and this ledger — no `apps/` code changed. |
| 2026-08-13 | audit | ledger reviewed against the LIVE api before any task ran. `/health` 200 in 0.57s, `/v1/billing/config` 200: plans byte-identical to the `billing.py` defaults, **2 of 4 providers enabled** (paypal, payoneer). Four defects found in this ledger and fixed: the four-provider claim (now §1f + `S5` + `R15`), §2 sold file-existence as capability (now caveated, `PL-12` widened), `R11-R14` named no instrument (now `apps/market-ui/e2e/`), and the Free tier had been raised 10→20/day by the ledger itself with no authority (reverted to 10). 6 markets confirmed in `markets.ts`. No prior billing ledger exists — no duplication. |

---

## 9. Stop — three conditions, name which one fired

- **TARGET** — no `[ ]` remains in §7 **and** `PL-12`'s sweep is in §8 with every
  `R1-R14` row green.
- **BUDGET** — 12 tasks or 30 iterations, whichever comes first.
- **STALL** — 3 consecutive iterations with no row changing state and no new failure
  mode. On stall, stop and report; do not keep ticking.
- **KILL** — `R1` red halts the loop immediately, whatever §7 says.

No stop condition here is graded by a model score, so no holdout or judge is required.

---

## 10. Escalation — halt and ask

- **E-P — prices.** §4's numbers are proposed by the loop, not decided by the owner.
  No price may render to a real user until confirmed. `PL-10` ships with placeholders.
- **E-T — closing `/trading`.** It is public today; people may be using it. Closing it
  is outward-facing and irreversible for anonymous sessions.

  **The package, prepared by `PL-8` and not merged.** Three changes, not two — the
  third is the one that would have turned a routing decision into an outage:

  1. `apps/market-ui/src/AppRouter.tsx:170` — move the `/trading` route from the
     public block into the `ProtectedRoute` block (satisfies `R9`).
  2. `services/gravity-api/app/api/routes/trading.py:98` — add
     `auth: dict = Depends(require_auth)` to `ask_about_market` and drop the
     anonymous branch of `caller_identity` (satisfies `R10`).
  3. **`apps/market-ui/src/components/trading/HermesQueryPanel.tsx:50` — the client
     sends no `Authorization` header at all.** Measured: the `fetch` carries only
     `Content-Type`. Doing 1 and 2 without this one returns **401 to every user,
     signed in or not**, because the panel has never attached a token. The fix is
     `getAccessToken()` from `src/services/supabase.ts:515`, awaited into the header.

  **What is already done, so this decision is not urgent.** `PL-7` metered the
  endpoint without closing it: anonymous callers are keyed by IP at the free tier's
  5 asks/day. The uncapped-spend reason for closing it is gone. What remains is a
  product question — should the terminal require an account — and that is the
  owner's, not the loop's.

- **E-G — `POST /v1/grid` is unauthenticated too.** `grid_search.py:98`
  `execute_grid` takes no auth dependency, so Research Grid runs cannot be metered
  per user. Same shape as E-T and the same decision: meter it by IP, require a
  session, or accept it. `PL-6` left it alone rather than changing a public contract
  on its own authority.
- **E-L — the ladder.** §4 assumes trading unlocks *above* search on one ladder. The
  alternative — trading as a priced add-on to any tier — is a different matrix. Ask
  before building the second one.
- **E-C — the checkout is half-off and only the owner can turn it on.** `S5`. Enabling
  Paddle or crypto needs credentials this loop does not have and must never ask for.
  `R15` reports the state; it does not fix it. If the answer is "PayPal only", say so
  and `PL-10` drops the tiers that a manual transfer cannot plausibly close.
- **E-D — existing subscribers.** Anyone already paying `pro` or `team` must not lose
  access at the cutover. The map in §4 is the plan; confirm it against the live
  `billing_subscriptions` rows before `PL-4` ships.
- Plus the standing triggers in `docs/LOOP_CONVENTIONS.md` §4 — never `git push`
  unasked, never decide alone on anything irreversible.

---

## 11. Cadence

120s between iterations. Every task here is work this agent performs itself — write
code, run the probe, verify — so there is no external state to wait for and a longer
tick is pure idle. Matches `docs/LOOP_CONVENTIONS.md` §5.

---

## 12. The loop graph

```mermaid
flowchart TD
    G["PL-1 gate · scripts/governance.mjs then the entitlement probe"] --> V{"R1 green?"}
    V -->|no| H["halt · §9 KILL"]
    V -->|yes| S["spine · PL-3 resolver reads billing.py subscriptions"]
    S --> A["PL-4 · auth.py stops hard-coding the free tier"]
    A --> M["PL-5 matrix schema · §4 rows, §6 rows R6 R7"]
    M --> E["PL-6 and PL-7 enforce · rate_limit.py becomes a projection"]
    E --> T["PL-8 · AppRouter.tsx closes the public trading route"]
    T --> U["PL-10 · BillingPage.tsx renders getBillingConfig as a matrix"]
    U --> C["PL-11 CTA · billing.ts getMySubscription names the tier"]
    C --> W["PL-12 sweep · paste real numbers into §8"]
    W --> X{"§9 target, budget or stall?"}
    X -->|none| G
    X -->|fired| D["stop and say which"]
```
