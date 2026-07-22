// TNC-2 regression — docs/TN_COLUMN_AUDIT_ROADMAP.md §4: the engine must not
// score a factor it has no evidence for. News with 0 sources, momentum on an
// untraded session and liquidity with no book emit null, drop out of the
// composite, and take score/label with them when too little weight survives.
// All network mocked. Run: npx vitest run src/services/tnEngine.test.ts

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

// AST: never traded, no resting orders, no history, no press — the §3
// zero-evidence shape. BIAT: traded, two-sided book, one bull headline.
const MARKETS = {
    markets: [
        { isin: 'TN0001100254', last: 5.2, change: 0, volume: 0, caps: 0, limit: {}, referentiel: { ticker: 'AST', stockName: 'ASTREE' } },
        { isin: 'TN0007250012', last: 100, change: 1.5, volume: 900, caps: 90000, limit: { bid: 99.8, ask: 100.2 }, referentiel: { ticker: 'BIAT', stockName: 'BIAT' } },
    ],
};
const RSS = (titles: string[]) =>
    `<rss>${titles.map((t) => `<item><title>${t}</title></item>`).join('')}</rss>`;

// bars: [date, hi, lo, open, close, vol] columns as gqueryTable returns them.
const stubFetch = (bars: any[][] | null, titles: string[]) => {
    vi.stubGlobal('fetch', vi.fn(async (url: any, init?: any) => {
        const u = String(url);
        if (u.includes('bvmt.com.tn')) return jsonOk(MARKETS);
        if (u.includes('/grafana/api/ds/query')) {
            if (!bars) return jsonOk({ results: { A: { frames: [] } } });
            return jsonOk({ results: { A: { frames: [{
                schema: { fields: [{ name: 'd' }, { name: 'hi' }, { name: 'lo' }, { name: 'op' }, { name: 'cl' }, { name: 'vol' }] },
                data: { values: bars },
            }] } } });
        }
        if (u.includes('news.google.com')) return jsonOk(RSS(titles)) as any;
        throw new Error(`unexpected fetch: ${u}`);
    }));
};

// 70 sessions of steadily rising closes — enough for momentum(60) and the rest.
const RICH_BARS = (() => {
    const n = 70, d: string[] = [], hi: number[] = [], lo: number[] = [], op: number[] = [], cl: number[] = [], vol: number[] = [];
    for (let i = 0; i < n; i++) {
        const c = 80 + i * 0.3;
        d.push(`2026-0${1 + Math.floor(i / 31)}-${String((i % 31) + 1).padStart(2, '0')}`);
        hi.push(c + 0.5); lo.push(c - 0.5); op.push(c - 0.2); cl.push(c); vol.push(1000 + i);
    }
    return [d, hi, lo, op, cl, vol];
})();

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const engine = async (symbol: string) => {
    const res = mkRes();
    await handler({ query: { fn: 'engine', symbol } }, res);
    return res.body;
};

describe('api/tn/engine — no evidence, no score (TNC-2)', () => {
    it('a stock with no trade, no book, no history and no press carries no score or label', async () => {
        stubFetch(null, []);
        const d = await engine('AST');

        expect(d.factors.momentum.score).toBeNull();
        expect(d.factors.momentum.detail).toBe('did not trade today');
        expect(d.factors.news.score).toBeNull();
        expect(d.factors.liquidity.score).toBeNull();
        expect(d.factors.trend.score).toBeNull();
        expect(d.factors.reversal.score).toBeNull();
        expect(d.factors.nearHigh.score).toBeNull();
        expect(d.factors.illiquidity.score).toBeNull();
        // Only turnover percentile survives — a tenth of the model is not a score.
        expect(d.covered).toBeCloseTo(0.1, 6);
        expect(d.score).toBeNull();
        expect(d.label).toBeNull();
    });

    it('news with 0 sources is null, not a neutral 50', async () => {
        stubFetch(RICH_BARS, []);
        const d = await engine('BIAT');

        expect(d.factors.news.score).toBeNull();
        expect(d.factors.news.detail).toContain('of 0 headlines');
        // The rest of the model survives, so the score is still earned.
        expect(typeof d.score).toBe('number');
        expect(d.covered).toBeCloseTo(0.85, 6);
    });

    it('a news source that failed reads differently from a stock with no press', async () => {
        vi.stubEnv('FIRECRAWL_API_KEY', 'fc-test');
        vi.resetModules();
        const fresh = (await import('../../api/tn/[fn]')).default;
        vi.stubGlobal('fetch', vi.fn(async (url: any) => {
            const u = String(url);
            if (u.includes('bvmt.com.tn')) return jsonOk(MARKETS);
            if (u.includes('/grafana/api/ds/query')) return jsonOk({ results: { A: { frames: [] } } });
            if (u.includes('api.firecrawl.dev')) return { ok: false, status: 502, json: async () => ({}) };
            throw new Error(`unexpected fetch: ${u}`);
        }));

        const res = mkRes();
        await fresh({ query: { fn: 'engine', symbol: 'BIAT' } }, res);
        expect(res.body.factors.news.score).toBeNull();
        expect(res.body.factors.news.detail).toBe('news source unavailable');
    });

    it('with evidence on every factor the composite is the plain weighted mean', async () => {
        stubFetch(RICH_BARS, ['BIAT en forte hausse, bénéfice record']);
        const d = await engine('BIAT');

        expect(d.covered).toBe(1);
        expect(d.factors.news.score).toBeGreaterThan(50);
        expect(d.factors.liquidity.score).toBeGreaterThan(0);
        const manual = Object.entries(d.factors)
            .reduce((a, [k, f]: any) => a + f.score * d.weights[k], 0);
        expect(d.score).toBe(Math.round(manual));
        expect(['bullish', 'bearish', 'neutral']).toContain(d.label);
    });
});
