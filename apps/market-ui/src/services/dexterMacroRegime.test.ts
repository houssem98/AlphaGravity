// DI-7 macro extension tests — docs/DEXTER_INSTITUTIONAL_ROADMAP.md G13 / DI-7.
import { describe, it, expect, beforeEach } from 'vitest';
import {
    percentileOf, classifyMacro, gateWithMacro, describeMacro,
    STRESS_PERCENTILE, CALM_PERCENTILE, MIN_HISTORY, MACRO_TTL_MS,
    readMacro, resetMacroCache,
    type MacroHistory,
} from './dexterMacroRegime';
import { allowedPlaybooks, type Regime } from './dexterRegime';

/** 0..99 — a flat distribution makes the percentile of `n` exactly n%. */
const flat = (n = 100): number[] => Array.from({ length: n }, (_, i) => i);

const HISTORY: MacroHistory = { vix: flat(), hySpread: flat(), yieldSpread: flat() };

describe('thresholds are percentiles of a series own history, not constants', () => {
    it('places a reading in its own distribution', () => {
        expect(percentileOf(50, flat())).toBe(51);   // 0..50 inclusive is 51 of 100
        expect(percentileOf(0, flat())).toBe(1);
        expect(percentileOf(99, flat())).toBe(100);
    });

    it('is scale-free — the same shape at any magnitude', () => {
        const small = flat().map(v => v / 1000);
        const large = flat().map(v => v * 1_000_000);
        expect(percentileOf(50 / 1000, small)).toBe(percentileOf(50 * 1_000_000, large));
    });

    it('refuses a percentile with too little history rather than guessing', () => {
        expect(percentileOf(50, flat(MIN_HISTORY - 1))).toBeNull();
        expect(percentileOf(50, [])).toBeNull();
        expect(percentileOf(50, undefined)).toBeNull();
    });

    it('refuses to place a reading that is not a number', () => {
        expect(percentileOf(null, flat())).toBeNull();
        expect(percentileOf(undefined, flat())).toBeNull();
        expect(percentileOf(NaN, flat())).toBeNull();
    });
});

describe('the macro read', () => {
    it('calls the top quintile of volatility stressed', () => {
        const r = classifyMacro({ vix: STRESS_PERCENTILE, hySpread: 10 }, HISTORY);
        expect(r.regime).toBe('stressed');
        expect(r.reasons.at(-1)).toContain(`${STRESS_PERCENTILE}th percentile`);
    });

    it('calls the top quintile of credit stressed even when volatility is quiet', () => {
        expect(classifyMacro({ vix: 5, hySpread: 95 }, HISTORY).regime).toBe('stressed');
    });

    it('calls the bottom quintile calm only when credit agrees', () => {
        expect(classifyMacro({ vix: 10, hySpread: 20 }, HISTORY).regime).toBe('calm');
        // Quiet vol, but credit above its median — not calm.
        expect(classifyMacro({ vix: 10, hySpread: 70 }, HISTORY).regime).toBe('normal');
    });

    it('calls the middle normal', () => {
        expect(classifyMacro({ vix: 50, hySpread: 50 }, HISTORY).regime).toBe('normal');
    });

    it('treats an absent reading as unknown, never as fine', () => {
        const r = classifyMacro({}, HISTORY);
        expect(r.regime).toBe('unknown');
        expect(r.reasons.at(-1)).toContain('adds no constraint');

        const thin = classifyMacro({ vix: 50, hySpread: 50 }, { vix: flat(10), hySpread: flat(10) });
        expect(thin.regime).toBe('unknown');
    });

    it('reports curve inversion without gating on it', () => {
        const inverted = classifyMacro({ vix: 50, hySpread: 50, yieldSpread: -0.3 }, HISTORY);
        expect(inverted.curveInverted).toBe(true);
        expect(inverted.reasons.join(' ')).toContain('INVERTED');
        expect(inverted.reasons.join(' ')).toContain('not gated');
        expect(inverted.regime).toBe('normal');   // inversion alone changes nothing

        expect(classifyMacro({ vix: 50, hySpread: 50 }, HISTORY).curveInverted).toBeNull();
    });

    it('states every percentile it judged on', () => {
        const r = classifyMacro({ vix: 90, hySpread: 40, yieldSpread: 0.5 }, HISTORY);
        expect(r.percentiles.vix).toBe(91);
        expect(r.percentiles.hySpread).toBe(41);
        expect(describeMacro(r)).toContain('91th percentile');
    });
});

describe('macro may only restrict the bars-only gate, never widen it', () => {
    const REGIMES: Regime[] = ['trending-up', 'trending-down', 'ranging', 'volatile', 'unknown'];
    const stressed = classifyMacro({ vix: 95, hySpread: 95 }, HISTORY);
    const calm = classifyMacro({ vix: 5, hySpread: 5 }, HISTORY);
    const normal = classifyMacro({ vix: 50, hySpread: 50 }, HISTORY);
    const unknown = classifyMacro({}, {});

    it('is an intersection — the result is always a subset of the bars-only set', () => {
        for (const regime of REGIMES) {
            for (const macro of [stressed, calm, normal, unknown]) {
                const base = allowedPlaybooks(regime);
                const gate = gateWithMacro(regime, macro);
                expect(gate.allowed.every(p => base.includes(p))).toBe(true);
                expect(gate.allowed.length).toBeLessThanOrEqual(base.length);
            }
        }
    });

    it('drops the fade and trend-following under stress', () => {
        const gate = gateWithMacro('ranging', stressed);
        expect(gate.allowed).toEqual(['breakout']);
        expect(gate.removed).toEqual(['mean-reversion']);
        expect(gate.reasons.at(-1)).toContain('never widen it');

        expect(gateWithMacro('trending-up', stressed).removed).toEqual(['trend']);
    });

    it('adds nothing when macro is calm, normal or unknown', () => {
        for (const macro of [calm, normal, unknown]) {
            for (const regime of REGIMES) {
                const gate = gateWithMacro(regime, macro);
                expect(gate.allowed).toEqual(allowedPlaybooks(regime));
                expect(gate.removed).toEqual([]);
            }
        }
    });

    it('cannot resurrect a playbook the bars-only regime already refused', () => {
        // `unknown` bars-regime permits nothing; no macro state may change that.
        for (const macro of [stressed, calm, normal, unknown]) {
            expect(gateWithMacro('unknown', macro).allowed).toEqual([]);
        }
    });

    it('says what it removed and why', () => {
        const gate = gateWithMacro('ranging', stressed);
        expect(gate.reasons[0]).toContain('macro regime stressed permits [breakout]');
        expect(gate.reasons[0]).toContain('a ranging tape permitted [mean-reversion, breakout]');
    });
});

describe('the macro read fails open', () => {
    const ids = { vix: 'VIXCLS', hy: 'BAMLH0A0HYM2', curve: 'T10Y2Y' };
    beforeEach(() => resetMacroCache());

    it('returns unknown when the feed throws, never a constraint', async () => {
        const read = await readMacro({ series: async () => { throw new Error('HTTP 503'); } }, ids);
        expect(read.regime).toBe('unknown');
        expect(gateWithMacro('ranging', read).removed).toEqual([]);
    });

    it('returns unknown when the feed is empty rather than inventing a percentile', async () => {
        const read = await readMacro({ series: async () => [] }, ids);
        expect(read.regime).toBe('unknown');
    });

    it('classifies from real-shaped series when the feed answers', async () => {
        const read = await readMacro({ series: async () => [...flat(), 95] }, ids);
        expect(read.regime).toBe('stressed');
        expect(read.percentiles.vix).not.toBeNull();
    });

    it('caches so a decision does not re-fetch ten years of history each time', async () => {
        let calls = 0;
        const deps = { series: async () => { calls++; return [...flat(), 50]; } };
        await readMacro(deps, ids);
        await readMacro(deps, ids);
        expect(calls).toBe(3);   // three series, fetched once
    });

    it('re-fetches once the cache has expired', async () => {
        let calls = 0;
        let t = 0;
        const deps = { series: async () => { calls++; return [...flat(), 50]; }, now: () => t };
        await readMacro(deps, ids);
        t += MACRO_TTL_MS + 1;
        await readMacro(deps, ids);
        expect(calls).toBe(6);
    });
});
