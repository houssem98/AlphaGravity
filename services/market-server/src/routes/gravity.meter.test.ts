// CF-12 · the service key stops being an unlimited bypass.
//
// auth.py puts `deep-research-internal` on a static allowlist carrying
// tier:unlimited, and deliberately routes API keys around _apply_entitlement — so
// it walks past every tier and rate limit the billing work built. CF-2 moved the
// key server-side, which fixed the leak but pooled every anonymous viewer behind
// ONE key: a limit on the key would be a limit on all of them at once.
//
// So the key is not metered. A signed-in viewer's own token is forwarded instead
// (their tier, resolved upstream), and anonymous viewers are metered per client.

import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { gravityRouter, meter, _resetMeter } from './gravity.js';

describe('the per-client meter', () => {
    beforeEach(() => _resetMeter());

    it('allows up to the per-minute allowance, then reports the full window', () => {
        const t = Date.now();
        for (let i = 0; i < 20; i++) expect(meter('1.2.3.4', t)).toBeNull();
        const full = meter('1.2.3.4', t);
        expect(full?.window).toBe('minute');
        expect(full?.retryAfter).toBeGreaterThan(0);
    });

    it('meters each client separately — one viewer cannot spend another\'s allowance', () => {
        const t = Date.now();
        for (let i = 0; i < 20; i++) meter('heavy', t);
        expect(meter('heavy', t)).not.toBeNull();
        // This is the whole point of the row: a shared bucket would 429 here.
        expect(meter('someone-else', t)).toBeNull();
    });

    it('frees the minute window as it slides', () => {
        const t = Date.now();
        for (let i = 0; i < 20; i++) meter('1.2.3.4', t);
        expect(meter('1.2.3.4', t)).not.toBeNull();
        expect(meter('1.2.3.4', t + 61_000)).toBeNull();
    });

    it('still holds an hourly ceiling once minutes are spread out', () => {
        let now = Date.now();
        let allowed = 0;
        // 20 per minute over 15 minutes would be 300; the hourly cap is 200.
        for (let m = 0; m < 15; m++) {
            for (let i = 0; i < 20; i++) if (meter('steady', now) === null) allowed++;
            now += 61_000;
        }
        expect(allowed).toBe(200);
    });
});

describe('the proxy chooses a credential per request', () => {
    let server: Server;
    let base: string;
    const seen: { auth?: string; key?: string }[] = [];

    beforeAll(async () => {
        process.env.GRAVITY_API_KEY = 'test-service-key';
        // The stub below replaces global fetch, which is also how this test reaches
        // its own server. Keep the real one for that.
        (globalThis as any).__realFetch = globalThis.fetch;
        vi.stubGlobal('fetch', async (input: any, init?: any) => {
            const url = String(input?.url ?? input);
            if (url.startsWith('http://127.0.0.1:')) {
                return (globalThis as any).__realFetch(input, init);
            }
            const h = new Headers(init?.headers ?? {});
            seen.push({ auth: h.get('authorization') ?? undefined, key: h.get('x-api-key') ?? undefined });
            return new Response(JSON.stringify({ sources: [] }), {
                status: 200, headers: { 'Content-Type': 'application/json' },
            });
        });

        const app = express();
        app.use(express.json());
        app.use('/api/gravity', gravityRouter);
        await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        vi.unstubAllGlobals();
        await new Promise<void>(resolve => server.close(() => resolve()));
    });

    beforeEach(() => { seen.length = 0; _resetMeter(); });

    const post = (headers: Record<string, string> = {}) =>
        (globalThis as any).__realFetch(`${base}/api/gravity/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify({ query: 'AAPL revenue' }),
        });

    it('forwards a signed-in viewer\'s token and does NOT send the service key', async () => {
        const res = await post({ Authorization: 'Bearer viewer-jwt' });
        expect(res.status).toBe(200);
        expect(seen).toHaveLength(1);
        expect(seen[0].auth).toBe('Bearer viewer-jwt');
        // The bypass: sending the unlimited service key would skip their real tier.
        expect(seen[0].key).toBeUndefined();
    });

    it('uses the service key for an anonymous viewer', async () => {
        const res = await post();
        expect(res.status).toBe(200);
        expect(seen[0].key).toBe('test-service-key');
        expect(seen[0].auth).toBeUndefined();
    });

    it('429s an anonymous viewer past the allowance, with Retry-After', async () => {
        for (let i = 0; i < 20; i++) await post();
        const res = await post();
        expect(res.status).toBe(429);
        expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
        const body = await res.json();
        expect(body.error).toMatch(/Sign in for your plan/);
    });

    it('does not meter a signed-in viewer against the anonymous allowance', async () => {
        for (let i = 0; i < 20; i++) await post();
        expect((await post()).status).toBe(429);
        // Signing in is the way out, and it must actually work.
        expect((await post({ Authorization: 'Bearer viewer-jwt' })).status).toBe(200);
    });
});
