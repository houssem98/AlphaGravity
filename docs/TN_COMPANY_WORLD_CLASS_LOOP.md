# TN Companies — World-Class Chart & Detail Loop

Task ledger. Goal: every Tunisian listing (~75) reads as polished as a top
crypto coin page. Trigger: TINV screenshot — awkward intraday chart, "50"
volume label on the price axis, displayed Bid/Ask crossed (53.82/53.79,
spread −0.03).

**Every claim below was verified against code or live payloads on
2026-07-05 (market closed; séance data = Thu 2 juil).** Verified facts are
marked ✅. Do not act on anything else without re-checking.

**This file is the loop's memory.** Each iteration: read it, do ONE task,
verify, flip `[x]`, log one line with real numbers, commit.

---

## Verified baseline (2026-07-05)

- ✅ `TnChart.tsx` (216 lines): candles+volume, intraday(1/5/15m)/daily modes,
  price alerts. Volume histogram ALREADY on overlay scale
  (`priceScaleId:''`, margins top 0.82) — the stray "50" axis label is only
  missing `lastValueVisible:false / priceLineVisible:false`.
- ✅ Default mode hardcoded `'intraday'` (line 31). TINV today: **1 intraday
  candle**; BIAT: 16. TINV daily history: **79 bars** available.
- ✅ `/api/tn/history` aggregates ALL of `raw_market` (~5 months, no cap).
  The missing piece is only W/M aggregation client-side.
- ✅ `fitContent()` on 1 candle → stretched bar (the screenshot). No session
  framing exists.
- ✅ Bid/Ask: dispatcher `api/tn/[fn].ts:55` re-swaps fields claiming "BVMT
  swaps them". Raw BVMT (closed session) contradicts a fixed rule:
  TINV raw bid 53.79 < ask 53.82 (sane → re-swap CREATED the crossed
  display); BIAT/SFBT/AB raw are crossed with one side == last (stale
  auction leftovers). **Correct mapping is unprovable while closed.**
- ✅ Fundamentals: Supabase blob `tn_fundamentals.json` = 39 companies, all
  with eps. `ref` endpoint (raw_referentiels) exists for About data.
- ✅ Vercel Hobby 12-fn cap → all TN endpoints live INSIDE
  `apps/market-ui/api/tn/[fn].ts` dispatcher. Never add new fn files.

## Loop rules (follow exactly each iteration)

1. Read this file, then the files the task names, before editing.
2. First `[ ]` task only. Too big → split in-file, do the first part.
3. Constraints: dispatcher-only endpoints (12-fn cap); BVMT public REST or
   Supabase `raw_market` only; no scraping; no new deps; reuse TnChart/
   marketsHub/registry.
4. Verify: tsc 0 errors + market-ui build ok; API tasks → curl prod after
   deploy, put real numbers in the log line. **Never assert an upstream
   field's meaning without a payload proving it.**
5. Flip checkbox, one Progress-log line, commit on `roadmap/world-class`.
6. `vercel --prod --yes` only on `[deploy]` tags.
7. No `[ ]` left → stop.

---

## Tasks

### A — Chart
- [x] **C1** — Kill the volume axis label.
  `TnChart.tsx` histogram series: add `lastValueVisible: false,
  priceLineVisible: false`. Nothing else — scale separation already exists.
  *Acceptance:* no volume number on the price axis (TINV + BIAT).
- [x] **C2** — Liquidity-aware default mode.
  On intraday load: if candles < 3 and the user hasn't manually picked a
  mode this session, auto-switch to `daily` (TINV-class names). Manual
  toggle always wins afterwards.
  *Acceptance:* TINV opens showing its 79 daily bars; BIAT (16 candles)
  stays intraday.
- [x] **C3** — Session framing + sane y-range for sparse intraday.
  Derive today's session bounds FROM DATA (min/max tick time across the
  groups feed — do not hardcode exchange hours) and pad the x-axis with
  whitespace points so 1 candle doesn't fill the width; ensure y-autoscale
  keeps a minimum visible range (~0.5% of price). Last price as a thin line
  to the right edge.
  *Acceptance:* TINV intraday = full-session axis, readable y-range, no
  stretched lone bar. `[deploy]`
- [x] **C4** — Weekly/Monthly timeframes.
  Client-side aggregate the daily bars (D→W ISO-week, D→M calendar) in
  `TnChart.tsx`. Selector becomes `1m 5m 15m · D W M`. History endpoint
  already serves everything — do not touch it.
  *Acceptance:* TINV W ≈ 16–17 bars from 79 dailies; one weekly OHLC
  hand-checked against its dailies.

### B — Data correctness
- [x] **C5** — Bid/Ask: enforce the book invariant, stop guessing sides.
  Raw evidence is contradictory (see baseline) → in the dispatcher, drop the
  blind re-swap; when both sides > 0 emit bid = min(price1, price2),
  ask = max(...), qty following its price; one side 0 → emit null for it;
  spread = ask − bid (≥ 0 by construction). Comment the open question and
  **re-verify the true field semantics against a LIVE session (Mon–Fri
  09:00–14:00 Tunis) before ever "correcting" sides again.**
  *Acceptance:* prod snapshot for TINV + BIAT: ask ≥ bid or null; panel never
  shows negative spread. `[deploy]`

### C — Every company complete
- [x] **C6** — Universal About + identity.
  Every listing gets sector badge + filled About tab from the existing `ref`
  endpoint (raw_referentiels) + BVMT fiche/ilboursa links (reuse
  `assetLinks`). Monogram fallback icon where no logo.
  *Acceptance:* AETEC, ALKIM, STPIL — About filled, sector shown, both links
  resolve (curl 200).
- [x] **C7** — Fundamentals: honest n/a + reject retries.
  36+ listings have NO fundamentals (39/75 covered). Render "n/a — no recent
  filing" instead of blanks. Then retry the 4 known unit-confusion rejects
  (NAKL, BNASS, BL, STPIL) in `scripts/tn_fundamentals.py` with
  scale-normalization; re-upload the blob.
  *Acceptance:* no blank fundamentals cell anywhere; coverage count after
  retries logged (target ≥ 41).
- [x] **C8** — Crosshair OHLC legend + formatting parity.
  Hover legend (O H L C V, colored by candle direction) top-left like the
  crypto Chart; TND prices on-chart formatted to 2 decimals (3 only when
  price < 1); loading skeleton; `prefers-reduced-motion` respected.
  *Acceptance:* hover any candle → correct OHLCV in legend (spot-check one
  candle against the API payload). `[deploy]`

---

## Definition of done
Any BVMT listing opens to a readable chart (daily default when illiquid,
framed session when intraday, D/W/M available), a book that never displays
crossed, filled About + sector + links, fundamentals value or labeled n/a —
polish indistinguishable from the crypto coin view.

## Progress log
<!-- YYYY-MM-DD Cxx — what — verify numbers -->
2026-07-05 C1 — histogram lastValueVisible/priceLineVisible false (scale separation already existed; only the label was the bug) — tsc 0. Ships with next [deploy] task (C3).
2026-07-05 C2 — auto-switch intraday→daily when candles<3 unless user picked mode (userPickedMode ref, reset default on asset change) — prod: TINV intraday=1→daily 79 bars, BIAT intraday=16 stays; tsc 0, build ok. Ships with C3 deploy.
2026-07-05 C3 — intraday returns sessionStart/sessionEnd = min/max groups-feed `time` (data-derived, board of 75); client pads whitespace buckets + autoscaleInfoProvider min y-range 0.5%; last-price line = lightweight-charts default (spans whitespace). DEPLOYED — prod: TINV/BIAT sessionStart=09:15:00 sessionEnd=12:00:00 (Thu 2… séance 3 juil), TINV 1 candle framed in 34 5m slots; tsc 0, build ok. C1+C2 shipped with this deploy.
2026-07-05 C4 — aggDaily D→W (ISO Monday) / D→M (calendar) client-side; selector now 1m 5m 15m · D W M — TINV: 79 dailies → W=19 M=6 (thin weeks, >16–17 estimate); hand-check week 2026-04-27 O=41 H=41 L=40.45 C=40.8 V=1783 == fold of its 4 dailies PASS; tsc 0, build ok. Ships with C5 deploy.
2026-07-05 C5 — book() invariant in dispatcher (markets+engine): bid=min ask=max qty-follows-price, zero side→null, blind re-swap deleted, live-session re-verify comment in place. DEPLOYED — prod markets: 75 rows crossed=0, TINV 53.79/53.82 spread=+0.03 (was −0.03), BIAT +0.20, SFBT +0.11, 6 one-sided rows null; tsc 0, build ok. C4 shipped with this deploy.
2026-07-05 C6 — assetLinks exported from MarketList, reused in TnAbout (BVMT fiche + ILBOURSA + News); sector badge pill in About header; Issuer row added; monogram fallback already existed — ref: AETEC=TECHNOLOGIE ALKIM=CHIMIE STPIL=PETROLE ET GAZ (issuer/shares/listingDate all present); links curl (curl.exe, PS5.1 TLS false-ERRs): 6/6 HTTP 200; tsc 0, build ok. Ships with C8 deploy.
2026-07-05 C7 — honest "n/a — no recent filing" row when no fund blob (AssetInfoPanel); scale-normalization in tn_fundamentals.py (try ×1/×1000/×1e6, PER band 2..80 admits ≤1) — recovered NAKL(×1, EPS 1.69 PER 13.3), BNASS(×1000, EPS 0.20 PER 21.1), BL(×1e6, EPS 0.35 PER 8.4); STPIL still REJECTED (extraction raw=123456 garbage — guard correct). Coverage 39→42 (target ≥41 ✓), blob re-uploaded HTTP 200, prod endpoint serves all 3; pdftotext needs Git-Bash PATH on this box. tsc 0, build ok. UI n/a row ships with C8 deploy.
2026-07-05 C8 — subscribeCrosshairMove legend (O H L C colored by direction + V) under title; priceFormat precision 2 (3 if price<1) set per load; loading skeleton (animate-pulse, motion-reduce:animate-none); legend values = the exact setData objects (identity with API payload by construction; spot-check BIAT 09:00 5m: O 169.20 H 170.00 L 169.20 C 170.00 V 109). DEPLOYED; tsc 0, build 0. C6+C7 UI shipped with this deploy. LOOP COMPLETE — 8/8.
