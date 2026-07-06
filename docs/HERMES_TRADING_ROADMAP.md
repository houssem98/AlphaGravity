# Hermes Agent × Trading — Accuracy & Premium Roadmap

Goal: wire **Nous Research Hermes Agent** (self-improving, self-hosted daemon,
MIT) into every trading-endpoint feature as the **accuracy layer + premium
content engine** — without touching the product's runtime constraints
(Vercel 12-fn cap, no new market-ui deps, BVMT/Supabase-only TN data).

Architecture stance (from 2026-07-06 research, see Progress log):
- Hermes is a **single-user ops daemon**, not an embeddable multi-tenant API.
  It runs beside the product (Docker on $5 VPS or Modal serverless,
  DeepSeek via custom base URL — our working key), consumes our **public
  prod endpoints**, and writes artifacts to **Supabase Storage blobs** that
  existing dispatchers serve. Zero new Vercel functions.
- Its learning loop (skill creation after tasks, 3-layer memory, FTS5
  recall) turns every incident/report into a reusable skill → the watchdog
  gets sharper the longer it runs.
- `hermes-agent-self-evolution` (DSPy + GEPA, eval-gated, PR-routed) evolves
  Hermes's own SKILL.md files (Phase 1 — the only implemented phase); for OUR
  prompts we use the DSPy+GEPA libraries directly (see H3.2).

Hard rules (every task):
1. **Grounding**: Hermes skills may only report numbers obtained by curling
   our endpoints or upstream BVMT/TSE feeds in that run — never from its
   memory. Memory is for procedure, not prices.
2. Prod stays read-only to the agent; all code/prompt changes route through
   **pull requests** (self-evolution default), human-merged.
3. New TN surface = routes inside `api/tn/[fn].ts` or Supabase blobs only.
4. Every claim about Hermes behavior verified against its repo/docs before
   building on it; every data claim verified with a payload.
5. One task per loop iteration; verify; flip `[x]`; one Progress-log line
   with REAL numbers; commit on `roadmap/world-class`.

---

## Phase H0 — Foundation (daemon online)
- [ ] **H0.1** — Deploy Hermes daemon: Docker on VPS or Modal (hibernating).
  Model = DeepSeek (OpenAI-compatible base URL, existing key). Telegram
  gateway connected. Sandboxed box, no repo write creds.
  *Acceptance:* `hermes` responds on Telegram; `hermes model` shows DeepSeek;
  daemon survives reboot; box has no Vercel/Supabase write tokens.
- [ ] **H0.2** — Grounding + safety scaffold: a base `SKILL.md` policy skill
  (curl-then-report only, endpoint allowlist = market-ui-self.vercel.app/api/*,
  bvmt.com.tn, tunis-stockexchange.com; refuse price-from-memory).
  *Acceptance:* ask agent for BIAT price with network blocked → it refuses
  rather than answers; with network → answer matches `/api/tn/markets` payload.

## Phase H1 — Accuracy watchdog (every endpoint gets an invariant skill)
- [ ] **H1.1** — `bvmt-health` skill: one run asserts, against live prod:
  markets (75 rows, book crossed=0, null-side count sane), intraday
  (sessionStart≤sessionEnd, candles within bounds), history (dates strictly
  increasing, hi≥lo), highs (ratio≤1), fundamentals (coverage≥42, PER∈[2,80]),
  index (TUNINDEX level >0 and within ±10% of TSE Grafana cross-check),
  snapshot (blob date = last weekday). Telegram summary, one line per check.
  *Acceptance:* full green run logged with the real numbers; one seeded fault
  (temporarily bad URL) produces a red alert.
- [ ] **H1.2** — Cron it: Mon–Fri 14:20 Tunis (post-close) + 09:20 (post-open).
  *Acceptance:* two consecutive scheduled runs delivered unattended.
- [ ] **H1.3** — Cross-source drift check skill: TUNINDEX (our endpoint) vs
  TSE Grafana raw; crypto tape prices vs a second public source; alert at
  >0.5% unexplained divergence.
  *Acceptance:* one drift report with both sources' real numbers side by side.

## Phase H2 — Close the C5 open question (live bid/ask semantics)
- [ ] **H2.1** — `bvmt-live-book` skill + cron Mon 09:30 Tunis: capture raw
  `groups` payload DURING the live session, record limit.bid/limit.ask vs
  trades for 5 liquid names (BIAT, SFBT, AB, TINV, DELICE), decide which raw
  field is the true bid (evidence: which side do executions cross?).
  *Acceptance:* archived live payload + a one-paragraph verdict with numbers.
- [ ] **H2.2** — If semantics proven: agent opens a PR updating the
  `book()` comment in `api/tn/[fn].ts` (mapping stays invariant-based; only
  the documented open question closes).
  *Acceptance:* PR with payload evidence linked; human merge.

## Phase H3 — Fundamentals accuracy flywheel
- [ ] **H3.1** — Eval set: 42 accepted + 4 rejected extractions as labeled
  cases (ticker, PDF url, expected NI/EPS or reject) in a blob/repo fixture.
  *Acceptance:* eval harness replays tn_fundamentals.py extraction on 5
  sampled cases and scores them.
- [ ] **H3.2** — Evolve the extraction prompt with **raw DSPy + GEPA
  libraries** (NOT hermes-agent-self-evolution — its implemented Phase 1
  only evolves Hermes's own SKILL.md files and PRs against the hermes-agent
  repo; arbitrary-prompt/system-prompt/code evolution is upstream Phase 2–4
  PLANNED). We write the harness: eval = H3.1 set, gate = no regression on
  the 42, STPIL extracts plausibly or stays rejected-for-cause.
  *Acceptance:* run report (candidates, winner delta) + PR.
- [ ] **H3.3** — `agm-dividends` skill: monitor BVMT/TSE publications for AGM
  dividend declarations (the data statements can't provide), extract DPS,
  propose blob update. Human confirms before upload.
  *Acceptance:* ≥3 real declared dividends captured with source links.

## Phase H4 — Premium content (agent writes, product serves)
- [ ] **H4.1** — Nightly **Daily Brief**: TN close report (TUNINDEX, breadth,
  top movers, near-highs, engine standouts, one-line news tone) written to
  Supabase blob `tn_brief.json` at 14:30 Tunis. Grounded rule 1 applies.
  *Acceptance:* 3 consecutive briefs; every number in them re-verifiable
  against that day's endpoints.
- [ ] **H4.2** — Serve + render: `brief` route inside `api/tn/[fn].ts`
  (reads blob; still 1 Vercel fn) + a Daily Brief card on the TN market page.
  *Acceptance:* card live in prod, shows yesterday's real brief; tsc 0 + build.
- [ ] **H4.3** — Weekly sector deep-dive (rotating BVMT sector; fundamentals
  table + 3-month performance from history endpoint) appended to the brief
  blob.
  *Acceptance:* first deep-dive live; spot-check 3 numbers vs endpoints.

## Phase H5 — Assistant quality loop
- [ ] **H5.1** — Eval set for the TN Assistant: 30 real TN questions
  (prices, ratios, comparisons, "when is the session open") with
  endpoint-derivable gold answers.
  *Acceptance:* baseline accuracy % measured and logged.
- [ ] **H5.2** — GEPA run on the Assistant system prompt via the same raw
  DSPy+GEPA harness as H3.2 (see H3.2 caveat — not an out-of-box
  hermes-agent-self-evolution capability); gate = eval accuracy strictly up,
  no grounding violations. PR.
  *Acceptance:* before/after accuracy with real percentages; PR merged.

## Phase H6 — Owner copilot (premium desk, optional)
- [ ] **H6.1** — Watchlist + NL alert rules via Telegram ("ping me if SFBT
  spread >1% or TINV prints >100 shares") compiled by the agent into cron
  skills over our endpoints.
  *Acceptance:* 2 rules firing correctly on real market events.

## Phase H7 — Flywheel maintenance
- [ ] **H7.1** — Monthly: skill audit (dedupe/self-improve), incident
  postmortems → skills, one self-evolution run, metrics report (checks run,
  alerts, mean-time-to-detect, brief streak).
  *Acceptance:* first monthly report with real counts.

---

## Definition of done
Every trading endpoint has a scheduled invariant guard; the two data
questions our own loop couldn't close (live bid/ask semantics, STPIL/AGM
fundamentals) are closed by the agent; the product ships agent-written,
endpoint-grounded premium content (daily brief, weekly deep-dive); and the
whole thing measurably improves itself month over month via skills + GEPA PRs.

## Progress log
<!-- YYYY-MM-DD Hx.y — what — verify numbers -->
2026-07-06 — Research base, VERIFIED via GitHub API + raw READMEs (not blog
claims): NousResearch/hermes-agent — 209,797 stars, created 2025-07-22, MIT,
Python; README confirms: any provider/own endpoint + `hermes model` switch,
single gateway (Telegram/Discord/Slack/WhatsApp/Signal), NL cron scheduler,
autonomous skill creation + skills self-improve + FTS5 recall + Honcho +
agentskills.io, ~/.hermes/skills/, terminal backends local/Docker/SSH/
Singularity/Modal/Daytona (idle hibernation), $5 VPS. self-evolution repo
(4,528 stars, created 2026-03-09): DSPy+GEPA, eval-gated, PRs against
hermes-agent; **Phase 1 implemented = SKILL.md only; tool-desc/system-prompt/
code evolution = Phases 2–4 PLANNED** → H3.2/H5.2 use raw DSPy+GEPA directly.
RETRACTED as unverified/SEO-slop: "released Feb 2026", "$2–10/run",
"60% faster after 30 days", "118 skills", hermes-ai.net as official domain
(real docs: hermes-agent.nousresearch.com). DeepSeek not explicitly listed —
reachable via own-endpoint/OpenRouter, verify in H0.1.
Live-probed our stack same day: 11/12 Vercel fns used; fundamentals
coverage 42; book crossed=0.
2026-07-06 H0.1 PARTIAL — DeepSeek PROVEN as provider two ways: (1) raw
chat/completions returned "HERMES-H01-OK", model=deepseek-v4-flash, 22 tokens,
id 8eb93254; (2) end-to-end agent run `hermes -z` returned
"HERMES-H01-DAEMON-OK" on existing local install (Hermes v0.14.0, home
~/.hermes, user redirected: reuse local install, not fresh Docker box).
`hermes config set model.provider deepseek` + model.default=deepseek-chat;
`hermes status` shows Provider: DeepSeek, key sk-8...a078 ✓. Repo verified via
GitHub API (pushed 2026-07-06T08:17Z, MIT, not archived). flyctl authed
(candidate always-on host); Modal absent. REMAINING for [x]: TELEGRAM_BOT_TOKEN
(user: create bot via @BotFather, put token in ~/.hermes/.env) → then
`hermes gateway start` + reboot persistence; NOTE dev machine is NOT the
sandboxed no-creds box the acceptance wants — final home should be Fly/VPS.
