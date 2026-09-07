# Company Feature — Fix Roadmap

Branch: `feat/web-research-sec-integration` (the feature does not exist on `main`).
Surface: `apps/market-ui/src/pages/CompanyPage.tsx` (994 lines), `components/company/*`,
`services/gravity-api/app/api/routes/company.py`.

Ordering principle: **fix what makes the feature lie before what makes it slow.**
A blank answer rendered as an answer, and a truncated count labelled `total`, are
worse than a slow chart.

## Ledger

| # | Task | Gate (binary) | Status |
|---|------|---------------|--------|
| CF-1 | Brief + Devil's Advocate call a model that returns content | Live POST to `/api/llm/chat` with the brief's default config returns non-empty `text` for 6/6 seed prompts. Recorded with the response bodies. | **DONE** |
| CF-2 | No credential in the client bundle | `grep -r "deep-research-internal" apps/market-ui/src` → 0 hits, AND `npm -w market-ui run build` output greps clean for the literal. | OPEN |
| CF-3 | One auth scheme on the company page | Every `fetch` in `CompanyPage.tsx` carries the same auth header construction; anonymous load renders a stated refusal, not a half page. | OPEN |
| CF-4 | `total` is the real filing count, or is not called `total` | For a ticker with >4000 chunks, the response's count matches a direct `count(distinct)` against the table. If unfixable without an RPC, the field is renamed and the cap is stated in the payload. | OPEN |
| CF-5 | Financials dedupe before truncation | For NVDA (402 XBRL rows), `limit=80` returns the 80 newest distinct metric+period pairs, verified against an unlimited query. | OPEN |
| CF-6 | The model picker offers only models that work | Each option is probed at mount; a failing provider is disabled with the provider's own error as its tooltip. No option is offered that returned an error in the last probe. | OPEN |
| CF-7 | The spinner cannot hang | An induced throw inside the settle handler still clears `loading`. Test asserts it. | OPEN |
| CF-8 | Trend chart costs one round trip, not two | Longitudinal periods derived without waiting on the financials response, or the two are issued in one batch. Measured before/after. | OPEN |
| CF-9 | `CompanyPage.tsx` under 400 lines | `wc -l` < 400; tabs extracted as components; no behaviour change (existing tests green). | OPEN |
| CF-10 | One backend company service | Sentiment + longitudinal + filings + financials reachable under one router with one auth dependency. | OPEN |
| CF-11 | An empty LLM completion is an error, not an answer | `llm.ts` returns `''` for a null completion today, with `ok: true` in the trace. Gate: a null/empty completion produces a non-2xx from `/api/llm/chat` and `ok: false` in the emitted trace, asserted by a test. | OPEN |

### Gate scripts

- CF-1 — `node docs/company-feature/gates/cf1-gate.mjs` (needs market-server up; set
  `PROXY=` if it is not on :3002). Reads the default model config out of the real
  source files rather than a transcription, so it keeps grading after edits.

## Stop conditions

- **Target** — all 10 gates green, each verified by its stated check actually run.
- **Budget** — 30 iterations.
- **Stall** — 3 consecutive iterations with no gate flipping and no new failure mode
  named. On stall: stop and report which gate is genuinely blocked and why.

## Escalation — halt and ask

- Any deploy, push to `main`, or Vercel prod publish.
- Rotating or revoking the leaked `deep-research-internal` key (breaks other callers —
  grep the repo for other consumers first and report them).
- Any provider key purchase or plan change (CF-6 may surface that all three are dead;
  that is a **finding to report**, not a spend decision to make).
- A gate that cannot be verified this iteration — say so, do not mark it green.

## Gate integrity

Gates may grow. A gate may never be weakened in the same change that claims it green.
Before any commit claiming a row green:

```bash
node ~/.claude/scripts/gate-guard.mjs
```

## Notes

- CF-1 is the unblocker: CF-6 cannot be assessed while the default model is wrong, and
  the whole AI surface (brief, Devil's Advocate) reads as "no data" until it lands.
- CF-2 and CF-3 are one commit's worth of work but land as separate rows because the
  second is a design decision and the first is a leak.
- Prod state as recorded: Fly deploys are blocked on an overdue invoice. This loop
  therefore works locally and **never deploys** — see escalation.
