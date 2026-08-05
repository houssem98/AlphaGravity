# MOBILE_FIELD_ROADMAP — what the phone actually renders

Second mobile ledger for `https://market-ui-self.vercel.app`.
Opened 2026-08-05 on branch `roadmap/world-class`.

`docs/MOBILE_APP_ROADMAP.md` (MB-1..MB-15) closed 16/16 with a 109-check sweep
green at 320/390/430/768/1440. Then the app was opened on a **real Android
phone in Chrome** and 16 screenshots were taken. They are in
`attachments/Screenshot_20260805-*.png`. Every fault in §1 below is visible in
one of them.

**The headline is not "V1 was wrong." It is "V1 was blind in two axes."**

1. **Every V1 gate measured horizontal overflow at the document root.** Nothing
   measured a child painting *over* a sibling. §1 G2 is a stacking-context bug
   that renders Bitcoin's price as `7.07`, and 109 green checks never saw it.
2. **Every V1 project was portrait.** `playwright.config.ts` ships
   `mobile-320 / mobile-390 / mobile-430 / tablet-768` — four portrait widths and
   no landscape. Rotating the phone puts the viewport at ≈788×360 CSS, which is
   **above `md:768`**, so a 360px-tall screen renders the full desktop
   three-panel shell. Six of the sixteen screenshots are that.

Read this before you believe any number below: the two lessons V1 closed on are
that **roughly half of all corrections were to the instrument, not to the app**,
and that **inferring structure from someone else's DOM caused four separate
wrong measurements**. Add a `data-testid` or read the source. Do not guess.

Baseline at ledger open: **857 vitest passing / 0 failing / 7 skipped**;
`npx tsc --noEmit -p tsconfig.app.json` clean; the six Playwright projects green.

---

## 1. Faults — every one of these is a photograph

The evidence column names the screenshot file by its timestamp suffix. All
sixteen live in `attachments/`. They were read in full before this ledger was
written; the loop is authorised to read them and no other file in that folder.

The device is Android Chrome. Portrait frames are 720×1568 device px and render
`MobileNav`, which is `md:hidden` — so the CSS width is **below 768**. Landscape
frames are 1576×720 and render the `hidden md:flex` rail — so the CSS width is
**at or above 768**. The exact CSS numbers are unknown and MF-1 measures them.
Do not assume 390; the evidence says smaller.

### Truth faults — a wrong number on screen

| # | Fault | Evidence | Anchor |
|---|---|---|---|
| **G1** | **The market table prints a false price.** In portrait the crypto table renders Bitcoin at `7.07`, Ethereum `9.46`, USDC `0076`, XRP `0613`, Solana `3.93`. The same rows in landscape read `$1.061`, `$73.91`, `$66.30B` — correct. The name cell is `sticky left-0 z-20` with an **opaque** `bg-[color:var(--bg)]`; once the table is scrolled horizontally that opaque cell paints over the leading digits of the price cell beside it. The user is shown a number the server never sent. | `122124` (wrong), `121607` (same data, right) | `components/trading/Markets.tsx:1225` (sticky name `td`), `:1244` (price `td`), same shape in `MarketList.tsx` |

**G1 is the only fault in this ledger that is not cosmetic, and it is why this
ledger exists.** `docs/DEXTER_DESIGN_ROADMAP.md` binds here: never display a
value the server did not send. A z-index that eats four leading digits is
exactly that, committed by CSS instead of by a fetcher. Fix it first.

### Reachability faults — a control the thumb cannot get to

| # | Fault | Evidence | Anchor |
|---|---|---|---|
| **G2** | Portfolio FAB is `fixed bottom-6 left-6 z-40` and lands **on top of the `SEARCH` tab** of `MobileNav`. The first destination in the app is untappable on every `/trading` screen. | `121450`, `121453`, `121621` | `components/trading/PortfolioPanel.tsx:132` |
| **G3** | PDF preview modal has **no reachable close control**. Its header is a two-group flex; the left group (three traffic-light dots + `PDF Preview` + a `truncate max-w-[320px]` title) alone exceeds the viewport, so the right group — zoom, download, **and close** — is pushed off-screen. The modal is a trap. | `122241` | `components/research/PdfPreview.tsx:72-100` |
| **G4** | Assistant FAB is `absolute bottom-4 right-4 z-[60]` and covers the `SOCIAL` half of the INFO/SOCIAL strip. | `121450`, `121453`, `121621` | `pages/TradingAssistantPage.tsx:777` |
| **G5** | `+ Columns` is `sticky right-0 z-50` with **no background**, so it prints its glyph and label directly on top of the `Categories` and `Portfolio` tab labels underneath. | `122124` | `components/trading/Markets.tsx:797-805` |

### Overflow faults — the document itself slides sideways

| # | Fault | Evidence | Anchor |
|---|---|---|---|
| **G6** | **`document` scrolls horizontally on `/search` and `/trading`.** The header, the content, and `MobileNav` all shift together, leaving an empty black column on the right. Row 9 of the V1 ledger asserts `scrollWidth <= clientWidth` on both routes and is green at 320/390/430. Either the fault needs the narrower real width, or it needs state the gate never reaches (a rendered answer, a loaded table). MF-1 decides which; do not fix before you can reproduce. | `121518`, `121925`, `122150` | V1 row 9, `e2e/mobileSweep.spec.ts` |
| **G7** | The asset About panel is clipped on **both** edges — `Market cap` renders as `arket cap`, `1.40%` as `1.40°`. Consistent with G6, but confirm it is the same overflow and not a second one. | `121707` | `components/trading/AssetInfoPanel.tsx` |

### Density faults — legible on a desktop, unreadable on a phone

| # | Fault | Evidence | Anchor |
|---|---|---|---|
| **G8** | Research Grid at portrait width is illegible. Column headers shatter into letter-stacks — `CAT/ALY/STS`, `NEX/T/PRI/NT`, `CO/MP/ARI/SO/N`. Cell bodies collapse to `. \| (` glyph fragments. `RAG` badges paint over `DECLINE` chips. | `121203` | `components/grid/GridView.tsx` |
| **G9** | Company financials table has no column gutters: `$215.94B$130.50B+65.5%` renders as one run of characters. | `121333` | `pages/CompanyPage.tsx` |
| **G10** | The asset tab strip is cut mid-word — `Holders` renders as `Ho` — because `BUY {asset}` is `shrink-0` and pinned right over a scrolling strip with no fade, no chevron, no affordance that the strip scrolls. | `121621` | `components/trading/Topbar.tsx:101-110` |
| **G11** | The chart's `Ask AI about this chart…` bar floats across the x-axis labels and the last candles. | `121450`, `121621` | `pages/TradingAssistantPage.tsx` |

### Landscape faults — a whole orientation with zero coverage

| # | Fault | Evidence | Anchor |
|---|---|---|---|
| **G12** | **Landscape crosses `md`.** At ≈788×360 CSS the shell renders the desktop layout — icon rail, research sidebar, fixed header, both trading side panels — inside a 360px-tall viewport. The actual content pane collapses to 100–200px: the Quick Answer is chopped mid-sentence, the chart is a 200px band, the research composer is the only visible element. Tailwind breakpoints are width-only, and 788 > 768. | `121354`, `121410`, `121426`, `121450`, `121453`, `121607` | `components/AppLayout.tsx:74`, `pages/TradingAssistantPage.tsx` |
| **G13** | MB-15's fix for content sliding under the fixed header is `pt-12 md:pt-0` — **portrait only**. In landscape the mode-tab strip scrolls under the header exactly as it did before MB-15. | `121410` | `components/AppLayout.tsx:74` |
| **G14** | The landscape safe-area gutter is an unpainted pure-black bar beside the app's `--bg`. `body` gets `padding-left: var(--safe-l)` but nothing paints the inset. | `121354` → `121607`, left edge | `src/index.css` safe-area block |
| **G15** | In landscape `MobileNav` correctly renders (`lg:hidden`, so it survives 768–1023) but the market list beneath it has no bottom padding — the last row sits under the bar. | `121607` | `components/trading/Markets.tsx` list container |
| **G16** | Keyboard open in landscape leaves roughly 130 CSS px of content — one input and a button, with no context above them. | `121402` | shell height strategy |

### Not a layout fault — escalate, do not fix here

| # | Observation | Evidence |
|---|---|---|
| **G17** | The `/trading` Topbar renders `LOG IN` / `SIGN UP` while the session is authenticated (`MobileNav` is rendering, which requires `AppLayout`, which is behind auth), and `SIGN UP` is clipped at the right edge. **The clipping is layout; the wrong auth state is not.** Report it in §8, open no task for it, and change no auth code from this loop. | `121607`, `121925` |

---

## 2. Anchors — read before you write

Everything in `docs/MOBILE_APP_ROADMAP.md` §2 still holds and is not repeated
here. Re-read it. The additions this ledger needs:

**Breakpoints are width-only.** `tailwind.config.js` has **no `screens` key** —
the stock `sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536` are all width media
queries. There is no height-aware prefix. G12 and G16 cannot be fixed with a
stock prefix; they need either a raw `@media (min-height: …)` block in
`src/index.css` or a **new named screen under `theme.extend.screens`**. Adding a
new name is additive and does not alter `md:`; **redefining `md:` is forbidden**.

**Playwright coverage today** — `playwright.config.ts` projects: `setup`,
`chromium` (retries 0, deliberately), `desktop-baseline`, `mobile-320`,
`mobile-390`, `mobile-430`, `tablet-768`. **All four mobile projects are
portrait. There is no landscape project and no 360px project.** The evidence
says the real device is narrower than 390 and that landscape is where the worst
faults live. MF-1 closes both holes.

**The shell** — `components/AppLayout.tsx:74` is the whole hinge:
`flex-1 min-w-0 md:ml-14 h-dvh md:h-auto pt-12 md:pt-0 flex flex-col md:block`.
Every `md:` in that string is a width-only assumption that landscape breaks.

**Stacking** — `Markets.tsx:1225` name cell `sticky left-0 z-20` with an opaque
`bg-[color:var(--bg)]`; `Markets.tsx:798` column chooser `sticky right-0 z-50`
with **no** background. Both are stacking contexts painting over neighbours. The
V1 escapee evaluator walks `getBoundingClientRect().right` — it is
**structurally incapable** of seeing either. A new instrument is required, and
MF-1 owns it.

**The screenshots** — `attachments/Screenshot_20260805-*.png`, sixteen files,
read in full before this ledger was written. They are the specification. When a
task's wording and a screenshot disagree, **the screenshot wins** and you say so
in §8.

---

## 3. Doctrine

Everything in `docs/MOBILE_APP_ROADMAP.md` §3 still binds — mobile is a second
layout, one primary surface, the thumb is the pointer, density survives but
cramping does not, ≥16px inputs, honesty outranks polish, desktop is a no-op.
Four rules are added by what the phone showed.

**Overpaint is an overflow.** A child that paints over a sibling has escaped its
box just as surely as one that sticks out of the frame — and it is *worse*,
because the frame at least scrolls. Every `sticky`, `fixed`, `absolute`, and
`z-*` in a mobile path is a claim on space that some other element also claims.
The gate must compare rendered rectangles between siblings, not each rectangle
against the viewport.

**Orientation is a device class, not a width.** A phone in landscape is 788
CSS px wide and 360 CSS px tall. It is not a tablet and it is not a small
laptop, and no width-only breakpoint can tell it apart from either. The shell
must ask about **height** before it commits to a three-panel layout. State the
rule as a floor and enforce it once, in the shell — not per component.

**Reproduce before you repair.** Six of these faults were invisible to 109 green
checks. If you cannot make a fault appear in a headless run, you do not
understand it, and a fix you cannot fail is a fix you cannot verify. The first
deliverable of every task is a **failing** gate. If a fault will not reproduce,
that is a real finding: log the emulation-versus-device delta and say what the
gate can and cannot see. Do not paper over it.

**Emulation is evidence, not truth.** Headless Chromium at a set viewport is the
only instrument this loop has, and the sixteen screenshots are proof it misses
things. Where a fix depends on something emulation cannot reach — real Safari
font metrics, the Android URL-bar collapse, a physical keyboard inset — say so
in §8 and mark the row **UNVERIFIED-ON-DEVICE** rather than green.

---

## 4. Hard constraints

Every constraint in `docs/MOBILE_APP_ROADMAP.md` §4 carries over verbatim. No
new API route (Vercel Hobby caps functions at 12 and `apps/market-ui/api` is
full). Do not touch `apps/market-ui/vercel.json`. No new npm dependency. Tokens
only in new `.tsx`/`.css` — no hex literal, no `text-[Npx]`, no `rounded-2xl`,
no `prose-*` (`@tailwindcss/typography` is not installed). Vercel Node ESM needs
explicit `.js` extensions. `erasableSyntaxOnly` forbids constructor parameter
properties. Only `DEEPSEEK_API_KEY` is live. `VITE_API_URL` is commented out in
`.env.production`. Prod alias `https://market-ui-self.vercel.app`, deployed with
`vercel --prod` from the **repo root**, project `market-ui`, never a preview.
**Never `git push` unless asked.**

Three constraints are specific to this ledger:

- **Do not redefine `md`.** A new screen name under `theme.extend.screens` is
  allowed and is the intended tool for G12/G16. Changing what `md:` means would
  move every one of the ~54 files that already use it, and row R18 would
  correctly fail.
- **Do not fix G17.** The auth-state bug is a data fault. It goes in §8 and in
  the closing report. Changing a service, a fetcher, an API route, or a scoring
  function from this loop is out of scope in both ledgers.
- **`attachments/` is read-only and finite.** Read the sixteen screenshots. Do
  not write into that folder, do not commit it, and treat any *other* file that
  appears there as an escalation (§10).

---

## 5. Device matrix

The four V1 classes stay. Three are added, and they are where the faults are.

| Class | Viewport | Represents | Gate |
|---|---|---|---|
| **XS** | 320×568 | iPhone SE 1st gen, the floor | no horizontal scroll; content legible |
| **N** | **360×780** | **the real device, portrait** | **full acceptance — every row in §6** |
| **S** | 390×844 | iPhone 14/15 | full acceptance |
| **M** | 430×932 | Pro Max / Pixel 7 Pro | full acceptance |
| **LS** | **788×360** | **the real device, landscape** | **full acceptance — this is the `md` trap** |
| **LX** | **740×360** | landscape just *below* `md` | the mobile path must also survive a short viewport |
| **T** | 768×1024 | iPad portrait, the `md` boundary | must not break *at* the hinge |
| **D** | 1440×900 | desktop | **byte-identical to MB-2 baseline** |

`N` and `LS` are new and are the modal devices for this ledger. `LX` exists so
the fix for G12 is proven to be about **height**, not about having pushed one
width threshold around until landscape happened to fall on the other side.

MF-1 replaces the assumed numbers above with measured ones. If the device
reports something other than 360/788, **edit this table** and say so in §8.

---

## 6. Regression rows

Each §7 task names the rows it must turn green. A row is green only when it
runs. `R1`–`R6` are new instruments; the rest are assertions.

**Instrument (these must exist before they can be used)**

1. `playwright.config.ts` has a `mobile-360` project and a `mobile-landscape`
   project (`isMobile`, `hasTouch`, a landscape viewport), both with
   `retries: 1`, and both included in the default run.
2. An **overpaint evaluator** exists and is unit-tested: for a given root it
   returns every pair (A, B) where A and B are non-ancestor DOM elements whose
   client rects intersect by more than 2px, A's effective stacking order puts it
   above B, A's computed `background-color` is not transparent, and B carries
   text. This is the instrument G1/G2/G4/G5 need and the V1 escapee walker
   cannot provide.
3. `scripts/capture-field-record.mjs` shoots every route in both orientations
   into `docs/mobile/field/`, printing `clientWidth × clientHeight`,
   `scrollWidth − clientWidth`, and the overpaint-pair count per shot.
4. The measured CSS viewport of the real device is recorded in §8 with the
   method used to obtain it.
5. Each of G1–G16 has a named gate that **fails on the tree at ledger open**, or
   a §8 line stating it does not reproduce headlessly and why.
6. `npx playwright test` runs all eight projects in §5 without a config edit.

**Truth**

7. `/trading` markets table at N and LS: for every visible row, the text content
   of the price cell parses to a number equal (±0.5%) to the same row's price
   read from the API payload, at horizontal scroll offsets 0, 150, and 400.
   *This is the G1 gate. It compares what the pixel says to what the server
   said. Nothing weaker closes G1.*
8. Zero overpaint pairs (row R2) where the covered element carries a numeral, on
   `/trading` and `/search` at N and LS.

**Reachability**

9. Every `MobileNav` tab is hit-testable at its centre point —
   `document.elementFromPoint(cx, cy)` resolves inside that tab's `<a>` — on
   `/`, `/search`, `/trading`, `/companies`, `/history` at N and LS.
10. Every modal and drawer reachable on a mobile route exposes a dismiss control
    whose rect is fully inside the viewport, at N, XS, and LS. *(PDF preview,
    asset modal, citation drawer, column chooser, portfolio panel.)*
11. No FAB, sticky, or fixed element overlaps `MobileNav`, the INFO/SOCIAL
    strip, or any tab strip, at N and LS.

**Overflow**

12. `document.documentElement.scrollWidth <= clientWidth` on all ten routes at
    XS, N, S, M, LS, LX — **after** the route's primary content has rendered,
    not merely after `domcontentloaded`. State the readiness condition per route
    in the spec.
13. Every horizontally scrolling strip shows a scroll affordance below `md` — a
    visible scrollbar, an edge fade, or a chevron — and no `shrink-0` sibling
    covers its last item.

**Landscape**

14. At LS the shell renders the **mobile** layout: no icon rail, no desktop side
    panel, and exactly one primary surface owning the pane.
15. At LS no content is under the fixed header on load — the topmost interactive
    element's `getBoundingClientRect().top >= headerRect.bottom`, with `scrollTop`
    at 0.
16. At LS the safe-area gutters paint `--bg`; sampling a pixel 4px inside each
    inset returns the background token, not `#000`.
17. At LS, with a simulated 200px keyboard inset, the focused input and its
    submit control are both fully visible.

**Non-regression**

18. Desktop Chrome at 1440×900: landmark geometry on all ten routes plus the
    `/trading` asset view matches the MB-2 baseline in `e2e/baselines/desktop-*.json`
    exactly. Unchanged from V1 row 18 and it still outranks tidiness.
19. Every V1 mobile row stays green — the full `e2e/mobileSweep.spec.ts` suite at
    320/390/430/768, 109 checks.
20. All pre-existing vitest suites stay green (857 passing at ledger open) and
    `npx tsc --noEmit -p tsconfig.app.json` reports 0 errors.
21. Existing e2e specs stay green against prod (`featureContinuity`,
    `floatingHeader`, `hubAssetMarket`, `tradingToSearch`, `scrollChrome`,
    `dexterShip`, `dexterNarrow`, `tnColumnAudit`, `tnNullFeed`, `gridTrust`,
    `backgroundActivity`, `desktopBaseline`).

**Prod**

22. Confirmed on the live alias after `vercel --prod`, at the task's viewport,
    with the measured number pasted into §8. A fixture proves the component;
    only prod proves the product.

---

## 7. Task ledger

Do the **first unchecked** task only. Its spec text is the requirement; the rows
it names are the acceptance tests.

- [x] **MF-1 · Build the instrument that can see these faults.**
      Nothing else may start until a headless run can *fail*. Measure the real
      device's CSS viewport in both orientations and write the numbers into §5
      and §8 (the honest method: open the alias on the device and read
      `innerWidth`/`innerHeight`/`devicePixelRatio`; if that needs the user, say
      so and use the bracket the screenshots prove — portrait renders
      `md:hidden` content so width < 768, landscape renders `hidden md:flex`
      content so width ≥ 768). Add the `mobile-360` and `mobile-landscape`
      projects. Write the overpaint evaluator and unit-test it against a fixture
      with a known-good and a known-bad pair. Write `capture-field-record.mjs`.
      Then run every gate against the **unmodified** tree and record, per fault
      G1–G16, either the failing assertion or the sentence explaining why it does
      not reproduce. **Rows R1, R2, R3, R4, R5, R6.**

- [x] **MF-2 · G1 — the table must never print a price the server did not send.**
      The `sticky left-0` identity cell paints over its neighbour's leading
      digits. Fix so that at every horizontal scroll offset the price cell's
      rendered text is the whole number. Do not solve it by removing the pin —
      MB-6 and V1 row 13 require the identity column to stay visible, and both
      must stay green. **Rows R7, R8, R19; R18 unchanged.**

- [ ] **MF-3 · G2 + G4 — get the floating buttons off the navigation.**
      The portfolio FAB (`fixed bottom-6 left-6`) covers the `SEARCH` tab; the
      assistant FAB (`absolute bottom-4 right-4`) covers `SOCIAL`. Below the
      hinge both must clear every bar and strip. The portfolio FAB also uses
      `bg-indigo-600` and `rounded-full`, neither of which is in the token set —
      if you move it, move it onto tokens; if you do not move it, leave them.
      **Rows R9, R11.**

- [ ] **MF-4 · G3 — the PDF preview must be dismissible on a phone.**
      Its header's left group alone exceeds the viewport and pushes close
      off-screen. A modal with no exit is the worst failure in this ledger after
      G1. Every mobile modal and drawer gets the same audit in the same pass.
      **Row R10.**

- [ ] **MF-5 · G6 + G7 — find the element that widens the document.**
      Name it before you fix it: log the offending element's tag, classes, and
      rect into §8. If MF-1 could not reproduce it headlessly, this task's first
      job is to reproduce it — vary width down to 320, vary readiness state, and
      try landscape — and if it still will not, close the row with the
      measurement that proves the gate cannot see it and say what a user would
      have to do to trigger it. **Rows R12, R19.**

- [ ] **MF-6 · G5 + G10 — sticky chrome stops printing on the content beneath.**
      `+ Columns` is `sticky right-0 z-50` with no background over the tab
      labels; `BUY {asset}` is `shrink-0` over a scrolling strip that gives no
      sign it scrolls. Fix both, and give every below-`md` horizontal strip a
      real affordance. **Rows R8, R13.**

- [ ] **MF-7 · G11 — the chart's ask-bar stops covering the chart.**
      It floats across the x-axis labels and the newest candles. The chart is the
      primary surface of `/trading`; the composer is secondary and must behave
      like it. **Rows R11, R19.**

- [ ] **MF-8 · G12 + G13 + G16 — the landscape hinge.**
      The largest task here. At ≈788×360 the shell picks the desktop layout
      because 788 > 768. Add a **height floor** to the shell's layout decision so
      a short viewport gets the mobile path regardless of width, using a new
      named screen under `theme.extend.screens` or a raw `@media` block in
      `src/index.css`. **You may not redefine `md`.** Carry MB-15's header offset
      into the landscape branch (G13) and prove the keyboard case (G16). Prove it
      is about height and not about a moved width threshold by passing **both**
      LS (788×360) and LX (740×360). **Rows R14, R15, R17, R18, R19.**

- [ ] **MF-9 · G14 + G15 — landscape gutters and the bar's own space.**
      Paint `--bg` into the safe-area insets, and give the list under
      `MobileNav` the bottom padding it is owed so the last row is reachable.
      **Rows R16, R11.**

- [ ] **MF-10 · G8 — Research Grid becomes a real surface at 360px.**
      Headers shatter into letter-stacks, cells collapse to punctuation
      fragments, badges overlap chips. Doctrine applies literally: this is not a
      table to shrink, it is a surface to redesign for a phone. Every cell keeps
      its citation one tap from its claim (`docs/DEXTER_DESIGN_ROADMAP.md`), and
      an uncited figure stays marked wherever it lands. **Rows R8, R12, R19.**

- [ ] **MF-11 · G9 — the company financials table gets its gutters back.**
      `$215.94B$130.50B+65.5%` must read as three values. **Rows R12, R19.**

- [ ] **MF-12 · Field sweep and close.**
      Re-shoot every route in both orientations with `capture-field-record.mjs`.
      Run all eight §5 classes and paste the full matrix into §8 — per class, per
      route, `clientWidth × clientHeight`, document overflow, overpaint-pair
      count, pass/fail. Deploy, verify on the alias, and state plainly which of
      G1–G16 are closed, which are closed-as-unreproducible, and which remain
      **UNVERIFIED-ON-DEVICE** because emulation cannot reach them. Restate G17
      as an open data fault for the user to route. **Rows R1–R22, all.**

---

## 8. Progress log

One line per completed task. Real numbers only — test counts, measured pixels,
route names, status codes, element selectors. No adjectives.

**MF-1** — `src/lib/overpaint.ts` (collector in-page + pure pairing in Node,
10/10 vitest), `e2e/mobileField.spec.ts` (15 gates, 151 tests over 6 mobile
projects), `src/mobileField.test.ts` (G3 source gate, 3/4 failing by design),
`scripts/capture-field-record.mjs`; `playwright.config.ts` +`mobile-360`
360x780, +`mobile-landscape` 788x360, +`mobile-landscape-740` 740x360, all
`retries: 1`, all in the default run — `npx playwright test --list` = 300 tests
over all 8 §5 classes with no config edit (chromium 30, desktop-baseline 11,
mobile-320 52, mobile-360 25, mobile-390 52, mobile-430 52, mobile-landscape 25,
mobile-landscape-740 25, tablet-768 27, setup 1). `npx tsc --noEmit -p
tsconfig.app.json` 0 errors. vitest 1193 passed / 3 failed (the 3 are G3's own
gates) / 7 skipped. `vercel --prod` from repo root, aliased
`https://market-ui-self.vercel.app`. Rows R1 R2 R3 R4 R5 R6.

**MF-2** — G1 closed. `Markets.tsx`: below `md` the price renders inside the
pinned identity cell (`data-testid="price"`, `md:hidden`), the price column
becomes `hidden md:table-cell`, and the `Price` header with it; one `priceText`
string feeds both. The pin is untouched — MB-6 and V1 row 13 stay green. On the
alias at N 360x780 the G1 gate went from **20 covered price glyphs**
(`td.py-2.5.px-4.sticky.left-0@-97,320 210x45` covering **39px** of
`"$64,602.82"` at scrollLeft 150) to **0** at offsets 0/150/400; **@LS 788x360
0** as before. V1 row 13 green at 320/390/430 — identity cell still
`position: sticky`. `mobileSweep` **103 passed / 6 skipped / 0 failed = 109**
(R19). `tsc --noEmit -p tsconfig.app.json` 0 errors. `vercel --prod` from repo
root, alias `market-ui-self.vercel.app`. Rows R7 R19 green.

**R8 is green on the surface G1 owns and red on one it does not, and is left
red.** Zero numeral overpaint in the market table at N and LS. On `/search` the
route-wide R8 gate catches `header.h-12.bg-[color:var(--surface)]@0,0 360x48`
covering **112x12px** of `"5 retrieval channels"`, **108x43px** of `"Tesla gross
margin trend from 2023 to 20"` and **11x7px** of `"04"` — at **N**, in
portrait. That is G13's mechanism (content under the fixed header) at a width
MB-15's `pt-12 md:pt-0` was supposed to cover, and it belongs to **MF-8**, which
must re-run R8 at N and LS before closing.

**R18's `/trading asset view` row was already red before MF-2 and MF-2 did not
move it.** Measured: `gone: [style*="width:"] x=72 w=242`,
`new: [style*="width:"] x=72 w=255`, `new: [style*="width:"] x=1156 w=249` — a
left panel 13px wider and a Social Intelligence right panel that the baseline
does not have. Three proofs it is not this task's: the **other 10 routes pass**,
including `/trading` itself, which is where the MF-2 diff renders; the asset
view mounts `MarketsTab` (`TradingAssistantPage.tsx:667`), not `<Markets>`
(`:570`); and `e2e/baselines/desktop-trading-asset.json` was captured at **MB-2
(db3c184, 2026-08-02)**, after which **7 commits** touched the asset view —
MB-4, MB-5, MB-6, MB-7, MB-8, MB-12, DI-13. The baseline is stale by design of
V1's own work. Escalated per §10; not re-baselined without a decision.

**R4 — the device's CSS viewport, and how it was obtained.** No JS was run on
the phone; reading `innerWidth`/`innerHeight`/`devicePixelRatio` there needs the
user. What the frames give: portrait 720x1568 device px, landscape 1576x720, and
the §1 bracket — portrait renders `MobileNav` (`md:hidden`, so width < 768),
landscape renders the `hidden md:flex` rail (width >= 768). The only DPR that
satisfies both is **2**: 720/2 = **360** (< 768, holds) and 1576/2 = **788**
(>= 768, holds). §5's widths are therefore measured, not assumed, and the table
is unchanged. **Heights are not**: subtracting Chrome's status+URL band from
each frame gives roughly (1568-163)/2 ~= **702** CSS px portrait and
(720-135)/2 ~= **292** landscape, so the emulated 360x780 and 788x360 are about
**78 and 68 CSS px TALLER than the real device**. Emulation is the more
forgiving instrument in exactly the axis G12 and G16 are about. Numbers derived
from the frames, not read from the device — treat as +/-10px.

**R5 — every fault, gate by gate, against the unmodified tree on prod.**

Reproduced, gate fails now:

| # | Gate | Measurement |
|---|---|---|
| G1 | R7 @N | **20 price glyphs painted over**. `td.py-2.5.px-4.sticky.left-0@-97,320 210x45` covers **39px** of `"$64,602.82"` in `td.py-2.5.px-4.text-right.font-mono@74,336 83x14` at scrollLeft 150. DOM text matched the `/api/crypto/markets` payload within 0.5% — the text is right and the pixels are wrong. **@LS the same gate PASSES**, which agrees with screenshot `121607`. |
| G2 | R11 @N | `button.fixed bottom-6 left-6 p-4 bg-indigo-600` `[24,700,80,756]` covers **56x22px** of the nav. |
| G3 | vitest | 3/3 mechanism gates fail: left group has no `min-w-0`, right group no `shrink-0`, close has no `aria-label`. |
| G4 | R11 @N,@LS | assistant FAB covers **44x28px** of `SOCIAL`. |
| G5 | R8 @N,@LS | `"Columns"` over `"categories"`; chooser `[263,251,360,282]` vs tab `[260,251,348,286]` = **85x31px**. |
| G11 | R11 | ask-bar covers **192x19px** (@N) / **348x19px** (@LS) of the chart canvas; `position: static`. |
| G12 | R14 @LS | `/search` and `/companies`: **desktop rail 56px wide at 788x360**, MobileNav not rendered. `/trading` runs its own shell (aside width 0, no `<header>`) and is not the surface this row asks about. |
| G13 | R15 @LS | `button.shiny chrome press group relative text-left rounde` top **-17** under a header ending at **48**, `scrollTop` 0. |
| G14 | R16 @LS | `html` paints `rgba(0, 0, 0, 0)`; `--bg` is `#070A12`. |
| G15 | R11 @LS | **2 rows under the nav**; nav top **314** of **360**. |

Does not reproduce headlessly — what the gate can and cannot see:

| # | Result |
|---|---|
| G6 | **10/10 routes pass at both N and LS**: `documentElement.scrollWidth - clientWidth = 0` on `/` `/auth` `/search` `/trading` `/companies` `/history` `/dashboard` `/documents` `/settings` `/billing`, measured after the route's primary content rendered. The document does not slide sideways in emulation at either the real portrait width or the real landscape width. MF-5 owns closing this with the measurement, not with a fix. |
| G7 | The About panel never renders on the asset view at N or LS — no element with the exact text `Market cap` exists after opening the asset and tapping `INFO`. The gate exists and skips with that reason. |
| G8 | `/search` renders **zero `<th>`** on prod for this account: the Research Grid needs a completed grid run, which the gate cannot produce. |
| G9 | `/companies/AAPL` renders **zero populated `<td>` pairs** at N or LS. `CompanyPage.tsx:611` exists; the data behind it does not arrive for this account. |
| G10 | R13 @N **passes** — the last tab of the asset strip hit-tests to itself. |
| G16 | R17 @LS **passes** at 788x160 (a 200px inset simulated by shrinking the frame; this reproduces the height, not the `visualViewport` events). |

**UNVERIFIED-ON-DEVICE.** G14's gate asserts the paint rule, not the photograph:
`env(safe-area-inset-*)` is 0 in headless Chromium — there is no notch to
emulate — so the black gutter in `121354`..`121607` cannot be produced here. Same
class of limit for G16's soft keyboard.

**R9 is a weaker instrument than R11 for G2.** Measured at N: the FAB is
`[24,700,80,756]`, the SEARCH tab is `[0,735,72,780]`, and the tab's centre
`(36, 757)` misses the FAB's bottom edge by **1.5px**. A centre-point hit test
reports the tab reachable while 56x22px of it is covered. R9 stays as written —
it is the row's own definition — and G2's acceptance is R11.

**Two instrument bugs found and fixed before any of the numbers above were
trusted**, both of which had been reporting the app clean: (1) the collector
culls anything outside the viewport, and the crypto table's first row sits past
y=780 at N, so every G1/G5 gate was measuring an empty set until the row was
scrolled into view; (2) the "over" side was pruned to elements with their own
`position` — G5's `+ Columns` text lives in a `static` button inside a
`sticky z-50` wrapper, so the box doing the painting was the one being dropped.

**Corrections to this ledger.** The stated baseline of **857 vitest passing is
wrong**: `npx vitest run` from `apps/market-ui/` on the unmodified tree reports
**1182 passed / 0 failed / 7 skipped**, with **21 test *files* failing
collection** — vitest picks up the Playwright specs and several 0-test files.
That is the pre-existing condition, not a regression.

**G17 stands, unfixed and unopened**, per §4: `/trading` renders `LOG IN` /
`SIGN UP` while the session is authenticated. Data fault. No task, no auth code
touched.

**Carried forward from V1, unresolved and still true:**
- Every V1 gate measures horizontal overflow; vertical clipping and sibling
  overpaint are invisible to all of them. R2 is the instrument that changes this.
- `EdgarLink.tsx` is untracked while `CompanyPage.tsx` imports it. A merge to
  `main` breaks the build until it lands. Not this loop's to fix — flagged.

---

## 9. Stop conditions

Stop on any one of three, and **say which**.

- **TARGET** — no `[ ]` remains in §7 **and** MF-12 actually ran the full §6
  sweep across all eight §5 classes with the matrix pasted into §8. Checked
  boxes with an unrun gate is not a target hit.
- **BUDGET** — 12 tasks or 20 iterations, whichever comes first.
- **STALL** — 3 consecutive iterations with no row changing state and no new
  failure mode. Report which row is stuck and on what. Do not widen scope and do
  not re-run a green sweep to manufacture activity.

A failed gate is a real result. If a row cannot go green, log the measurement
that proves it and close the row. **Do not invent an MF-13 to keep the loop
alive.** If G6 turns out to be unreproducible, "the gate cannot see it and here
is what a user must do to trigger it" is a finished, valid, shippable output.

---

## 10. Escalation — halt and ask

- any `git push`, or any deploy other than `vercel --prod` on `market-ui`
- any new npm dependency, any change to `vercel.json`, any new API route
- any redefinition of the `md` breakpoint
- any file entering the repo the loop did not write and has not read — including
  any file appearing in `attachments/` beyond the sixteen named screenshots
- any desktop screenshot that legitimately must change
- any fault that turns out to be a data problem rather than a layout problem
  (G17 is already one; report it, do not fix it)
- anything that cannot be verified this iteration

Escalation is the loop working, not the loop failing.

---

## 11. Cadence

This loop **works** rather than watches. Every iteration is edit, test, deploy,
verify, log — all performed by the agent, with no external state to wait on.
Schedule the next wakeup at **120 seconds**, per `~/.claude/LOOP_SPEC.md`.

On usage or rate limit (429, overload): stop consuming tokens immediately,
`ScheduleWakeup` 3600s with the same `/loop` prompt, and on wake re-read this
ledger and the §8 log and resume the same task from its last verified step. Log
partial progress **before** long or risky operations.

---

## 12. Reporting

Report what the instrument measured, not what the fix intended. Every §8 line
carries a number a reader could re-derive. When a screenshot and a gate
disagree, the screenshot is the ground truth and the gate is the bug — say so.
When a fix cannot be verified headlessly, the row is **UNVERIFIED-ON-DEVICE**,
never green.

If every remaining gate has failed, say the work is finished and recommend
stopping.
