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
| **crypto** markets table — the surface F1's frames show | `src/components/trading/Markets.tsx` — price `<td>` ~line 1243, pinned identity `<td>` ~line 1225, `change` cell ~line 963, header row ~line 898. `TradingAssistantPage.tsx:569` routes `crypto` here and every other market to `MarketList` |
| every **other** market's table (TN, US, …) | `src/components/trading/MarketList.tsx` — `price` column def ~line 64, price `<td>` ~line 407, pinned identity `<td>` ~line 395 |
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

- [x] **MP-2 · F1 — the markets table must never render a price the server did not send.**
      The price `<td>` in `src/components/trading/MarketList.tsx` is right-aligned and
      clips its own leading digits inside the pinned identity column's shadow. Fix so
      that at every offset in row 2 the rendered price is the whole number. Do not solve
      it by shrinking the font below the type scale. **Rows R2, R3.**

- [x] **MP-3 · F2 — no route scrolls the document horizontally.**  *Closed as an honest
      null: F2 does not reproduce at any class in §4 and the containment it asks for is
      already in `src/index.css:127`. See §8.*
      Find the child that exceeds the root width on `/trading` and contain it. The table
      may scroll inside its own container; the document may not. **Rows R4.**

- [x] **MP-4 · F3 — the floating `+ Columns` control must not paint on the tab strip.**
      **Rows R5.**

- [x] **MP-5 · F4 + U3 — landscape renders the mobile shell.**
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

- 2026-08-07 · MP-2 · **§2's anchor named the wrong file.** F1's frames (`122124`, `121925`)
  show the tab strip `Cryptocurrencies / Watchlist / Categories / Portfolio` and the floating
  `+ Columns` — that is `src/components/trading/Markets.tsx`, not `MarketList.tsx`.
  `TradingAssistantPage.tsx:569` sends `crypto` to `Markets` and every other market to
  `MarketList`. The frame wins (loop rule 2); §2 is corrected above. A first fix was written
  against `MarketList.tsx`, deployed, measured **identical numbers**, and reverted — the
  reverted file has the same 210px identity cell and is covered by no row here.

- 2026-08-07 · MP-2 · diagnosis at N, live alias, before the fix: scroller
  `div.w-full.overflow-x-auto` client **326px**, table **371px**; row = star 46 + rank 49 +
  identity **210** + price 115. Price `<td>` at x=322..437 with its glyphs at 338..421, so
  **78px of "$64,377.21" rendered outside a 343px-wide window** — and `min-w-0` was the
  missing ingredient: a flex item will not shrink below its content, so the identity cell
  never gave the price room.

- 2026-08-07 · MP-2 · fix, layout only, in `Markets.tsx`: `min-w-0` on the identity flex row
  and `shrink-0` on the symbol chip; the name capped at **72px below md** (110px from md,
  uncapped from lg); cell padding **px-2 below md, px-4 from md** (57 cells and headers);
  rank column, `change` column and the trailing spacer `hidden md:table-cell`; the change
  value moved **under the price at the same `text-data` size** so the number survives its
  column; `data-testid="price"` / `data-testid="symbol"` added — the two attributes
  `e2e/mobileField.spec.ts` had been reading since V2 and no source file emitted. No font
  size was reduced anywhere in the diff.

- 2026-08-07 · MP-2 · measured on prod after `vercel --prod` (alias
  `https://market-ui-self.vercel.app`), `cd apps/market-ui && node
  scripts/capture-legibility-baseline.mjs`:
  **R2 and R3 green at every class.** Client viewports 320x568 / 360x780 / 390x844 / 430x932 /
  788x360 / 740x360, `scrollWidth - clientWidth` **0px** on five routes at each.
  `clippedText('table')` numeric entries at offsets 0/150/400: **XS 9→0, N 15→0, S 11→0,
  M 12→0, LS 0→0**; worst clipped px **78→0**. `overpaintPairs` on the same table at the same
  instant: **XS 32→0, N 25→0, S 22→0, M 8→0**. R3 at N: 8 rows, 200 payload symbols, **0
  faults, 0 unpaired** — e.g. BTC rendered `$64,350.19` against payload `64305`, 0.07%, and 0
  clipped px. Ledger total **11 RED → 4 RED**, the remainder R5 x2 (MP-4) and R6 x2 (MP-5).

- 2026-08-07 · MP-2 · gates: `npx tsc --noEmit -p tsconfig.app.json` clean; `npx vitest run`
  1200/1210 with the same 3 pre-existing F5 failures and no new one; `gate-guard` clean;
  diff grepped for `#hex`, `text-[Npx]`, `rounded-2xl`, `prose-*` — none.
  `npx playwright test` **213 passed / 18 failed / 75 skipped (18.9m)**, against 211/20 before:
  both `G1 · R7 + R8 — no opaque cell covers a price glyph at any scroll offset` runs (N and
  LS) flipped green, and that gate had been failing on `no rendered price cell found`. The 18
  that remain are the same V2 gates owned by MP-4 (G5 chooser), MP-5 (G12–G16 landscape),
  MP-6/7 (G2/G4 FAB, G8–G11) plus the one `desktopBaseline` trading-asset landmark drift that
  predates this ledger. The loop's "playwright green" is a whole-ledger condition, not one
  MP-2 can satisfy alone; MP-2's own rows are green and the suite moved two gates in the right
  direction.
  Deploy note: the working tree carried another loop's `CompanyPage.tsx` + untracked
  `EdgarLink.tsx`; escalated before deploying and the user chose "deploy tree as-is", so those
  shipped in the same three prod deploys.

- 2026-08-07 · MP-3 · **F2 does not reproduce, and R4 could not have failed.** 30 measurements
  on the live alias — 5 routes × 6 classes — `documentElement.scrollWidth - clientWidth` =
  **0px everywhere**, clients 320x568 / 360x780 / 390x844 / 430x932 / 788x360 / 740x360. The
  reason is `body { overflow-x: hidden }` at **`src/index.css:127`**: `html` computes
  `overflow-x: visible`, so the body rule propagates to the viewport and `scrollWidth` can
  never exceed `clientWidth` on any route. That is the containment MP-3 was told to add, in
  place since before this ledger opened — and by §3 rule 6 a row that cannot fail on the tree
  is not a gate. Escalated per §10 as a fault that does not reproduce headlessly at any §4
  class; closed as an honest null rather than kept alive.

- 2026-08-07 · MP-3 · the probe grew instead. R4's second half now asks what F2 *means*:
  an element with its own text, outside the viewport, that **no** ancestor with
  `overflow-x: auto|scroll` owns — contained is not the same as hidden. Result:
  **0 unreachable text elements at XS, N, S, M and LX** on all five routes; **20 at LS, all on
  `/`** — two decorative landing-hero cards, the "New Order" ticket at x=-319..-44 and the
  "Pattern Alert" card at x=894..1108 against a 788px viewport, both entirely off-canvas.
  They exist only because 788 ≥ `md` renders the desktop hero, which is **F4's root cause and
  MP-5's fix**, so they are recorded here and not touched. The count is logged beside R4's
  verdict and deliberately **excluded from it**: choosing a new pass criterion after seeing
  which way it fell is how a loop grades its own homework.

- 2026-08-07 · MP-3 · finding for MP-5: R6's current probe counts 23–24 "controls outside the
  viewport" at LS/LX, but its worst example — `GSPC$7,709.96-0.18%` at x=-265 — sits inside
  the market ticker strip, an `overflow-x: auto` scroller that legitimately owns it. The same
  scroller test this task added to R4 belongs in R6, or MP-5 will chase scrolled strip items
  instead of clipped chrome.
  No app code changed in MP-3, so no deploy. Full sweep after the probe grew:
  **30 measurements, 4 RED, 6 UNMEASURED, 20 GREEN** — the 4 red are R5 x2 (MP-4) and R6 x2
  (MP-5). `npx playwright test` **212 passed / 19 failed / 75 skipped (18.1m)**; the one
  failure MP-2's run did not have is `floatingHeader.spec.ts:17 · column header follows you
  down the list`, which **passes 3/3 in 25.4s when run alone**. It is a live-data flake under
  twelve parallel workers — the clone only shows while `wrapRect.bottom > top + headRect.height`,
  so a short crypto table (a cold CoinGecko 429 serves an honest empty list) never buries the
  real header. The `chromium` project keeps `retries: 0` on purpose, so it reports rather than
  hides it. Not touched: it is not MP-3's row and the spec is a gate.

- 2026-08-07 · MP-4 · F3 measured, then fixed. Before: at N the tab row was
  `flex-none … max-w-[100vw]` and the chooser beside it `ml-auto sticky right-0`, so both
  claimed the same pixels — `overpaintPairs(requireOpaque: false)` reported
  **`"Columns" over "categories" 61x13px`**, which is frame `122124`'s text-on-text.
  Fix in `Markets.tsx`, layout only: the tab row becomes `flex-1 min-w-0` (it yields and
  scrolls inside its own box) and the chooser drops `ml-auto sticky right-0`, keeping
  `shrink-0`. After, measured on prod: strip `clientWidth 229 / scrollWidth 626`, chooser at
  x=246..343, **0 chooser pairs at N and LS**, and the screenshot shows
  `Cryptocurrencies · Watchlist (0) · + Columns` on one clean line.

- 2026-08-07 · MP-4 · **R5 was measuring two things that are not faults**, each proved with a
  number before it was excluded.
  (1) **Scroll state.** `/search` autofocuses its composer, so the thread pane loads at
  `scrollTop 448 of 448` and the hero sits under the fixed 48px header — 2 pairs at N, 7 at
  LS. Scrolled to the top instead, the last example card sits under the composer. R5 is now
  collected at **both ends of every scroller** and keeps only pairs present in both: a cover
  is a fault when the text can never be read, not when fixed chrome is doing its job.
  (2) **Clipped text.** `overpaintPairs` compares raw rects, so a tab scrolled out of its own
  `overflow-x: auto` strip still reports its rect (`categories` at 260..348 against a strip
  ending at 246) and anything beside it "covers" it. V2 cannot see clipping in either
  direction — this ledger's premise, pointed the other way. `visiblePairs` in
  `src/lib/legibility.ts` re-checks each pair against the covered rect clamped to its
  clipping ancestor. V2's instrument is unchanged, as R5 requires.
  After both: **R5 is 0 pairs at N and 0 at LS**; the full sweep is **30 measurements, 2 RED,
  6 UNMEASURED, 22 GREEN**, the 2 red being R6 x2 (MP-5).

- 2026-08-07 · MP-4 · **a gate's measurement changed in the change that claims it green** —
  said loudly because `docs/LOOP_CONVENTIONS.md` §11 exists for exactly this.
  `e2e/mobileField.spec.ts` G5 kept failing on `"Columns" over "categories"` **after** the
  fix, and its own failure screenshot
  (`test-results/mobileField-G5-…-mobile-360/test-failed-1.png`) shows a clean tab row: the
  pair is a false positive over a tab painted nowhere. The assertion, its matcher and its
  count are untouched; the pairs handed to it are wrapped in `visiblePairs`, and the filter
  is fixed by **4 new unit tests** in `src/lib/legibility.test.ts` — a pair with no clipper
  survives, a pair still visible inside its clipper survives, a pair whose covered text is
  scrolled out is dropped, and with both present only the clipped one goes. `gate-guard`
  reports **clean**; `npx vitest run` 1204/1214 with the same 3 pre-existing F5 failures.
  G5 at N passes alone in 18.4s after the correction.

- 2026-08-07 · MP-4 · `npx playwright test` **214 passed / 17 failed / 75 skipped (17.8m)**,
  from 212/19 before. Two gates flipped: **G5** (the fix plus the false-positive correction)
  and `tnColumnAudit · every Tunisian column paints real data`, which had failed the previous
  run with `factor columns emitting one constant for every row: Vol Factor=0` and passed here
  untouched — a live TN-feed flake, not a regression, and the second flake of this kind after
  MP-3's `floatingHeader`. The 17 that remain are the same V2 gates owned by MP-5 (G12–G16
  landscape), MP-6/7 (G2/G4 FAB, G8–G11 ask-bar), G1's R8 on `/search` at N and LS, and the
  pre-existing `desktopBaseline` trading-asset landmark drift. Deployed to prod once.
  `MarketList.tsx` carries the same `ml-auto sticky right-0` chooser shape for the TN and US
  lists and no row measures it — same scoping call as MP-2.

- 2026-08-07 · MP-5 · **R10 was green on one route and red on three.** The probe only visited
  `/trading`, and the shell is per route: frame `121607` shows `/trading` with MobileNav,
  frame `121426` shows `/search` with the 72px desktop icon rail plus a second panel in 360px
  of height. Measured across five routes at LS (788x360): **10 shell faults** — `/search`,
  `/companies` and `/history` each rendering `aside.w-14` + `nav.flex flex-col gap-1 flex-1
  stagger` with **MobileNav absent**. At LX (740x360, below `md`) only `/` — 1 fault.

- 2026-08-07 · MP-5 · fix: the app shell is gated on a new Tailwind screen
  **`desk: (min-width: 768px) and (min-height: 500px)`** instead of `md`, in
  `tailwind.config.js`, `AppLayout.tsx` (11 class positions) and `MobileNav.tsx`. A phone in
  landscape is wide enough for `md` and 360px tall; tablet portrait (768x1024) still resolves
  desktop, and both §4 landscape classes no longer do. After, on prod: **R10 0 shell faults
  over 5 routes at LS and LX.**

- 2026-08-07 · MP-5 · **F4's top-chrome half does not reproduce.** `LOG IN` / `SIGN UP` live
  in `TradingAssistantPage.tsx:536-541`, inside a header that renders only when
  `currentView !== 'hub' && activeMarket === 'crypto'` — one tap in from `/trading`, the
  surface F1 and F3 were on. R6 had been measuring `/trading`'s root, where that header does
  not exist, so it could not have seen the fault it names. Measured on the real surface at the
  top of the scroll: LS `LOG IN [631,-38,694,-11]`, `SIGN UP [702,-39,776,-10]` against
  vw 788 — **both fit horizontally** (776 ≤ 788; at LX 728 ≤ 740). Frame `121607` shows SIGN
  UP cut at the right edge; today's build does not. Two measurement corrections were needed to
  say that honestly: MP-3's finding that the ticker strip is an `overflow-x: auto` scroller
  that owns its items (that alone took the count 23–24 → 0), and judging top chrome at
  `scrollTop 0`, because `openCrypto` scrolls the first row into view and pushes the header to
  y=-38. R6 **GREEN at LS and LX**.

- 2026-08-07 · MP-5 · `/` is `LandingPage`, a public route outside `AppLayout`
  (`AppRouter.tsx:163`), so it carries no app chrome at any width — measured `nav: false` at
  **360x780** as well as 788x360. R10's MobileNav half is scoped to app routes; its rail half
  still covers all five, so a desktop rail on the landing page would still fail.

- 2026-08-07 · MP-5 · gates: `tsc --noEmit -p tsconfig.app.json` clean;
  `npx playwright test` **215 passed / 16 failed / 75 skipped (16.4m)**, from 214/17 — V2's
  `G12–G16 · R14: the shell renders the mobile layout at a short viewport` flipped green at
  mobile-landscape, which is F4 measured by someone else's gate. **Second gate touch of this
  ledger, declared:** `src/components/MobileNav.test.tsx` asserts AppLayout's class strings by
  name, so 6 `toContain` arguments moved from `md:` to `desk:` — same count, same matcher, same
  constraint under a renamed breakpoint. `gate-guard` reports `note · 6 assertion(s) rewritten
  at equal or greater strength`, then `clean`. Deployed to prod once.

- 2026-08-07 · MP-5 · whole-ledger sweep after the shell fix:
  **30 measurements, 0 RED, 6 UNMEASURED, 24 GREEN** — from 11 RED at MP-1. Every row that can
  be measured on a cold route is green (R2, R3, R4, R5, R6, R10 across their classes). The 6
  unmeasured all need an interaction the sweep does not perform: **R7 x3** a modal to open
  (MP-6), **R8 and R9** a Research Grid to exist (MP-7), **R11** a company selected (MP-8).
  Those three tasks own opening their own surfaces, and each must show its row red before it
  claims it green. R4's LS line still carries `20 unreachable text element(s)` beside its
  verdict — the landing hero at 788x360, recorded by MP-3 and unowned by any row.

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
