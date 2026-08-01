// DX-2 regression tests — docs/AI_TRADING_AGENT_ROADMAP.md Section 6 rows 4 and 6.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    executeTool, yahooRange, TOOL_DEFS, TOOL_NAMES,
    type AssetContext, type ToolDeps,
} from './dexterTools';

const EQUITY: AssetContext = { symbol: 'AAPL', isTN: false, isCrypto: false };
const CRYPTO: AssetContext = { symbol: 'BTC', isTN: false, isCrypto: true };
const TN: AssetContext = { symbol: 'SAH', isTN: true, isCrypto: false, name: 'Sah Lilas' };

// Records every URL the tool belt reaches for, and answers from a fixture map.
function deps(routes: Record<string, unknown>, seen: string[] = []): ToolDeps {
    return {
        getJson: async (url: string) => {
            seen.push(url);
            const hit = Object.keys(routes).find(k => url.includes(k));
            if (!hit) throw new Error(`${url} → HTTP 404`);
            const v = routes[hit];
            if (v instanceof Error) throw v;
            return v;
        },
    };
}

describe('row 4 — typed tool contract', () => {
    it('exposes exactly the four tools the server implements', () => {
        expect([...TOOL_NAMES]).toEqual([
            'drawTechnicalAnalysis', 'getChartData', 'getFundamentalData', 'getFinancialStatements',
        ]);
        for (const t of TOOL_DEFS) {
            expect(t.parameters).toHaveProperty('type', 'object');
            expect(typeof t.description).toBe('string');
        }
    });

    it('returns a typed payload the caller serialises once — never prose', async () => {
        const out = await executeTool('getChartData', { days: 2 }, CRYPTO, deps({
            'api.binance.com': [
                [1735689600000, '93000.1', '94000.2', '92000.3', '93500.4', '1200.5'],
                [1735776000000, '93500.4', '95000.0', '93100.0', '94800.9', '1310.2'],
            ],
        }));
        expect(out.data).toEqual([
            { date: '2025-01-01', open: 93000.1, high: 94000.2, low: 92000.3, close: 93500.4, volume: 1200.5 },
            { date: '2025-01-02', open: 93500.4, high: 95000, low: 93100, close: 94800.9, volume: 1310.2 },
        ]);
        expect(out.action).toBeUndefined();
    });

    it('turns a draw request into a client action rather than a chart mutation here', async () => {
        const out = await executeTool(
            'drawTechnicalAnalysis',
            { type: 'support_resistance', levels: [93000, 95000], reasoning: 'swing pivots' },
            CRYPTO, deps({}),
        );
        expect(out.action).toEqual({
            type: 'support_resistance',
            args: { type: 'support_resistance', levels: [93000, 95000], reasoning: 'swing pivots' },
        });
        expect(String(out.data)).toContain('support_resistance');
    });

    it('reports a dead feed as an error the model can read, never as silence', async () => {
        const out = await executeTool('getFinancialStatements', {}, EQUITY, deps({}));
        expect(out.data).toEqual({ error: 'Financial statements not available for this asset.' });

        const bad = await executeTool('getChartData', { days: 5 }, CRYPTO, {
            getJson: async () => { throw new Error('binance timeout'); },
        });
        expect((bad.data as any).error).toContain('binance timeout');
    });

    it('rejects a tool it does not implement', async () => {
        const out = await executeTool('rugPull', {}, EQUITY, deps({}));
        expect(out.data).toEqual({ error: 'Unknown tool: rugPull' });
    });

    it('clamps the bar count and maps it to a Yahoo range', async () => {
        const seen: string[] = [];
        await executeTool('getChartData', { days: 9999 }, EQUITY, deps({ '/api/history': { chart: { result: [] } } }, seen));
        expect(seen[0]).toContain('range=2y');
        expect(yahooRange(30)).toBe('3mo');
        expect(yahooRange(150)).toBe('1y');
        expect(yahooRange(300)).toBe('2y');
    });

    it('drops Yahoo bars with a null close instead of emitting a hole', async () => {
        const out = await executeTool('getChartData', { days: 3 }, EQUITY, deps({
            '/api/history': {
                chart: {
                    result: [{
                        timestamp: [1735689600, 1735776000, 1735862400],
                        indicators: { quote: [{ open: [1, 2, 3], high: [2, 3, 4], low: [0, 1, 2], close: [1.5, null, 3.5], volume: [10, 20, null] }] },
                    }],
                },
            },
        }));
        expect(out.data).toEqual([
            { date: '2025-01-01', open: 1, high: 2, low: 0, close: 1.5, volume: 10 },
            { date: '2025-01-03', open: 3, high: 4, low: 2, close: 3.5, volume: 0 },
        ]);
    });
});

describe('row 4 — market-specific routing', () => {
    it('reads BVMT history + intraday for a Tunisian listing, in TND', async () => {
        const seen: string[] = [];
        const out: any = (await executeTool('getChartData', { days: 5 }, TN, deps({
            '/api/tn/history': { candles: [{ time: 1735689600, open: 10, high: 11, low: 9, close: 10.5, volume: 100 }] },
            '/api/tn/intraday': { candles: [{ t: 1, c: 10.6 }], prevClose: 10.4, last: 10.6 },
        }, seen))).data;
        expect(seen.some(u => u.includes('/api/tn/history?symbol=SAH'))).toBe(true);
        expect(seen.some(u => u.includes('/api/tn/intraday?symbol=SAH'))).toBe(true);
        expect(out.currency).toBe('TND');
        expect(out.dailyBars).toEqual([{ date: '2025-01-01', open: 10, high: 11, low: 9, close: 10.5, volume: 100 }]);
        expect(out.last).toBe(10.6);
    });

    it('states the BVMT fundamentals gap instead of filling it with a ratio', async () => {
        const out: any = (await executeTool('getFundamentalData', {}, TN, deps({
            '/api/tn/markets': { rows: [{ symbol: 'SAH', last: 10.6, volume: 5000 }] },
            '/api/tn/engine': { score: 61, factors: { momentum: 0.4 } },
        }))).data;
        expect(out.currency).toBe('TND');
        expect(out.engineScore).toBe(61);
        expect(out.note).toContain('not yet available for BVMT listings');
        expect(out).not.toHaveProperty('trailingPE');
    });

    it('says statements do not apply to crypto rather than returning an empty shell', async () => {
        const out = await executeTool('getFinancialStatements', {}, CRYPTO, deps({}));
        expect(out.data).toEqual({ error: 'Financial statements are not applicable for cryptocurrencies.' });
    });

    it('merges quote + fundamentals for an equity, and suffixes crypto for the quote feed', async () => {
        const seen: string[] = [];
        const out: any = (await executeTool('getFundamentalData', {}, EQUITY, deps({
            '/api/quote': { quoteResponse: { result: [{ regularMarketPrice: 231.4 }] } },
            '/api/fundamentals': { quoteSummary: { result: [{ trailingPE: 34.2 }] } },
        }, seen))).data;
        expect(out).toEqual({ regularMarketPrice: 231.4, trailingPE: 34.2 });

        const cryptoSeen: string[] = [];
        await executeTool('getFundamentalData', {}, CRYPTO, deps({ '/api/quote': { quoteResponse: { result: [{}] } } }, cryptoSeen));
        expect(cryptoSeen[0]).toContain('symbols=BTC-USD');
    });
});

// ── Row 6: absent tools leave the plain chat path untouched ─────────────────
// Asserted against the handler source: with no asset context the request
// carries no tool belt, and results never travel as a user-role turn.

describe('row 6 — no tools, no behavior change', () => {
    const handler = readFileSync(join(__dirname, '../../api/agent/[fn].ts'), 'utf8');

    it('offers the tool belt only when the caller sent an asset', () => {
        expect(handler).toMatch(/ctx \? \(tools \?\? TOOL_DEFS\) : \(tools \?\? \[\]\)/);
    });

    it('feeds tool results back as role:"tool" turns, never as a user message', () => {
        expect(handler).toMatch(/role: 'tool', tool_call_id: call\.id/);
        const userPushes = handler.match(/role: 'user'/g) ?? [];
        expect(userPushes).toEqual([]);
    });

    it('caps the server-side tool loop', () => {
        expect(handler).toMatch(/MAX_TOOL_LOOPS = 5/);
    });
});
