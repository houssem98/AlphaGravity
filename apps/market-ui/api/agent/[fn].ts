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
import type { Bar } from '../../src/services/taLevels.js';
import { newTrace } from '../../src/services/gridTrace.js';

export const maxDuration = 60;   // a tool round-trip plus a reasoning model exceeds the 10s default

export const MAX_TOOL_LOOPS = 5;

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const fn = String(req.query?.fn ?? '');
  if (fn !== 'chat') return res.status(404).json({ error: `Unknown agent route: ${fn}` });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

  const { messages, asset, tools, mode, rounds } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages[] required' });
  }

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

  const history: ChatMessage[] = [...messages];
  const actions: ClientAction[] = [];
  const citations: DexterCitation[] = [];
  const t0 = Date.now();

  // DX-3: the trace is a record, never a performance. A step exists iff its
  // call executed; a thrown tool keeps its real error. It is built even when
  // the request is toolless, so the plain chat path still shows its one step.
  const trace = newTrace();

  try {
    let provider = '';
    let model = '';

    // DX-8: the analyst layer. Four evidence sources read in parallel, each
    // spending exactly one LLM call on a bounded cited report, then one call to
    // answer from all four. DX-11 will route here automatically; until then it
    // is opt-in so it can be probed without changing the default path.
    if ((mode === 'deep' || mode === 'decide') && ctx) {
      const callLLM = (msgs: ChatMessage[]) => chatWithFallback(msgs, [], { keys });
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

      // DX-9: on a decision-shaped request the reports go to a bull/bear debate
      // and a research manager before anyone answers. Opt-in until DX-11 routes
      // it, because 2N+1 extra calls is not something to spend on "what's the
      // price".
      let debate: DebateResult | null = null;
      if (mode === 'decide') {
        debate = await trace.step('Bull/bear debate', 'debate',
          () => runDebate(ctx, reports, { callLLM }, clampRounds(rounds)),
          { meta: d => `${d.rounds} round(s), ${d.turns.length} turns → ${d.stance}${d.confidence === null ? '' : ` ${d.confidence}%`}` });
      }

      const final = await trace.step('Answering from the analyst reports', 'llm',
        () => chatWithFallback([
          ...messages as ChatMessage[],
          {
            role: 'user',
            content:
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
                : ''),
          },
        ], [], { keys }),
        { meta: r => `${r.provider}/${r.model}` });
      provider = final.provider;
      model = final.model;

      const deepTrust = scoreAnswerTrust({ answer: final.text, citations, steps: trace.done() });
      return res.json({
        text: final.text,
        actions,
        steps: trace.done(),
        citations,
        trust: deepTrust,
        reports: reports.map(r => ({
          id: r.id, title: r.title, ok: r.ok, error: r.error, ms: r.ms, steps: r.steps,
        })),
        debate: debate && {
          rounds: debate.rounds, stance: debate.stance, confidence: debate.confidence,
          verdict: debate.verdict, turns: debate.turns, steps: debate.steps,
        },
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
        () => chatWithFallback(history, toolDefs, { keys }),
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

    res.json({
      text,
      actions,
      steps: trace.done(),
      citations,
      trust,
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
    // evidence needed to see where it died.
    res.status(502).json({ error: e.message, steps: trace.done() });
  }
}
