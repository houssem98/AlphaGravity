// Dexter Costs — DI-2, docs/DEXTER_INSTITUTIONAL_ROADMAP.md rows 3-4.
//
// G5: every R this repo has ever produced was gross. The floor-OFF arm of the
// n=30 A/B averaged +0.11R per trade (contamination suspect, gross of costs),
// which is inside the round-trip cost of the instrument — so the number could
// not distinguish a small edge from no edge at all.
//
// The conversion that matters: an R is profit divided by the risk taken, so a
// cost quoted in basis points of NOTIONAL only becomes an R once it is divided
// by the stop distance. That makes cost-in-R a function of how tight the stop
// is, which is why a sub-ATR stop is punished twice — it gets hit by noise AND
// it magnifies every basis point of friction.
//
// PROBED, not assumed (2026-08-02): GET api.binance.com/api/v3/ticker/bookTicker
// ?symbol=BTCUSDT returned bid 63684.60 / ask 63684.61 — a one-tick spread of
// $0.01, 0.002 bps, half-spread 0.001 bps. On this instrument the spread is
// noise next to the fee, which is why the default below is fee-dominated.

export interface CostModel {
    /** Per side, in basis points of notional. */
    feeBps: number;
    /** Half the quoted bid-ask, per side, in bps — a marketable order crosses it. */
    halfSpreadBps: number;
    /** Per side, in bps — the part that is an assumption, not a measurement. */
    slippageBps: number;
    /** Stated inline with every number this model touches (doctrine 6). */
    assumptions: string[];
}

export const DEFAULT_COSTS: CostModel = {
    feeBps: 10,
    halfSpreadBps: 0.001,
    slippageBps: 2,
    assumptions: [
        'fee 10.0 bps per side — Binance spot taker rate, the published standard tier',
        'half-spread 0.001 bps per side — measured 2026-08-02 from BTCUSDT bookTicker (bid 63684.60 / ask 63684.61)',
        'slippage 2.0 bps per side — ASSUMPTION, not a measurement: no fill data exists for a strategy that has never traded',
        'costs are charged on both the entry and the exit, at each side\'s own price',
    ],
};

// A zero-cost run is legitimate for isolating a change, but it must be asked for
// by name. `resolveCosts(undefined)` returns the real model, never this one.
export const ZERO_COSTS: CostModel = {
    feeBps: 0,
    halfSpreadBps: 0,
    slippageBps: 0,
    assumptions: ['ZERO-COST RUN, explicitly requested — these R figures are gross and are not tradeable results'],
};

export function resolveCosts(costs?: CostModel): CostModel {
    return costs ?? DEFAULT_COSTS;
}

export function perSideBps(c: CostModel): number {
    return c.feeBps + c.halfSpreadBps + c.slippageBps;
}

export function isZeroCost(c: CostModel): boolean {
    return perSideBps(c) === 0;
}

/**
 * Round-trip friction expressed in R.
 * Charged at each leg's own price, then divided by the risk per unit — the same
 * denominator the R itself uses.
 */
export function costInR(c: CostModel, entryPx: number, exitPx: number, riskPerUnit: number): number | null {
    if (!Number.isFinite(riskPerUnit) || riskPerUnit <= 0) return null;
    if (!Number.isFinite(entryPx) || !Number.isFinite(exitPx)) return null;
    const rate = perSideBps(c) / 10_000;
    return Number((((Math.abs(entryPx) + Math.abs(exitPx)) * rate) / riskPerUnit).toFixed(4));
}

export interface CostedTrade {
    entryPx: number | null;
    stopPx: number | null;
    exitPx: number | null;
    grossR: number | null;
}

export interface CostedResult {
    grossR: number | null;
    costR: number | null;
    netR: number | null;
    /** Why a costed number could not be produced — never silently dropped. */
    gap: string | null;
}

export function applyCosts(c: CostModel, t: CostedTrade): CostedResult {
    if (t.grossR === null) return { grossR: null, costR: null, netR: null, gap: 'unresolved position' };
    if (t.entryPx === null || t.stopPx === null || t.exitPx === null) {
        return { grossR: t.grossR, costR: null, netR: null, gap: 'no entry/stop/exit price to charge costs against' };
    }
    const costR = costInR(c, t.entryPx, t.exitPx, Math.abs(t.entryPx - t.stopPx));
    if (costR === null) return { grossR: t.grossR, costR: null, netR: null, gap: 'risk per unit is zero' };
    return { grossR: t.grossR, costR, netR: Number((t.grossR - costR).toFixed(4)), gap: null };
}

/** One line stating what was charged, to travel with any net figure. */
export function describeCosts(c: CostModel): string {
    return isZeroCost(c)
        ? 'ZERO-COST: gross figures only, explicitly requested'
        : `costs ${perSideBps(c).toFixed(3)} bps per side (fee ${c.feeBps}, half-spread ${c.halfSpreadBps}, slippage ${c.slippageBps}), charged on entry and exit`;
}
