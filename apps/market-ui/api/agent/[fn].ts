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
  executeTool, isEmptyToolData, normalizeBars, toolMeta, TOOL_DEFS, TOOL_LABEL,
  type AssetContext, type ClientAction, type ToolDeps, type ToolOutcome,
} from '../../src/services/dexterTools.js';
import type { Bar } from '../../src/services/taLevels.js';
import { newTrace } from '../../src/services/gridTrace.js';

export const maxDuration = 60;   // a tool round-trip plus a reasoning model exceeds the 10s default

export const MAX_TOOL_LOOPS = 5;

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const fn = String(req.query?.fn ?? '');
  if (fn !== 'chat') return res.status(404).json({ error: `Unknown agent route: ${fn}` });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

  const { messages, asset, tools } = req.body ?? {};
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
  const t0 = Date.now();

  // DX-3: the trace is a record, never a performance. A step exists iff its
  // call executed; a thrown tool keeps its real error. It is built even when
  // the request is toolless, so the plain chat path still shows its one step.
  const trace = newTrace();

  try {
    let text = '';
    let provider = '';
    let model = '';

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
        history.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(outcome.data) });
      }
    }

    res.json({ text, actions, steps: trace.done(), provider, model, ms: Date.now() - t0 });
  } catch (e: any) {
    // A blown run still ships its trace — the steps that ran are exactly the
    // evidence needed to see where it died.
    res.status(502).json({ error: e.message, steps: trace.done() });
  }
}
