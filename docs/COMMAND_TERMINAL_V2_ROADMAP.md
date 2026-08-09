# COMMAND_TERMINAL_V2 — source-linked commands, and a loop that can be stopped

**Ledger.** Tasks `CT2-1..CT2-10`, gaps `P1-P6` and `V1-V4`, acceptance rows `R1-R12`.
Commit scope `command-terminal-v2`.

**Predecessor.** `docs/COMMAND_TERMINAL_ROADMAP.md` closed at CT-10 with 5 buildable
commands, 3 blocked, and one escalation it could not close from inside market-ui. This
ledger picks up that escalation and adds the outer loop the last one did not have.

---

## 1. What the reference product does, and what is actually true here

The target named by the request is LinqAlpha. Measured 2026-08-09 with Playwright
against `https://linqalpha.com/`, `/terminal` and `/developer` — not from memory.

Its homepage section **"Investment researchers use LinqAlpha for"** is five numbered
cases with no descriptive copy; each has one product screenshot whose `img alt`
names it. That mapping is quoted, not inferred:

| # | their case | their screenshot alt |
|---|---|---|
| 01 | Market Signal Monitoring | "market signal monitoring dashboard tracking real-time investment alerts" |
| 02 | Company Screening | "company screening interface filtering global equities by financial criteria" |
| 03 | Fundamental Analysis | "fundamental analysis view showing AI-driven company financial insights" |
| 04 | Sentiment & Trend Tracking | "sentiment and trend tracking visualization across global markets" |
| 05 | Competitive Landscape Analysis | "competitive landscape analysis comparing peer companies and market positioning" |

Their `/terminal` page states the pipeline as **`01 Interpret` → `02 Pull` → `03 Search`
→ `04 Run`** and claims five differentiators: automated multi-step workflows, persistent
workspace, **source-linked research you can verify**, cross-model delegation, session
continuity.

**Where the brief disagrees with this tree.** The request says "make all of them work
like LinqAlpha". Four corrections, each with the measurement:

1. **Four of their five cases already have a surface here.** `/company`, `/data`,
   `/sentiment`, `/peer-compare` route to surfaces that render. This is not a build,
   it is a quality climb. Rebuilding a Company tab is the wrong turn — see §3 rule 2.
2. **Their 02 Company Screening is our `⛔ /screening`.** CT-9 probed it and closed it:
   `GridView` runs authored prompts over a *named ticker list*, ranks nothing and
   filters no universe. Parity here needs a ranker that does not exist. CT2-8 probes
   whether one is reachable and is permitted to close ⛔ again.
3. **Their headline differentiator is the one thing we ship zero of.** "Source-linked
   research you can verify" is `Q1b` from the last ledger, which closed by escalation.
   §5 P1 reopens it, because the fix is in this monorepo and the last ledger's scope
   simply did not reach it.
4. **Their scale claims are not a target.** 57,663+ companies / 139+ countries / 42+
   languages. Our corpus is S&P 500 SEC filings plus BVMT. No task in §7 chases that
   number; a roadmap that pretends it can is lying about a corpus, not shipping a feature.

**What is NOT extractable.** The loop-governance source
(`https://linas.substack.com/p/ai-agent-loop-governance`) is **paywalled**. Fetched
2026-08-09; only the free preview resolved. §6 V-rows are built from the named concepts
the preview does state — inner vs outer loop, a governance layer outside the loop with
the power to end it, light-factory vs dark-factory review removal, and two costed failure
modes (a clarification loop running 11 days to $47,000; a retry storm of 240 retries in
3 hours to $4,200). **The article's file structures and checklists are behind the
paywall and are NOT reproduced or guessed.** Anything in §6 beyond those named concepts
is derived from `~/.claude/LOOP_STANDARD.md` and this repo's own tooling, and says so.

---

## 2. Anchors — verified to exist. Never invent one.

| anchor | what it is |
|---|---|
| `apps/market-ui/src/lib/commands.ts` | `COMMANDS` (5 buildable / 3 blocked), `parseCommand`, `matchCommands`, `findCommand` |
| `apps/market-ui/src/lib/commands.test.ts` | the parser + matrix assertions |
| `apps/market-ui/src/pages/SearchPage.tsx` | Quick Answer composer, palette, command commit |
| `apps/market-ui/src/pages/CompanyPage.tsx` | `GravityMetric` (:65), the tab surfaces |
| `apps/market-ui/src/components/grid/GridView.tsx` | `tickers` prop (CT-9), param read at :277 |
| `apps/market-ui/src/services/dexterBlocks.ts` | `parseBlock`, `dexterLang` — the answer feed's renderer |
| `services/gravity-api/app/api/routes/company.py` | `company_filings` (:22), `company_financials` (:67) |
| `services/gravity-api/app/api/routes/analytics.py` | the sentiment endpoint that 422s |
| `services/gravity-api/app/api/routes/documents.py` | `:488` exposes `"accession": filing.get("accession_number")` |
| `services/gravity-api/app/ingestion/parallel_ingest.py` | `accession_number` on the ingest task (:51) |
| `scripts/graph-lint.mjs` · `scripts/loop-lint.mjs` · `~/.claude/scripts/gate-guard.mjs` | the three checkers `npm run loops` runs |

---

## 3. Doctrine

1. **Never infer a citation.** A figure is linked to a source document only when the
   payload carries the identifier. Matching a figure to a filing by period is the exact
   failure the last ledger named, and it is still forbidden — however plausible it looks.
2. **Address, do not rebuild.** Every buildable command routes to a surface that already
   renders. A diff that re-implements a Company tab, a peer strip, or a second widget
   system has taken the wrong turn. Reuse `parseBlock` / `dexterLang`.
3. **The route budget is spent.** `apps/market-ui/api` holds **12 of 12** Vercel
   functions (`_sina.ts` is underscore-ignored, so 13 files = 12 functions). A new route
   is an ESCALATION, not a task. gravity-api has no such cap — that is where P1 lives.
4. **A label is part of the number.** A figure ships with its period and unit or it ships
   as an honest null. Fiscal periods carry their period-end: FY2026 ended January 2026 for NVDA.
5. **A blocked command refuses.** It states what is missing, in the words of
   `CommandSpec.blocked`, and never invents a figure to fill the gap.
6. **The governance loop is not the task loop.** §6 V-rows are checked by a script that
   the task loop does not author in the same change that claims them green.

---

## 4. Command matrix — carried forward from CT-10, with the parity column added

| command | routes to | status | LinqAlpha case | parity gap |
|---|---|---|---|---|
| `/company <ticker>` | `CompanyPage` overview | buildable, wired | 03 Fundamental Analysis | P1 no citations |
| `/filings <ticker>` | `CompanyPage` filings tab | buildable, wired | — | P1 |
| `/sentiment <ticker>` | `CompanyPage` sentiment tab | **wired, tab has never rendered** | 04 Sentiment & Trend | P2 |
| `/data <ticker>` | `CompanyPage` data tab | buildable, wired | 03 | P1 |
| `/peer-compare <t1> <t2>` | `GridView` on named tickers | buildable, wired CT-9 | 05 Competitive Landscape | P1, P3 |
| `/screening <query>` | nothing | **⛔ blocked** | 02 Company Screening | P5 — probe, may re-close ⛔ |
| `/capex <ticker>` | nothing | **⛔ blocked** | — | route budget spent |
| `/tariff-risk <ticker>` | nothing | **⛔ blocked** | — | route budget spent |

`/company` is the closest thing we have to their **01 Market Signal Monitoring**; nothing
here streams an overnight news flow, and no task in §7 claims to.

---

## 5. Gaps

**P — product parity with the reference.**

| id | gap |
|---|---|
| **P1** | **Figures ship with no source, and the source is already in the row.** `company_financials` filters `document_id: like.xbrl:*` at `company.py:80` and then selects `metric_name,period,value_float,unit,filing_type,filing_date` at `:83` — **`document_id` is never selected**. The last ledger recorded provenance as absent from the payload; it is absent from the *response*, present in the *table*. Whether that id resolves to a filing is unmeasured — CT2-2 measures it before CT2-3 ships anything |
| **P2** | **`/sentiment` mounts a tab that has never existed.** `/v1/analytics/sentiment/{ticker}` returns **422** `{"loc":["query","document_id"],"msg":"Field required"}`. `CompanyPage` renders the tab only on a returned score, so no ticker has ever shown one |
| **P3** | **No chaining.** Their pipeline is Interpret → Pull → Search → Run. A command result here cannot feed the next command |
| **P4** | **No session continuity.** A committed command's result is not restorable across a reload |
| **P5** | **No screener.** Their 02 is our ⛔. No service ranks or filters a universe |
| **P6** | **The palette does not say what a command costs.** Blocked names are listed but the palette does not group or categorise, so discoverability stops at the name |

**V — loop governance. The last ledger had stop conditions; it had no authority above itself.**

| id | gap |
|---|---|
| **V1** | **No kill authority outside the loop.** `docs/LOOP_CONVENTIONS.md` §6 gives the loop three stop conditions it evaluates *itself*. A loop that decides its own stop cannot be stopped by the thing it is failing to satisfy |
| **V2** | **No retry ceiling.** Nothing counts consecutive failed attempts at one task. The preview's costed case is 240 retries in 3 hours |
| **V3** | **No clarification-loop detector.** Nothing detects iterations that restate without progressing. The preview's costed case ran 11 days |
| **V4** | **No review tier per task.** Every task closes the same way. The preview's light-factory/dark-factory split asks which tasks may close unreviewed and which may not |

---

## 6. Acceptance rows

Binary, and **written before the tasks that satisfy them**. `R1` is the instrument.

| row | assertion |
|---|---|
| **R1** | `scripts/governance.mjs` exists, exits non-zero on a synthetic violation of each of R9/R10/R11, and its `--self-check` passes |
| **R2** | For `NVDA`, `GET /v1/company/NVDA/financials` returns rows in which `document_id` is present and non-empty on **≥ 1** row. Record: rows total, rows with `document_id`, distinct `document_id` values |
| **R3** | For the same payload, the count of `document_id` values that **resolve** to a filing from `GET /v1/company/NVDA/filings` is recorded. This row asserts the number is *recorded*, not that it is high — an unresolvable id is a finding, not a failure |
| **R4** | Every figure rendered by `/company NVDA` either shows a source affordance or shows the honest-null marker. Count: figures total / with source / null. **Zero figures render bare** |
| **R5** | Clicking a figure's source affordance opens a drawer naming the filing type and filing date it came from. The drawer's text appears in the `filings` payload — asserted by lookup, never by string similarity |
| **R6** | `/sentiment NVDA` either renders a score, or renders a stated refusal naming the 422. **No fabricated sentiment figure appears** — the reply is greped for a score-shaped token and the list is empty |
| **R7** | A command committed after another command keeps the prior turn in the feed (`>= priorTurns`, and `not.toHaveCount(0)`) |
| **R8** | After a reload, the last committed command's turn is still in the feed |
| **R9** | `governance.mjs` fails when a task's iteration count exceeds its declared ceiling |
| **R10** | `governance.mjs` fails when 3 consecutive iterations record no row state change and no new failure mode |
| **R11** | `governance.mjs` fails when a task marked `review: human` is checked `[x]` without an escalation entry in §8 |
| **R12** | Sweep: `npx playwright test commandTerminal --workers=1` on `desktop-baseline` and `mobile-360`, with R4/R6/R7/R8 green on both, and the tap count per command recorded against the mode-toggle path |

---

## 7. Task ledger

Each task names the rows it must turn green. **`review: human`** marks a task that may
not be checked `[x]` without an escalation entry — that is R11's subject.

- [x] **CT2-1 · The governance harness. `review: auto`. Rows R1, R9, R10, R11.**
      Write `scripts/governance.mjs`: reads this ledger, enforces the retry ceiling (V2),
      the stall detector (V3), and the review tier (V4). Wire it into `npm run loops`
      after `graph-lint`. **No product task may claim green before R1 is green** — the
      last ledger's CT-1 gate, applied to the loop itself rather than the parser.

- [x] **CT2-2 · Probe the provenance, change nothing. `review: auto`. Rows R2, R3.**
      Call both company endpoints for NVDA against the live API. Record rows total, rows
      carrying `document_id`, distinct ids, and how many resolve against the filings list.
      **Ship no UI in this task.** If zero resolve, CT2-3 closes ⛔ with this measurement.

- [ ] **CT2-3 · Ship the id through the API. `review: auto`. Rows R2, R4.**
      Add `document_id` to the `select` at `company.py:83`, carry it onto `GravityMetric`,
      and render a source affordance per figure — honest-null where the id is absent.
      Type shrinking is forbidden: the marker exists because the id can be missing.

- [ ] **CT2-4 · The citation drawer. `review: human`. Row R5.**
      Clicking the affordance opens the filing it resolves to. **Resolution is by id
      lookup against the filings payload. A period match is not a citation** (§3 rule 1).

- [ ] **CT2-5 · `/sentiment` tells the truth. `review: human`. Row R6.**
      Either supply the `document_id` the 422 demands, or make the command refuse in the
      words of the error. Escalate if the fix needs an endpoint change this ledger cannot make.

- [ ] **CT2-6 · Chaining. `review: auto`. Row R7.**
      A command committed after another appends rather than replaces. Their Interpret →
      Pull → Search → Run as far as the existing surfaces allow — no new route.

- [ ] **CT2-7 · Session continuity. `review: auto`. Row R8.**
      The last committed command's turn survives a reload.

- [ ] **CT2-8 · Probe `/screening`. `review: human`. No row — it reports.**
      Ask one question: is any ranker over a universe reachable without a new route? If
      no, **re-close ⛔ with the measurement** and stop. Inventing a screener is the failure.

- [ ] **CT2-9 · Palette categories. `review: auto`. Row R4 stays green.**
      Group the palette the way `/developer` groups its 22 tools. Names only — no new command.

- [ ] **CT2-10 · The sweep. `review: human`. Row R12.**
      `--workers=1`. Both projects. Paste every measured number into §8.

---

## 8. Progress log

Real numbers only. No adjectives. A failed row is a result.

`scripts/governance.mjs` parses this section, so an iteration line has a shape:

```
- CT2-n · iter N · R4 green, R6 red · <measured numbers>          [· fail: <mode>]
- ESCALATION · CT2-n · <what was asked, what came back>
```

The row states drive R10 (a stall is three of them unchanged); `fail:` names the
failure mode that clears it; an `ESCALATION` line is what R11 looks for.

- CT2-1 · iter 1 · R1 green, R9 green, R10 green, R11 green · `scripts/governance.mjs` 21 self-check assertions passed; live ledger 0/10 closed, 0 iterations logged, 0 violations, exit 0. Synthetic violations spawned against the real binary: R9 (3 iterations, ceiling 2) exit 1, R10 (3 iterations, sig `R2=red`, mode `422` thrice) exit 1, R11 (`review: human` `[x]`, 0 escalation entries) exit 1 — each printing its row and the KILL line. Negative controls green: a changed row state clears R10, a new failure mode clears R10, an escalation entry clears R11, `review: auto` closes itself. Checkers: graph-lint 6 graphs / 0 drifted / 0 decorative; gate-guard clean HEAD..working tree; loop-lint `COMMAND_TERMINAL_V2_LOOP.sh` PASS at 2161 chars. `npm run loops` exits 1 on the pre-existing 8-loop backlog (`QA_LOOP.sh`, `LOOP_PROMPT.md`, `LOOP_TASK.md`, `WC_LOOP_TASK.md`, `LOOP_SELF_IMPROVE.sh`, +3), none of them CT2 — `LOOP_CONVENTIONS.md` §9 records that ordering as deliberate. `tsc --noEmit -p tsconfig.app.json` — No errors found. `npx vitest run` — 1247 passed / 0 failed / 7 skipped, identical to the CT-10 baseline. No UI and no api function changed, so no deploy.

- CT2-2 · iter 1 · R2 red, R3 green · `node scripts/probe-provenance.mjs NVDA` against `https://gravity-api-prod.fly.dev`, window 2026-08-09T16:06:56Z, `X-API-Key: eval-unlimited-fb-2026`. **R2 red:** `GET /v1/company/NVDA/financials?limit=60` returns **60 rows, 0 carrying `document_id`, 0 distinct** — the response keys are exactly the 7 selected at `company.py:83` (`metric,value,unit,period,ticker,filing_type,filing_date`). **R3 recorded, and the number is zero:** the `financials` table holds **402** NVDA rows matching `document_id=like.xbrl:*` and **1 distinct `document_id` — the literal string `xbrl:NVDA`**. `GET /v1/company/NVDA/filings?limit=50` returns **5 documents / total 5**, ids being chunk UUIDs (`abbc9d90-5bb1-487b-847b-f666bfe7c542`). Resolution by id lookup: **direct 0/1, prefix-stripped 0/1**. Two independent reasons, both structural: `company.py:43` skips every `document_id` starting `xbrl:` while `company.py:80` selects only those, so the sets are disjoint by construction; and the value is a per-ticker constant, not a document reference. Of the **14** columns on a real row (`id NVDA_Revenues_FY2016_xbrl`, `source_section xbrl_companyfacts`, …) the only two matching accession/document/source/url/cik and non-null are `document_id=xbrl:NVDA` and `source_section=xbrl_companyfacts` — **no column carries filing identity**. **The accession is not missing upstream, it is dropped at ingest:** the SEC companyfacts observation carries `accn` (its shape is documented at `xbrl_extractor.py:585`), `sec_xbrl.py:219-227` emits 7 keys and `accn` is not among them, and `backfill_xbrl_financials.py:42` then writes `document_id = f"xbrl:{ticker}"`. **P1's premise — "the source is already in the row" — is false as measured.** Adding `document_id` to the select at `company.py:83` would ship `xbrl:NVDA` on every figure, which is a source-tag rendered as a citation; §3 rule 1 forbids it. CT2-3 therefore closes ⛔ on R5's citation and delivers R4 as all-honest-null. Recovering real per-figure provenance needs `accn` carried at `sec_xbrl.py:219` plus a re-backfill across the 501-ticker corpus — outside this ledger's scope, recorded here, not attempted. No UI, no api function and no schema changed; `npx vitest run` 1247 passed / 0 failed / 7 skipped.

**Baseline, measured 2026-08-09 before any task ran:**
- `commands.ts` — 5 buildable, 3 blocked.
- `company.py:83` select list — 6 columns, `document_id` **not** among them.
- Figures carrying a resolvable source — **0**, per CT-10's escalation.
- `/v1/analytics/sentiment/{ticker}` — **422**, `document_id` required.
- Vercel functions in `apps/market-ui/api` — **12 of 12**.
- `npx vitest run` at CT-10 close — **1247 passed / 0 failed / 7 skipped**.

---

## 9. Stop

- **TARGET** — no `[ ]` remains in §7 **and** CT2-10's sweep actually ran.
- **BUDGET** — 10 tasks or 24 iterations, whichever comes first. Per task the retry
  ceiling is **4** iterations unless the §7 line declares its own `ceiling: N`; that is
  the number R9 enforces, counted from the `iter N` lines in §8.
- **STALL** — 3 consecutive iterations with no row changing state and no new failure
  mode. Report which row is stuck and on what. Do not widen scope, and do not re-run a
  green sweep to manufacture activity. `governance.mjs` enforces this (R10).
- **KILL** — `governance.mjs` exiting non-zero halts the loop regardless of the above.
  This is the authority V1 says the loop must not hold over itself.

## 10. Escalation

Per `docs/LOOP_CONVENTIONS.md` §4, plus: **any** new API route in `apps/market-ui/api`;
**any** new npm dependency; any change to `vercel.json`; any schema change in Supabase;
any task marked `review: human` reaching its close; any figure that would ship without a
source or a null.

## 11. Cadence

Every iteration is edit → test → deploy → verify → log, performed by the agent, with no
external state to wait on. `ScheduleWakeup` **120 seconds**. Playwright gates are scoped
and backgrounded, never polled — `docs/LOOP_CONVENTIONS.md` §1.

## 12. Graph of loops

Two loops, and the outer one can end the inner one. That is the whole point of V1.

```mermaid
flowchart TD
    START["/loop /command-terminal-v2"] --> GOV

    subgraph GOV["L0 · GOVERNANCE LOOP — CT2-1 builds it, it runs FIRST"]
        direction TB
        V2["V2 retry ceiling<br/>row R9"] --> V3["V3 stall detector<br/>row R10"]
        V3 --> V4["V4 review tier<br/>row R11"]
        V4 --> KILL{"any violation?"}
    end

    KILL -- yes --> HALT["§9 KILL — halt the loop.<br/>the task loop does not get a vote"]
    KILL -- no --> R1GATE

    R1GATE{"is CT2-1 closed?"}
    R1GATE -- no --> ONLY1["only CT2-1 may run.<br/>no product task claims green<br/>before R1 can fail"]
    ONLY1 --> L1
    R1GATE -- yes --> L1

    subgraph L1["L1 · TASK LOOP — first unchecked CT2-n in §7"]
        direction TB
        A1["read §2 anchors + the P or V row"] --> A2{"needs a new route,<br/>dependency or schema change?"}
        A2 -- yes --> A3["§10 escalation — halt and ask"]
        A2 -- no --> A4["route via parseBlock + dexterLang<br/>src/services/dexterBlocks.ts (§3 rule 2)"]
        A4 --> A5["vitest: the §6 rows this task names"]
        A5 --> A6["tsc --noEmit -p tsconfig.app.json"]
        A6 --> A7{"green?"}
        A7 -- no --> A4
        A7 -- yes --> L2
    end

    subgraph L2["L2 · PROVENANCE LOOP — §3 rule 1"]
        direction TB
        B1{"does this task render a figure?"}
        B1 -- no --> B4["skip"]
        B1 -- yes --> B2{"is the source an ID LOOKUP<br/>against company.py filings?"}
        B2 -- "no, a period match" --> B3["FORBIDDEN — row R5 fails.<br/>render the honest null instead"]
        B2 -- yes --> B4
    end

    L2 --> TIER{"§7 tier of this task"}
    TIER -- "review: auto" --> LOG
    TIER -- "review: human" --> ESC["§10 escalation entry in §8<br/>required before [x] — row R11"]
    ESC --> LOG

    LOG["append measured numbers to §8<br/>npm run loops before the commit"] --> STOPQ

    STOPQ{"§9: target, budget or stall?"}
    STOPQ -- no --> GOV
    STOPQ -- yes --> DONE["stop and say WHICH condition fired"]
```

**Reading it.** `GOV` runs before the task loop on every wakeup, not after — a governance
layer that reports at the end is a post-mortem. `L2` is drawn as a loop rather than a
check because it is the rule the last ledger broke twice and caught twice. `TIER` is the
light-factory/dark-factory split: `review: auto` closes itself, `review: human` cannot.
