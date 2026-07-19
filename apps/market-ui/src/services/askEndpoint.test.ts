// AC-8 regression tests — docs/GRID_AGENT_CELL_ROADMAP.md row 11 (NL endpoint):
// /api/tn/ask runs one agentic cell server-side; response carries answer,
// citations, steps, and earned trust. All network mocked.
// Run: npx vitest run src/services/askEndpoint.test.ts

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

afterEach(() => vi.unstubAllGlobals());

describe('api/tn/ask — NL agentic endpoint', () => {
    it('400 without q; 400 without a resolvable ticker', async () => {
        const r1 = mkRes();
        await handler({ query: { fn: 'ask' } }, r1);
        expect(r1.statusCode).toBe(400);

        const r2 = mkRes();
        await handler({ query: { fn: 'ask', q: 'what is the revenue?' } }, r2);
        expect(r2.statusCode).toBe(400);
        expect(r2.body.error).toContain('ticker');
    });

    it('grounded ask → answer + tool citations + 3 steps + earned trust grade', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url: any) => {
            const u = String(url);
            if (u.includes('/v1/search')) {
                return jsonOk({
                    answer: 'Revenue was $416,161M [1].\n\nSources\n[1] AAPL 10-K, Revenue (SEC XBRL): $416,161 million',
                    sources: [], citations: [], structured_data: [], confidence: 'HIGH', latency_ms: 5,
                });
            }
            if (u.includes('/api/quote')) {
                return jsonOk({ quoteResponse: { result: [{ regularMarketPrice: 333.74, regularMarketChangePercent: 0.14, marketCap: 4.9e12, fiftyTwoWeekLow: 201.5, fiftyTwoWeekHigh: 334.99 }] } });
            }
            if (u.includes('/api/fundamentals')) {
                return jsonOk({ quoteSummary: { result: [{ financialData: { totalRevenue: 451.4e9, freeCashflow: 101.1e9, grossMargins: 0.479, recommendationKey: 'buy' } }] } });
            }
            throw new Error(`unexpected fetch: ${u}`);
        }));

        const res = mkRes();
        await handler({ query: { fn: 'ask', q: 'AAPL total net sales fiscal 2025', ticker: 'AAPL' } }, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe('done');
        expect(res.body.answer).toContain('$416,161M');
        expect(res.body.answer).toContain('Live market:');
        expect(res.body.steps).toHaveLength(3);
        expect(res.body.steps.every((s: any) => s.status === 'ok')).toBe(true);
        expect(res.body.citations.filter((c: any) => c.source === 'market-server')).toHaveLength(2);
        expect(res.body.trust?.grade).toBe('B'); // grounded round-1 ceiling — earned, not asserted by the endpoint
        expect(res.headers['Cache-Control']).toBe('no-store');
    });
});
