// TNC-3 regression — docs/TN_COLUMN_AUDIT_ROADMAP.md §4: PER must agree with the
// price rendered beside it. Only the per-symbol branch reprices; the bulk payload
// the table reads carried the extraction-time `per`, so it now ships `eps` alone.
// All network mocked. Run: npx vitest run src/services/tnFundamentals.test.ts

import { describe, it, expect, vi, afterEach } from 'vitest';
import handler from '../../api/tn/[fn]';

const mkRes = () => {
    const res: any = { headers: {} as Record<string, string>, statusCode: 200, body: undefined };
    res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (b: any) => { res.body = b; return res; };
    return res;
};
const jsonOk = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

const MARKETS = { markets: [{ isin: 'TN0007250012', last: 100, change: 0, volume: 10, caps: 1000, referentiel: { ticker: 'BIAT', stockName: 'BIAT' } }] };
// `per` here is what the offline extraction wrote at a price of 80, not today's 100.
// STB/SFBT/ATL carry the P/B values prod actually served past the bound.
const BLOB = {
    BIAT: { eps: 5, per: 16, pb: 1.4, dividend: 2, yield: 2.5 },
    STB: { eps: 1, pb: 152348.2142857143 },
    SFBT: { eps: 1, pb: 14.585452389165507 },
    ATL: { eps: 1, pb: 12.25 },
    LOW: { eps: 1, pb: 0.1 },
    EDGE: { eps: 1, pb: 12 },
};

const stub = () => {
    vi.stubEnv('SUPABASE_URL', 'https://x.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k');
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
        const u = String(url);
        if (u.includes('tn_fundamentals.json')) return jsonOk(BLOB);
        if (u.includes('/storage/v1/object/market-data/')) return { ok: false, status: 404, json: async () => ({}) };
        if (u.includes('bvmt.com.tn')) return jsonOk(MARKETS);
        throw new Error(`unexpected fetch: ${u}`);
    }));
};

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('api/tn/fundamentals — PER agrees with the displayed price (TNC-3)', () => {
    it('the bulk payload ships eps and no stale per', async () => {
        stub();
        const res = mkRes();
        await handler({ query: { fn: 'fundamentals' } }, res);

        const f = res.body.fundamentals.BIAT;
        expect(f.eps).toBe(5);
        expect('per' in JSON.parse(JSON.stringify(f))).toBe(false);
        // Everything else the table reads survives.
        expect(f.pb).toBe(1.4);
        expect(f.dividend).toBe(2);
    });

    it('a caller dividing the displayed price by eps lands within 1% of it', async () => {
        stub();
        const res = mkRes();
        await handler({ query: { fn: 'fundamentals' } }, res);

        const price = MARKETS.markets[0].last;
        const per = price / res.body.fundamentals.BIAT.eps;
        expect(per).toBe(20);
        // The stale blob value would have been 16 — a 20% lie about a price never shown.
        expect(Math.abs(per - price / 5) / (price / 5)).toBeLessThanOrEqual(0.01);
    });

    it('the P/B bound applies to the bulk payload the table reads (TNC-5)', async () => {
        stub();
        const res = mkRes();
        await handler({ query: { fn: 'fundamentals' } }, res);

        const f = res.body.fundamentals;
        expect(f.STB.pb).toBeNull();   // 152 348.21 reached the board before this
        expect(f.SFBT.pb).toBeNull();  // 14.59
        expect(f.ATL.pb).toBeNull();   // 12.25
        expect(f.LOW.pb).toBeNull();   // 0.1
        // In-bound values, including the boundary itself, are untouched.
        expect(f.BIAT.pb).toBe(1.4);
        expect(f.EDGE.pb).toBe(12);
        const served = Object.values(f).map((x: any) => x.pb).filter((v) => typeof v === 'number');
        expect(served.filter((v) => v < 0.2 || v > 12)).toEqual([]);
    });

    it('the same bound applies per-symbol, and does not mutate the shared blob', async () => {
        stub();
        const one = mkRes();
        await handler({ query: { fn: 'fundamentals', symbol: 'STB' } }, one);
        expect(one.body.fundamentals.pb).toBeNull();

        // A second read must see the original blob, not a value an earlier call wrote through.
        const all = mkRes();
        await handler({ query: { fn: 'fundamentals' } }, all);
        expect(all.body.fundamentals.BIAT.pb).toBe(1.4);
        expect('per' in JSON.parse(JSON.stringify(all.body.fundamentals.BIAT))).toBe(false);
    });

    it('the per-symbol branch still reprices against the live quote', async () => {
        stub();
        const res = mkRes();
        await handler({ query: { fn: 'fundamentals', symbol: 'BIAT' } }, res);

        expect(res.body.fundamentals.per).toBe(20);
        expect(res.body.fundamentals.yield).toBe(2);
    });
});
