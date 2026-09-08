// CF-13 · market-server's own gravity calls carry the key, and a rejected
// credential is reported rather than returned as "nothing found".
//
// Every function in this file used to end in `catch { return [] }` and send no
// auth header at all, so a 401 arrived indistinguishable from a company with no
// indexed filings — the CF-1 shape a third time.

import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const SRC = new URL('./gravityClient.ts', import.meta.url);

describe('every gravity call carries the key', () => {
    const src = readFileSync(SRC, 'utf8');

    it('no fetch in this file goes out without headers', () => {
        // Every `fetch(` call site must build its headers from gravityHeaders()
        // within its own options object.
        const sites: string[] = [];
        for (let i = src.indexOf('await fetch('); i !== -1; i = src.indexOf('await fetch(', i + 1)) {
            sites.push(src.slice(i, i + 400));
        }
        expect(sites.length).toBeGreaterThanOrEqual(3);
        const bare = sites.filter(s => !s.includes('gravityHeaders('));
        expect(bare.map(s => s.split('\n')[0].trim())).toEqual([]);
    });

    it('no call site swallows every error unconditionally', () => {
        // The undiscriminating `catch { return [] }` is the pattern this row
        // removed: it reported a credential fault as an empty result. Comments are
        // stripped first — this file's own docstrings quote the pattern by name.
        const code = src
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');
        expect(code).not.toMatch(/catch\s*\{\s*return \[\]/);
        expect(code).not.toMatch(/catch\s*\([\s\S]{0,20}?\)\s*\{\s*return \[\]/);
    });
});

describe('a rejected credential', () => {
    beforeEach(() => { vi.resetModules(); });
    afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

    async function withStatus(status: number) {
        vi.stubGlobal('fetch', async () => new Response('{}', { status }));
        return await import('./gravityClient.js');
    }

    it('throws a named error from searchGravityParallel instead of returning []', async () => {
        const m = await withStatus(401);
        await expect(m.searchGravityParallel(['AAPL revenue'], ['AAPL']))
            .rejects.toThrow(/rejected the service credential: HTTP 401/);
    });

    it('treats 403 the same way', async () => {
        const m = await withStatus(403);
        await expect(m.searchGravityParallel(['AAPL revenue'], ['AAPL']))
            .rejects.toThrow(/HTTP 403/);
    });

    it('throws from fetchGravityDocuments too', async () => {
        const m = await withStatus(401);
        await expect(m.fetchGravityDocuments('AAPL')).rejects.toThrow(/HTTP 401/);
    });

    it('says whether the key is missing or merely rejected', async () => {
        const m = await withStatus(401);
        await expect(m.searchGravityParallel(['q'], ['AAPL']))
            .rejects.toThrow(/GRAVITY_API_KEY is (set but not accepted|not set on this server)/);
    });
});

describe('a genuine empty result is still an empty result', () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

    it('a 200 with no sources returns [], not an error', async () => {
        vi.resetModules();
        vi.stubGlobal('fetch', async () => new Response(
            JSON.stringify({ sources: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
        const m = await import('./gravityClient.js');
        await expect(m.searchGravityParallel(['q'], ['AAPL'])).resolves.toEqual([]);
    });

    it('a 500 still degrades rather than throwing — one bad query must not kill a batch', async () => {
        vi.resetModules();
        vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }));
        const m = await import('./gravityClient.js');
        await expect(m.searchGravityParallel(['q'], ['AAPL'])).resolves.toEqual([]);
    });
});
