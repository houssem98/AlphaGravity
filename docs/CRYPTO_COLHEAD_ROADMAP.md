# Crypto Screener — Column Header Menu (per-column sort / move / hide)

Spec: gemini-code-1784010195934.md + user screenshot. EVERY data column
header in the crypto Markets table gets the same context menu:
Sort ascending / Sort descending / Move left / Move right / Move to the
start / Move to the end, plus a hide (trash) action and the existing
tooltip affordance. Generic component driven by column metadata — nothing
hardcoded per metric.

## Why this needs a registry first

Markets.tsx renders ~60 column headers and cells as hardcoded JSX in a
fixed sequence (base fields via sortTh, technicals via techTh, bespoke
cells inline). Arbitrary reordering is impossible until each column's
header+cell become entries in an ordered registry. That refactor is CH-1
and must land with ZERO visual change before any menu work starts.

## Doctrine (hard rules)

- **DESIGN FREEZE on everything except the new menu**: same table look,
  same cell markup, same chooser, same tooltips. CH-1 is a pure
  restructure — pixel-identical output. The menu itself follows the
  screenshot: dark popover, icon + label rows, dividers, same tokens as
  the existing merged-% dropdown menu (reuse its classes).
- **th/td parity by construction**: registry renders header and cell from
  the same ordered list — a column can never render a th without its td.
- Pinned columns: star, #, Name, Price — not movable, not hideable (like
  CMC). Every other column (incl. 7d spark) is movable/hideable.
- Column order persists in localStorage with the existing prefs blob
  (`nexus_crypto_cols` → {tf, cols, order}); missing/unknown keys in a
  stored order fall back to default order (new columns appear at their
  default position).
- Sort asc/desc wires to the EXISTING sort paths (handleSort for base
  fields, handleTechSort for view fields) — no new sort engine. Hide
  wires to the existing cols toggle (chooser stays the re-enable path).
- Standing constraints: no new npm deps, typecheck 0 + vercel --prod
  (repo root) + prod smoke per task, audit stays green
  (spot 200/200, MISMATCH 0), commit each task on roadmap/world-class.

## Ledger

- [x] CH-1 **Column registry (zero visual change)**: define
  `COLUMN_DEFS: { key, label, group, sortField?, sortKind: 'base'|'tech'|'none', th(), td(market, ctx) }`
  for every data column by MOVING the existing JSX (th markup from the
  current header row, td markup from the current body row) into the
  registry entries — byte-identical markup, no styling edits. Render
  header + body by mapping a `colOrder: ColKey[]` state (default = current
  visual order, persisted in prefs blob, sanitized against unknown/missing
  keys). Pinned star/#/Name/Price stay hardcoded around the mapped region.
  ctx carries the in-scope locals cells use today (spot/tech/derivs/metas
  maps, chg/tf values, helper fns). Verify: typecheck 0, deploy, visual
  smoke — table renders identical (spot-check 10 columns incl. merged-%
  dropdown, Dash tooltips, expanded row colSpan), audit green.
- [x] CH-2 **Generic header menu — sort + hide**: one `ColHeadMenu`
  component instantiated by every registry th: click opens popover
  (reuse merged-% menu styling/backdrop pattern): trash row = hide
  (sets cols[key]=false), divider, ↑ Sort ascending, ↓ Sort descending
  (dispatch by sortKind; 'none' columns hide the sort rows). Old
  click-to-toggle-sort on th replaced by the menu (kept for pinned Name/
  Price ths). Verify: sort asc/desc works on a base col (Price change %),
  a tech col (RSI), hide works + chooser re-enables; typecheck 0, deploy,
  prod smoke.
- [x] CH-3 **Move actions**: menu gains ← Move left / → Move right /
  |← Move to the start / →| Move to the end mutating colOrder (visible
  columns only for left/right semantics; start/end = whole order). Persist.
  Verify: move RSI to start → renders right after Price; move to end →
  before nothing (last); reload keeps order; typecheck 0, deploy.
- [ ] CH-4 **Sweep**: full visual smoke (200-row page, expanded row,
  chooser, merged-% dropdown, watchlist tab), audit rerun green
  (spot 200/200 MISMATCH 0), TN regression 200s, first paint budget
  unchanged, update this ledger + memory.

## Progress log

(append one line per completed task, real numbers only)

- 2026-07-14 CH-1: codemod moved 65 th + 65 td verbatim into headerFor/cellFor switches (IIFE locals hoisted into cellFor prelude; th/td key sequences asserted equal), rendered via orderedCols = colOrder.filter(visible); DEFAULT_ORDER 65 keys, order persisted in nexus_crypto_cols {tf,cols,order}, sanitized; pinned star/#/Rank/Name/Price untouched. Typecheck 0, vite build ok, /trading 200 0.91s, audit spot 200/200 tech 197 deriv 177 meta 122 MISMATCH 0.
- 2026-07-14 CH-2: menuTh — 64 headers converted (codemod: sortTh→base, techTh→tech, plain th→none; merged-% col keeps its own dropdown); menu = Sort asc/desc (explicit setSortConfig/setTechSort, kind-dispatched) + divider + Trash2 Hide (cols toggle, chooser re-enables); popover = merged-% dropdown classes. Typecheck 0, build 57.5s, /trading 200 0.65s, audit spot 200/200 MISMATCH 0.
- 2026-07-14 CH-3: menu gains Move left/right (hops hidden cols) + Move to start/end (whole order) via moveColumn(setColOrder); FIXED CH-1 leftover — persist replace had silently no-oped on CRLF, {tf,cols,order} now actually written + colOrder in deps. Typecheck 0, /trading 200 0.59s, audit spot 200/200 tech 197 deriv 177 meta 123 MISMATCH 0.
