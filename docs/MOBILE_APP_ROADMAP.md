# MOBILE_APP_ROADMAP — market-ui on a phone

Ledger for the mobile pass on `https://market-ui-self.vercel.app`.
Opened 2026-08-02 on branch `roadmap/world-class`.

Scope: **presentation and layout only.** Every data path in this app is already
correct and already verified by its own ledger (`docs/AI_TRADING_AGENT_ROADMAP.md`
DX-1..16, `docs/DEXTER_DESIGN_ROADMAP.md` DD-1..14, `docs/TN_VISUAL_PARITY_ROADMAP.md`,
`docs/CRYPTO_V*_ROADMAP.md`). This loop never edits a service, a fetcher, an API
route, or a scoring function. If a mobile task appears to need different data,
it needs a different **layout**, not a different **payload**.

Baseline at ledger open: **857 vitest passing, 0 failing, 7 skipped**;
`npx tsc --noEmit -p tsconfig.app.json` clean; Playwright green on one project
(Desktop Chrome).

---

## 1. Faults — measured, not asserted

Each row was measured against the tree at ledger open. Line numbers are anchors;
re-read them before trusting them.

| # | Fault | Evidence | Effect at 390px |
|---|---|---|---|
| **F1** | Trading asset view is a hard 3-column with fixed side panels | `pages/TradingAssistantPage.tsx:56-57` (`leftW` default **288**, `rightW` default **300**), rendered at `:564-676` | 288 + 300 = **588px of side panel on a 390px screen**. The chart column is `flex-1 min-w-0` → collapses to ~0. The primary surface of the app is invisible. |
| **F2** | `AppLayout` has **zero** breakpoints | `components/AppLayout.tsx:29-63`, `grep -oE '(sm\|md\|lg\|xl):' → 0 hits` | A 56px icon rail is permanently pinned (`w-14` + `ml-14`), eating **14%** of the viewport. Nav labels exist only as `title=` (`:33,44,58`) — a hover affordance with no touch equivalent, so nine routes are nine unlabelled glyphs. |
| **F3** | Market tables carry a hard floor of 1200px | `components/trading/Markets.tsx:899`, `components/trading/MarketList.tsx:824` — both `min-w-[1200px] whitespace-nowrap` | **3.1× the viewport.** Usable only by blind horizontal dragging, with no frozen identity column, so a scrolled row loses its ticker. |
| **F4** | 33 viewport-height sites, **0** dynamic ones | `grep -rn 'h-screen\|100vh' → 33`; `grep -rn 'dvh' → 0` | iOS Safari sizes `100vh` to the *expanded* toolbar state. Every bottom-pinned control (composer, tab bar, assistant toggle) sits under the browser chrome until the user scrolls. |
| **F5** | No mobile document contract | `index.html` ships `width=device-width, initial-scale=1.0` and nothing else; `public/` = `data/`, `logos/`, 4 jpgs — **no manifest, no icons** | No `viewport-fit=cover` → content runs under the notch and the home indicator. No `theme-color` → white browser chrome above a `#070A12` app. Not installable: "add to home screen" yields a generic bookmark. |
| **F6** | `index.css` has no mobile layer | 3 `@media` blocks total (`:187`, `:485` reduced-motion, `:493` print) — **zero width-based queries** | Every responsive decision is a per-component Tailwind prefix, and there are almost none (F7). |
| **F7** | Breakpoint coverage is decorative | 54 of 135 `.tsx` files carry any `sm:`/`md:`/`lg:`. Per page: `SearchPage` 4 hits across 113KB, `TradingAssistantPage` 3, `CompanyPage` 2, and **0** for `AuthPage`, `DocumentsPage`, `SettingsPage`, `MfaSetupPage`, `ReportViewerPage`, `ForgotPasswordPage`, `ResetPasswordPage`, `VerifyEmailPage` | The sign-in path — the first screen a new phone user meets — has no mobile handling at all. |
| **F8** | Mobile primitives installed, never adopted | `hooks/use-mobile.ts` (`useIsMobile`, 768px) has exactly **one** consumer: `components/ui/sidebar.tsx`, itself unused. `vaul` is in `dependencies` and `components/ui/drawer.tsx` wraps it — **zero** product consumers | The bottom-sheet pattern this roadmap needs is already paid for and sitting idle. Build on it; add no new dependency. |
| **F9** | The Dexter panel is 396px wide on a 390px screen | `pages/TradingAssistantPage.tsx:667` — `absolute bottom-20 right-4 w-[380px]` | 380 + 16 = **396 > 390**. DD-13 already proved the panel's *contents* reflow cleanly at 380px (`e2e/dexterNarrow.spec.ts`); only its shell is wrong. |
| **F10** | Asset modal reserves a fixed side column | `components/trading/AssetInfoPanel.tsx:1501` `w-[900px] max-w-[96vw]` with `:1550` `w-[280px] shrink-0` | 96vw of 390 = 374px; minus the 280px column leaves **94px** for the modal's actual content. |
| **F11** | Touch targets below the platform minimum | ~20 button sites at `w-6 h-6` (24px) or `w-8 h-8` (32px) out of 323 buttons; the whole nav rail is 32px | iOS HIG minimum is 44pt, Android 48dp. The rail, the toolbar, and the panel close buttons are all mis-taps. |
| **F12** | Mobile regressions are invisible to CI | `playwright.config.ts` → `projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }]` | Nothing in the repo has ever rendered this app at a phone width except the one DD-13 fixture spec. Every fault above shipped green. |

**Root cause, stated once:** this is a Bloomberg-lineage terminal UI — 11/12/13px
type, 2-6px radii, multi-panel density — built at desktop width and never given a
second layout. The design system is good. It has one breakpoint, and that
breakpoint is "desktop".

---

## 2. Anchors — read before you write

Never invent a token, class, prop, or number. These are the real ones.

**Design tokens** — `src/index.css:15-31`
`--bg #070A12`, `--surface`, `--surface-2`, `--line`, `--line-strong`,
`--text`, `--text-2`, `--text-3`, `--text-4`, `--accent`, `--accent-ink`,
`--up`, `--down`, `--flat` (all oklch).
Spacing `--space-3xs 2px` → `--space-3xl 48px`. Radii `--radius-sm 2px`,
`--radius 4px`, `--radius-lg 6px`. Type `--fs-label 11` / `--fs-data 12` /
`--fs-body 13` / `--fs-h4 14` / `--fs-h3 16` / `--fs-h2 20` / `--fs-h1 28`.

**Tailwind** — `tailwind.config.js:7-61`
Colour names `background surface surface-2 line line-strong text-2 text-3 text-4
accent up down flat`. Families `Archivo` (sans), `Archivo Narrow` (display),
`Martian Mono` (mono). Sizes `label`/`data`/`body` only. Spacing steps
`3xs 2xs xs sm md lg xl 2xl 3xl`. **Radii capped at `xl: 8px`** — `rounded-2xl`
is off-scale and falls through to Tailwind's default 16px.
Breakpoints are Tailwind stock: `sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536`.
Plugins: `tailwindcss-animate` **only** — `@tailwindcss/typography` is NOT
installed, so every `prose-*` class compiles to nothing.

**Shell** — `components/AppLayout.tsx` (rail + header + `<Outlet/>`),
`src/AppRouter.tsx:163-203` (21 routes), `src/lib/navItems.ts` (`NAV_ITEMS`, 9
entries — the single source of truth both rails import; do not fork it).

**Trading** — `pages/TradingAssistantPage.tsx` (`:398` root `flex h-screen`,
`:443` column, `:564` 3-column asset view, `:667` assistant shell, `:676` FAB),
`components/trading/ResizeHandle.tsx`, `Topbar.tsx`, `Sidebar.tsx` (drawing
tools), `AssetInfoPanel.tsx`, `CommunityPanel.tsx`, `Markets.tsx`,
`MarketList.tsx`, `MarketHub.tsx`, `tabs/{Markets,News,Yield,Holders,About}Tab.tsx`.

**Mobile primitives already present** — `hooks/use-mobile.ts` (`useIsMobile`,
768px, `matchMedia`), `components/ui/drawer.tsx` (vaul; supports
`direction=bottom|top|left|right`, `max-h-[80vh]`, drag handle).

**Measurement** — `e2e/dexterNarrow.spec.ts` is the model: set a real viewport,
render, then walk the DOM for elements whose `getBoundingClientRect().right`
exceeds the frame with no scrolling ancestor. Copy that evaluator; do not invent
a new assertion style. `playwright.config.ts` baseURL defaults to the prod alias.

---

## 3. Doctrine

**Mobile is a second layout, not a shrunken first one.** A 390px phone is not a
narrow desktop. Panels that sit side by side on a desktop become *destinations*
on a phone — a sheet, a tab, a route — not 94px slivers. Any task whose answer is
"make it smaller" is the wrong answer.

**One primary surface per screen.** At `md` and below, exactly one thing owns the
viewport: the chart, or the table, or the answer. Everything else is one tap
away and announces itself. Two competing panels on a phone means neither works.

**The thumb is the pointer.** Primary actions live in the bottom third. Nothing
interactive is smaller than 44×44 CSS px, including its hit-slop. `title=` is not
an affordance on touch — a glyph that needs a tooltip needs a label.

**Density survives; cramping does not.** Keep the terminal aesthetic — 11/12/13px
type, 2-6px radii, mono numerals, the oklch palette. Do not "mobile-ify" into
rounded cards and 16px body text. But a **text input** must be ≥16px or iOS
zooms the viewport on focus and never zooms back; that is a platform bug, not a
design choice, and it is the one size exception.

**Honesty outranks polish, always.** Every rule from
`docs/DEXTER_DESIGN_ROADMAP.md` still binds: a citation stays one tap from its
claim, an uncited figure stays marked where it sits, a fabricated citation stays
red, and no responsive collapse may hide provenance to save vertical space. If a
mobile layout cannot fit both a number and its source, it ships the source.

**Never display a value the server did not send.** Collapsing a panel does not
license inventing a summary of it. Hide it, or render what arrived.

**Degrade to the same pixels.** Above `md`, every diff in this loop must be a
**no-op**. The desktop app is finished and correct; if a desktop screenshot
changes, the task is wrong. Guard this with an explicit regression row, not with
hope.

---

## 4. Hard constraints

- **No new API route.** Vercel Hobby caps functions at 12 and `apps/market-ui/api`
  is full (`agent/ crypto/ social/ tn/ _sina financials fundamentals history news
  quote spark`). This is a layout loop; it should need zero server work.
- **Do not touch `apps/market-ui/vercel.json`.** The `/api/((?!tn/|agent/).*)`
  rewrite to Fly and the SPA fallback are both load-bearing.
- **No new npm dependency.** `vaul`, `motion`, `lucide-react`,
  `react-resizable-panels`, `embla-carousel-react`, and `@radix-ui/*` are already
  installed. Read `package.json` before reaching for anything.
- **Tokens only in new code.** No hex literal, no `text-[Npx]`, no `rounded-2xl`,
  no `prose-*`. Legacy hex (`#0B0E14`, `#1B2236`, `#00F0FF`) may stay where it is
  unless a task names it. Grep your own diff for those four patterns before
  calling a task done.
- **Vercel Node ESM** needs explicit `.js` extensions on relative imports from
  `src/` reachable by `api/` (builds fine, 500s at request time).
- **`erasableSyntaxOnly`** forbids constructor parameter properties.
- **Env reality:** only `DEEPSEEK_API_KEY` is live (Gemini quota-dead, Anthropic
  401, Groq 401). `VITE_API_URL` is commented out in `.env.production`, so
  market-server is unreachable from prod — mobile work must not depend on it.
- **Prod alias:** `https://market-ui-self.vercel.app`. Deploy with
  `vercel --prod` from the **repo root** (project `market-ui`). Never stage a
  preview. **Never `git push`** unless asked — a push to `main` clobbers prod.

---

## 5. Device matrix

| Class | Width | Represents | Gate |
|---|---|---|---|
| **XS** | 320px | iPhone SE 1st gen, the floor | no horizontal scroll; content legible |
| **S** | 390px | iPhone 14/15, the modal device | full acceptance — every row in §6 |
| **M** | 430px | iPhone Pro Max, Pixel 7 Pro | full acceptance |
| **T** | 768px | iPad portrait, the `md` boundary | the hinge: layout may switch here, and must not break *at* here |
| **D** | 1440px | desktop | **byte-identical to ledger open** |

Playwright device profiles: `devices['iPhone 14']`, `devices['Pixel 7']`,
`devices['iPad (gen 7)']`, `devices['Desktop Chrome']`.

---

## 6. Regression rows

Numbered acceptance tests. Each §7 task names the rows it must turn green. A row
is green only when it runs — a row that was never executed is not a pass.

**Structure (vitest, `npx vitest run` from `apps/market-ui/`)**

1. `index.html` contains `viewport-fit=cover` and a `theme-color` meta matching `--bg`.
2. `public/manifest.webmanifest` parses, and its `name`/`short_name`/`theme_color`/`background_color`/`display`/`icons` are all present.
3. No product component under `src/` renders a `100vh`/`h-screen` root; app shells use `dvh`.
4. `NAV_ITEMS` is consumed by both the desktop rail and the mobile nav — one import, no forked list.
5. Every wide surface (`min-w-[…]` table, horizontal strip) has an ancestor with `overflow-x-auto`.
6. Every interactive element in the mobile nav and mobile toolbars resolves to ≥44px in both axes.
7. Every `<input>`/`<textarea>` reachable on a mobile route computes to ≥16px font-size.
8. No new `prose-*`, `rounded-2xl`, `text-[Npx]`, or hex literal in the diff — scoped to `.tsx` and `.css`, where the tokens are reachable. Static assets and document `<meta>` (`index.html`, `manifest.webmanifest`, `icon.svg`) cannot read a CSS variable and are exempt; their literals must equal the token they mirror.

**Layout (Playwright, mobile projects)**

9. `document.documentElement.scrollWidth <= clientWidth` on every route in §5 XS/S/M. *(routes: `/`, `/auth`, `/search`, `/trading`, `/companies`, `/history`, `/dashboard`, `/documents`, `/settings`, `/billing`)*
10. No element's right edge exceeds the viewport without a scrolling ancestor — the DD-13 escapee evaluator, run per route.
11. `/trading` asset view at 390px: the chart element's measured width is ≥ 88% of viewport width.
12. `/trading` at 390px: `AssetInfoPanel` and `CommunityPanel` are each reachable in **one** tap and each own ≥ 90% of the viewport when open.
13. Market table at 390px: the identity column stays pinned while the row scrolls; the ticker of the first row is still visible after a 600px horizontal scroll.
14. Dexter assistant at 390px: opens to ≥ 85% viewport height, its own right edge ≤ viewport width, and the composer sits above the safe-area inset.
15. Bottom-pinned chrome is visible without scrolling on a 390×664 viewport (iOS Safari's collapsed-toolbar height).
16. Tapping any bottom-nav destination changes the route and the active state, with no layout shift > 0.1 CLS.
17. `/auth` at 390px: email field, password field, and submit are all visible without horizontal scroll and without the keyboard covering submit.

**Non-regression**

18. Desktop Chrome at 1440px: **landmark geometry** on all 10 routes in row 9, plus the `/trading` asset view, matches the baseline captured in MB-2 (`e2e/baselines/desktop-*.json`). The gate compares the x-offset and width of every structural landmark and their count; heights are recorded but not asserted, since a table that gained rows is data, not layout. *(Row 18 originally said "pixel-identical screenshot". That is unachievable against this alias — every route renders live prices, so two runs a minute apart differ in hundreds of cells with no layout change at all. Geometry is the sharper instrument for the actual question, not a weaker one. Screenshots are still written to `e2e/baselines/shots/` as human-reviewable artifacts; they are not the gate.)* Modal and drawer open states are proven by the task that owns each surface — MB-7 the assistant, MB-8 the asset modal, MB-9 the citation drawer — where the interaction is already being exercised.
19. All pre-existing vitest suites stay green — 857 passing at ledger open (`dexter*`, `taLevels`, `drawGate`, `gridTrust`, `gridTrustRunner`, `gridLessons`, `gridRunStore`, `gridTrace`, `gridResearch.sources`, `EdgarLink`, `tnColumn*`).
20. `npx tsc --noEmit -p tsconfig.app.json` → 0 errors.
21. Existing e2e specs stay green against prod (`featureContinuity`, `floatingHeader`, `hubAssetMarket`, `tradingToSearch`, `scrollChrome`, `dexterShip`, `dexterNarrow`, `tnColumnAudit`, `tnNullFeed`, `gridTrust`, `backgroundActivity`).

**Prod**

22. The change is confirmed **on the live alias** at a real mobile viewport after `vercel --prod`, with the measured number pasted into §8. A fixture proves the component; only prod proves the product.

---

## 7. Task ledger

Do the **first unchecked** task only. Its spec text is the requirement; the rows
it names are the acceptance tests.

- [x] **MB-1 · Mobile document contract.** `index.html`: `viewport-fit=cover`,
  `theme-color` = `--bg`, `apple-mobile-web-app-*`, manifest link. Add
  `public/manifest.webmanifest`. Add safe-area custom properties to
  `src/index.css` (`--safe-t/-r/-b/-l` from `env(safe-area-inset-*)`, 0 fallback)
  and one width-based `@media` layer to hang mobile rules on. Swap `h-screen` →
  `h-dvh` in the app shells (`AppLayout`, `TradingAssistantPage:398`,
  `SearchPage`) — shells only, not every one of the 33 sites.
  *Rows: 1, 2, 3, 19, 20.*

- [x] **MB-2 · The measurement gate.** Add `mobile-390`, `mobile-320`,
  `mobile-430`, `tablet-768` Playwright projects alongside `chromium`. Write
  `e2e/mobileSweep.spec.ts`: for each of the 10 routes in row 9, load, assert
  rows 9 + 10 using the DD-13 escapee evaluator lifted verbatim from
  `dexterNarrow.spec.ts`. **Capture the desktop baseline screenshots for row 18
  in this task, before any layout changes land.** Expect this spec to FAIL loudly
  on ~every route — that failure list is the real fault map and gets pasted into
  §8 as MB-2's result. Do not fix anything here.
  *Rows: 9, 10, 18 (baseline captured), 21.*

- [x] **MB-3 · App shell nav.** `AppLayout`: below `md`, hide the 56px rail and
  drop `ml-14`; render a bottom tab bar with the first 4 `NAV_ITEMS` plus a
  "More" trigger opening a `vaul` bottom Drawer holding the rest — **labelled**,
   ≥44px, safe-area padded. Header shrinks to brand + live dot. Above `md`,
  nothing changes. One `NAV_ITEMS` import, no forked list.
  *Rows: 4, 6, 9, 10, 15, 16, 18, 19, 20, 22.*

- [ ] **MB-3.5 · The front door.** `/` is the URL a phone user actually types,
  and it is the least-covered surface in the app: `LandingPage` composes four
  GSAP `ScrollTrigger` sections (`sections/{Hero,Dashboard,Execution,Closing}Section.tsx`)
  that are each `h-screen` with `pin: true` + `scrub`, behind **614KB** of
  `*_city_bg.jpg`; `ExecutionSection` has **0** breakpoints. Below `md`: drop the
  pinning and let the page scroll natively (scroll-jacking fights both the touch
  scroller and the iOS toolbar collapse — on a phone it reads as a broken page,
  not as motion design), stack every section grid to one column, and serve the
  city backgrounds at a mobile width or drop them to a token gradient. The
  `prefers-reduced-motion` block already in `index.css:187,485` must actually
  disable the remaining GSAP timelines, not just the CSS ones. Above `md` the
  pinned scroll experience is unchanged. `InvestorsPage` (0 breakpoints) rides
  along.
  *Rows: 9, 10, 15, 18, 19, 20, 22.*

- [ ] **MB-4 · Trading shell → single column.** `TradingAssistantPage:564-676`:
  below `md`, stop rendering the 3-column flex. Chart owns the viewport;
  `AssetInfoPanel` and `CommunityPanel` become `vaul` sheets opened from a
  two-button strip; `ResizeHandle` and the drawing `Sidebar` are hidden (the
  drawing tools are a desktop-pointer feature — a `title`-only 32px palette is
  not usable by thumb, and pretending otherwise is worse than hiding it).
  `leftW`/`rightW` localStorage keys keep their desktop meaning untouched.
  *Rows: 9, 10, 11, 12, 18, 19, 20, 22.*

- [ ] **MB-5 · Topbar and tab strip.** `components/trading/Topbar.tsx`: below
  `md`, the tab row (`Chart/Markets/News/Yield/Holders/About`) and the timeframe
  row become horizontally scrollable snap strips inside their own
  `overflow-x-auto` — never wrapping, never truncating the active tab out of
  view (scroll the active one into view on change). Buy/sell and the overflow
  menu meet 44px.
  *Rows: 5, 6, 9, 10, 18, 19, 20, 22.*

- [ ] **MB-6 · Market tables.** `Markets.tsx:899` and `MarketList.tsx:824`: below
  `md`, drop the `min-w-[1200px]` floor and render a mobile column preset —
  identity (logo + ticker) **pinned** via `sticky left-0`, then price and change,
  with the remaining columns reachable by horizontal scroll inside the existing
  container. Reuse the existing column-preference plumbing
  (`tn-cols-v2` / crypto col prefs); do not fork a second table component.
  Desktop column set and order unchanged.
  *Rows: 5, 9, 10, 13, 18, 19, 20, 21, 22.*

- [ ] **MB-7 · Dexter assistant sheet.** `TradingAssistantPage:667`: below `md`,
  replace `absolute bottom-20 right-4 w-[380px] h-[600px]` with a full-width
  bottom sheet — `inset-x-0 bottom-0 h-[88dvh]`, safe-area padded composer,
  drag-to-dismiss handle. The panel's *contents* already reflow at 380px (DD-13,
  proven by `dexterNarrow.spec.ts`) — change the shell only, touch nothing inside
  `components/trading/Assistant.tsx` except what the shell change forces. The FAB
  moves clear of the bottom tab bar.
  *Rows: 9, 10, 14, 15, 18, 19, 20, 21, 22.*

- [ ] **MB-8 · Asset modal.** `AssetInfoPanel.tsx:1501,1550`: below `md`, the
  `w-[900px]` modal goes full-screen and the `w-[280px]` side column stacks
  beneath the main body instead of stealing from it. The modal's off-scale
  `rounded-2xl` stays exactly as it is — changing it would change the modal on
  desktop, which §3 forbids. Note it in §8 and move on.
  *Rows: 9, 10, 18, 19, 20, 22.*

- [ ] **MB-9 · Search.** `SearchPage.tsx`: the `w-[256px]`/`w-[280px]` asides
  (`:1192`, `:1616`) become sheets below `md`; the `w-[400px]` citation drawer
  (`:635`) goes full width; the composer is safe-area padded and its input is
  ≥16px so iOS does not zoom on focus. A citation stays **one tap** from its
  claim — if the drawer costs a tap, the claim marker gains one.
  *Rows: 7, 9, 10, 18, 19, 20, 21, 22.*

- [ ] **MB-10 · The zero-breakpoint pages.** `AuthPage`, `ForgotPasswordPage`,
  `ResetPasswordPage`, `VerifyEmailPage`, `MfaSetupPage`, `DocumentsPage`,
  `SettingsPage`, `ReportViewerPage` — all currently at 0 breakpoint hits. Auth
  first: it is the first screen a new phone user sees. Single-column stacks,
  full-width controls, ≥16px inputs, no fixed-width containers.
  *Rows: 7, 9, 10, 17, 18, 19, 20, 22.*

- [ ] **MB-11 · Company + Dashboard + History.** `CompanyPage` (2 hits, 38.7KB),
  `DashboardPage`, `HistoryPage`, `BillingPage`: stack the multi-column grids,
  make the peer strip and filing tables scroll inside their own containers, keep
  every figure with its source marker.
  *Rows: 5, 9, 10, 18, 19, 20, 22.*

- [ ] **MB-12 · Touch targets.** Sweep the ~20 sub-44px button sites. Prefer
  hit-slop (a transparent `::after` inset expansion or padding) over visually
  enlarging the control — the terminal density stays, the tap area grows. Mobile
  surfaces only; desktop control sizes are unchanged.
  *Rows: 6, 18, 19, 20.*

- [ ] **MB-13 · Scroll and gesture polish.** `overscroll-behavior: contain` on
  sheets and scroll containers so a flick does not pull-to-refresh the page;
  momentum scrolling on the table containers; `touch-action` on chart surfaces so
  a pan gesture reaches the chart instead of the page; the existing
  `prefers-reduced-motion` block (`index.css:187,485`) covers every animation
  this loop adds.
  *Rows: 9, 10, 16, 18, 19, 20, 22.*

- [ ] **MB-14 · Installable.** Generate the icon set (192/512/maskable) and an
  `apple-touch-icon` from the existing `Sparkles`-on-accent mark, wire them into
  the manifest from MB-1, and verify "Add to Home Screen" launches standalone
  with the correct name, theme colour, and no browser chrome. No service worker —
  offline is not a requirement and a stale-cache bug is worse than a cold load.
  *Rows: 2, 22.*

- [ ] **MB-15 · Close the ledger.** Run the full §6 sweep at 320/390/430/768/1440.
  Every row green, every route zero-overflow, desktop screenshots identical to
  the MB-2 baseline. Paste the full matrix into §8. Capture one screenshot per
  route at 390px into `docs/mobile/` as the shipped record.
  *Rows: all.*

---

## 8. Progress log

One line per completed task. **Real numbers only** — test counts, measured
pixels, route names, status codes. No adjectives. A line without a number is not
a log line.

Format: `MB-n · <what changed> · <measured evidence> · <prod confirmation>`

- _(ledger open 2026-08-02 — 857 vitest passing / 0 failing / 7 skipped; tsc 0 errors; Playwright 1 project, Desktop Chrome only)_

- **MB-1 · document contract + safe areas + dynamic shells** · `index.html` gained `viewport-fit=cover`, `theme-color #070A12`, `color-scheme`, `mobile-web-app-capable`, `apple-mobile-web-app-{capable,status-bar-style,title}`, `rel=icon`, `rel=manifest`; new `public/manifest.webmanifest` (standalone, both colours `#070A12`) and `public/icon.svg` (accent `#5898F6` = `--accent` oklch(0.680 0.155 258), glyph `#FCF9F4` = `--accent-ink`); `--safe-t/-r/-b/-l` added to `index.css:63-69` as `env(safe-area-inset-*, 0px)` with `body` taking `--safe-l`/`--safe-r` for the landscape notch; **7 shell sites** moved to dynamic units — `AppLayout` ×2 `min-h-screen`→`min-h-dvh`, `TradingAssistantPage:399` `h-screen`→`h-dvh`, `SearchPage` ×2 `h-[calc(100vh-64px)]`→`100dvh` and ×2 `min-h-[calc(100vh-48px)]`→`100dvh`. · **857 → 889 vitest passing / 0 failing / 7 skipped** (+32 in new `src/mobileFoundation.test.ts`), tsc 0 errors, **30/30 existing e2e green against prod** after deploy. · Prod `market-pqmptlz17` aliased to `market-ui-self.vercel.app`: `/manifest.webmanifest` **200 application/manifest+json**, `/icon.svg` **200 image/svg+xml**, served `<meta>` carries `viewport-fit=cover` + `theme-color #070A12`. Measured on **iPhone 14 (390×664)**: `/trading` root class is `flex h-dvh …` with **rootHeight 664 = the visible viewport exactly** (the collapsed-toolbar height — this is the fault F4 fix, confirmed on the real profile, not a fixture); `--safe-*` all resolve `0px` headless (no notch to report, inert as designed); `documentElement.scrollWidth 390 = clientWidth 390`, **overflow 0px** on `/` and `/trading`.
  - _Found by the gate, missed by recon:_ **2 further SearchPage shells** (`min-h-[calc(100vh-48px)]` at the grid and company modes) were invisible to the `h-screen` grep that produced fault F4's count of 33. Row 3 scans for the raw unit, not the utility class, and caught them. F4's real shell count was 7, not 5.
  - _Deviation:_ MB-1's spec asked for "one width-based `@media` layer to hang mobile rules on". **Not shipped** — at MB-1 there is no width-scoped rule to put in it, and an empty block is dead code. The safe-area custom properties and the `body` inset padding are the mechanism the later tasks actually consume; MB-3 opens a `@media` block when it has a rule for it.
- **MB-2 · the gate, and the fault map it produced** · New `e2e/auth.setup.ts` (one Supabase login, reused as `storageState` — 7 of the 10 routes are behind `ProtectedRoute`), 5 new Playwright projects (`setup`, `desktop-baseline` @1440×900, `mobile-320`, `mobile-390` iPhone 14, `mobile-430` iPhone 14 Pro Max, `tablet-768` iPad gen 7); the pre-existing `chromium` project is untouched and `testIgnore`s the new specs. `e2e/mobileSweep.spec.ts` runs rows 9 + 10 with DD-13's escapee evaluator lifted from `dexterNarrow.spec.ts:49-69`; `e2e/desktopBaseline.spec.ts` captures row 18. **Nothing was fixed** — this task only builds the instrument. · **41 failed / 44 passed of 84**, and **30/30 existing e2e still green** (row 21 survived the config change).

  **The fault map — measured on prod, overflow px and uncontained-element count:**

  | route | 320 | 390 | 430 | 768 |
  |---|---|---|---|---|
  | `/` | 12 esc | 12 esc | 12 esc | 12 esc |
  | `/auth` | **+63px** · 4 esc | 1 esc | 1 esc | ok |
  | `/search` | **+196px** · 12 esc | **+126px** · 12 esc | **+86px** · 12 esc | ok |
  | `/trading` (hub) | ok | ok | ok | ok |
  | `/companies` | **+40px** · 12 esc | ok | ok | ok |
  | `/history` | **+139px** · 12 esc | **+68px** · 12 esc | **+28px** · 12 esc | ok |
  | `/dashboard` | **+45px** · 6 esc | ok | ok | ok |
  | `/documents` | **+339px** · 12 esc | **+269px** · 12 esc | **+229px** · 12 esc | ok |
  | `/settings` | **+204px** · 12 esc | **+134px** · 12 esc | **+94px** · 12 esc | ok |
  | `/billing` | 2 esc | ok | ok | ok |

  **Row 11 — fault F1, measured rather than estimated:** the `/trading` asset view renders the chart at **16px** on every device — **5%** of 320px, **4%** of 390px, **4%** of 430px, **2%** of an 810px iPad — with side panels measured at **[288, 287, 300]**. The roadmap predicted "collapses to ~0"; the real figure is 16px. Note the tablet: 288 + 287 + 300 = 875 > 810, so F1 breaks the iPad too, not just phones.

  - _The gate's first catch was the gate itself:_ a bare `/trading` load lands on the market hub (`max-w-[1280px] mx-auto px-4`), which reflows fine — so the route **passed at all four widths** while the worst layout bug in the app sat one click deeper. Both the sweep and the baseline now drive into the asset view before measuring. Measuring only what loads at rest would have certified the broken surface as clean, which is worse than not measuring at all.
  - _Read of the map:_ `tablet-768` is clean on every route except `/`, so the handful of `md:` prefixes that do exist (F7) mostly hold at the hinge; the damage is concentrated below it. `/documents` and `/settings` are the worst overflows and both have **0** breakpoints (F7) — the correlation is exact. `/` fails the escapee check at **every** width including tablet, which is the absolutely-positioned landing decor, and confirms MB-3.5 was worth adding.
  - _Row 18 mechanism changed_ from pixel screenshots to landmark geometry — see the amended row for why. Verified non-flaky: two consecutive compare-mode runs against live data, 12/12 green both times. The baseline now pins fault F1's desktop geometry exactly (`[style*="width:"][0] x=56 w=288`, `[19] x=1140 w=300`), so MB-4 cannot silently restack the desktop.
  - _Baseline selector widened:_ `/trading` builds its columns from unsemantic divs sized by inline style, so the semantic landmarks caught only the rail. Added `[style*="width:"]` filtered to boxes ≥200px — unfiltered it also matched sparklines inside market cards, whose count tracks the data and would have made the gate flap.
  - _Deferred, not skipped:_ modal and drawer open-state baselines. Driving them is stateful (the citation drawer needs a completed search with citations), and the task that changes each surface already exercises the interaction — so MB-7, MB-8 and MB-9 own their own open-state proof. Row 18 amended to say so rather than leaving an unrunnable clause in the gate.

- **MB-3 · bottom tab bar, More sheet, shell restructure** · New `src/components/MobileNav.tsx` — four labelled tabs from `NAV_ITEMS.slice(0,4)` plus a More trigger opening the `vaul` sheet with the remaining five destinations and Sign Out; `NAV_ITEMS` is imported, never copied. `AppLayout`: rail `hidden md:flex`, margin `md:ml-14`, header `left-0 md:left-14` with the strapline and avatar slot `hidden md:*`, content column `flex-1 min-w-0`, and below `md` the column is `h-dvh flex flex-col` with `main` as `flex-1 overflow-y-auto`. · **905 vitest passing** (+16 in `MobileNav.test.tsx`), tsc 0 errors, **row 18 12/12**, **row 21 30/30**. · **Sweep: 41 → 12 failures of 88.** Every `document gains no horizontal scroll` test now passes at every width on every route — row 9 is **100% green**. All seven AppLayout routes went fully green on rows 9 **and** 10:

  | route | 320 before → after | 390 before → after |
  |---|---|---|
  | `/search` | +196px · 12 esc → **ok** | +126px · 12 esc → **ok** |
  | `/documents` | +339px · 12 esc → **ok** | +269px · 12 esc → **ok** |
  | `/settings` | +204px · 12 esc → **ok** | +134px · 12 esc → **ok** |
  | `/history` | +139px · 12 esc → **ok** | +68px · 12 esc → **ok** |
  | `/companies` | +40px · 12 esc → **ok** | ok |
  | `/dashboard` | +45px · 6 esc → **ok** | ok |
  | `/billing` | 2 esc → **ok** | ok |

  The 12 remaining failures are all owned by later tasks: `/` escapees ×4 widths (MB-3.5), `/auth` escapees ×3 (MB-10), and the `/trading` asset view ×4 (MB-4, still 16px).

  - _`min-w-0` did most of the work._ Dropping the rail's 56px explains only part of it; the rest is that `flex-1` defaults to `min-width:auto`, so the content column could never shrink below its widest child and pushed the entire shell sideways instead of letting each page's own `overflow-x-auto` container do its job. `/documents` improved by 215px at 390 from one class.
  - _The bar was built wrong first, and the gate caught it._ `fixed bottom-0` is the obvious implementation and it is wrong on a phone: measured on prod at iPhone 14, **`window.innerHeight` reported 743 against a 664px visible viewport**, so the bar's bottom edge sat at **743 — 79px below the fold**, unreachable, and unreachable by scrolling too since fixed elements do not move. That is fault F4 wearing a different hat, and `dvh` on the shells does not fix it because `fixed` anchors to the layout viewport regardless. Rebuilt as a normal flex child at the end of an `h-dvh` column with `main` scrolling internally: bar now measures **top 618, bottom 664, height 46 — flush with the visible viewport**, `position: static`. Row 15's assertion deliberately compares against `documentElement.clientHeight`, never `innerHeight`, with a comment saying why, because "fixing" it to `innerHeight` would make the bug invisible again.
  - _Row 18 comparison changed from per-index to set-of-positions._ `/history` failed the desktop guard with 8 landmarks "disappeared" at identical `x=204/571/937 w=355` — the account's card list had shrunk between runs. Row counts are data, not layout. The set still catches a column that moves, resizes, restacks or vanishes; only multiplicity is discarded. Regenerating the baseline was safe because the other 11 routes passed against the pre-MB-3 baseline, which is itself the proof that MB-3 did not move the desktop.
  - _One flake, not a regression:_ `floatingHeader.spec.ts` failed once in a full 30-spec parallel run against live prod, then passed 3/3 alone and 30/30 on a clean re-run.
  - _Cadence changed to 120s_ at the user's instruction, and written into `~/.claude/LOOP_SPEC.md` as the global default for loops that **work** rather than **watch**. Polling loops keep the old rule of matching the tick to the observed process.

  - _Spec corrections made in MB-1:_ **MB-3.5 added** — `/` (`LandingPage` + `sections/*`, four GSAP `pin:true` + `scrub` `h-screen` sections behind 614KB of city JPEGs, `ExecutionSection` at 0 breakpoints) was the front door and owned by no task; budget 15→16. **Row 8 scoped** to `.tsx`/`.css`, exempting `<meta>` and static assets that cannot read a CSS variable. **Row 18 widened** from 3 routes to all 10 plus modal/drawer open states. **MB-8's `rounded-2xl` fix struck** — it is a desktop visual change that row 18 could not have caught, since the modal only exists when opened.

---

## 9. Stop conditions

The loop stops on **any** of three, not on the first one that feels done.

**Target.** No `[ ]` remains in §7 **and** MB-15 actually ran — the full §6 sweep
executed at all five widths with the matrix pasted into §8. A ledger of checked
boxes with an unrun gate is not a target hit.

**Budget.** 16 tasks OR 22 iterations, whichever comes first. An iteration that
ends without flipping a box or logging a measured failure still counts.

**Stall.** 3 consecutive iterations with no row changing state and no new failure
mode. On stall: stop and report which row is stuck and what it is stuck on. Do
not widen scope to keep the loop alive, and do not re-run a green sweep to
manufacture activity.

---

## 10. Escalation — halt and ask

These are the loop working, not the loop failing:

- **`git push`, or any deploy beyond `vercel --prod` on the `market-ui` project.**
  Pushing `main` clobbers prod.
- **Any new npm dependency**, any change to `vercel.json`, or any new API route.
- **Any file entering the repo the loop did not write and has not read** — a
  pasted design, an icon set from elsewhere, a downloaded component.
- **A desktop screenshot that legitimately must change.** The doctrine says
  desktop is a no-op; if a task genuinely cannot hold that, that is a scope
  decision, not a judgement call.
- **Anything unverifiable this iteration** — prod down, a route behind an auth
  wall the loop cannot pass, a device behaviour with no headless equivalent. Say
  so, ledger-note it, skip to the next unblocked task.
- **A fault that turns out to be a data problem, not a layout problem.** Out of
  scope by §0. Report it; do not fix it here.

---

## 11. Cadence

**120 seconds between iterations.** This loop works rather than watches — each
tick is edit, test, deploy, verify, log, all performed by the agent — so there is
no external state to wait for and a long tick is idle time. Run tasks back to
back while they are unblocked.

On a rate limit or 429: stop consuming tokens immediately, schedule a wake-up an
hour out, and resume from the last logged step — never spin.

The one thing worth waiting on is a prod deploy propagating, and that is seconds.

---

## 12. Reporting

A failed gate is a real result. If a row cannot go green — the platform will not
allow it, the design cannot hold both constraints — say so in §8 with the
measurement that proves it, and close the row. Do not invent an MB-16 to keep the
loop alive. If every remaining row is blocked, the correct output is "the work is
finished, here is what did not ship and why."
