// DI-7 regression tests — docs/DEXTER_INSTITUTIONAL_ROADMAP.md Section 6 row 11.
import { describe, it, expect } from 'vitest';
import {
    classifyRegime, allowsPlaybook, allowedPlaybooks, explainGate, slope,
    REGIME_LOOKBACK, TREND_DRIFT_ATR, VOLATILE_RATIO, MIN_BARS,
} from './dexterRegime';
import type { Bar } from './taLevels';

const bar = (i: number, close: number, range: number): Bar => ({
    date: `2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
    open: close,
    high: close + range / 2,
    low: close - range / 2,
    close,
    volume: 1,
});

/** A calm series drifting `step` per bar with a steady `range` per bar. */
const series = (n: number, from: number, step: number, range: number): Bar[] =>
    Array.from({ length: n }, (_, i) => bar(i, from + step * i, range));

/** Alternating closes: no drift, steady range. */
const choppy = (n: number, mid: number, amp: number, range: number): Bar[] =>
    Array.from({ length: n }, (_, i) => bar(i, mid + (i % 2 ? amp : -amp), range));

describe('row 11 — a regime is named from bars alone', () => {
    it('names a rising tape trending-up', () => {
        const r = classifyRegime(series(80, 100, 1.5, 2));
        expect(r.regime).toBe('trending-up');
        expect(r.driftAtr!).toBeGreaterThanOrEqual(TREND_DRIFT_ATR);
    });

    it('names a falling tape trending-down', () => {
        const r = classifyRegime(series(80, 300, -1.5, 2));
        expect(r.regime).toBe('trending-down');
        expect(r.driftAtr!).toBeLessThanOrEqual(-TREND_DRIFT_ATR);
    });

    it('names a flat tape ranging', () => {
        const r = classifyRegime(choppy(80, 100, 0.4, 2));
        expect(r.regime).toBe('ranging');
        expect(Math.abs(r.driftAtr!)).toBeLessThan(TREND_DRIFT_ATR);
    });

    it('names an expanding tape volatile even when it is also drifting', () => {
        // Calm for 60 bars, then the daily range triples.
        const bars = [...series(60, 100, 0.5, 2), ...series(REGIME_LOOKBACK, 130, 0.5, 12)];
        const r = classifyRegime(bars);
        expect(r.volRatio!).toBeGreaterThanOrEqual(VOLATILE_RATIO);
        expect(r.regime).toBe('volatile');
    });

    it('refuses to name a regime it cannot measure', () => {
        const r = classifyRegime(series(MIN_BARS - 1, 100, 1, 2));
        expect(r.regime).toBe('unknown');
        expect(r.driftAtr).toBeNull();
        expect(r.reasons[0]).toContain(`under the ${MIN_BARS}-bar floor`);
    });

    it('reports the numbers it judged on', () => {
        const r = classifyRegime(series(80, 100, 1.5, 2));
        expect(r.reasons[0]).toContain('ATR/bar over the last 20 bars');
        expect(r.reasons[1]).toContain("prior baseline ATR");
        expect(r.reasons.at(-1)).toContain('trending-up');
    });

    it('computes a least-squares slope, not a first-to-last difference', () => {
        expect(slope([1, 2, 3, 4, 5])).toBeCloseTo(1, 9);
        expect(slope([5, 4, 3, 2, 1])).toBeCloseTo(-1, 9);
        // A spike at the end must not drag the slope the way an endpoint diff would.
        expect(slope([1, 1, 1, 1, 9])).toBeLessThan(slope([1, 3, 5, 7, 9])!);
        expect(slope([3])).toBeNull();
    });
});

describe('row 11 — the label is stable under a one-bar perturbation', () => {
    const perturbations = [0.5, -0.5, 1.5, -1.5, 3, -3];

    const perturb = (bars: Bar[], index: number, delta: number): Bar[] =>
        bars.map((b, i) => (i === index ? { ...b, close: b.close + delta, high: b.high + delta, low: b.low + delta } : b));

    for (const [name, bars] of [
        ['trending-up', series(80, 100, 1.5, 2)],
        ['trending-down', series(80, 300, -1.5, 2)],
        ['ranging', choppy(80, 100, 0.4, 2)],
    ] as Array<[string, Bar[]]>) {
        it(`holds ${name} when any single bar moves`, () => {
            const base = classifyRegime(bars).regime;
            expect(base).toBe(name);
            for (const delta of perturbations) {
                for (const index of [0, 40, bars.length - 5, bars.length - 1]) {
                    expect(classifyRegime(perturb(bars, index, delta)).regime).toBe(base);
                }
            }
        });
    }

    it('moves the measurement a little, not the label', () => {
        const bars = series(80, 100, 1.5, 2);
        const before = classifyRegime(bars);
        const after = classifyRegime(perturb(bars, 70, 2));
        expect(after.regime).toBe(before.regime);
        expect(Math.abs(after.driftAtr! - before.driftAtr!)).toBeLessThan(0.1);
    });

    it('is a pure function of the bars', () => {
        const bars = series(80, 100, 1.5, 2);
        expect(classifyRegime(bars)).toEqual(classifyRegime(bars));
    });
});

describe('row 11 — the regime gates which playbook may fire', () => {
    it('forbids mean reversion inside a trend', () => {
        for (const regime of ['trending-up', 'trending-down'] as const) {
            expect(allowsPlaybook(regime, 'mean-reversion')).toBe(false);
            expect(allowsPlaybook(regime, 'trend')).toBe(true);
            expect(allowsPlaybook(regime, 'breakout')).toBe(true);
        }
    });

    it('forbids trend following inside a range', () => {
        expect(allowsPlaybook('ranging', 'trend')).toBe(false);
        expect(allowsPlaybook('ranging', 'mean-reversion')).toBe(true);
        expect(allowsPlaybook('ranging', 'breakout')).toBe(true);
    });

    it('allows only breakouts in a volatile tape', () => {
        expect(allowedPlaybooks('volatile')).toEqual(['breakout']);
        expect(allowsPlaybook('volatile', 'trend')).toBe(false);
        expect(allowsPlaybook('volatile', 'mean-reversion')).toBe(false);
    });

    it('permits nothing at all when the regime is unknown', () => {
        expect(allowedPlaybooks('unknown')).toEqual([]);
        for (const p of ['trend', 'breakout', 'mean-reversion'] as const) {
            expect(allowsPlaybook('unknown', p)).toBe(false);
        }
    });

    it('never gates a flat signal, which needs no permission', () => {
        for (const regime of ['trending-up', 'ranging', 'volatile', 'unknown'] as const) {
            expect(allowsPlaybook(regime, 'none')).toBe(true);
        }
    });

    it('explains a refusal with what would have been allowed', () => {
        expect(explainGate('ranging', 'trend')).toBe('trend is not permitted in a ranging regime (allowed: mean-reversion, breakout)');
        expect(explainGate('unknown', 'trend')).toContain('allowed: none');
        expect(explainGate('trending-up', 'trend')).toBe('trend is permitted in a trending-up regime');
    });
});
