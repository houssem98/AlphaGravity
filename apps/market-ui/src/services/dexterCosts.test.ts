// DI-2 regression tests — docs/DEXTER_INSTITUTIONAL_ROADMAP.md Section 6 row 3.
import { describe, it, expect } from 'vitest';
import {
    DEFAULT_COSTS, ZERO_COSTS, resolveCosts, perSideBps, isZeroCost, costInR, applyCosts, describeCosts,
} from './dexterCosts';

describe('row 3 — fee, spread and slippage are charged per side', () => {
    it('sums all three legs of friction into the per-side rate', () => {
        expect(perSideBps(DEFAULT_COSTS)).toBeCloseTo(10 + 0.001 + 2, 6);
        expect(perSideBps({ feeBps: 4, halfSpreadBps: 1, slippageBps: 3, assumptions: [] })).toBe(8);
    });

    it('charges both the entry and the exit, at each leg\'s own price', () => {
        // 100 bps per side on 1000 in and 1200 out, risk 100 ⇒ (1000+1200)*0.01/100 = 0.22R
        const c = { feeBps: 100, halfSpreadBps: 0, slippageBps: 0, assumptions: [] };
        expect(costInR(c, 1000, 1200, 100)).toBeCloseTo(0.22, 6);
    });

    it('makes friction a function of stop distance, not of notional alone', () => {
        // The same trade with a stop four times tighter costs four times as many R.
        const wide = costInR(DEFAULT_COSTS, 70_000, 70_000, 4000)!;
        const tight = costInR(DEFAULT_COSTS, 70_000, 70_000, 1000)!;
        expect(tight / wide).toBeCloseTo(4, 3);
    });

    it('refuses to cost a trade with no risk rather than dividing by zero', () => {
        expect(costInR(DEFAULT_COSTS, 100, 110, 0)).toBeNull();
        expect(costInR(DEFAULT_COSTS, 100, 110, -5)).toBeNull();
        expect(costInR(DEFAULT_COSTS, NaN, 110, 10)).toBeNull();
    });

    it('states its assumptions rather than burying them', () => {
        expect(DEFAULT_COSTS.assumptions.join(' ')).toContain('Binance spot taker');
        expect(DEFAULT_COSTS.assumptions.join(' ')).toContain('ASSUMPTION');
        expect(describeCosts(DEFAULT_COSTS)).toContain('per side');
        expect(describeCosts(DEFAULT_COSTS)).toContain('charged on entry and exit');
    });
});

describe('row 3 — a zero-cost run must be asked for by name', () => {
    it('defaults to the real cost model when none is supplied', () => {
        expect(resolveCosts()).toBe(DEFAULT_COSTS);
        expect(resolveCosts(undefined)).toBe(DEFAULT_COSTS);
        expect(isZeroCost(resolveCosts())).toBe(false);
        expect(perSideBps(DEFAULT_COSTS)).toBeGreaterThan(0);
    });

    it('only returns zero costs when zero costs were passed in', () => {
        expect(resolveCosts(ZERO_COSTS)).toBe(ZERO_COSTS);
        expect(isZeroCost(ZERO_COSTS)).toBe(true);
        expect(costInR(ZERO_COSTS, 70_000, 71_000, 1000)).toBe(0);
    });

    it('labels a zero-cost run as not tradeable', () => {
        expect(ZERO_COSTS.assumptions[0]).toContain('explicitly requested');
        expect(describeCosts(ZERO_COSTS)).toContain('ZERO-COST');
    });
});

describe('row 3 — applying costs to a trade', () => {
    it('nets a winner down and a loser further down', () => {
        const win = applyCosts(DEFAULT_COSTS, { entryPx: 70_000, stopPx: 66_000, exitPx: 78_000, grossR: 2 });
        expect(win.costR!).toBeGreaterThan(0);
        expect(win.netR!).toBeLessThan(2);

        const loss = applyCosts(DEFAULT_COSTS, { entryPx: 70_000, stopPx: 66_000, exitPx: 66_000, grossR: -1 });
        expect(loss.netR!).toBeLessThan(-1);
    });

    it('shows why a sub-ATR stop is punished twice', () => {
        // BTC at 70k: a 1.5xATR stop (ATR 2500 ⇒ 3750) vs the 0.25xATR stop DX-15 measured.
        const wide = applyCosts(DEFAULT_COSTS, { entryPx: 70_000, stopPx: 66_250, exitPx: 70_000, grossR: 0 });
        const tight = applyCosts(DEFAULT_COSTS, { entryPx: 70_000, stopPx: 69_375, exitPx: 70_000, grossR: 0 });
        expect(wide.costR!).toBeCloseTo(0.0448, 3);
        expect(tight.costR!).toBeCloseTo(0.2688, 3);
    });

    it('reports a gap rather than a fake zero when it cannot charge', () => {
        expect(applyCosts(DEFAULT_COSTS, { entryPx: null, stopPx: 1, exitPx: 2, grossR: 1 }))
            .toMatchObject({ grossR: 1, costR: null, netR: null, gap: 'no entry/stop/exit price to charge costs against' });
        expect(applyCosts(DEFAULT_COSTS, { entryPx: 1, stopPx: 1, exitPx: 2, grossR: 1 }).gap).toBe('risk per unit is zero');
        expect(applyCosts(DEFAULT_COSTS, { entryPx: 1, stopPx: 2, exitPx: 3, grossR: null }).gap).toBe('unresolved position');
    });

    it('leaves gross untouched under a zero-cost run', () => {
        const r = applyCosts(ZERO_COSTS, { entryPx: 70_000, stopPx: 66_000, exitPx: 78_000, grossR: 2 });
        expect(r).toMatchObject({ grossR: 2, costR: 0, netR: 2, gap: null });
    });
});
