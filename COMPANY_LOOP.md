# Company Intelligence Roadmap Loop

One iteration = one ledger item shipped end-to-end. Loop until every item in
`docs/COMPANY_INTELLIGENCE_ROADMAP.md` §6 is ✅ or ⛔, then stop the loop.

## Iteration protocol

1. **Pick**: read §6 Progress ledger in `docs/COMPANY_INTELLIGENCE_ROADMAP.md`.
   Take the FIRST unchecked item (top-to-bottom order; phases are dependency-ordered).
2. **Implement** the smallest shippable slice. Reuse before build:
   grid prompts + `GridView` plumbing, Gravity QA pipeline (`useGravitySearch`),
   Supabase client (frontend already authed), `financials` table `xbrl:*` rows,
   investment-committee chain, grid memo/Excel exporters, `AnswerText`/`CitationPanel`.
3. **Verify** (must pass before deploy):
   - `npx tsc --noEmit` + `npm run build` in `apps/market-ui`
   - probe touched prod endpoints with curl; gravity-api auth: `X-API-Key: eval-unlimited-fb-2026`
   - a UI item counts as done only if its data call returns real rows in prod
4. **Deploy**: `vercel --prod` from repo root (market-ui). If gravity-api touched:
   `fly deploy` from `services/gravity-api` only after local verification, then re-probe prod.
5. **Commit** the item's files only: `feat(company): <ledger item>` (normal style).
6. **Tick the ledger**: ✅ + date + one-line evidence (probe output or URL).
   Blocked (missing key, dead dep, needs paid provider) → ⛔ + reason, continue to next item.
7. Every 3 items or on phase completion: update memory `project_company_intelligence.md`.

## Guardrails

- No destructive DB ops, no purges, no schema drops.
- Server-side data paths: Supabase client, NOT asyncpg (dead in prod).
- Free/existing providers only — no new paid keys. Anthropic key dead; DeepSeek works.
- Never fabricate data: empty state beats wrong numbers. Numbers come from `xbrl:*` or cited passages only.
- Don't touch unrelated working-tree changes; commit only files this item modified.
- If an iteration's diff grows past ~300 lines, ship the working subset and split the rest into the next iteration.

## Pacing

Self-paced. Implementation iterations run back-to-back (short wakeups).
If waiting on external state (deploy propagation), wake ≤270s.
