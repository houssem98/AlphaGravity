// Single Vercel function for every Dexter agent route (Hobby caps functions at
// 12; api/ held 11, this is the 12th and last). Dispatches on the path segment:
// /api/agent/chat. Later ledger tasks that need a route (DX-12 journal, DX-13
// outcomes) add a branch here — never a new function file.
//
// docs/AI_TRADING_AGENT_ROADMAP.md DX-1 (server-side brain) + DX-2 (the tool
// loop runs here too, so a tool result reaches the model without a round trip
// through the browser).
import {
  chatWithFallback, configuredProviders, NO_PROVIDER,
  type ChatMessage, type ProviderId, type ToolDef,
} from '../../src/services/dexterLlm.js';
import {
  citationFor, executeTool, isEmptyToolData, normalizeBars, toolMeta,
  uncitedFigures, TOOL_DEFS, TOOL_LABEL,
  type AssetContext, type ClientAction, type DexterCitation, type ToolDeps, type ToolOutcome,
} from '../../src/services/dexterTools.js';
import { extractFigures, findUnmappedCites } from '../../src/services/gridResearch.js';
import {
  buildVerifyPrompt, needsVerification, scoreAnswerTrust, GRADE_RANK,
} from '../../src/services/dexterTrust.js';
import { allCitations, renderReports, runAnalysts } from '../../src/services/dexterGraph.js';
import {
  clampRounds, renderTurns, runDebate, type DebateResult,
} from '../../src/services/dexterDebate.js';
import {
  clampRiskRounds, minStopDistance, renderPlan, runRisk, DISCLOSURE, type RiskResult,
} from '../../src/services/dexterRisk.js';
import { taLevels } from '../../src/services/taLevels.js';
import {
  classifyIntent, describeBudget, CallBudget,
} from '../../src/services/dexterIntent.js';
import {
  buildEntry, recordDecision, supabaseJournalStore,
} from '../../src/services/dexterJournal.js';
import { gradeOpen } from '../../src/services/dexterOutcome.js';
import {
  buildPastContext, renderTrackRecord, trackRecord,
} from '../../src/services/dexterMemory.js';
import type { Bar, TaLevels } from '../../src/services/taLevels.js';
import { renderLevelsBlock, MAX_LEVELS_PER_SIDE } from '../../src/services/dexterBlocks.js';
import { plannedStages } from '../../src/services/dexterStages.js';
import { newTrace } from '../../src/services/gridTrace.js';

// A tool round-trip plus a reasoning model exceeds the 10s default. The full
// `decide` path (analysts → debate → risk trio → answer) measured 158.7s in
// prod, so 60 was already being exceeded without a 504 — the declared value was
// not biting. Declared honestly at 300 rather than relying on that.
export const maxDuration = 300;

export const MAX_TOOL_LOOPS = 5;

// Same mechanism @vercel/functions' waitUntil uses, without the dependency —
// copied from api/tn/[fn].ts, which has run on it in prod for weeks.
function waitUntil(p: Promise<unknown>) {
  const ctx = (globalThis as any)[Symbol.for('@vercel/request-context')]?.get?.();
  const q = p.catch(() => {});
  if (ctx?.waitUntil) ctx.waitUntil(q);
}

// DX-13: re-price every open decision against real bars and write the verdicts
// back. Zero model calls — grading is arithmetic, and paying a model to read a
// price path would be both slower and less trustworthy.
async function outcomesRoute(req: any, res: any) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(503).json({ error: 'journal storage is not configured' });

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const origin = `${proto}://${req.headers.host}`;
  const getJson = async (u: string) => {
    const r = await fetch(u.startsWith('http') ? u : `${origin}${u}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) throw new Error(`${u} → HTTP ${r.status}`);
    return r.json();
  };

  const store = supabaseJournalStore(url, key);
  const rows = await store.get();

  const { rows: graded, summary } = await gradeOpen(rows, async (entry) => {
    const out = await executeTool('getChartData', { days: 60 },
      { symbol: entry.symbol, isTN: entry.isTN, isCrypto: entry.isCrypto }, { getJson });
    return normalizeBars(out.data);
  });

  if (summary.graded > 0) await store.put(graded);
  res.json({ scanned: rows.length, ...summary });
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const fn = String(req.query?.fn ?? '');

  // DX-13: the outcome pass. Driven by the daily cron in vercel.json, and
  // callable by hand. Read-mostly: it fetches bars and rewrites the journal, it
  // never asks a model anything.
  if (fn === 'outcomes') return outcomesRoute(req, res);

  if (fn !== 'chat') return res.status(404).json({ error: `Unknown agent route: ${fn}` });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

  const { messages, asset, tools, mode, rounds, riskRounds, confirmed, stream } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages[] required' });
  }
  const t0 = Date.now();

  // DX-16: NDJSON step events. This is the live ticker DX-3 could not ship —
  // one non-streaming POST gave the browser no way to learn a server step
  // before the run ended, and inventing progress would have been a performance
  // rather than a record. Steps only, not tokens: on a 100-second graph the
  // useful signal is WHICH STAGE is running, and streaming tokens through five
  // stages would buy noise at the cost of a much larger surface.
  const streaming = stream === true;
  if (streaming) {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
  }
  let emitted = 0;
  const send = (obj: unknown) => {
    if (!streaming) return;
    try { res.write(JSON.stringify(obj) + '\n'); } catch { /* client hung up */ }
  };
  const finish = (payload: Record<string, unknown>) => {
    if (!streaming) return res.json(payload);
    send({ type: 'done', ...payload });
    return res.end();
  };

  const keys: Partial<Record<ProviderId, string | undefined>> = {
    deepseek: process.env.DEEPSEEK_API_KEY,
    groq: process.env.GROQ_API_KEY,
  };
  if (configuredProviders(keys).length === 0) return res.status(503).json({ error: NO_PROVIDER });

  // No asset context means no tool belt: the caller gets the plain chat path,
  // byte-identical to a request that never mentioned tools (row 6).
  const ctx: AssetContext | null = asset?.symbol
    ? { symbol: String(asset.symbol), isTN: !!asset.isTN, isCrypto: !!asset.isCrypto, name: asset.name, price: asset.price }
    : null;
  const toolDefs = (ctx ? (tools ?? TOOL_DEFS) : (tools ?? [])) as ToolDef[];

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const origin = `${proto}://${req.headers.host}`;
  const getJson = async (url: string) => {
    const r = await fetch(url.startsWith('http') ? url : `${origin}${url}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
    return r.json();
  };

  // DX-5: the draw gate needs the same bars the analysis ran on. Fetched at
  // most once per request and shared by every tool call in the loop.
  let barsPromise: Promise<Bar[]> | null = null;
  const deps: ToolDeps = {
    getJson,
    getBars: () => {
      barsPromise ??= ctx
        ? executeTool('getChartData', { days: 180 }, ctx, { getJson })
            .then(o => normalizeBars(o.data))
            .catch(() => [])
        : Promise.resolve([]);
      return barsPromise;
    },
  };

  // DX-11: route on the last user turn unless the caller pinned a mode. A
  // decision costs minutes and real money, so it is quoted and confirmed before
  // it runs — the refusal below spends zero model calls.
  const lastUser = [...(messages as ChatMessage[])].reverse().find(m => m.role === 'user');
  const routed = classifyIntent(String(lastUser?.content ?? ''));
  const effectiveMode: string = mode ?? routed.intent;

  if (effectiveMode === 'decide' && confirmed !== true) {
    return finish({
      needsConfirmation: true,
      intent: routed.intent,
      reason: routed.reason,
      budget: routed.budget,
      message: describeBudget(routed),
      ms: Date.now() - t0,
    });
  }

  // Every model call in this request goes through the counter, including the
  // ones inside the analysts, the debate and the risk trio.
  const budget = new CallBudget();
  const countedChat: typeof chatWithFallback = budget.wrap(chatWithFallback);

  const history: ChatMessage[] = [...messages];
  const actions: ClientAction[] = [];
  const citations: DexterCitation[] = [];

  // DX-3: the trace is a record, never a performance. A step exists iff its
  // call executed; a thrown tool keeps its real error. It is built even when
  // the request is toolless, so the plain chat path still shows its one step.
  const rawTrace = newTrace();

  // DX-16: the same trace, with each completed step pushed to the client as it
  // lands. It reports steps AFTER they run, so a streamed step is still a
  // record of something that happened — never a spinner labelled with a stage
  // that has not started.
  const trace: typeof rawTrace = {
    async step(label, tool, fn, opts) {
      send({ type: 'stage', label, tool });
      try {
        return await rawTrace.step(label, tool, fn, opts);
      } finally {
        const done = rawTrace.done();
        for (const s of done.slice(emitted)) send({ type: 'step', ...s });
        emitted = done.length;
      }
    },
    done: () => rawTrace.done(),
  };

  // DD-10: the pipeline the router chose, stated before it runs. The tool-loop
  // path returns [] — the model picks its own calls there, so there is nothing
  // honest to promise.
  send({
    type: 'plan',
    intent: effectiveMode,
    stages: ctx
      ? plannedStages(effectiveMode, {
          hasMemory: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
        })
      : [],
  });

  try {
    let provider = '';
    let model = '';

    // DX-8: the analyst layer. Four evidence sources read in parallel, each
    // spending exactly one LLM call on a bounded cited report, then one call to
    // answer from all four. DX-11 will route here automatically; until then it
    // is opt-in so it can be probed without changing the default path.
    if ((effectiveMode === 'deep' || effectiveMode === 'decide') && ctx) {
      const callLLM = (msgs: ChatMessage[]) => countedChat(msgs, [], { keys });

      // DX-14: what this agent already tried on this name, and how it went. One
      // storage read, no model call. Empty journal ⇒ empty block: a model told
      // "no prior history" starts inventing patterns, a model told nothing
      // does not.
      let memoryBlock = '';
      if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        try {
          const rows = await trace.step('Recalling past calls', 'memory',
            () => supabaseJournalStore(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!).get(),
            { isEmpty: rs => rs.length === 0, meta: rs => `${rs.length} journalled decision(s)` });
          const past = buildPastContext(rows, ctx.symbol);
          const record = renderTrackRecord(trackRecord(rows));
          memoryBlock = [past.text, record].filter(Boolean).join('\n\n');
        } catch { /* memory is a bonus; never fail a run over it */ }
      }
      const reports = await trace.step('Running analysts', 'analysts',
        () => runAnalysts(ctx, { tools: deps, callLLM }),
        {
          isEmpty: rs => rs.every(r => !r.ok),
          meta: rs => rs.map(r => `${r.id}:${r.ok ? 'ok' : 'unavailable'}`).join(' '),
        });

      // Each analyst's own steps stay inside its report rather than being
      // spliced into the main trace: they ran concurrently, so interleaving
      // them into one ordered list would imply a sequence that never happened.
      citations.push(...allCitations(reports));

      // DD-8: the deterministic levels, read once from the same bars the
      // analysis ran on. They back the risk floor below AND the levels block
      // prepended to the answer, so the ladder the user scans and the stop the
      // manager was held to can never come from two different reads.
      let levels: TaLevels | null = null;
      if (deps.getBars) {
        try { levels = taLevels(await deps.getBars()); } catch { levels = null; }
      }

      // DX-9: on a decision-shaped request the reports go to a bull/bear debate
      // and a research manager before anyone answers. Opt-in until DX-11 routes
      // it, because 2N+1 extra calls is not something to spend on "what's the
      // price".
      let debate: DebateResult | null = null;
      if (effectiveMode === 'decide') {
        debate = await trace.step('Bull/bear debate', 'debate',
          () => runDebate(ctx, reports, { callLLM }, clampRounds(rounds)),
          { meta: d => `${d.rounds} round(s), ${d.turns.length} turns → ${d.stance}${d.confidence === null ? '' : ` ${d.confidence}%`}` });
      }

      // DX-10: three risk views, then a portfolio manager who has to show the
      // risk. A BUY/SELL whose block does not validate comes back as
      // commentary — the plan is dropped, not quietly repaired.
      let risk: RiskResult | null = null;
      if (effectiveMode === 'decide') {
        // DX-17: the stop floor comes from the same bars the analysis ran on.
        // Without an ATR (too little history) there is no floor rather than a
        // guessed one.
        const minStop = minStopDistance(levels?.atr ?? null);
        risk = await trace.step('Risk trio + portfolio manager', 'risk',
          () => runRisk(ctx, reports, debate, { callLLM, minStop }, clampRiskRounds(riskRounds)),
          { meta: r => r.plan
              ? `${r.plan.action} ${r.plan.sizePct}% · stop ${r.plan.stop} · R:R ${r.plan.rr}:1`
              : `no position (${r.commentary ? `downgraded: ${r.rejectReason}` : 'HOLD'})` });
      }

      const final = await trace.step('Answering from the analyst reports', 'llm',
        () => countedChat([
          ...messages as ChatMessage[],
          {
            role: 'user',
            content:
              (memoryBlock ? `${memoryBlock}\n\n---\n\n` : '') +
              `Analyst reports for ${ctx.symbol}:\n\n${renderReports(reports)}\n\n` +
              `Answer the question using these reports. Keep every [N] marker attached to the ` +
              `figure it came from, and do not introduce a figure that is not in a report above.\n\n` +
              // A prod run wrote "No social read is available [502]", turning an HTTP status into
              // a citation marker that resolved to nothing and correctly graded F. Square
              // brackets belong to citations alone.
              `Square brackets are reserved for citation markers. Never put any other number in ` +
              `brackets — not an error code, not a year, not a quantity. When an analyst section ` +
              `is unavailable, say so in plain words with no marker at all.` +
              (debate
                ? `\n\nThe bull and bear have already argued this and the research manager ruled ` +
                  `${debate.stance}${debate.confidence === null ? '' : ` at ${debate.confidence}% confidence`}. ` +
                  `Lead with that verdict and the reason it won.\n\n` +
                  `Manager's verdict:\n${debate.verdict}\n\nDebate:\n${renderTurns(debate.turns)}`
                : '') +
              (risk
                ? `\n\nPortfolio manager's decision:\n${risk.text}\n\n` +
                  (risk.plan
                    ? `The risk block validated. State it exactly as given and do not restate the ` +
                      `numbers differently anywhere else.`
                    : risk.commentary
                      ? `The risk block did NOT validate (${risk.rejectReason}). You may NOT present ` +
                        `this as a trade. Present it as commentary and say plainly that no ` +
                        `executable plan was produced.`
                      : `The manager chose HOLD, which is a real answer. Do not turn it into a trade.`)
                : ''),
          },
        ], [], { keys }),
        { meta: r => `${r.provider}/${r.model}` });
      provider = final.provider;
      model = final.model;

      // Row 22: the disclosure is appended here, not left to the model's
      // discretion — and the validated risk block is rendered from the numbers
      // that passed validation, so the two can never disagree.
      let answer = final.text;
      if (risk?.plan) answer = `${renderPlan(risk.plan, ctx)}\n\n${answer}`;
      // DD-8: the ladder goes above the plan — a reader checks where price is
      // before reading what to do about it. Emitted only when the TA actually
      // found levels; there is no empty ladder.
      if (levels && (levels.support.length > 0 || levels.resistance.length > 0)) {
        answer = `${renderLevelsBlock({
          lastClose: levels.lastClose,
          trend: levels.trend,
          atr: levels.atr,
          unit: ctx.isTN ? ' TND' : '',
          support: levels.support.slice(0, MAX_LEVELS_PER_SIDE).map(l => ({ price: l.price, touches: l.touches })),
          resistance: levels.resistance.slice(0, MAX_LEVELS_PER_SIDE).map(l => ({ price: l.price, touches: l.touches })),
        })}\n\n${answer}`;
      }
      if (effectiveMode === 'decide') answer = `${answer}\n\n_${DISCLOSURE}_`;

      const deepTrust = scoreAnswerTrust({ answer: final.text, citations, steps: trace.done() });

      // DX-12: write the call down. Fire-and-forget — a journal failure must not
      // cost the user their answer, and a decision the user already read is
      // worth more than a perfectly consistent ledger.
      let journalled: string | null = null;
      if (effectiveMode === 'decide' && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        const entry = buildEntry({
          symbol: ctx.symbol, isTN: ctx.isTN, isCrypto: ctx.isCrypto,
          priceAtCall: ctx.price ?? null,
          plan: risk?.plan ?? null,
          action: risk?.plan?.action ?? 'HOLD',
          stance: debate?.stance ?? null,
          confidence: debate?.confidence ?? null,
          grade: deepTrust.grade, score: deepTrust.score,
          thesis: final.text, calls: budget.spent,
        });
        journalled = entry.id;
        const store = supabaseJournalStore(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        waitUntil(recordDecision(store, entry).catch(e => console.error('[journal]', e.message)));
      }
      return finish({
        text: answer,
        actions,
        steps: trace.done(),
        citations,
        trust: deepTrust,
        intent: effectiveMode,
        calls: budget.spent,
        journalled,
        reports: reports.map(r => ({
          id: r.id, title: r.title, ok: r.ok, error: r.error, ms: r.ms, steps: r.steps,
        })),
        debate: debate && {
          rounds: debate.rounds, stance: debate.stance, confidence: debate.confidence,
          verdict: debate.verdict, turns: debate.turns, steps: debate.steps,
        },
        risk: risk && {
          rounds: risk.rounds, plan: risk.plan, commentary: risk.commentary,
          rejectReason: risk.rejectReason, turns: risk.turns, steps: risk.steps,
        },
        disclosure: effectiveMode === 'decide' ? DISCLOSURE : undefined,
        fabricatedCites: findUnmappedCites(final.text, citations),
        uncitedFigures: uncitedFigures(final.text),
        provider, model, ms: Date.now() - t0,
      });
    }

    // One pass of "think → call tools → read results", up to the loop cap. The
    // verification round (DX-7) runs this a second time against the same
    // history, so it re-derives from the tools rather than restating.
    const runRound = async (): Promise<string> => {
    let text = '';

    for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
      const reply = await trace.step(
        loop === 0 ? 'Thinking' : 'Reading tool results',
        'llm',
        () => countedChat(history, toolDefs, { keys }),
        {
          isEmpty: r => !r.text && r.toolCalls.length === 0,
          meta: r => `${r.provider}/${r.model}${r.toolCalls.length ? ` → ${r.toolCalls.map(c => c.name).join(', ')}` : ''}`,
        },
      );
      provider = reply.provider;
      model = reply.model;
      if (reply.text) text += (text ? '\n\n' : '') + reply.text;

      if (reply.toolCalls.length === 0) {
        history.push({ role: 'assistant', content: reply.text });
        break;
      }

      // The assistant turn must carry the tool_calls it made, or the provider
      // rejects the tool results that follow (OpenAI protocol). Results go back
      // as role:'tool' turns — never re-serialised into a user message.
      history.push({
        role: 'assistant',
        content: reply.text,
        tool_calls: reply.toolCalls.map(c => ({
          id: c.id, type: 'function' as const,
          function: { name: c.name, arguments: JSON.stringify(c.args) },
        })),
      });

      for (const call of reply.toolCalls) {
        let outcome: ToolOutcome;
        try {
          outcome = await trace.step(
            TOOL_LABEL[call.name] ?? `Running ${call.name}`,
            call.name,
            () => ctx
              ? executeTool(call.name, call.args, ctx, deps)
              : Promise.resolve({ data: { error: 'No asset context — tools are unavailable for this request.' } }),
            {
              isEmpty: o => isEmptyToolData(o.data),
              meta: o => toolMeta(call.name, o.data),
            },
          );
        } catch (e: any) {
          // The trace already recorded the real failure; the model gets an
          // honest error so it can say the feed was down instead of guessing.
          outcome = { data: { error: `${call.name} failed: ${e?.message ?? String(e)}` } };
        }
        if (outcome.action) actions.push(outcome.action);

        // DX-6: a snapshot that carried something becomes citable evidence, and
        // the model is handed its id inline so it can cite while writing.
        let content = JSON.stringify(outcome.data);
        if (ctx && !isEmptyToolData(outcome.data)) {
          const cite = citationFor(citations.length + 1, call.name, ctx.symbol, outcome.data);
          citations.push(cite);
          content = `[${cite.id}] ${content}\n\nCite any figure taken from this result as [${cite.id}].`;
        }
        history.push({ role: 'tool', tool_call_id: call.id, content });
      }
    }
    return text;
    };

    let text = await runRound();
    let trust = scoreAnswerTrust({ answer: text, citations, steps: trace.done() });

    // DX-7 row 11: a D or F earns exactly one more attempt, capped at 2 rounds.
    // A verification that made the answer worse is not an improvement, so the
    // better-graded round is the one that ships.
    if (needsVerification(trust)) {
      const priorFigures = extractFigures(text);
      history.push({ role: 'user', content: buildVerifyPrompt(text, trust) });
      const second = await runRound();
      const secondTrust = scoreAnswerTrust({
        answer: second, citations, steps: trace.done(), rounds: 2, priorFigures,
      });
      if (GRADE_RANK[secondTrust.grade] <= GRADE_RANK[trust.grade]) {
        text = second;
        trust = secondTrust;
      } else {
        trust = { ...trust, rounds: 2, reasons: [...trust.reasons, 'verification round scored worse — kept round 1'] };
      }
    }

    finish({
      text,
      actions,
      steps: trace.done(),
      citations,
      trust,
      intent: effectiveMode,
      calls: budget.spent,
      // Two different lies, kept apart: a [N] pointing at no source, and a
      // number resting on no [N] at all.
      fabricatedCites: findUnmappedCites(text, citations),
      uncitedFigures: uncitedFigures(text),
      provider,
      model,
      ms: Date.now() - t0,
    });
  } catch (e: any) {
    // A blown run still ships its trace — the steps that ran are exactly the
    // evidence needed to see where it died. On a stream the status is already
    // sent, so the failure rides the same channel as everything else.
    if (streaming) { send({ type: 'error', error: e.message, steps: trace.done() }); return res.end(); }
    res.status(502).json({ error: e.message, steps: trace.done() });
  }
}
