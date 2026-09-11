// V2-6 · /api/llm/chat is not an open spend endpoint.
//
// The route took caller-supplied provider, model, prompt and max_tokens and
// called a provider with SERVER-side credentials under no inbound auth at all.
// Anyone who could reach market-server could choose the model and spend the
// credits.
//
// These are end-to-end against a real express app on a real socket: no viewer
// gets 401 before anything is spent, a viewer is metered, and max_tokens is a
// ceiling the caller cannot raise.

import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Set before the route module is imported: `authMiddleware` reads DEV_AUTH_BYPASS
// per request, but the Supabase client it builds needs a URL to exist at all.
vi.hoisted(() => {
    process.env.SUPABASE_URL ??= 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role';
});

const { llmRouter, capMaxTokens, maxTokensCap } = await import('./llm.js');
const { _resetMeter } = await import('./gravity.js');

const ANON_PER_MIN = Number(process.env.GRAVITY_ANON_PER_MIN ?? 20);

let server: Server;
let base: string;

const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/llm/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
    });

beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/llm', llmRouter);
    await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => {
    _resetMeter();
    delete process.env.DEV_AUTH_BYPASS;
});

describe('an unauthenticated request', () => {
    it('is refused', async () => {
        const res = await post({ provider: 'deepseek', model: 'deepseek-chat', prompt: 'hi' });
        expect(res.status).toBe(401);
    });

    it('is refused before any provider is chosen, so nothing is spent', async () => {
        // A body naming a real provider and a huge budget. It must still 401,
        // and must not come back carrying a completion.
        const res = await post({
            provider: 'anthropic', model: 'claude-opus-5',
            prompt: 'spend my money', max_tokens: 200_000,
        });
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.text).toBeUndefined();
    });

    it('is refused even with a malformed Authorization header', async () => {
        for (const header of ['', 'Bearer', 'Basic abc', 'token abc']) {
            const res = await post(
                { provider: 'deepseek', model: 'deepseek-chat', prompt: 'hi' },
                header ? { Authorization: header } : {},
            );
            expect(res.status, `header ${JSON.stringify(header)}`).toBe(401);
        }
    });
});

describe('an authenticated request', () => {
    beforeEach(() => { process.env.DEV_AUTH_BYPASS = '1'; });

    it('gets past auth', async () => {
        // No provider named, so it stops at validation — which is proof it got
        // past the 401 without calling anything.
        const res = await post({});
        expect(res.status).toBe(400);
        expect((await res.json()).error).toContain('Required');
    });

    it('is metered per viewer, and the meter closes', async () => {
        const statuses: number[] = [];
        for (let i = 0; i < ANON_PER_MIN + 1; i++) {
            statuses.push((await post({})).status);
        }
        expect(statuses.slice(0, ANON_PER_MIN)).toEqual(Array(ANON_PER_MIN).fill(400));
        expect(statuses[ANON_PER_MIN]).toBe(429);
    });

    it('says when the viewer may retry', async () => {
        for (let i = 0; i < ANON_PER_MIN; i++) await post({});
        const res = await post({});
        expect(res.status).toBe(429);
        expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
        expect((await res.json()).retryAfter).toBeGreaterThan(0);
    });

    it('meters the same viewer regardless of which address they arrive from', async () => {
        for (let i = 0; i < ANON_PER_MIN; i++) {
            await post({}, { 'X-Forwarded-For': `10.0.0.${i}` });
        }
        const res = await post({}, { 'X-Forwarded-For': '10.0.9.9' });
        expect(res.status).toBe(429);
    });
});

describe('max_tokens is capped server-side', () => {
    it('caps a caller who asks for more than the ceiling', () => {
        expect(capMaxTokens(1_000_000)).toBe(maxTokensCap());
        expect(capMaxTokens(200_000)).toBe(maxTokensCap());
    });

    it('honours a caller who asks for less', () => {
        expect(capMaxTokens(512)).toBe(512);
    });

    it('gives a caller who names nothing the default, not NaN', () => {
        // Some providers read NaN or 0 as "no limit", which is the same defect
        // wearing a different mask.
        for (const junk of [undefined, null, '', 'lots', NaN, 0, -1, Infinity]) {
            const got = capMaxTokens(junk);
            expect(Number.isFinite(got), String(junk)).toBe(true);
            expect(got, String(junk)).toBeGreaterThan(0);
            expect(got, String(junk)).toBeLessThanOrEqual(maxTokensCap());
        }
    });

    it('never returns more than the ceiling for any input', () => {
        for (const n of [1, 8191, 8192, 8193, 1e6, 1e12]) {
            expect(capMaxTokens(n)).toBeLessThanOrEqual(maxTokensCap());
        }
    });
});
