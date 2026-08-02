// DI-4 regression tests — docs/DEXTER_INSTITUTIONAL_ROADMAP.md Section 6 rows 6-7.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    signalFrom, signalFromBars, arbitrate, describeSignal,
    MIN_TOUCHES, BREAKOUT_ATR, NEAR_ATR, INVERSION_PENALTY,
    type Signal, type LlmView,
} from './dexterSignal';
import type { TaLevels, Level } from './taLevels';

const level = (price: number, touches: number, kind: 'support' | 'resistance'): Level =>
    ({ price, touches, kind, dates: [] });

const ta = (over: Partial<TaLevels> = {}): TaLevels => ({
    bars: 120,
    lastClose: 100,
    atr: 4,
    trend: 'range',
    pivots: [],
    support: [],
    resistance: [],
    orderBlocks: [],
    fairValueGaps: [],
    fib: null,
    ...over,
});

describe('row 6 — a direction comes out of bars alone', () => {
    it('imports no model, no prompt and no network in the signal path', () => {
        const src = readFileSync(join(__dirname, 'dexterSignal.ts'), 'utf8');
        const imports = src.split('\n').filter(l => /^\s*import\b/.test(l)).join('\n');
        for (const forbidden of ['dexterLlm', 'dexterGraph', 'dexterDebate', 'dexterRisk', 'dexterTools']) {
            expect(imports).not.toContain(forbidden);
        }
        // The only thing it imports is the deterministic TA engine.
        expect(imports).toContain("from './taLevels.js'");
        expect(src).not.toContain('fetch(');
    });

    it('reads a break above held resistance as long', () => {
        const s = signalFrom(ta({ lastClose: 102, resistance: [level(100, 3, 'resistance')] }));
        expect(s.direction).toBe('long');
        expect(s.playbook).toBe('breakout');
        expect(s.reasons[0]).toContain('0.5 ATR beyond the resistance at 100');
        expect(s.reasons[0]).toContain('3 touches');
    });

    it('reads a break below held support as short', () => {
        const s = signalFrom(ta({ lastClose: 98, support: [level(100, 2, 'support')] }));
        expect(s.direction).toBe('short');
        expect(s.playbook).toBe('breakout');
    });

    it('needs a real break, not a graze', () => {
        // 0.2 ATR past the level, under the 0.25 threshold.
        const s = signalFrom(ta({ lastClose: 100.8, resistance: [level(100, 3, 'resistance')], trend: 'range' }));
        expect(s.playbook).not.toBe('breakout');
    });

    it('ignores a level that has not been touched enough to be structure', () => {
        const s = signalFrom(ta({ lastClose: 102, resistance: [level(100, MIN_TOUCHES - 1, 'resistance')] }));
        expect(s.playbook).not.toBe('breakout');
    });

    it('follows the pivot sequence when there is no break', () => {
        const up = signalFrom(ta({ trend: 'up', lastClose: 100, support: [level(96, 3, 'support')] }));
        expect(up).toMatchObject({ direction: 'long', playbook: 'trend' });
        expect(up.reasons[1]).toContain('support at 96');

        const down = signalFrom(ta({ trend: 'down', lastClose: 100, resistance: [level(104, 2, 'resistance')] }));
        expect(down).toMatchObject({ direction: 'short', playbook: 'trend' });
    });

    it('takes the fade only inside a range, and only at a level', () => {
        const atSupport = signalFrom(ta({ trend: 'range', lastClose: 101, support: [level(100, 3, 'support')] }));
        expect(atSupport).toMatchObject({ direction: 'long', playbook: 'mean-reversion' });
        expect(atSupport.reasons[0]).toContain(`within ${NEAR_ATR} ATR`);

        const midRange = signalFrom(ta({ trend: 'range', lastClose: 110, support: [level(100, 3, 'support')] }));
        expect(midRange).toMatchObject({ direction: 'flat', playbook: 'none' });
    });

    it('never runs mean reversion inside a trend', () => {
        const s = signalFrom(ta({ trend: 'down', lastClose: 101, support: [level(100, 4, 'support')] }));
        expect(s.playbook).toBe('trend');
        expect(s.direction).toBe('short');
    });

    it('stands flat rather than guessing when structure is missing', () => {
        expect(signalFrom(ta({ atr: null })).direction).toBe('flat');
        expect(signalFrom(ta({ lastClose: null })).direction).toBe('flat');
        expect(signalFrom(ta({ atr: 0 })).reasons[0]).toContain('not enough bars');
        expect(signalFrom(ta({ trend: 'range' })).reasons[0]).toContain('no held level in reach');
    });

    it('is a pure function of the levels — same input, same output', () => {
        const input = ta({ lastClose: 102, resistance: [level(100, 3, 'resistance')] });
        expect(signalFrom(input)).toEqual(signalFrom(input));
    });

    it('runs straight off bars with no other dependency', () => {
        const bars = Array.from({ length: 60 }, (_, i) => ({
            date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
            open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 1,
        }));
        const s = signalFromBars(bars);
        expect(['long', 'short', 'flat']).toContain(s.direction);
        expect(s.evidence.atr).not.toBeNull();
    });

    it('cites the number behind every reason', () => {
        const s = signalFrom(ta({ lastClose: 102, resistance: [level(100, 4, 'resistance')] }));
        expect(s.evidence).toMatchObject({ lastClose: 102, atr: 4, level: 100, touches: 4 });
        expect(describeSignal(s)).toContain('LONG · breakout · conviction');
    });

    it('keeps conviction inside its stated bounds for every playbook', () => {
        const cases: Signal[] = [
            signalFrom(ta({ lastClose: 102, resistance: [level(100, 9, 'resistance')] })),
            signalFrom(ta({ trend: 'up', support: [level(96, 9, 'support')] })),
            signalFrom(ta({ trend: 'range', lastClose: 101, support: [level(100, 9, 'support')] })),
        ];
        expect(cases.map(c => c.playbook)).toEqual(['breakout', 'trend', 'mean-reversion']);
        expect(cases[0].strength).toBeLessThanOrEqual(0.9);
        expect(cases[1].strength).toBeLessThanOrEqual(0.7);
        expect(cases[2].strength).toBeLessThanOrEqual(0.6);
        for (const c of cases) expect(c.strength).toBeGreaterThan(0);
    });
});

describe('row 7 — the model may veto or downgrade, never invert', () => {
    const long: Signal = signalFrom(ta({ lastClose: 102, resistance: [level(100, 3, 'resistance')] }));
    const view = (direction: LlmView['direction'], reason: string, confidence?: number): LlmView =>
        ({ direction, reason, confidence });

    it('accepts agreement without touching conviction', () => {
        const a = arbitrate(long, view('long', 'breadth confirms'));
        expect(a.arbitration).toBe('accepted');
        expect(a.direction).toBe('long');
        expect(a.strength).toBe(long.strength);
        expect(a.reasons.at(-1)).toContain('model agrees: breadth confirms');
    });

    it('lets the model stand the trade down entirely', () => {
        const a = arbitrate(long, view('flat', 'CPI lands tomorrow'));
        expect(a.arbitration).toBe('vetoed');
        expect(a.direction).toBe('flat');
        expect(a.strength).toBe(0);
        expect(a.reasons.at(-1)).toContain('VETOED by the model: CPI lands tomorrow');
    });

    it('lets the model cut conviction while keeping the direction', () => {
        const a = arbitrate(long, view('long', 'thin volume', 0.3));
        expect(a.arbitration).toBe('downgraded');
        expect(a.direction).toBe('long');
        expect(a.strength).toBe(0.3);
        expect(a.reasons.at(-1)).toContain('downgraded');
    });

    it('will not treat a higher model confidence as an upgrade', () => {
        const a = arbitrate(long, view('long', 'very sure', 0.99));
        expect(a.arbitration).toBe('accepted');
        expect(a.strength).toBe(long.strength);
    });

    it('REJECTS an inversion, keeps the deterministic direction and records the attempt', () => {
        const a = arbitrate(long, view('short', 'the chart looks toppy to me'));
        expect(a.arbitration).toBe('inversion-rejected');
        expect(a.direction).toBe('long');
        expect(a.strength).toBe(Number((long.strength * INVERSION_PENALTY).toFixed(2)));
        const recorded = a.reasons.at(-1)!;
        expect(recorded).toContain('INVERSION REJECTED');
        expect(recorded).toContain('the chart looks toppy to me');
        expect(recorded).toContain('never reverse it');
    });

    it('rejects the inversion in both directions', () => {
        const short = signalFrom(ta({ lastClose: 98, support: [level(100, 3, 'support')] }));
        const a = arbitrate(short, view('long', 'oversold'));
        expect(a.arbitration).toBe('inversion-rejected');
        expect(a.direction).toBe('short');
    });

    it('keeps the model view on the record whether or not it was adopted', () => {
        for (const v of [view('long', 'agree'), view('flat', 'stand down'), view('short', 'flip it')]) {
            expect(arbitrate(long, v).modelView).toBe(v);
        }
    });

    it('has nothing to arbitrate when the signal is already flat', () => {
        const nothing = signalFrom(ta({ trend: 'range' }));
        const a = arbitrate(nothing, view('long', 'I like it here'));
        expect(a.arbitration).toBe('accepted');
        expect(a.direction).toBe('flat');
        expect(a.reasons.at(-1)).toBe('no signal to arbitrate');
    });

    it('never mutates the signal it was handed', () => {
        const before = JSON.stringify(long);
        arbitrate(long, view('short', 'flip it'));
        arbitrate(long, view('flat', 'stand down'));
        expect(JSON.stringify(long)).toBe(before);
    });
});
