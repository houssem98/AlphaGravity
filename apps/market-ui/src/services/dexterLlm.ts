// Dexter LLM — the trading agent's server-side provider chain.
// docs/AI_TRADING_AGENT_ROADMAP.md DX-1, regression rows 2-3.
//
// Why this file exists: Assistant.tsx used to hold a Gemini key in the BROWSER
// (`VITE_GEMINI_API_KEY`) and call Google directly. That variable is empty in
// prod, so `initChat()` returned null and Dexter threw "Failed to initialize
// chat" on the first message — roadmap §0 F1, the dead panel in the screenshot.
// Keys now live in the deployment environment and only api/agent/[fn].ts,
// through this module, ever talks to a provider.
//
// SCOPE (doctrine rule 1 — never wire an endpoint you cannot probe): only
// OpenAI-compatible providers are implemented. DeepSeek is the sole live key
// (probed 2026-08-01); Groq is the same wire format for one line. Gemini and
// Anthropic need a different request shape AND both keys are dead (quota /
// 401), so writing unprobeable adapters for them would be exactly the mock-in-
// prod-code the doctrine forbids. They are a ledger note, not code.

export type ProviderId = 'deepseek' | 'groq';

export interface ToolDef {
    name: string;
    description: string;
    parameters: Record<string, unknown>;   // JSON Schema
}

export interface ToolCall {
    id: string;
    name: string;
    args: Record<string, unknown>;
}

// OpenAI chat wire format — the transport for every provider in the chain.
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_call_id?: string;
    tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
}

export interface ChatReply {
    text: string;
    toolCalls: ToolCall[];
}

export interface ChatResult extends ChatReply {
    provider: ProviderId;
    model: string;
    ms: number;
}

export const PROVIDER_CHAIN: readonly ProviderId[] = ['deepseek', 'groq'];

export const PROVIDER_ENDPOINT: Record<ProviderId, string> = {
    deepseek: 'https://api.deepseek.com/chat/completions',
    groq: 'https://api.groq.com/openai/v1/chat/completions',
};

// Live-probed 2026-08-01: GET https://api.deepseek.com/models returns exactly
// `deepseek-v4-flash` and `deepseek-v4-pro`, so the repo's internal ids are the
// real API model names — no translation layer needed.
export const DEFAULT_MODEL: Record<ProviderId, string> = {
    deepseek: 'deepseek-v4-flash',
    groq: 'llama-3.3-70b-versatile',
};

// Honesty over a plausible answer (doctrine rule 4): with no provider the agent
// says so rather than replying from the model's stale priors.
export const NO_PROVIDER =
    'No LLM provider is configured on the server, so Dexter will not guess an answer. ' +
    'Set DEEPSEEK_API_KEY (or GROQ_API_KEY) in the deployment environment.';

export function configuredProviders(keys: Partial<Record<ProviderId, string | undefined>>): ProviderId[] {
    return PROVIDER_CHAIN.filter(p => !!keys[p]);
}

function parseArgs(raw: unknown): Record<string, unknown> {
    if (typeof raw !== 'string' || !raw.trim()) return {};
    try {
        const v = JSON.parse(raw);
        return v && typeof v === 'object' ? v as Record<string, unknown> : {};
    } catch {
        return {};   // a malformed arg blob is an empty call, never invented values
    }
}

export type FetchLike = (url: string, init: Record<string, unknown>) => Promise<{
    ok: boolean; status: number; text(): Promise<string>; json(): Promise<any>;
}>;

export async function callOpenAICompatible(
    provider: ProviderId,
    model: string,
    messages: ChatMessage[],
    tools: ToolDef[],
    key: string,
    fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<ChatReply> {
    const body: Record<string, unknown> = { model, messages, max_tokens: 4096, temperature: 0.3 };
    if (tools.length > 0) {
        body.tools = tools.map(t => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
    }
    const resp = await fetchImpl(PROVIDER_ENDPOINT[provider], {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`${provider}/${model} HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);

    const msg = (await resp.json())?.choices?.[0]?.message ?? {};
    return {
        text: typeof msg.content === 'string' ? msg.content : '',
        toolCalls: (msg.tool_calls ?? []).map((c: any) => ({
            id: String(c.id ?? ''),
            name: String(c.function?.name ?? ''),
            args: parseArgs(c.function?.arguments),
        })),
    };
}

export interface ChatDeps {
    keys: Partial<Record<ProviderId, string | undefined>>;
    call?: (provider: ProviderId, model: string, messages: ChatMessage[], tools: ToolDef[], key: string) => Promise<ChatReply>;
    now?: () => number;
}

// Walks the chain in order, skipping providers with no key and falling through
// providers that fail. An exhausted chain throws with every provider's real
// error — it never degrades into an answer the model made up (row 3).
export async function chatWithFallback(
    messages: ChatMessage[],
    tools: ToolDef[],
    deps: ChatDeps,
): Promise<ChatResult> {
    const chain = configuredProviders(deps.keys);
    if (chain.length === 0) throw new Error(NO_PROVIDER);

    const call = deps.call ?? ((p, m, msgs, t, k) => callOpenAICompatible(p, m, msgs, t, k));
    const now = deps.now ?? Date.now;
    const failures: string[] = [];

    for (const provider of chain) {
        const model = DEFAULT_MODEL[provider];
        const t0 = now();
        try {
            const reply = await call(provider, model, messages, tools, deps.keys[provider]!);
            return { ...reply, provider, model, ms: now() - t0 };
        } catch (e) {
            failures.push(`${provider}: ${(e as Error).message}`);
        }
    }
    throw new Error(`Every configured LLM provider failed — ${failures.join(' | ')}`);
}
