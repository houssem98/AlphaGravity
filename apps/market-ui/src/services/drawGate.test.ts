// DX-5 regression tests — docs/AI_TRADING_AGENT_ROADMAP.md Section 6 row 8.
// The model may SELECT a level and explain it. It may not INVENT one.
import { describe, it, expect } from 'vitest';
import { gateDrawing, normalizeBars, executeTool, type AssetContext } from './dexterTools';
import { taLevels, candidateLevels, levelTolerance, nearestCandidate, type Bar } from './taLevels';

const bar = (date: string, open: number, high: number, low: number, close: number): Bar =>
    ({ date, open, high, low, close, volume: 1000 });

// Same golden series as taLevels.test.ts: pivots 112 / 90 / 120 / 88,
// ATR 15.52 → tolerance 7.76, support 89 and 112, resistance 120.
const FIXTURE: Bar[] = [
    bar('2026-01-01', 100, 104, 98, 103),
    bar('2026-01-02', 103, 106, 99, 105),
    bar('2026-01-05', 105, 112, 100, 110),
    bar('2026-01-06', 107, 108, 97, 99),
    bar('2026-01-07', 99, 107, 96, 105),
    bar('2026-01-08', 103, 104, 90, 92),
    bar('2026-01-09', 96, 110, 95, 108),
    bar('2026-01-12', 108, 115, 99, 113),
    bar('2026-01-13', 113, 120, 103, 118),
    bar('2026-01-14', 115, 116, 101, 104),
    bar('2026-01-15', 104, 112, 98, 100),
    bar('2026-01-16', 100, 105, 88, 90),
    bar('2026-01-19', 93, 108, 92, 106),
    bar('2026-01-20', 112, 114, 96, 98),
    bar('2026-01-21', 114, 125, 113, 123),
    bar('2026-01-22', 118, 122, 110, 115),
];

const TA = taLevels(FIXTURE);
const CRYPTO: AssetContext = { symbol: 'BTC', isTN: false, isCrypto: true };

describe('row 8 — the candidate set', () => {
    it('is exactly what the engine computed, deduped and sorted', () => {
        const c = candidateLevels(TA);
        expect(c).toEqual([...new Set(c)].sort((a, b) => a - b));
        for (const p of [112, 120, 88, 90, 89, 108, 113, 96, 114, 104]) {
            expect(c).toContain(p);
        }
    });

    it('scales its tolerance to the instrument', () => {
        expect(levelTolerance(TA)).toBeCloseTo(7.7602, 3);
        // No ATR (too few bars) → fall back to a fraction of price, not to zero.
        const shallow = taLevels(FIXTURE.slice(0, 6));
        expect(shallow.atr).toBeNull();
        expect(shallow.lastClose).toBe(92);           // close of 2026-01-08
        expect(levelTolerance(shallow)).toBeCloseTo(92 * 0.005, 6);
    });

    it('finds the nearest real level, or null when there are none', () => {
        expect(nearestCandidate(119, candidateLevels(TA))).toBe(120);
        expect(nearestCandidate(100, [])).toBeNull();
    });
});

describe('row 8 — refusal leaves the chart alone', () => {
    it('refuses a round number nobody traded', () => {
        const gate = gateDrawing(
            { type: 'support_resistance', levels: [150], reasoning: 'looks like resistance' },
            TA,
        );
        expect(gate.ok).toBe(false);
        expect(gate.args).toBeUndefined();
        expect(gate.reason).toContain('150');
        expect(gate.reason).toContain('nearest real level 120');
        expect(gate.reason).toContain('not from estimation');
    });

    it('refuses the whole request when any single level is invented', () => {
        const gate = gateDrawing(
            { type: 'support_resistance', levels: [112, 999], reasoning: 'mixed' },
            TA,
        );
        expect(gate.ok).toBe(false);
        expect(gate.reason).toContain('999');
        expect(gate.reason).not.toMatch(/^Refused: 112/);
    });

    it('refuses a pattern whose anchor points are invented', () => {
        const gate = gateDrawing({
            type: 'pattern',
            points: [{ time: '2026-01-05', price: 112, label: 'Left Shoulder' },
                     { time: '2026-01-13', price: 200, label: 'Head' }],
            reasoning: 'head and shoulders',
        }, TA);
        expect(gate.ok).toBe(false);
        expect(gate.reason).toContain('200');
    });

    it('refuses everything when there are no bars to verify against', () => {
        const gate = gateDrawing({ type: 'support_resistance', levels: [100], reasoning: 'x' }, taLevels([]));
        expect(gate.ok).toBe(false);
        expect(gate.reason).toContain('Call getChartData first');
    });

    it('names the real levels so the model can retry instead of guessing again', () => {
        const gate = gateDrawing({ type: 'support_resistance', levels: [150], reasoning: 'x' }, TA);
        expect(gate.reason).toContain('Real levels available:');
        for (const p of [88, 120]) expect(gate.reason).toContain(String(p));
    });
});

describe('row 8 — accepted levels are snapped to the engine, not to the model', () => {
    it('passes a level that is genuinely on the chart', () => {
        const gate = gateDrawing({ type: 'support_resistance', levels: [120], reasoning: 'swing high' }, TA);
        expect(gate.ok).toBe(true);
        expect(gate.args!.levels).toEqual([120]);
        expect(gate.snapped).toEqual([{ asked: 120, drawn: 120 }]);
    });

    it('snaps a near-miss to the exact computed price', () => {
        // 118 is inside the 7.76 tolerance of the real 120 swing high.
        const gate = gateDrawing({ type: 'support_resistance', levels: [118], reasoning: 'roughly the high' }, TA);
        expect(gate.ok).toBe(true);
        expect(gate.args!.levels).toEqual([120]);
        expect(gate.snapped).toEqual([{ asked: 118, drawn: 120 }]);
    });

    it('snaps pattern points while preserving their labels and times', () => {
        const gate = gateDrawing({
            type: 'pattern',
            points: [{ time: '2026-01-13', price: 119, label: 'Head' }],
            reasoning: 'top',
        }, TA);
        expect(gate.ok).toBe(true);
        expect(gate.args!.points).toEqual([{ time: '2026-01-13', price: 120, label: 'Head' }]);
    });

    it('lets a drawing with no numbers through untouched', () => {
        const args = { type: 'pattern', reasoning: 'annotation only' };
        expect(gateDrawing(args, TA)).toEqual({ ok: true, args });
    });
});

describe('row 8 — wired into the tool, chart untouched on refusal', () => {
    const deps = { getJson: async () => { throw new Error('unused'); }, getBars: async () => FIXTURE };

    it('emits no client action when the level is invented', async () => {
        const out = await executeTool('drawTechnicalAnalysis',
            { type: 'support_resistance', levels: [150], reasoning: 'vibes' }, CRYPTO, deps);
        expect(out.action).toBeUndefined();
        expect((out.data as any).error).toContain('nearest real level 120');
    });

    it('emits the action with snapped prices when the level is real', async () => {
        const out = await executeTool('drawTechnicalAnalysis',
            { type: 'support_resistance', levels: [118], reasoning: 'swing high' }, CRYPTO, deps);
        expect(out.action!.args.levels).toEqual([120]);
        expect(String(out.data)).toContain('118→120');
    });

    it('refuses rather than drawing blind when no bars were fetched', async () => {
        const out = await executeTool('drawTechnicalAnalysis',
            { type: 'support_resistance', levels: [120], reasoning: 'x' }, CRYPTO,
            { getJson: async () => ({}) });
        expect(out.action).toBeUndefined();
        expect((out.data as any).error).toContain('No price bars available');
    });
});

describe('row 8 — bar normalisation across the three feed shapes', () => {
    it('takes an equity/crypto array straight through', () => {
        expect(normalizeBars(FIXTURE)).toHaveLength(16);
    });

    it('unwraps the BVMT dailyBars envelope', () => {
        expect(normalizeBars({ currency: 'TND', dailyBars: FIXTURE.slice(0, 3) })).toHaveLength(3);
    });

    it('yields nothing for an error payload rather than a fake series', () => {
        expect(normalizeBars({ error: 'feed down' })).toEqual([]);
        expect(normalizeBars(null)).toEqual([]);
        expect(normalizeBars([{ open: NaN, high: 1, low: 1, close: 1 }])).toEqual([]);
    });
});
