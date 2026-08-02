// DI-10 regression tests — docs/DEXTER_INSTITUTIONAL_ROADMAP.md Section 6 row 14.
import { describe, it, expect } from 'vitest';
import {
    calibrationOf, brier, renderCalibration, MIN_CALIBRATION_N, type ScoredCall,
} from './dexterCalibration';

const calls = (n: number, confidence: number, winEvery: number): ScoredCall[] =>
    Array.from({ length: n }, (_, i) => ({ confidence, won: i % winEvery === 0 }));

describe('row 14 — Brier over journalled confidence vs realised outcomes', () => {
    it('scores a perfect forecaster at 0 and a perfectly wrong one at 1', () => {
        expect(brier([{ p: 1, outcome: 1 }, { p: 0, outcome: 0 }])).toBe(0);
        expect(brier([{ p: 1, outcome: 0 }, { p: 0, outcome: 1 }])).toBe(1);
        expect(brier([{ p: 0.5, outcome: 1 }, { p: 0.5, outcome: 0 }])).toBe(0.25);
        expect(brier([])).toBeNull();
    });

    it('computes the score over resolved calls only', () => {
        const c = calibrationOf([
            ...calls(MIN_CALIBRATION_N, 50, 2),
            { confidence: 90, won: null },   // still open
        ]);
        expect(c.n).toBe(MIN_CALIBRATION_N);
        expect(c.brier).toBe(0.25);
        expect(c.calibrated).toBe(true);
    });

    it('reports the base rate and the skill against it', () => {
        // 50% stated on every call, half of them right ⇒ no skill over the base rate.
        const c = calibrationOf(calls(24, 50, 2));
        expect(c.baseRate).toBe(0.5);
        expect(c.baseRateBrier).toBe(0.25);
        expect(c.skillScore).toBe(0);
    });

    it('gives a confident forecaster who is right credit over the base rate', () => {
        // 90% stated, right 3 of every 4 ⇒ base rate 0.75.
        const c = calibrationOf(Array.from({ length: 24 }, (_, i) => ({ confidence: 90, won: i % 4 !== 0 })));
        expect(c.baseRate).toBe(0.75);
        expect(c.brier!).toBeGreaterThan(0);
        // Stating 90 when the truth is 75 is worse than just stating the base rate.
        expect(c.skillScore!).toBeLessThan(0);
    });

    it('measures overconfidence as stated minus realised', () => {
        const over = calibrationOf(Array.from({ length: 24 }, (_, i) => ({ confidence: 90, won: i % 2 === 0 })));
        expect(over.overconfidence).toBeCloseTo(0.4, 4);
        expect(over.summary).toContain('overconfident');

        const under = calibrationOf(Array.from({ length: 24 }, (_, i) => ({ confidence: 20, won: i % 4 !== 0 })));
        expect(under.overconfidence!).toBeLessThan(0);
        expect(under.summary).toContain('underconfident');
    });

    it('buckets by stated confidence and shows where the gap is', () => {
        const mixed: ScoredCall[] = [
            ...Array.from({ length: 12 }, () => ({ confidence: 90, won: false })),   // wildly overconfident
            ...Array.from({ length: 12 }, () => ({ confidence: 50, won: true })),
        ];
        const c = calibrationOf(mixed);
        const high = c.buckets.find(b => b.range === '80-100%')!;
        expect(high.n).toBe(12);
        expect(high.stated).toBeCloseTo(0.9, 4);
        expect(high.realised).toBe(0);
        expect(high.gap).toBeCloseTo(-0.9, 4);
        expect(renderCalibration(c)).toContain('widest bucket 80-100%');
    });
});

describe('row 14 — an honest null below the sample floor', () => {
    it('refuses to score fewer than the floor', () => {
        const c = calibrationOf(calls(MIN_CALIBRATION_N - 1, 70, 2));
        expect(c.calibrated).toBe(false);
        expect(c.brier).toBeNull();
        expect(c.skillScore).toBeNull();
        expect(c.buckets).toEqual([]);
        expect(c.summary).toBe(`not yet calibrated (n=${MIN_CALIBRATION_N - 1} of ${MIN_CALIBRATION_N} resolved calls with a stated confidence)`);
    });

    it('says so in the rendered line rather than showing a number', () => {
        const line = renderCalibration(calibrationOf(calls(5, 70, 2)));
        expect(line).toContain('not yet calibrated (n=5 of 20');
        expect(line).not.toMatch(/Brier \d/);
    });

    it('does not count open positions towards the floor', () => {
        const c = calibrationOf(Array.from({ length: 40 }, () => ({ confidence: 70, won: null })));
        expect(c.n).toBe(0);
        expect(c.calibrated).toBe(false);
    });

    it('counts resolved calls with no stated confidence as unscored, not as zero', () => {
        const c = calibrationOf([
            ...calls(MIN_CALIBRATION_N, 60, 2),
            { confidence: null, won: true },
            { confidence: null, won: false },
        ]);
        expect(c.n).toBe(MIN_CALIBRATION_N);
        expect(c.unscored).toBe(2);
        expect(c.brier).not.toBeNull();
    });

    it('reports unscored calls in the refusal message too', () => {
        const c = calibrationOf([{ confidence: null, won: true }, { confidence: 50, won: false }]);
        expect(c.summary).toContain('1 resolved call(s) carried no confidence');
    });

    it('ignores a confidence outside 0-100 rather than clamping it', () => {
        const c = calibrationOf([...calls(MIN_CALIBRATION_N, 60, 2), { confidence: 140, won: true }]);
        expect(c.n).toBe(MIN_CALIBRATION_N);
        expect(c.unscored).toBe(1);
    });
});
