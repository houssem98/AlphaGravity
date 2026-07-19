// AC-1 regression tests — docs/GRID_AGENT_CELL_ROADMAP.md rows 1, 2, 3
// (fake clock, resolved/rejected/empty fns, bound + truncation).
// Run: npx vitest run src/services/gridTrace.test.ts

import { describe, it, expect } from 'vitest';
import { newTrace, traceSummary, TRACE_MAX_STEPS, TRACE_META_MAX } from './gridTrace';

// Fake monotonic clock: each fn advances it explicitly.
const mkClock = () => {
    const c = { t: 0, now: () => c.t, tick: (ms: number) => { c.t += ms; } };
    return c;
};

describe('gridTrace — newTrace', () => {
    it('row 1: records exactly the calls that executed — nothing invented', async () => {
        const clock = mkClock();
        const trace = newTrace(clock.now);
        await trace.step('Searching SEC filings', 'rag', async () => { clock.tick(120); return 'x'; });
        await trace.step('Analyzing', 'llm', async () => { clock.tick(80); return 'y'; });
        const steps = trace.done();
        expect(steps).toHaveLength(2);
        expect(steps.map(s => s.tool)).toEqual(['rag', 'llm']);
        expect(steps.every(s => s.status === 'ok')).toBe(true);
    });

    it('row 2: timings are real clock measurements', async () => {
        const clock = mkClock();
        const trace = newTrace(clock.now);
        await trace.step('a', 'rag', async () => { clock.tick(120); });
        await trace.step('b', 'marketQuote', async () => { clock.tick(35); });
        const steps = trace.done();
        expect(steps[0].ms).toBe(120);
        expect(steps[1].ms).toBe(35);
        expect(steps.every(s => s.ms > 0)).toBe(true);
        expect(traceSummary(steps).totalMs).toBe(155);
    });

    it('row 3: rejection → failed step with the real error, re-thrown; later steps still record', async () => {
        const clock = mkClock();
        const trace = newTrace(clock.now);
        await expect(
            trace.step('Fetching market data', 'marketQuote', async () => { clock.tick(50); throw new Error('HTTP 502'); }),
        ).rejects.toThrow('HTTP 502');
        await trace.step('Analyzing', 'llm', async () => { clock.tick(10); return 'ok'; });
        const steps = trace.done();
        expect(steps).toHaveLength(2);
        expect(steps[0].status).toBe('failed');
        expect(steps[0].error).toBe('HTTP 502');
        expect(steps[0].ms).toBe(50);
        expect(steps[1].status).toBe('ok');
    });

    it('empty detection: ran fine but returned nothing useful → status empty, not failed', async () => {
        const trace = newTrace(mkClock().now);
        await trace.step('Searching the web', 'webSearch', async () => [] as string[], { isEmpty: v => v.length === 0 });
        expect(trace.done()[0].status).toBe('empty');
    });

    it('meta captured and truncated to 500 chars', async () => {
        const trace = newTrace(mkClock().now);
        await trace.step('a', 'rag', async () => 'v', { meta: () => 'x'.repeat(600) });
        expect(trace.done()[0].meta).toHaveLength(TRACE_META_MAX);
    });

    it('bounded: never more than 12 steps survive done()', async () => {
        const trace = newTrace(mkClock().now);
        for (let i = 0; i < 15; i += 1) await trace.step(`s${i}`, 't', async () => i);
        expect(trace.done()).toHaveLength(TRACE_MAX_STEPS);
    });
});

describe('gridTrace — traceSummary', () => {
    it('counts ok (incl. empty), failed, and sums ms', () => {
        const s = traceSummary([
            { label: 'a', tool: 'rag', ms: 100, status: 'ok' },
            { label: 'b', tool: 'webSearch', ms: 40, status: 'empty' },
            { label: 'c', tool: 'marketQuote', ms: 60, status: 'failed', error: 'boom' },
        ]);
        expect(s).toEqual({ tools: 3, ok: 2, failed: 1, totalMs: 200 });
    });

    it('empty trace → zeros', () => {
        expect(traceSummary([])).toEqual({ tools: 0, ok: 0, failed: 0, totalMs: 0 });
    });
});
