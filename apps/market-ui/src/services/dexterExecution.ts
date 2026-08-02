// Dexter Execution — DI-14, docs/DEXTER_INSTITUTIONAL_ROADMAP.md row 19.
//
// Every R this repo has produced assumed a stop fills AT the stop. It does not.
// A market that gaps through the level overnight fills at the open, and the
// difference is not a rounding error: a stop 1R away that opens 2R through is a
// −2R trade booked as −1R. Backtests that ignore this are systematically
// optimistic in exactly the conditions that matter — the violent ones.
//
// Three departures from the idealised fill, all in the pessimistic direction
// where the evidence is ambiguous:
//   1. gap-through — the fill is `bar.open` whenever the open is already beyond
//      the level, for stops AND targets;
//   2. partial fills — an order larger than a share of the bar's volume does not
//      all trade; the remainder is reported, never assumed filled;
//   3. overnight risk — how often this instrument gaps at all, measured from the
//      bars rather than asserted, so the first two are not treated as freak events.

import type { Bar } from './taLevels.js';

export type Side = 'long' | 'short';
export type FillKind = 'at-level' | 'gapped' | 'none';

export interface Fill {
    kind: FillKind;
    /** Where it actually filled. Null when the level was never touched. */
    price: number | null;
    /** Signed, in price: how much worse than the level the fill was. Never negative for a stop. */
    slippage: number;
    reason: string;
}

/** Share of a bar's volume one order may realistically take. */
export const MAX_PARTICIPATION = 0.1;
/** A gap of at least this many ATR is "a gap" for the overnight-risk statistic. */
export const GAP_ATR = 0.5;

const beyondStop = (side: Side, price: number, stop: number): boolean =>
    side === 'long' ? price <= stop : price >= stop;

const beyondTarget = (side: Side, price: number, target: number): boolean =>
    side === 'long' ? price >= target : price <= target;

/**
 * Row 19. A stop gapped through fills at the OPEN, not at the stop.
 * Touch order inside a bar is unknowable from daily data, so the open is the
 * only fill price that is actually observable.
 */
export function fillStop(side: Side, stop: number, bar: Bar): Fill {
    if (beyondStop(side, bar.open, stop)) {
        const slippage = side === 'long' ? stop - bar.open : bar.open - stop;
        return {
            kind: 'gapped',
            price: bar.open,
            slippage: Number(slippage.toFixed(8)),
            reason: `${bar.date} opened at ${bar.open}, already through the ${stop} stop — filled at the open, ` +
                `${slippage.toFixed(2)} worse than the level`,
        };
    }
    const touched = side === 'long' ? bar.low <= stop : bar.high >= stop;
    return touched
        ? { kind: 'at-level', price: stop, slippage: 0, reason: `${bar.date} traded through ${stop} intrabar — filled at the stop` }
        : { kind: 'none', price: null, slippage: 0, reason: `${bar.date} never reached ${stop}` };
}

/** Targets gap too, and a gap in your favour is still a fill at the open. */
export function fillTarget(side: Side, target: number, bar: Bar): Fill {
    if (beyondTarget(side, bar.open, target)) {
        const slippage = side === 'long' ? target - bar.open : bar.open - target;
        return {
            kind: 'gapped',
            price: bar.open,
            slippage: Number(slippage.toFixed(8)),
            reason: `${bar.date} opened at ${bar.open}, already through the ${target} target — filled at the open`,
        };
    }
    const touched = side === 'long' ? bar.high >= target : bar.low <= target;
    return touched
        ? { kind: 'at-level', price: target, slippage: 0, reason: `${bar.date} traded through ${target} intrabar — filled at the target` }
        : { kind: 'none', price: null, slippage: 0, reason: `${bar.date} never reached ${target}` };
}

/** R actually realised, from the fill price rather than the intended level. */
export function realisedR(side: Side, entry: number, stop: number, fillPrice: number): number | null {
    const risk = Math.abs(entry - stop);
    if (!(risk > 0)) return null;
    const move = side === 'long' ? fillPrice - entry : entry - fillPrice;
    return Number((move / risk).toFixed(4));
}

export interface PartialFill {
    /** Units that actually traded. */
    filled: number;
    /** Units left unfilled — reported, never assumed away. */
    remaining: number;
    complete: boolean;
    reason: string;
}

export function participationFill(units: number, barVolume: number | undefined, max = MAX_PARTICIPATION): PartialFill {
    if (barVolume === undefined || !(barVolume > 0)) {
        return {
            filled: 0, remaining: units, complete: false,
            reason: 'no volume on the bar — the fill cannot be assumed, so none is claimed',
        };
    }
    const capacity = barVolume * max;
    if (units <= capacity) {
        return { filled: units, remaining: 0, complete: true, reason: `${units} units is inside ${max * 100}% of the bar's ${barVolume} volume` };
    }
    return {
        filled: Number(capacity.toFixed(8)),
        remaining: Number((units - capacity).toFixed(8)),
        complete: false,
        reason: `${units} units exceeds ${max * 100}% of the bar's ${barVolume} volume; ` +
            `${capacity.toFixed(2)} filled, ${(units - capacity).toFixed(2)} left working`,
    };
}

export interface OvernightRisk {
    bars: number;
    gaps: number;
    /** Share of sessions that opened at least GAP_ATR from the prior close. */
    gapRate: number | null;
    /** Largest open-to-prior-close move seen, in ATR. */
    worstGapAtr: number | null;
}

export function overnightRisk(bars: Bar[], atr: number | null, threshold = GAP_ATR): OvernightRisk {
    if (bars.length < 2 || atr === null || atr <= 0) {
        return { bars: bars.length, gaps: 0, gapRate: null, worstGapAtr: null };
    }
    let gaps = 0;
    let worst = 0;
    for (let i = 1; i < bars.length; i++) {
        const move = Math.abs(bars[i].open - bars[i - 1].close) / atr;
        if (move >= threshold) gaps++;
        if (move > worst) worst = move;
    }
    const n = bars.length - 1;
    return {
        bars: bars.length,
        gaps,
        gapRate: Number((gaps / n).toFixed(4)),
        worstGapAtr: Number(worst.toFixed(4)),
    };
}
