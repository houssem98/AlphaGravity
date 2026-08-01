// Single Vercel function for every Dexter agent route (Hobby caps functions at
// 12; api/ held 11, this is the 12th and last). Dispatches on the path segment:
// /api/agent/chat. Later ledger tasks that need a route (DX-12 journal, DX-13
// outcomes) add a branch here — never a new function file.
//
// docs/AI_TRADING_AGENT_ROADMAP.md DX-1, regression row 2.
import {
  chatWithFallback, configuredProviders, NO_PROVIDER,
  type ChatMessage, type ProviderId, type ToolDef,
} from '../../src/services/dexterLlm.js';

export const maxDuration = 60;   // a tool round-trip plus a reasoning model exceeds the 10s default

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const fn = String(req.query?.fn ?? '');
  if (fn !== 'chat') return res.status(404).json({ error: `Unknown agent route: ${fn}` });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

  const { messages, tools } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages[] required' });
  }

  const keys: Partial<Record<ProviderId, string | undefined>> = {
    deepseek: process.env.DEEPSEEK_API_KEY,
    groq: process.env.GROQ_API_KEY,
  };
  if (configuredProviders(keys).length === 0) return res.status(503).json({ error: NO_PROVIDER });

  try {
    const result = await chatWithFallback(messages as ChatMessage[], (tools ?? []) as ToolDef[], { keys });
    res.json(result);
  } catch (e: any) {
    res.status(502).json({ error: e.message });
  }
}
