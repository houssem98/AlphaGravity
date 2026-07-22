// TNC-1 regression — docs/TN_COLUMN_AUDIT_ROADMAP.md §4: /api/tn/board must not
// serve, or cache, an empty 7-day history. The closes query swallows its own
// timeout (gqueryTable returns []), so "no history" is indistinguishable from
// "nothing traded" unless the payload says which. All network mocked.
// Run: npx vitest run src/services/tnBoard.test.ts

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
        { isin: 'TN0007250012', last: 100, change: 1.5, volume: 900, caps: 90000, referentiel: { ticker: 'BIAT', stockName: 'BIAT' } },
        { isin: 'TN0001100254', last: 5.2, change: 0, volume: 0, caps: 0, referentiel: { ticker: 'AST', stockName: 'ASTREE' } },
    ],
};
const CLOSES = { TN0007250012: [96, 97, 99] };

// Blobs the run starts with, keyed by file; anything absent 404s. Returns the
// list of files written, so "never persists the empty shape" is directly asserted.
const stubFetch = (blobs: Record<string, any>, closesRows: any[][] | null) => {
    const puts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: any, init?: any) => {
        const u = String(url);
        if (u.includes('/storage/v1/object/market-data/')) {
            const file = u.split('/market-data/')[1];
            if (init?.method === 'POST') { puts.push(file); return { ok: true, status: 200, json: async () => ({}) }; }
            return blobs[file] ? jsonOk(blobs[file]) : { ok: false, status: 404, json: async () => ({}) };
        }
        if (u.includes('/grafana/api/ds/query')) {
            const sql = JSON.parse(String(init.body)).queries[0].rawSql;
            // No frames = the timeout path: gqueryTable catches and returns [].
            if (!sql.includes('raw_market') || !closesRows) return jsonOk({ results: { A: { frames: [] } } });
            return jsonOk({
                results: { A: { frames: [{
                    schema: { fields: [{ name: 'codeisin' }, { name: 'd' }, { name: 'cl' }] },
                    data: { values: closesRows },
                }] } },
            });
        }
        throw new Error(`unexpected fetch: ${u}`);
    }));
    return puts;
};

const fresh = (d: any) => ({ _t: Date.now(), d });
const stale = (d: any) => ({ _t: Date.now() - 60 * 60_000, d });

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('api/tn/board — 7-day history (TNC-1)', () => {
    const supabase = () => {
        vi.stubEnv('SUPABASE_URL', 'https://x.supabase.co');
        vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k');
    };

    it('history query dead → board still serves the cached closes, and never overwrites them', async () => {
        supabase();
        const puts = stubFetch({ 'tn_groups.json': fresh(MARKETS), 'tn_closes.json': stale(CLOSES) }, null);

        const res = mkRes();
        await handler({ query: { fn: 'board' } }, res);
        await new Promise((r) => setTimeout(r, 30)); // let the stale blob's background refresh finish

        expect(res.body.historyOk).toBe(true);
        const biat = res.body.board.find((r: any) => r.symbol === 'BIAT');
        expect(biat.closes).toEqual([96, 97, 99]);
        expect(biat.change7d).toBeCloseTo(3.125, 3);
        expect(puts).not.toContain('tn_closes.json');
    });

    it('history query dead with no cached closes → historyOk false, nothing persisted', async () => {
        supabase();
        const puts = stubFetch({ 'tn_groups.json': fresh(MARKETS) }, null);

        const res = mkRes();
        await handler({ query: { fn: 'board' } }, res);

        expect(res.body.historyOk).toBe(false);
        expect(res.body.board).toHaveLength(2);
        expect(res.body.board.every((r: any) => r.closes.length === 0 && r.change7d === null)).toBe(true);
        expect(puts).not.toContain('tn_closes.json');
        expect(puts).not.toContain('tn_board.json');
    });

    it('history query alive → closes computed and persisted; a stock that did not trade stays null', async () => {
        supabase();
        const puts = stubFetch({ 'tn_groups.json': fresh(MARKETS) }, [
            ['TN0007250012', 'TN0007250012'], ['2026-07-20', '2026-07-21'], [96, 99],
        ]);

        const res = mkRes();
        await handler({ query: { fn: 'board' } }, res);

        expect(res.body.historyOk).toBe(true);
        expect(res.body.board.find((r: any) => r.symbol === 'BIAT').closes).toEqual([96, 99]);
        // AST never traded in the window — absence of data is data, not a failure.
        expect(res.body.board.find((r: any) => r.symbol === 'AST').change7d).toBeNull();
        expect(puts).toContain('tn_closes.json');
        expect(puts).toContain('tn_board.json');
    });
});
