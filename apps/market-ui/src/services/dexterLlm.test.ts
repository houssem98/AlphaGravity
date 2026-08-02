// DX-1 regression tests — docs/AI_TRADING_AGENT_ROADMAP.md Section 6 rows 1 and 3.
// Row 2 (the live /api/agent/chat probe) is a deployment check, logged in §8.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
    chatWithFallback, configuredProviders, callOpenAICompatible,
    NO_PROVIDER, PROVIDER_CHAIN, DEFAULT_MODEL, DEFAULT_TEMPERATURE,
    type ChatMessage, type ChatReply, type FetchLike, type ProviderId,
} from './dexterLlm';

const MSGS: ChatMessage[] = [{ role: 'user', content: 'hi' }];

// ── Row 1: the browser-side Gemini client is gone for good ──────────────────
// The panel in the roadmap screenshot died because a key the browser could not
// have was read from the browser. Any reintroduction fails here.

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const p = join(dir, name);
        return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

describe('row 1 — no browser-side LLM credential', () => {
    const srcFiles = walk(join(__dirname, '..')).filter(f => /\.(ts|tsx)$/.test(f) && !f.endsWith('dexterLlm.test.ts'));

    it('scans a non-trivial source tree', () => {
        expect(srcFiles.length).toBeGreaterThan(50);
    });

    // Matches the read, not the word: this file and dexterLlm.ts name the dead
    // variable in prose so the regression stays legible.
    it('no VITE_GEMINI* read survives in src/', () => {
        const offenders = srcFiles.filter(f => /import\.meta\.env\.VITE_GEMINI/.test(readFileSync(f, 'utf8')));
        expect(offenders).toEqual([]);
    });

    it('no @google/genai import survives in src/', () => {
        const offenders = srcFiles.filter(f => /@google\/genai/.test(readFileSync(f, 'utf8')));
        expect(offenders).toEqual([]);
    });
});

// ── Row 3: the chain falls through, and an exhausted chain stays honest ─────

const ok = (text: string): ChatReply => ({ text, toolCalls: [] });

describe('row 3 — provider chain', () => {
    it('lists only providers that actually have a key, in chain order', () => {
        expect(configuredProviders({ deepseek: 'k', groq: 'k2' })).toEqual([...PROVIDER_CHAIN]);
        expect(configuredProviders({ groq: 'k2' })).toEqual(['groq']);
        expect(configuredProviders({ deepseek: '' })).toEqual([]);
        expect(configuredProviders({})).toEqual([]);
    });

    it('uses the first configured provider when it succeeds', async () => {
        const tried: ProviderId[] = [];
        const r = await chatWithFallback(MSGS, [], {
            keys: { deepseek: 'k', groq: 'k2' },
            call: async (p) => { tried.push(p); return ok('answer'); },
        });
        expect(tried).toEqual(['deepseek']);
        expect(r.provider).toBe('deepseek');
        expect(r.model).toBe(DEFAULT_MODEL.deepseek);
        expect(r.text).toBe('answer');
    });

    it('falls through a dead provider to the next one without throwing', async () => {
        const tried: ProviderId[] = [];
        const r = await chatWithFallback(MSGS, [], {
            keys: { deepseek: 'k', groq: 'k2' },
            call: async (p) => {
                tried.push(p);
                if (p === 'deepseek') throw new Error('deepseek/deepseek-v4-flash HTTP 401: dead key');
                return ok('from groq');
            },
        });
        expect(tried).toEqual(['deepseek', 'groq']);
        expect(r.provider).toBe('groq');
        expect(r.text).toBe('from groq');
    });

    it('skips unconfigured providers entirely', async () => {
        const tried: ProviderId[] = [];
        await chatWithFallback(MSGS, [], {
            keys: { groq: 'k2' },
            call: async (p) => { tried.push(p); return ok('x'); },
        });
        expect(tried).toEqual(['groq']);
    });

    it('reports every provider error when the chain is exhausted — never an answer', async () => {
        await expect(chatWithFallback(MSGS, [], {
            keys: { deepseek: 'k', groq: 'k2' },
            call: async (p) => { throw new Error(`${p} exploded`); },
        })).rejects.toThrow(/deepseek exploded.*groq exploded/);
    });

    it('refuses to answer at all when no provider is configured', async () => {
        await expect(chatWithFallback(MSGS, [], { keys: {} })).rejects.toThrow(NO_PROVIDER);
    });

    it('measures elapsed time from the injected clock', async () => {
        let t = 1000;
        const r = await chatWithFallback(MSGS, [], {
            keys: { deepseek: 'k' },
            now: () => (t += 250),
            call: async () => ok('x'),
        });
        expect(r.ms).toBe(250);
    });
});

// ── OpenAI-compatible transport ─────────────────────────────────────────────
// Response shape asserted against the live DeepSeek probe of 2026-08-01
// (finish_reason: "tool_calls", arguments as a JSON string).

function fakeFetch(status: number, payload: unknown, seen?: { url?: string; body?: any }): FetchLike {
    return async (url, init) => {
        if (seen) { seen.url = url; seen.body = JSON.parse(String(init.body)); }
        return {
            ok: status < 400,
            status,
            text: async () => JSON.stringify(payload),
            json: async () => payload,
        };
    };
}

describe('callOpenAICompatible', () => {
    it('parses text and tool calls from the live response shape', async () => {
        const f = fakeFetch(200, {
            choices: [{
                message: {
                    content: "I'll fetch 30 days of bars for BTC.",
                    tool_calls: [{ id: 'call_00_viY5', type: 'function', function: { name: 'getChartData', arguments: '{"days": 30}' } }],
                },
            }],
        });
        const r = await callOpenAICompatible('deepseek', 'deepseek-v4-flash', MSGS, [], 'k', f);
        expect(r.text).toBe("I'll fetch 30 days of bars for BTC.");
        expect(r.toolCalls).toEqual([{ id: 'call_00_viY5', name: 'getChartData', args: { days: 30 } }]);
    });

    it('sends tools in OpenAI function format only when there are tools', async () => {
        const seen: { body?: any } = {};
        await callOpenAICompatible('deepseek', 'm', MSGS, [
            { name: 'getChartData', description: 'bars', parameters: { type: 'object', properties: {} } },
        ], 'k', fakeFetch(200, { choices: [{ message: { content: 'ok' } }] }, seen));
        expect(seen.body.tools).toEqual([
            { type: 'function', function: { name: 'getChartData', description: 'bars', parameters: { type: 'object', properties: {} } } },
        ]);

        const bare: { body?: any } = {};
        await callOpenAICompatible('deepseek', 'm', MSGS, [], 'k', fakeFetch(200, { choices: [{ message: { content: 'ok' } }] }, bare));
        expect(bare.body.tools).toBeUndefined();
    });

    // DI-3: an evaluation harness is only seeded if the sampler is.
    it('sends the default temperature unless a caller asks for another', async () => {
        const prod: { body?: any } = {};
        await callOpenAICompatible('deepseek', 'm', MSGS, [], 'k', fakeFetch(200, { choices: [{ message: { content: 'ok' } }] }, prod));
        expect(prod.body.temperature).toBe(DEFAULT_TEMPERATURE);

        const replay: { body?: any } = {};
        await callOpenAICompatible('deepseek', 'm', MSGS, [], 'k',
            fakeFetch(200, { choices: [{ message: { content: 'ok' } }] }, replay), undefined, undefined, 0);
        expect(replay.body.temperature).toBe(0);
    });

    it('carries a replay temperature through the fallback chain', async () => {
        const seen: { body?: any } = {};
        const originalFetch = globalThis.fetch;
        globalThis.fetch = fakeFetch(200, { choices: [{ message: { content: 'ok' } }] }, seen) as unknown as typeof fetch;
        try {
            await chatWithFallback(MSGS, [], { keys: { deepseek: 'k' }, temperature: 0 });
            expect(seen.body.temperature).toBe(0);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('treats a malformed argument blob as an empty call rather than inventing values', async () => {
        const r = await callOpenAICompatible('deepseek', 'm', MSGS, [], 'k', fakeFetch(200, {
            choices: [{ message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'getChartData', arguments: '{not json' } }] } }],
        }));
        expect(r.toolCalls[0].args).toEqual({});
    });

    it('surfaces the provider status and body on an HTTP error', async () => {
        await expect(
            callOpenAICompatible('groq', 'llama-3.3-70b-versatile', MSGS, [], 'k', fakeFetch(401, { error: 'Invalid API Key' })),
        ).rejects.toThrow(/groq\/llama-3\.3-70b-versatile HTTP 401/);
    });
});

// A 10-decision replay died four decisions in on a bare `terminated` from the
// socket layer. With only one key configured, giving up on the first blip fails
// the whole run.
describe('transient failures are retried, permanent ones are not', () => {
    const ok = { choices: [{ message: { content: 'recovered' } }] };
    const noWait = async () => {};

    function flaky(failures: number, mode: 'throw' | number): FetchLike {
        let n = 0;
        return (async () => {
            if (n++ < failures) {
                if (mode === 'throw') throw new Error('terminated');
                return { ok: false, status: mode, text: async () => 'busy', json: async () => ({}) };
            }
            return { ok: true, status: 200, text: async () => '', json: async () => ok };
        }) as unknown as FetchLike;
    }

    it('recovers from a dropped socket', async () => {
        const r = await callOpenAICompatible('deepseek', 'm', MSGS, [], 'k', flaky(2, 'throw'), 3, noWait);
        expect(r.text).toBe('recovered');
    });

    it('recovers from a rate limit and from an overload', async () => {
        for (const status of [429, 503, 529]) {
            const r = await callOpenAICompatible('deepseek', 'm', MSGS, [], 'k', flaky(1, status), 3, noWait);
            expect(r.text).toBe('recovered');
        }
    });

    it('gives up after the attempt cap rather than hammering', async () => {
        let n = 0;
        const always = (async () => { n++; throw new Error('terminated'); }) as unknown as FetchLike;
        await expect(callOpenAICompatible('deepseek', 'm', MSGS, [], 'k', always, 3, noWait)).rejects.toThrow('terminated');
        expect(n).toBe(3);
    });

    it('does not retry a bad key — it will fail every time', async () => {
        let n = 0;
        const dead = (async () => { n++; return { ok: false, status: 401, text: async () => 'bad key', json: async () => ({}) }; }) as unknown as FetchLike;
        await expect(callOpenAICompatible('deepseek', 'm', MSGS, [], 'k', dead, 3, noWait)).rejects.toThrow(/HTTP 401/);
        expect(n).toBe(1);
    });

    it('backs off between attempts instead of retrying instantly', async () => {
        const waits: number[] = [];
        await callOpenAICompatible('deepseek', 'm', MSGS, [], 'k', flaky(2, 'throw'), 3,
            async (ms) => { waits.push(ms); });
        expect(waits).toEqual([1000, 2000]);
    });
});
