// TNC-4 regression — docs/TN_COLUMN_AUDIT_ROADMAP.md §4: the day range must not
// contradict the price. High/low now ride the same board row as `price`, so
// `low <= price <= high` holds by construction; a stock that did not trade has
// no range at all. All network mocked.
// Run: npx vitest run src/services/tnDayRange.test.ts

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

const MARKETS = {
    markets: [
        // Traded: a real session range around the last price.
        { isin: 'TN0007250012', last: 96.4, change: 0.2, volume: 13142, caps: 1e6, open: 0, high: 97, low: 96.4, referentiel: { ticker: 'AB', stockName: 'AB' } },
        // Untraded: BVMT carries yesterday's close into high/low/last alike.
        { isin: 'TN0001100254', last: 75.5, change: 0, volume: 0, caps: 0, open: 0, high: 75.5, low: 75.5, referentiel: { ticker: 'AST', stockName: 'ASTREE' } },
    ],
};

const stub = () => {
    vi.stubEnv('SUPABASE_URL', 'https://x.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k');
    vi.stubGlobal('fetch', vi.fn(async (url: any, init?: any) => {
        const u = String(url);
        if (u.includes('/storage/v1/object/market-data/')) {
            const file = u.split('/market-data/')[1];
            if (init?.method === 'POST') return { ok: true, status: 200, json: async () => ({}) };
            if (file === 'tn_groups.json') return jsonOk({ _t: Date.now(), d: MARKETS });
            if (file === 'tn_closes.json') return jsonOk({ _t: Date.now(), d: { TN0007250012: [95, 96.4] } });
            return { ok: false, status: 404, json: async () => ({}) };
        }
        if (u.includes('/grafana/api/ds/query')) return jsonOk({ results: { A: { frames: [] } } });
        throw new Error(`unexpected fetch: ${u}`);
    }));
};

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const board = async () => {
    const res = mkRes();
    await handler({ query: { fn: 'board' } }, res);
    return res.body.board as any[];
};

describe('api/tn/board — day range (TNC-4)', () => {
    it('every row that has a range contains its own price', async () => {
        stub();
        const rows = await board();
        const withRange = rows.filter((r) => r.high != null && r.low != null);

        expect(withRange.length).toBeGreaterThan(0);
        expect(withRange.filter((r) => r.price < r.low || r.price > r.high)).toEqual([]);
    });

    it('a stock that did not trade has no range, not a flat one', async () => {
        stub();
        const ast = (await board()).find((r) => r.symbol === 'AST');

        // BVMT sent high = low = last = 75.5; that is yesterday's close, not a day range.
        expect(ast.price).toBe(75.5);
        expect(ast.high).toBeNull();
        expect(ast.low).toBeNull();
    });

    it('a traded stock keeps its real range', async () => {
        stub();
        const ab = (await board()).find((r) => r.symbol === 'AB');

        expect(ab.low).toBe(96.4);
        expect(ab.high).toBe(97);
        expect(ab.price).toBeGreaterThanOrEqual(ab.low);
        expect(ab.price).toBeLessThanOrEqual(ab.high);
    });
});
