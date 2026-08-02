// DI-5 regression tests — docs/DEXTER_INSTITUTIONAL_ROADMAP.md Section 6 rows 8-9.
import { describe, it, expect } from 'vitest';
import {
    computeSize, applySizing, kellyRiskPct,
    DEFAULT_RISK_BUDGET_PCT, MAX_POSITION_PCT, KELLY_FRACTION, MIN_TRACK_RECORD, MIN_STOP_ATR,
    type SizingInputs, type TrackRecord,
} from './dexterSizing';

// Equity 100k, BTC at 70k, stop 3750 below (1.5xATR on a 2500 ATR).
const BASE: SizingInputs = { equity: 100_000, entry: 70_000, stop: 66_250, atr: 2500 };

describe('row 8 — size is computed from ATR, risk budget and equity', () => {
    it('risks exactly the budget when nothing else binds', () => {
        const s = computeSize({ ...BASE, riskBudgetPct: 1 });
        // 1% of 100k = 1000 risked / 3750 per unit = 0.2667 units * 70k = 18,666.67 notional
        expect(s.units).toBeCloseTo(1000 / 3750, 6);
        expect(s.notional).toBeCloseTo(18_666.67, 1);
        expect(s.sizePct).toBeCloseTo(18.67, 2);
        expect(s.riskPct).toBe(1);
        expect(s.gap).toBeNull();
    });

    it('scales inversely with stop distance — a wider stop is a smaller position', () => {
        const tight = computeSize({ ...BASE, stop: 66_250, riskBudgetPct: 1 });
        const wide = computeSize({ ...BASE, stop: 62_500, riskBudgetPct: 1 });
        expect(wide.sizePct).toBeLessThan(tight.sizePct);
        expect(wide.riskPct).toBe(tight.riskPct);   // same risk, different size
    });

    it('scales with equity', () => {
        const small = computeSize({ ...BASE, equity: 10_000 });
        const large = computeSize({ ...BASE, equity: 100_000 });
        expect(small.notional * 10).toBeCloseTo(large.notional, 0);
        expect(small.sizePct).toBeCloseTo(large.sizePct, 6);
    });

    it('sizes on the ATR floor when the stop is tighter than the noise', () => {
        // 500-wide stop against a 2500 ATR: the floor is 3750.
        const s = computeSize({ ...BASE, stop: 69_500, atr: 2500, riskBudgetPct: 1 });
        expect(s.riskPerUnit).toBe(2500 * MIN_STOP_ATR);
        expect(s.caps).toContain('atr-floor');
        expect(s.reasons.join(' ')).toContain('sized on the floor, not on the tighter stop');
    });

    it('does not inflate a position off an understated stop', () => {
        const honest = computeSize({ ...BASE, stop: 66_250, atr: 2500 });
        const understated = computeSize({ ...BASE, stop: 69_500, atr: 2500 });
        expect(understated.sizePct).toBeCloseTo(honest.sizePct, 6);
    });

    it('uses the real stop when it is wider than the floor', () => {
        const s = computeSize({ ...BASE, stop: 60_000, atr: 2500 });
        expect(s.riskPerUnit).toBe(10_000);
        expect(s.caps).not.toContain('atr-floor');
    });

    it('refuses to size rather than guessing when an input is missing', () => {
        expect(computeSize({ ...BASE, equity: 0 }).gap).toBe('no equity to size against');
        expect(computeSize({ ...BASE, entry: 0 }).gap).toBe('no entry price to size against');
        expect(computeSize({ ...BASE, stop: 70_000 }).gap).toContain('no risk per unit');
        expect(computeSize({ ...BASE, riskBudgetPct: 0 }).gap).toContain('risk budget is zero');
        for (const bad of ['no equity to size against']) expect(computeSize({ ...BASE, equity: -1 }).gap).toBe(bad);
    });

    it('defaults the budget rather than requiring every caller to state it', () => {
        expect(computeSize(BASE).riskPct).toBe(DEFAULT_RISK_BUDGET_PCT);
    });
});

describe('row 8 — a model-supplied size is discarded, not weighed', () => {
    it('substitutes the computed size and records what was thrown away', () => {
        const p = applySizing(95, { ...BASE, riskBudgetPct: 1 });
        expect(p.sizePct).toBeCloseTo(18.67, 2);
        expect(p.modelSizePct).toBe(95);
        expect(p.note).toContain("the model's 95% was discarded");
    });

    it('ignores the model whether it asked for more or for less', () => {
        const greedy = applySizing(99, BASE);
        const timid = applySizing(0.1, BASE);
        expect(greedy.sizePct).toBe(timid.sizePct);
        expect(greedy.sizePct).toBe(computeSize(BASE).sizePct);
    });

    it('never falls back to the model size when it cannot compute one', () => {
        const p = applySizing(5, { ...BASE, equity: 0 });
        expect(p.sizePct).toBe(0);
        expect(p.note).toContain('not substituted');
    });

    it('works with no model size at all', () => {
        const p = applySizing(null, BASE);
        expect(p.modelSizePct).toBeNull();
        expect(p.note).not.toContain('discarded');
    });
});

describe('row 9 — Kelly cap and hard per-position maximum', () => {
    const track = (over: Partial<TrackRecord> = {}): TrackRecord =>
        ({ n: 40, winRate: 0.5, payoff: 2, ...over });

    it('computes half-Kelly from the track record', () => {
        // W 0.5, R 2 ⇒ f* = 0.5 - 0.5/2 = 0.25 ⇒ half-Kelly 12.5%
        expect(kellyRiskPct(track())).toBe(12.5);
        expect(KELLY_FRACTION).toBe(0.5);
    });

    it('refuses a Kelly number below the track-record floor', () => {
        expect(kellyRiskPct(track({ n: MIN_TRACK_RECORD - 1 }))).toBeNull();
        expect(kellyRiskPct(null)).toBeNull();
        expect(kellyRiskPct(track({ payoff: 0 }))).toBeNull();
    });

    it('says so in the reasons rather than silently skipping the cap', () => {
        expect(computeSize(BASE).reasons.join(' ')).toContain('no track record');
        expect(computeSize({ ...BASE, track: track({ n: 5 }) }).reasons.join(' ')).toContain('under the 20-trade floor');
    });

    it('binds risk to Kelly when Kelly is tighter than the budget', () => {
        // W 0.4, R 1 ⇒ f* = 0.4 - 0.6 = -0.2 ⇒ clamped to 0 ⇒ no position.
        const negative = computeSize({ ...BASE, track: track({ winRate: 0.4, payoff: 1 }) });
        expect(negative.sizePct).toBe(0);
        expect(negative.gap).toContain('Kelly says this edge is negative');

        // W 0.55, R 1 ⇒ f* = 0.1 ⇒ half-Kelly 5%, over a 1% budget ⇒ budget binds.
        const loose = computeSize({ ...BASE, riskBudgetPct: 1, track: track({ winRate: 0.55, payoff: 1 }) });
        expect(loose.caps).not.toContain('kelly');
        expect(loose.riskPct).toBe(1);

        // Same record against a 9% budget ⇒ Kelly binds the risk at 5% first.
        // At 70k with a 3750 stop each unit of risk carries ~18.7x notional, so
        // 5% risk implies 93% of equity and the hard position cap binds after it.
        const bound = computeSize({ ...BASE, riskBudgetPct: 9, track: track({ winRate: 0.55, payoff: 1 }) });
        expect(bound.caps).toEqual(['kelly', 'max-position']);
        expect(bound.reasons.join(' ')).toContain('caps risk at 5%');
        expect(bound.sizePct).toBe(MAX_POSITION_PCT);
        expect(bound.riskPct).toBeLessThan(5);   // the risk actually taken, restated
    });

    it('never exceeds the hard per-position maximum, whatever the maths says', () => {
        // A very wide budget against a tight-but-legal stop would otherwise blow past it.
        const s = computeSize({ ...BASE, riskBudgetPct: 50, stop: 66_250, atr: 2500 });
        expect(s.sizePct).toBe(MAX_POSITION_PCT);
        expect(s.caps).toContain('max-position');
        expect(s.reasons.join(' ')).toContain(`hard ${MAX_POSITION_PCT}% per-position cap`);
    });

    it('restates the risk actually taken once the position cap binds', () => {
        const s = computeSize({ ...BASE, riskBudgetPct: 50, stop: 66_250, atr: 2500 });
        // Capped notional 20k ⇒ 0.2857 units ⇒ 1071.4 at risk ⇒ ~1.07% of equity, not 50%.
        expect(s.notional).toBeCloseTo(20_000, 2);
        expect(s.riskPct).toBeLessThan(50);
        expect(s.riskPct).toBeCloseTo((s.units * s.riskPerUnit / 100_000) * 100, 3);
    });

    it('asserts both bounds hold together', () => {
        const s = computeSize({ ...BASE, riskBudgetPct: 40, track: track({ winRate: 0.6, payoff: 3 }) });
        expect(s.sizePct).toBeLessThanOrEqual(MAX_POSITION_PCT);
        const kelly = kellyRiskPct(track({ winRate: 0.6, payoff: 3 }))!;
        expect(s.riskPct).toBeLessThanOrEqual(Math.max(kelly, 0));
    });

    it('keeps every applied bound on the record, in order', () => {
        const s = computeSize({ ...BASE, stop: 69_500, riskBudgetPct: 40, track: track({ winRate: 0.6, payoff: 3 }) });
        expect(s.caps[0]).toBe('atr-floor');
        expect(s.caps).toContain('kelly');
        expect(s.caps.at(-1)).toBe('max-position');
    });
});
