# Mobile Parity Roadmap — the phone must be as useful as the desktop

**Ledger.** Task IDs `MP-n`. Loop file `MOBILE_PARITY_LOOP.sh`.
Contract: `docs/LOOP_CONVENTIONS.md` — done-criteria, truth rules, repo hard
constraints, escalation, cadence, stop, persistence. Not repeated here.

---

## 1. Why V3 exists

`docs/MOBILE_APP_ROADMAP.md` (V1) closed 16/16 with 109 checks green, then the phone
showed 16 faults. `docs/MOBILE_FIELD_ROADMAP.md` (V2) built an overpaint evaluator and
a landscape project, and closed the faults it could see.

The 2026-08-05 frames in `attachments/` show V2's gates are still green while the phone
is still wrong. **That is a blind instrument, not a regression.**

V2 measures two things: whether one element paints over another
(`overpaintPairs` in `src/lib/overpaint.ts`), and whether the DOM's price text matches
the API payload (`e2e/mobileField.spec.ts`, row R7). A cell that clips its own text
passes both. `textContent` is the whole string; `getClientRects()` reports the element
visible; no second element covers it, so no pair exists. The pixels are wrong and every
assertion is green.

V3's premise: **a number a user cannot read is wrong, whatever the DOM says.** The new
axis is legibility — rendered glyphs versus the string the element claims to hold.

Beyond legibility, V2 asked "does it overflow?" and never asked "is this usable?". A
phone that renders a nine-column research grid as one letter per line is not overflowing.
It is useless. §5 separates the two: **F-faults are correctness, U-faults are utility.**

## 2. Anchors — read these before touching anything

Every path and symbol below was verified to exist. Never invent one.

| what | where |
|---|---|
| markets table, price cell, sticky identity column | `src/components/trading/MarketList.tsx` — `price` column def ~line 64, price `<td>` ~line 407, pinned identity `<td>` ~line 395 |
| overpaint evaluator (V2's instrument) | `src/lib/overpaint.ts` — `overpaintPairs`, `collectPaintBoxes` |
| V2 field gates | `e2e/mobileField.spec.ts` — rows R7, R8, R9, R11 |
| V1 sweep | `e2e/mobileSweep.spec.ts` |
| bottom tab bar | `src/components/MobileNav.tsx` |
| viewport projects | `apps/market-ui/playwright.config.ts` |
| desktop reference behaviour | `e2e/desktopBaseline.spec.ts` |

**Evidence is `attachments/Screenshot_20260805-*.png`, 16 real-device frames.** They are
the specification. Where a fault row and a frame disagree, the frame wins and you say so
in §8. Read only the frames your task's fault names. Treat any new file in
`attachments/` as an escalation.

## 3. Doctrine

1. **Legibility over structure.** "It does not overflow" is not "it can be read".
   Every numeric assertion compares *rendered* text to the payload, not DOM text.
2. **Mobile is a second layout, not a shrunken first one.** A panel that sits beside
   another on desktop becomes a destination on a phone. Any task whose answer is
   "make it smaller" is the wrong answer.
3. **Parity is utility, not pixels.** The phone does not need the desktop's layout. It
   needs the desktop's *answers* reachable in the same number of decisions.
4. **Scope is layout and presentation only.** Never edit a service, fetcher, API route
   or scoring function. A mobile task that seems to need different data needs a
   different layout, not a different payload.
5. **Tokens only in new code** — no hex literal, no `text-[Npx]`, no `rounded-2xl`
   (off-scale), no `prose-*` (`@tailwindcss/typography` is not installed, so every
   `prose` class compiles to nothing). Legacy hex may stay unless a task names it.
   Grep your own diff for those four patterns before calling a task done.
6. **A gate that cannot fail on the current tree is not a gate.** Every row in §6 must
   be shown red before the task that turns it green. Record the red measurement in §8.

## 4. Device matrix

Classes are the `playwright.config.ts` project names. `LS` is above the `md` breakpoint
(788 ≥ 768) and therefore renders the **desktop** shell in a 360px-tall viewport — that
is the trap V2 found and it still bites.

| class | project | viewport |
|---|---|---|
| XS | `mobile-320` | 320 × 568 |
| N | `mobile-360` | 360 × 780 |
| S | `mobile-390` | 390 × 844 |
| M | `mobile-430` | 430 × 932 |
| LS | `mobile-landscape` | 788 × 360 |
| LX | `mobile-landscape-740` | 740 × 360 |
| T | `tablet-768` | 768 × 1024 |

## 5. Faults

**F — correctness. A user reads something untrue or cannot read it at all.**

| id | fault | frame |
|---|---|---|
| F1 | Markets table prints truncated prices at scroll offset 0: Bitcoin `7.07`, Ethereum `9.46`, BNB `7.55`, USDC `0076`, XRP `0613`, TRON `3291`. Leading digits are clipped, not covered — R7 is green | `122124`, `121925` |
| F2 | Whole document scrolls horizontally on `/trading`; row labels and the identity chip are cut at the left edge | `121925` |
| F3 | `Categories` / `Portfolio` tab labels collide with the floating `+ Columns` control — text over text | `122124`, `121925` |
| F4 | At LS the desktop shell renders: icon rail plus two panels in 360px of height. `LOG IN` / `SIGN UP` clip past the right edge | `121426`, `121607` |
| F5 | PDF preview modal has no dismiss control inside the viewport and its title is cut mid-word | `122241` |

**U — utility. Nothing is untrue; the screen is unusable.**

| id | fault | frame |
|---|---|---|
| U1 | Research Grid headers render one letter per line (`THE/SIS`, `CAT/ALY/STS`, `VAL/UAT/ION`); cells collapse to dots and pipes. The grid conveys nothing on a phone | `121203` |
| U2 | Grid cell badges overlap — `DECLINE` paints over `RAG`, `LITIGATION` over `RAG` | `121203` |
| U3 | Company tab prior-period column (`$130.50B`) sits flush against the delta (`+65.5%`) with no gap and low contrast | `121333` |
| U4 | At LS the on-screen keyboard leaves ~90px of usable height; the search view has no compact mode | `121402` |

## 6. Acceptance rows

Each §7 task names the rows it must turn green. **Written before the tasks that satisfy
them.** `R1` is the instrument; the rest are assertions.

**Instrument — must exist, and must fail on the unmodified tree, before anything else**

1. A **legibility evaluator** exists in `src/lib/legibility.ts`, unit-tested, exported as
   `clippedText`. For a root selector it returns every element whose rendered text is
   narrower than the text it holds — `scrollWidth > clientWidth + 1`, or whose rect is
   not fully contained by the nearest ancestor with `overflow` not `visible`. It reports
   the element, its `textContent`, and the clipped width in px. This is the instrument
   F1 needs and `overpaintPairs` structurally cannot provide.

**F rows — correctness**

2. On `/trading` at XS, N, S, M and LS, at horizontal scroll offsets 0, 150 and 400:
   `clippedText('table')` returns **zero** entries whose text contains a digit.
   *This is the F1 gate. Nothing weaker closes F1.*
3. On `/trading` at every class in §4, for the first 8 rows, the price cell's rendered
   text parses to a number within ±0.5% of the same symbol's `last`/`priceUsd` read off
   the `/api/crypto/markets` response — **and** that cell reports zero clipped px.
   Row 3 is row R7 plus the legibility half R7 cannot see.
4. `document.documentElement.scrollWidth <= clientWidth` on `/`, `/search`, `/trading`,
   `/companies`, `/history` at XS, N, S, M, LS, LX — after the route's primary content
   has rendered, not on first paint.
5. `overpaintPairs` returns zero pairs where the covered element carries text, on
   `/trading` and `/search` at N and LS. Reuses V2's instrument unchanged.
6. Every control in the top chrome of `/trading` — including `LOG IN` and `SIGN UP` — has
   a rect fully inside the viewport at LS and LX.
7. Every modal and drawer reachable on a mobile route exposes a dismiss control whose
   rect is fully inside the viewport at XS, N and LS, and whose title is not clipped.

**U rows — utility**

8. On `/search` Research Grid at N: no column header's rendered height exceeds 3× the
   line-height of its own computed font size. A header stacked one letter per line fails
   this and nothing else catches it.
9. On `/search` Research Grid at N, every visible cell either renders ≥ 12 characters of
   its own `textContent` or is replaced by a control that opens the full value.
10. At LS, the app renders the mobile shell, not the desktop shell: `MobileNav` is in the
    accessibility tree and the desktop icon rail is not.
11. On the Company tab at N, the prior-period value and the delta have ≥ 8px of
    horizontal gap and the prior-period text meets 4.5:1 contrast against its background.

**Parity row**

12. For each of `/trading`, `/search` Company tab and `/companies`, the number of taps to
    reach the primary answer at N is ≤ the number of clicks at `desktop-baseline` + 1,
    measured by a scripted path recorded in §8.

## 7. Task ledger

Do the **first unchecked** task only. Its spec text is the requirement; the rows it names
are the acceptance tests.

- [x] **MP-1 · Build the instrument that can see clipping.**
      Nothing else may start. Write `src/lib/legibility.ts` exporting `clippedText`, and
      unit-test it against a fixture with a known-clipped and a known-clean element.
      Then run every §6 row against the **unmodified** tree and record, per fault F1–F5
      and U1–U4, either the failing assertion with its measured number or the sentence
      explaining why it does not reproduce headlessly.
      Then edit §12's L2 node to name `src/lib/legibility.ts` and `clippedText` directly.
      The graph deliberately does **not** name them yet — `scripts/graph-lint.mjs`
      resolves every file and symbol a node cites, so naming an instrument before it
      exists makes the graph red from ledger open, and a permanently red check is one
      you learn to skip. The graph grows with the code. **Rows R1.**

- [ ] **MP-2 · F1 — the markets table must never render a price the server did not send.**
      The price `<td>` in `src/components/trading/MarketList.tsx` is right-aligned and
      clips its own leading digits inside the pinned identity column's shadow. Fix so
      that at every offset in row 2 the rendered price is the whole number. Do not solve
      it by shrinking the font below the type scale. **Rows R2, R3.**

- [ ] **MP-3 · F2 — no route scrolls the document horizontally.**
      Find the child that exceeds the root width on `/trading` and contain it. The table
      may scroll inside its own container; the document may not. **Rows R4.**

- [ ] **MP-4 · F3 — the floating `+ Columns` control must not paint on the tab strip.**
      **Rows R5.**

- [ ] **MP-5 · F4 + U3 — landscape renders the mobile shell.**
      788 ≥ `md`, so LS currently gets the desktop three-panel layout in 360px of height.
      Gate the shell on height as well as width. Top-chrome controls must fit.
      **Rows R6, R10.**

- [ ] **MP-6 · F5 — every modal is dismissable and its title readable.**
      **Rows R7.**

- [ ] **MP-7 · U1 + U2 — the Research Grid becomes a phone layout.**
      A nine-column matrix is not a phone screen. One ticker at a time, its cells as a
      list, the comparison behind a control. Badges may not overlap. **Rows R8, R9, R5.**

- [ ] **MP-8 · U4 — the Company tab reads at 360px.**
      Gap and contrast for the prior-period column. **Rows R11.**

- [ ] **MP-9 · Parity sweep.**
      Record the tap path for each surface in row 12 and close the row with numbers, or
      log the honest gap and close it as a null. **Rows R12.**

## 8. Progress log

One line per iteration. Real numbers — n, viewport, measured px, status codes,
counts. **No adjectives.**

- 2026-08-06 · ledger opened · 5 F-faults and 4 U-faults catalogued from 8 of 16 frames
  · R1 not yet built, so every row below R1 is currently unmeasured, not green.

- 2026-08-07 · MP-1 · `src/lib/legibility.ts` exports `clippedText`; 7 unit tests green in
  `src/lib/legibility.test.ts` (no jsdom added — the evaluator runs in the page, so the test
  stubs the 7 DOM members it calls); `npx tsc --noEmit -p tsconfig.app.json` clean; `npx vitest run`
  1200/1210 pass, 7 skipped, 3 failing — all three are pre-existing F5 assertions in
  `src/mobileField.test.ts` (`shrink-0`, `aria-label="Close"`) that MP-6 owns and this task did
  not touch. §12's L2 node now names the file and the symbol; `node scripts/graph-lint.mjs
  docs/MOBILE_PARITY_ROADMAP.md` → PASS 14 refs.

- 2026-08-07 · MP-1 · every §6 row run against the **unmodified** tree.
  `cd apps/market-ui && node scripts/capture-legibility-baseline.mjs`, live alias
  `https://market-ui-self.vercel.app`, 30 measurements → `docs/mobile/parity/baseline.json`.
  **11 RED · 13 GREEN · 6 UNMEASURED.** Measured client viewports: 320x568, 360x780, 390x844,
  430x932, 788x360, 740x360; `documentElement.scrollWidth - clientWidth` = **0px** on all six
  across `/`, `/search`, `/trading`, `/companies`, `/history`.

| fault | rows | measured on the unmodified tree |
|---|---|---|
| F1 | R2, R3 | **RED.** N: 15 clipped numeric elements in `table` over offsets 0/150/400, worst **78px** on `<td> "$64,360.98"` (ancestor clip, scrollLeft 0). S 11 / 48px, M 12 / 8px, XS 9 / 49px on `<button> "24h %"`, LS 0. R3 at N: BTC, ETH and USDC price cells each clip **78px** while their rendered text matches the payload — BTC `$64,335.87` vs `64305` = 0.048%, inside R3's ±0.5%. True number, unreadable cell. |
| F2 | R4 | **GREEN — does not reproduce headlessly.** 0px document overflow at all six classes on five routes. Frame `121925` shows the fault on the device. MP-3 must find the device-only condition or close R4 as an honest null. |
| F3 | R5 | **RED, but not on F3's surface.** 2 pairs at N, 7 at LS, all on `/search` — `header.h-12` over "5 retrieval channels", 112x12px. The `+ Columns` chooser lives one tap in from `/trading` (MarketHub "See all Crypto"), and R5 as written visits only the two route roots. Ledger finding; MP-4 owns the chooser. |
| F4 | R6, R10 | **Split.** R6 **RED**: 24 top-chrome controls at LS and 23 at LX have rects outside the viewport, worst `GSPC$7,709.96-0.18%` at x=-227 (vw 788) and x=-314 (vw 740) — the market ticker strip, not `LOG IN`/`SIGN UP`. R10 **GREEN**: MobileNav present and 0 desktop-rail candidates at both LS and LX, so the desktop-shell half of frames `121426`/`121607` does not reproduce on today's prod. |
| F5 | R7 | **UNMEASURED headlessly.** 0 `[role="dialog"]` on a cold `/search`; PdfPreview mounts only from ResearchReport after a completed deep-research run. Its mechanism gate is red: 3 failing assertions in `src/mobileField.test.ts`. |
| U1 | R8 | **UNMEASURED.** No `<th>` on a cold `/search` — the Research Grid of frame `121203` renders only after a run, so MP-7 must open it before R8 can fail. |
| U2 | R5, R9 | **UNMEASURED.** No grid cells exist to overlap on a cold `/search`; same precondition as U1. |
| U3 | R11 | **UNMEASURED.** 0 money and 0 percent elements on a cold `/search`; the Company tab of frame `121333` needs a company selected. |
| U4 | — | **No row owns it.** §6 has no landscape-keyboard row, and §7 crosses the labels: MP-5 calls its pair "F4 + U3" and MP-8 calls R11 "U4", while §5 has U3 = Company gap and U4 = keyboard. The rows themselves are unambiguous (R6/R10 = landscape shell, R11 = Company gap); the labels are wrong and U4 is ungated. |

- 2026-08-07 · MP-1 · two findings about the instruments, not the layout.
  (1) `e2e/mobileField.spec.ts` R7 reads `[data-testid="price"]` and `[data-testid="symbol"]`, and
  **no file under `src/` emits either attribute** — the baseline reads the cells
  `src/components/trading/MarketList.tsx` actually renders (the `font-mono` chip at :405, the first
  visible `td.text-right.font-mono` at :407).
  (2) `overpaintPairs` is **not** silent on that table: 25 numeric pairs at N, 32 at XS, 22 at S,
  6 at M, 0 at LS across the three offsets. §1's blind spot is real but narrower than it reads —
  the 78px price fault is an *ancestor clip*, which overpaint structurally cannot express, while
  the table trips V2's instrument elsewhere. Nothing in this ledger may be called green on
  overpaint alone, but "V2 green, phone wrong" is not the whole picture and is corrected here.

- 2026-08-07 · MP-1 · `npx playwright test` against the live alias: **211 passed, 20 failed,
  75 skipped, 18.3m** — not green, and not made green by this task. 19 of the 20 are V2 gates
  in `e2e/mobileField.spec.ts` already owned by open MP tasks (G1 R7+R8 at N and LS, G2/G4 R11,
  G5 chooser, G8–G11 ask-bar, G12–G16 landscape) plus one `desktopBaseline` landmark drift at
  1440px — `trading-asset: 5 desktop landmark(s) moved`, outside this ledger's mobile scope and
  escalated rather than touched. The first mobileField failure reads
  `Error: no rendered price cell found`, which is finding (1) above, not F1. MP-1 adds no
  Playwright spec, so the suite it inherited is the suite it leaves; §1's "V2's gates are still
  green" is **false on today's prod** and the corrected statement is that V2's gates are red for
  faults V3 has not yet fixed and, in one case, for a selector that no longer exists.
  No deploy: this task changed no UI and no api function, so contract gate 6 does not apply.

## 9. Stop

- **TARGET** — no `[ ]` remains in §7 **and** MP-9's sweep actually ran.
- **BUDGET** — 9 tasks or 20 iterations, whichever comes first.
- **STALL** — 3 consecutive iterations with no row changing state and no new failure
  mode. Report which row is stuck and on what. Do not widen scope or re-run a green
  sweep to manufacture activity.

## 10. Escalation

Per `docs/LOOP_CONVENTIONS.md` §4, plus: any new file in `attachments/`; any change that
would edit a service, fetcher, API route or scoring function; any fault that cannot be
reproduced headlessly at any class in §4.

## 11. Cadence

Every iteration is edit → test → deploy → verify → log, performed by the agent, with no
external state to wait on. `ScheduleWakeup` **120 seconds**.

## 12. Graph of loops

```mermaid
flowchart TD
    L0["L0 · LEDGER LOOP<br/>first unchecked MP-n in §7"] --> GATE

    GATE{"is MP-1 closed?"}
    GATE -- no --> FORCE["only MP-1 may run.<br/>no fault task may claim green<br/>before the instrument can fail"]
    FORCE --> L1
    GATE -- yes --> L1

    subgraph L1["L1 · TASK LOOP"]
        direction TB
        A1["read §2 anchors + the fault's frame"] --> A2["change layout only (§3 rule 4)"]
        A2 --> A3["grep own diff: #hex, text-[Npx], rounded-2xl, prose-*"]
        A3 --> A4["vitest: the §6 rows this task names"]
        A4 --> A5["tsc --noEmit -p tsconfig.app.json"]
        A5 --> A6{"green?"}
        A6 -- no --> A2
        A6 -- yes --> L2
    end

    subgraph L2["L2 · LEGIBILITY LOOP"]
        direction TB
        B1["clippedText in src/lib/legibility.ts over the route"] --> B2{"any element with a digit clipped?"}
        B2 -- yes --> B3["widen or reflow, never shrink the type"] --> B1
        B2 -- no --> B4["overpaintPairs in src/lib/overpaint.ts"]
        B4 --> B5{"any covered text?"}
        B5 -- yes --> B3
        B5 -- no --> L3
    end

    subgraph L3["L3 · FIELD LOOP"]
        direction TB
        C1["playwright: e2e/mobileField.spec.ts at N and LS"] --> C2["vercel --prod, load the alias at the real viewport"]
        C2 --> C3{"rendered text == payload?"}
        C3 -- no --> A2
        C3 -- yes --> C4["paste measured numbers into §8"]
    end

    L3 --> STOP{"§9: target, budget, or stall?"}
    STOP -- none --> L0
    STOP -- fired --> END["say which one fired"]
```
