// DX-3 regression tests — docs/AI_TRADING_AGENT_ROADMAP.md Section 6 rows 5 and 6.
// The trace is a record, never a performance: a step exists iff its call ran.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newTrace, traceSummary, stepGlyph, TRACE_MAX_STEPS } from './gridTrace';
import { executeTool, isEmptyToolData, toolMeta, TOOL_LABEL, type AssetContext } from './dexterTools';

const CRYPTO: AssetContext = { symbol: 'BTC', isTN: false, isCrypto: true };

describe('row 5 — every executed call is recorded once, with real ms', () => {
    it('records one step per call, in order, with the injected clock', async () => {
        let t = 0;
        const trace = newTrace(() => (t += 40));
        await trace.step('Thinking', 'llm', async () => ({ text: 'hi', toolCalls: [] }));
        await trace.step('Reading price history', 'getChartData', async () => [1, 2, 3]);
        const steps = trace.done();

        expect(steps.map(s => [s.label, s.tool, s.status, s.ms])).toEqual([
            ['Thinking', 'llm', 'ok', 40],
            ['Reading price history', 'getChartData', 'ok', 40],
        ]);
    });

    it('records a thrown tool as failed with its real error, and re-throws', async () => {
        const trace = newTrace();
        await expect(
            trace.step('Reading price history', 'getChartData', () =>
                executeTool('getChartData', { days: 5 }, CRYPTO, {
                    getJson: async () => { throw new Error('binance timeout'); },
                })),
        ).rejects.toThrow('binance timeout');

        const [step] = trace.done();
        expect(step.status).toBe('failed');
        expect(step.error).toBe('binance timeout');
        expect(step.tool).toBe('getChartData');
    });

    it('never records a step for a call that did not run', async () => {
        const trace = newTrace();
        await trace.step('Thinking', 'llm', async () => ({ text: 'no tools needed', toolCalls: [] }));
        expect(trace.done()).toHaveLength(1);
    });

    it('separates "ran but empty" from "failed"', async () => {
        const trace = newTrace(() => 0);
        await trace.step('Reading fundamentals', 'getFundamentalData',
            () => executeTool('getFundamentalData', {}, { symbol: 'SAH', isTN: true, isCrypto: false }, {
                getJson: async (u: string) => (u.includes('markets') ? { rows: [] } : null),
            }),
            { isEmpty: o => isEmptyToolData(o.data), meta: o => toolMeta('getFundamentalData', o.data) });

        const [step] = trace.done();
        expect(step.status).toBe('empty');
        expect(step.error).toBeUndefined();
        expect(step.meta).toBe('Symbol not found on the BVMT board.');
    });

    it('summarises a mixed trace honestly', async () => {
        const trace = newTrace(() => 0);
        await trace.step('a', 'llm', async () => 'x');
        await trace.step('b', 'getChartData', async () => [], { isEmpty: (v: unknown[]) => v.length === 0 });
        await trace.step('c', 'getFundamentalData', async () => { throw new Error('down'); }).catch(() => {});

        expect(traceSummary(trace.done())).toEqual({ tools: 3, ok: 2, failed: 1, totalMs: 0 });
        expect([stepGlyph('ok'), stepGlyph('empty'), stepGlyph('failed')]).toEqual(['✓', '∅', '✗']);
    });

    it('caps a runaway trace at the gridTrace ceiling', async () => {
        const trace = newTrace(() => 0);
        for (let i = 0; i < TRACE_MAX_STEPS + 6; i++) await trace.step(`s${i}`, 'llm', async () => i);
        expect(trace.done()).toHaveLength(TRACE_MAX_STEPS);
    });
});

describe('row 5 — step classification helpers', () => {
    it('treats an error payload as empty, not as a failure', () => {
        expect(isEmptyToolData({ error: 'Symbol not found on the BVMT board.' })).toBe(true);
        expect(isEmptyToolData([])).toBe(true);
        expect(isEmptyToolData({})).toBe(true);
        expect(isEmptyToolData(null)).toBe(true);
        expect(isEmptyToolData({ dailyBars: [], todayIntraday15m: [] })).toBe(true);
        expect(isEmptyToolData({ dailyBars: [], todayIntraday15m: [{ c: 1 }] })).toBe(false);
        expect(isEmptyToolData([{ close: 1 }])).toBe(false);
        expect(isEmptyToolData({ trailingPE: 34.2 })).toBe(false);
    });

    it('writes a short factual note, never the payload', () => {
        expect(toolMeta('getChartData', [1, 2, 3])).toBe('3 bars');
        expect(toolMeta('getChartData', { dailyBars: [1], todayIntraday15m: [1, 2] })).toBe('1 daily bars, 2 intraday');
        expect(toolMeta('getFundamentalData', { a: 1, b: 2 })).toBe('2 fields');
        expect(toolMeta('getFundamentalData', { error: 'BVMT feed unreachable.' })).toBe('BVMT feed unreachable.');
    });

    it('labels every implemented tool with a user-facing verb', () => {
        for (const name of ['getChartData', 'getFundamentalData', 'getFinancialStatements', 'drawTechnicalAnalysis']) {
            expect(TOOL_LABEL[name]).toMatch(/^[A-Z]/);
        }
    });
});

describe('row 6 — the trace never changes behavior', () => {
    const handler = readFileSync(join(__dirname, '../../api/agent/[fn].ts'), 'utf8');

    it('wraps both the model turn and every tool call', () => {
        expect(handler).toMatch(/trace\.step\(\s*\n?\s*loop === 0 \? 'Thinking'/);
        expect(handler).toMatch(/TOOL_LABEL\[call\.name\]/);
    });

    it('converts a traced failure into an honest message rather than a guess', () => {
        expect(handler).toMatch(/failed: \$\{e\?\.message/);
    });

    it('ships the trace on the error path too', () => {
        expect(handler).toMatch(/status\(502\)\.json\(\{ error: e\.message, steps: trace\.done\(\) \}\)/);
    });
});
