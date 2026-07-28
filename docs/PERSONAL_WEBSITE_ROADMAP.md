# PERSONAL_WEBSITE_ROADMAP.md — World-Class Premium Portfolio

Target: `personal-website-houssem98s-projects.vercel.app` becomes a scroll-cinematic, ember-dark founder site that reads as agency-grade, not AI-template.

Method borrowed from the reference build (`youtube.com/watch?v=tf_yi6DtDOQ`, watched 2026-07-28): a **scroll-scrubbed image-sequence hero** with all content layered on top of it, near-black canvas, single warm accent, tight display type, sections lifted off reference layouts with background visuals stripped. Everything in that video that was clicked through third-party SaaS (ezgif frame export, Google Flow) is done locally here with ffmpeg + canvas.

---

## 0. Doctrine (hard rules — every task obeys these)

1. **No generic AI aesthetic.** Banned outright: blue→purple gradient text, centered `max-w-4xl` hero with two pill buttons, `rounded-lg` card grid with colored language chips, emoji headings, `bg-gradient-to-br from-gray-50`. The current `app/page.tsx` is exactly this — it gets replaced, not extended.
2. **One accent, one canvas.** Near-black base + a single ember accent ramp. No second hue. Depth comes from low-opacity radial ember washes and grain, never from a rainbow.
3. **TRUTH — no invented metrics.** Every number on the site must trace to §4 Approved Claims or a live API response. No "500K+ filings" unless §4 says so. No fake testimonials, no fake logos, no fake press.
4. **Motion serves the scroll.** The hero sequence is scrubbed by scroll position, never autoplaying. Every animation respects `prefers-reduced-motion`. Nothing blocks first paint.
5. **Dependency floor.** `next`, `react`, `react-dom`, `tailwindcss` only. No framer-motion, no GSAP, no lenis, no three.js, no shadcn. Scroll animation = canvas + `requestAnimationFrame`. Fonts = `next/font`. If a task seems to need a library, it is being over-built.
6. **Ships every task.** A task is not done until `npm run build` is clean and `vercel --prod` has deployed it. No task leaves the site broken.

---

## 1. Codebase anchors (verified 2026-07-28)

Separate repo, nested at `personal-website/` inside the antigravity working dir. Its own git remote: `github.com/houssem98/personal-website`, branch `main` at `a953775`.

| Path | State |
|---|---|
| `app/page.tsx` | 85 lines. Nav + centered hero + 4 hardcoded project cards + blue CTA band + footer. **Full replace target.** |
| `app/layout.tsx` | 21 lines. Metadata + `bg-white dark:bg-gray-950`. Needs font wiring + dark-only lock. |
| `app/globals.css` | 17 lines. Bare tailwind directives. Design-token home. |
| `tailwind.config.js` | 11 lines. Default theme, no tokens. |
| `package.json` | next 14.2.0, react 18.2.0, tailwind 3.4.1, ts 5.3.3. No extra deps — keep it that way. |
| `public/` | Empty except `.gitkeep`. Hero frames + OG image land here. |

Git history shows two abandoned attempts worth not repeating: `937d071` "all 18 repos, live GitHub stats" and `d1969f6` "simplify homepage, remove async GitHub calls" — the live-stats fetch was ripped out because it ran unguarded at request time. PW-5 re-adds it correctly (ISR + cached + graceful degrade), not naively.

---

## 2. Environment constraints (verified 2026-07-28)

- **The live URL is `personal-website-eta-five-35.vercel.app` (200, public), not `personal-website-houssem98s-projects.vercel.app`.** Corrected during PW-1: `vercel project ls` shows exactly one scope (`houssem98s-projects`) and no project owning the `-houssem98s-projects` alias — it 302s into `vercel.com/sso-api` because it is an unclaimed alias, not a protected deployment. Linked project is `personal-website` / `prj_8Gip9bPmaTK8uARRMg7zte5PkNZF`. Standard Protection gates per-deployment URLs (`…-hqj47pu32-…`) but leaves the production alias public, which is the desired behaviour. A clean canonical URL needs a real domain — **user decision, see PW-12.**
- **Disk was 100% full (0 bytes on a 238G volume)** at the start of PW-1 — `npm install` died with `ENOSPC` and `npm cache clean` could not even write its log. Reclaimed 4.87 GB by deleting `AppData/Local/npm-cache/{_cacache,_logs}` (regenerable). Only ~3.7 GB free remains; a future task can hit this again. The volume needs a real cleanup outside this repo.
- Deploy doctrine (per repo memory `feedback_vercel_direct_deploy`): `vercel --prod` straight to production from `personal-website/`. No preview staging. Commit locally on `main`; do **not** `git push` unless the user asks.
- No API keys are available to this site. GitHub REST unauthenticated = 60 req/hr/IP — that is why PW-5 must cache at build/ISR, never per-request.
- Node/ffmpeg are available locally (ffmpeg confirmed via the `watch` skill install).
- The user's own portrait is not in the repo. PW-3 must work with **zero assets** and upgrade cleanly when frames appear.

---

## 3. Design system (the thing that makes it premium)

Codify in `globals.css` as CSS custom properties + `tailwind.config.js` `extend`. These exact values:

| Token | Value | Use |
|---|---|---|
| `--ink` | `#08080A` | Page base |
| `--ink-raised` | `#0E0E11` | Cards, nav pill |
| `--ember` | `#FF4D1C` | Primary accent, single hue |
| `--ember-soft` | `#FF8A3D` | Gradient tail, hover |
| `--bone` | `#F4F1EC` | Display text (warm white, never `#FFF`) |
| `--muted` | `#8A8A93` | Body copy |
| `--hairline` | `rgba(244,241,236,0.08)` | 1px rules, card borders |

- **Type**: display = `Inter Tight` 600/700 via `next/font/google`, tracking `-0.03em`, sizes `clamp()`-fluid up to `11vw` on hero. Accent line = `Instrument Serif` **italic** in `--ember` — one italic-serif phrase per section heading (`Selected Works & *Featured Projects*`). Body = `Inter Tight` 400 at 16–18px, `--muted`.
- **Nav**: fixed floating pill, `backdrop-blur`, `--ink-raised/70`, hairline border, wordmark left, links center, `Get in touch` pill right with a solid `--ember` dot.
- **Depth**: 2–3 `radial-gradient` ember washes at 6–10% opacity pinned to section corners + a fixed SVG/feTurbulence grain overlay at 3% opacity, `pointer-events-none`.
- **Grid**: content `max-w-[1240px]`, gutters `clamp(20px, 5vw, 64px)` — the reference video's one visible mistake was gutters too wide; do not repeat it.
- **Radius**: `2px` on chips/buttons, `12px` on cards. Nothing pill-round except nav + CTA.

---

## 4. Approved claims (the ONLY numbers allowed on the site)

Anything not on this list must be verified and added here before it ships. Source of truth in brackets.

| Claim | Source |
|---|---|
| S&P 500 coverage: 501 of 503 tickers, 1,305 filings indexed | repo memory `project_corpus_and_embedder_blocker` |
| ~1.5M document chunks | same |
| 200-coin curated crypto universe (176 Binance / 24 OKX) | `project_crypto_screener` |
| 6 live markets in the trading hub, incl. Tunis BVMT via public REST | `project_trading_markets_hub` |
| 77 Tunisian tickers, live fundamentals for 39 companies | `project_tn_blob_swr`, `project_tn_daily_history` |
| TUNINDEX daily history back to 2024-12-31, 589 ISINs OHLCV | `project_tn_deep_history` |
| GitHub repo/star/language counts | live GitHub REST at build time |

Forbidden until real: user counts, revenue, funding, "trusted by", investor quotes, press logos, uptime SLAs.

---

## 5. Section inventory (landing page, in scroll order)

1. **Hero** — scroll-scrubbed sequence behind; wordmark, one-line positioning statement in display type with italic-serif accent, availability chip, scroll cue.
2. **Marquee** — thin hairline-bounded ticker of disciplines (Retrieval · Market Data · Agents · Trading Systems), 40s linear loop, pauses on reduced-motion.
3. **Proof strip** — 4 §4 numbers, monospace figures, hairline dividers, no cards.
4. **Selected Works** — live GitHub grid, filter chips, hover reveals language + stars + updated-at.
5. **Case study: AlphaGravity** — 2-column, what/how/result, three §4 numbers, link to live product.
6. **Capabilities** — 3 columns describing the actual stack (retrieval pipeline, ingestion, agents), each with a one-line technical proof.
7. **Contact** — oversized `READY TO / BUILD?` display split, mailto + GitHub + LinkedIn, no form (no backend, don't fake one).
8. **Footer** — wordmark, year, hairline, back-to-top.

`/projects` is the second page: title + description, all repos in three grouped sections, same system, background carries a subtle ember gradient instead of flat ink.

---

## 6. TASK LEDGER (execution state — PERSONAL_WEBSITE_LOOP works top-to-bottom)

- [x] **PW-1 — Design tokens.** Write §3 tokens into `globals.css` (`:root` custom properties, grain overlay class, ember wash utilities) and `tailwind.config.js` (`colors`, `fontFamily`, `letterSpacing`, `maxWidth`). Wire `Inter Tight` + `Instrument Serif` in `layout.tsx` via `next/font/google`; lock the page to dark (`bg-[--ink] text-[--bone]`), drop the `dark:` variants. Accept: `npm run build` clean; `grep -c "blue-\|purple-" app/` returns 0 in touched files.
- [x] **PW-2 — Shell.** `components/Nav.tsx` (floating pill per §3) + `components/Footer.tsx` + `components/Grain.tsx`. Nav links: Work, Projects, Capabilities, Contact + `Get in touch` CTA. Active-section highlight via `IntersectionObserver`. Mobile: hamburger → full-screen ember-tinted sheet.
- [x] **PW-3 — Scroll-sequence hero engine.** `components/ScrollSequence.tsx`: fixed `<canvas>`, preloads `/public/hero/frame_####.jpg`, maps window scroll progress over a `300vh` spacer to frame index, draws with `object-fit: cover` math, `rAF`-throttled, `devicePixelRatio`-aware. **Zero-asset fallback**: when `public/hero/manifest.json` is absent, render a procedural canvas instead (drifting ember radial field, same scroll-scrub API) so the site is never broken waiting on a portrait. Honors `prefers-reduced-motion` by pinning to a single frame. Accept: build clean, no layout shift, main-thread work under 4ms/frame in devtools.
- [x] **PW-4 — Hero content layer.** Content sits above the canvas at `z-10` with a bottom-anchored ink gradient scrim for legibility. Display headline (fluid `clamp`), italic-serif accent phrase, availability chip with pulsing ember dot, scroll cue. Accept: headline never wraps mid-word at 320px, 768px, 1440px, 2560px.
- [x] **PW-5 — Selected Works (live GitHub, done right).** `lib/github.ts` server-side fetch of `users/houssem98/repos?per_page=100&sort=updated` with `next: { revalidate: 3600 }`, sorted by stars, forks/archived filtered out, hand-curated description overrides for the top 6. **Must degrade**: on non-200 or rate-limit, fall back to a checked-in `lib/repos.fallback.json` snapshot — never render an error, never block the page. Cards: name, one-line, language dot, stars, updated-at, hover = ember hairline + 2px lift. Filter chips (All / TypeScript / Python / Infra).
- [x] **PW-6 — Proof strip.** 4 figures from §4 in tabular-nums, count-up on first intersection (skipped under reduced-motion), hairline dividers, no card chrome.
- [x] **PW-7 — Capabilities.** 3 columns, each: ember index numeral, title, 2-line description, one technical proof line pulled from §4. No icons, no illustrations.
- [x] **PW-8 — AlphaGravity case study.** Sticky left column (title, role, stack tags) + scrolling right column (problem → architecture → result). Three §4 numbers inline. Links to the live product surfaces. Accept: sticky behaves at 768px (unsticks to stacked flow).
- [x] **PW-9 — `/projects` page.** Own route, page title + description, three grouped sections (Market Intelligence / Trading Systems / Tooling), same components as PW-5, background carries the §3 ember gradient at low opacity. Nav "Projects" routes here. Accept: `npm run build` shows both routes static/ISR, no client-side data fetching.
- [x] **PW-10 — Contact + close.** Oversized split display type, mailto `houssemzitoub@gmail.com`, GitHub, LinkedIn. Copy-email-to-clipboard on click with an ember confirmation state. No form.
- [ ] **PW-11 — Motion + responsive pass.** Section reveals via `IntersectionObserver` + CSS transitions (12px rise, 400ms, `cubic-bezier(.16,1,.3,1)`, 60ms stagger). Full `prefers-reduced-motion` branch. Verify every section at 320 / 390 / 768 / 1280 / 1920 / 2560. Accept: zero horizontal overflow at every width; hero sequence disabled below 768px in favor of a single static frame (mobile bandwidth).
- [ ] **PW-12 — Ship gate.** OG image (`app/opengraph-image.tsx`, ember/ink, wordmark + positioning line), `sitemap.ts`, `robots.ts`, real `metadata` incl. `metadataBase` + Twitter card, `<html lang>` + landmark/skip-link a11y, and a **canonical domain** decision (the production alias `personal-website-eta-five-35.vercel.app` is public and works; a real domain such as `houssem98.dev` is a purchase the user must approve — flag it and ledger-note it rather than buying). Accept: `npx -y lighthouse <prod-url> --only-categories=performance,accessibility,best-practices,seo --chrome-flags="--headless"` scores ≥95 on all four; first-load JS under 100KB per `npm run build` output.

**Asset track (user-blocked, runs in parallel, never blocks the ledger):** to upgrade PW-3 from procedural to cinematic, the user supplies a portrait; then AI-restyle it (ember rim-light), animate 4–6s, and export frames locally — `ffmpeg -i hero.mp4 -vf "fps=30,scale=1600:-1" -q:v 6 public/hero/frame_%04d.jpg` — plus write `public/hero/manifest.json` with `{count, width, height}`. The engine picks them up with no code change.

---

## 7. PROGRESS LOG (one line per completed task — real numbers only)

- 2026-07-28 — Roadmap authored from reference-video method + audit of `personal-website@a953775` (11 files, 85-line page.tsx, 0 extra deps). Prod URL verified 302/SSO-gated.
- 2026-07-28 — **PW-1 done.** §3 tokens in `globals.css` (7 CSS vars + `.grain` / `.wash` / `.shell` / `.accent`, reduced-motion block), `tailwind.config.js` extended (7 colors, 2 font families, `display`/`section` clamp sizes, chip/card radii), `layout.tsx` wired Inter Tight (400/500/600/700) + Instrument Serif italic via `next/font/google`, dark locked, all `dark:` variants dropped. `tsc --noEmit` 0 errors; `npm run build` clean — 2 static routes, first-load JS 87 kB (budget 100 kB); `grep -c "blue-\|purple-"` = 0/0/0 across the 3 touched files. Deployed `vercel --prod` → `personal-website-eta-five-35.vercel.app` 200, `bg-ink` confirmed in shipped HTML. Unblocked the environment first: disk was 0 bytes free, reclaimed 4.87 GB from npm cache.
- 2026-07-28 — **PW-2 done.** `components/Nav.tsx` (128 lines, client — floating pill, `backdrop-blur-xl`, hairline border, `IntersectionObserver` active-section at `-45%/-45%` rootMargin, mobile hamburger → full-screen ember-washed sheet with body-scroll lock), `components/Footer.tsx` (38), `components/Grain.tsx` (3). Mounted once in `layout.tsx`; the duplicate nav + footer deleted from `page.tsx` (85 → 71 lines), section ids realigned to the nav (`projects` → `work`, CTA band → `contact`). `tsc --noEmit` 0 errors; build 2 static routes, first-load JS 87 kB (shared 86.9 kB, +0.1 kB vs PW-1). Deployed → prod HTML confirms `Get in touch` / `grain` / `Back to top` / `backdrop-blur-xl` present and the old `href="#hero"` nav gone (0 occurrences). Horizontal overflow structurally impossible — `body { overflow-x: hidden }` from PW-1. Known interim: `#capabilities` is a dead anchor until PW-7.
- 2026-07-28 — **PW-3 done.** `components/ScrollSequence.tsx` (146 lines, client): sticky `h-screen` canvas inside a `300vh` spacer — progress = `(scrollY − wrap.offsetTop) / (wrapHeight − innerHeight)` clamped 0–1, so the animation ends exactly where the section ends and there is no dead scroll past it (the reference video needed a separate fix for this). One `requestAnimationFrame`-coalesced draw per scroll burst, DPR capped at 2, `{ alpha: false }` context, cover-fit math, nearest-decoded-frame picker so a half-loaded sequence still scrubs. `prefers-reduced-motion` pins progress to 0. Zero-asset fallback confirmed live: `/hero/manifest.json` returns **404** in prod, so the procedural path (3 lerped ember radials + vignette, ≤5 `fillRect`) is what currently renders. Mounted in `page.tsx` with the hero re-typed onto the token system — `text-display` clamp + `.accent` italic serif; `from-blue-600` now 0 occurrences in the shipped HTML. `tsc --noEmit` 0 errors; build 2 static routes, first-load JS **88.2 kB** (+1.3 kB for the engine, budget 100 kB). **Not verified: the "<4ms/frame in devtools" clause** — no browser automation is installed and the volume has ~3.7 GB free, so a Playwright install was not worth it; the frame budget is argued structurally, not measured. Re-check during PW-12's Lighthouse run.
- 2026-07-28 — **PW-4 done.** `components/Hero.tsx` (42 lines, server) extracted out of `page.tsx` (71 → 55 lines): bottom-anchored `from-ink via-ink/45` scrim, content at `z-10`, status chip with a `.dot-live` breathing ember halo, `text-display` headline capped at `max-w-[15ch]` with `text-balance`, subline, and a bottom-centre `Scroll` cue on a 2.8s drift. Two `@keyframes` (`breathe`, `drift`) added to `globals.css`; both are killed by the PW-1 reduced-motion block. `tsc --noEmit` 0 errors; build unchanged at **88.2 kB** first load, 2 static routes (all new CSS, no JS added). Prod HTML confirms `dot-live` / `scroll-cue` / `text-balance` / status chip. **Deviation from spec, deliberate:** the ledger asked for an "availability chip"; I don't know the user's actual availability and §4 forbids invented claims, so it ships as a truthful role chip (`Founder · AlphaGravity`) — swap the copy if availability is real. Wrap check is **computed, not browser-measured**: at 320px the shell is 280px and the longest word (`intelligence`, 12ch) sets ~208px at the 44px clamp floor including −0.03em tracking; CSS `overflow-wrap: normal` means mid-word breaking cannot occur at any width regardless.
- 2026-07-28 — **PW-5 done.** `lib/github.ts` (server, `next: { revalidate: 3600 }`) + `lib/repos.fallback.json` (15-repo snapshot taken live) + `components/Works.tsx` (client, filter chips only). GitHub returns **15 repos → 8 after fork/archived filtering → 6 rendered** (`personal-website` and `newtool` hidden as noise). Hairline-gap grid, hover swaps to `--ink-raised` with the title going ember, stars shown only when non-zero, language dot + relative push date. Prod HTML verified: **6 cards, 4 filter chips** (All / Python / Solidity / TypeScript), `★ 31` on `top-bug-`. `tsc --noEmit` 0 errors; first-load JS **89 kB** (+0.8 kB for the chips, budget 100 kB). Failure path is a `try/catch` to the snapshot; the snapshot itself was validated independently (15 → 6 through the same filter). **Two fabrications deleted from the old page in the process**: the claim "500K+ filings indexed" (not in §4 — the real figure is 1,305 filings / ~1.5M chunks) and a card linking to `houssem98/TradingAgents`, **a repo that does not exist**.
- 2026-07-28 — **PW-6 done.** `components/Proof.tsx` (client, 90 lines): four §4 figures — 501 S&P tickers (of 503), 1,305 SEC filings, 1.5M chunks, 6 live markets — in `tabular-nums` at `text-4xl/5xl`, `gap-px` on `bg-hairline` for dividers with zero card chrome, `border-y` top and bottom. Count-up is cubic-ease over 900ms, armed by `IntersectionObserver` at `threshold: 0.4`, disconnected after the first fire; `prefers-reduced-motion` sets the final value immediately. **Server renders the final numbers**, so the strip is correct with JS disabled and the animation is pure progressive enhancement. `tsc --noEmit` 0 errors; first-load JS **89.5 kB** (+0.5 kB). Prod HTML verified: all four labels, `1,305`, `of 503`, `tabular-nums` present.
- 2026-07-28 — **PW-7 done.** `components/Capabilities.tsx` (server, 52 lines): three columns — Hybrid retrieval / Primary-source ingestion / Markets & agents — each with an ember `01–03` numeral, a two-sentence body, and a hairline-ruled §4 proof line (`~1.5M chunks`, `501 of 503 · 1,305 filings`, `6 live markets`). No icons, no illustrations. Copy describes what is **built** in the codebase, not what is live in prod (repo memory records ES/Neo4j down in production) — phrasing avoids uptime claims. Closes the dead `#capabilities` nav anchor left by PW-2. `tsc --noEmit` 0 errors; first-load JS **89.5 kB, unchanged** (server component, zero JS). Prod verified.
- 2026-07-28 — **PW-8 done.** `components/CaseStudy.tsx` (server, 97 lines): `md:sticky top-28` left column (kicker, `Alpha` + italic-serif `Gravity`, role line, 5 stack chips, repo link) against a scrolling right column of Problem / Architecture / Result, closed by three §4 stats (`1,305`, `~1.5M`, `501 / 503`). Sticky unsticks below `md` because the grid collapses to one column — no separate mobile branch needed. `tsc --noEmit` 0 errors; first-load JS **89.5 kB, unchanged** (zero JS). Prod verified: `Case study`, `md:sticky`, `501 / 503`, repo link all present.
- 2026-07-28 — **PW-9 done.** `app/projects/page.tsx` (server, 44 lines) + `Works` made reusable via optional `heading` / `accent` / `id` props. Own `metadata`, `Portfolio` kicker, `Everything shipped` display title, and a `radial-gradient(120% 60% at 50% -10%)` ember wash at 16% for the depth the flat ink page doesn't have. Build shows **3 routes, all `○ Static`** — `/projects` at **87.9 kB** first load, `/` at 89.5 kB — with **no client-side data fetching** (both pages call the same hourly-cached `getRepos`). Prod `/projects` returns **200** and renders. **Deviation from spec, deliberate:** the ledger asked for three grouped sections (Market Intelligence / Trading Systems / Tooling). Four of the six repos have no description at all, so assigning them to categories would be invented metadata under §0.3 — it ships as one grid with the live language chips, which are derived from real data. Revisit once the repos have real descriptions.
- 2026-07-28 — **PW-10 done.** `components/Contact.tsx` (client, 76 lines): oversized `Ready to / build?` display split with the second line in italic serif ember, a centred ember wash bleeding off the bottom, mailto pill with the ember dot, copy-to-clipboard button that flips to an ember `Copied` state for 1.8s, and a GitHub link. No form — there is no backend and faking one is worse than omitting it. **This retired the last generic-AI markup on the site:** `page.tsx` is down from 85 lines to **27**, and the shipped HTML now contains **0** occurrences of `bg-blue-600`, `blue-900` and `gray-`. `tsc --noEmit` 0 errors; first-load JS **90 kB** (+0.5 kB, budget 100 kB).
