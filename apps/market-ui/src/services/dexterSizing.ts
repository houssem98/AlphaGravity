// Dexter Sizing — DI-5, docs/DEXTER_INSTITUTIONAL_ROADMAP.md rows 8-9.
//
// G3: `TradePlan.sizePct` was `num(text, 'SIZE')` with a `> 0` check — a number
// the model said. `rr` was already computed rather than parsed, and the comment
// above it said "computed here… never taken from the model". This extends that
// rule to size, which is where it matters more: a wrong `rr` misinforms, a wrong
// size loses money.
//
// The arithmetic a PM expects, in order:
//   1. risk per unit — the stop distance, floored at 1.5xATR, because sizing off
//      a stop that sits inside the instrument's own noise sizes off a fiction;
//   2. risk budget — a fixed percent of equity per trade;
//   3. Kelly cap — only once there is a track record to compute it from, and
//      halved, because full Kelly assumes the win rate is known exactly;
//   4. a hard per-position maximum that nothing may exceed.
// Each bound that binds is named in `caps`, so a reader can see which one held.

export const DEFAULT_RISK_BUDGET_PCT = 1.0;
/** Nothing may exceed this share of equity in one position, whatever the maths says. */
export const MAX_POSITION_PCT = 20;
/** Half-Kelly: full Kelly assumes the win rate is known without error. It is not. */
export const KELLY_FRACTION = 0.5;
/** Below this many resolved trades there is no track record and no Kelly cap. */
export const MIN_TRACK_RECORD = 20;
/** The stop distance sizing is allowed to believe, in ATR (matches dexterRisk). */
export const MIN_STOP_ATR = 1.5;

export interface TrackRecord {
    /** Resolved trades behind the numbers below. */
    n: number;
    /** Fraction 0..1. */
    winRate: number;
    /** Average win divided by average loss, in R. */
    payoff: number;
}

export interface SizingInputs {
    equity: number;
    entry: number;
    stop: number;
    atr?: number | null;
    riskBudgetPct?: number;
    track?: TrackRecord | null;
}

export interface Sizing {
    /** Position notional as a percent of equity. The only size anything downstream may use. */
    sizePct: number;
    /** Percent of equity actually at risk if the stop is hit. */
    riskPct: number;
    units: number;
    notional: number;
    riskPerUnit: number;
    /** Which bounds bound it, in the order they were applied. */
    caps: string[];
    reasons: string[];
    gap: string | null;
}

const round = (n: number, dp = 4): number => Number(n.toFixed(dp));

function nothing(gap: string): Sizing {
    return { sizePct: 0, riskPct: 0, units: 0, notional: 0, riskPerUnit: 0, caps: [], reasons: [], gap };
}

/**
 * Half-Kelly on the risk fraction. Returns null when there is no track record
 * to compute it from — an uncalibrated Kelly is a made-up number.
 */
export function kellyRiskPct(track: TrackRecord | null | undefined): number | null {
    if (!track || track.n < MIN_TRACK_RECORD) return null;
    if (!(track.payoff > 0)) return null;
    const f = track.winRate - (1 - track.winRate) / track.payoff;
    return round(Math.max(0, f) * KELLY_FRACTION * 100);
}

export function computeSize(input: SizingInputs): Sizing {
    const { equity, entry, stop, atr = null } = input;
    const budget = input.riskBudgetPct ?? DEFAULT_RISK_BUDGET_PCT;

    if (!(equity > 0)) return nothing('no equity to size against');
    if (!(entry > 0)) return nothing('no entry price to size against');
    if (!(budget > 0)) return nothing('risk budget is zero or negative — nothing to allocate');

    const stopDistance = Math.abs(entry - stop);
    if (!(stopDistance > 0)) return nothing('stop equals entry — no risk per unit to divide by');

    const reasons: string[] = [];
    const caps: string[] = [];

    // A stop tighter than the noise floor is not a real risk level, so sizing
    // uses the floor instead. Sizing off the tighter number would inflate the
    // position by exactly the ratio the stop was understated by.
    let riskPerUnit = stopDistance;
    if (atr !== null && atr > 0) {
        const floor = atr * MIN_STOP_ATR;
        if (stopDistance < floor) {
            riskPerUnit = floor;
            caps.push('atr-floor');
            reasons.push(
                `stop distance ${round(stopDistance, 2)} is inside the ${MIN_STOP_ATR}x ATR floor ` +
                `${round(floor, 2)}; sized on the floor, not on the tighter stop`,
            );
        }
    }

    let riskPct = budget;
    reasons.push(`risk budget ${budget}% of equity ${equity}`);

    const kelly = kellyRiskPct(input.track);
    if (kelly === null) {
        reasons.push(
            input.track
                ? `track record n=${input.track.n} is under the ${MIN_TRACK_RECORD}-trade floor — no Kelly cap applied`
                : `no track record — no Kelly cap applied (DI-10 supplies one)`,
        );
    } else if (kelly < riskPct) {
        caps.push('kelly');
        reasons.push(
            `half-Kelly on n=${input.track!.n} (win rate ${input.track!.winRate}, payoff ${input.track!.payoff}) ` +
            `caps risk at ${kelly}%, under the ${budget}% budget`,
        );
        riskPct = kelly;
    } else {
        reasons.push(`half-Kelly allows ${kelly}%, above the ${budget}% budget, so the budget binds`);
    }

    if (riskPct <= 0) {
        return { ...nothing('Kelly says this edge is negative — no position'), caps, reasons };
    }

    const riskAmount = equity * (riskPct / 100);
    let units = riskAmount / riskPerUnit;
    let notional = units * entry;
    let sizePct = (notional / equity) * 100;

    if (sizePct > MAX_POSITION_PCT) {
        caps.push('max-position');
        reasons.push(`computed ${round(sizePct, 2)}% exceeds the hard ${MAX_POSITION_PCT}% per-position cap`);
        sizePct = MAX_POSITION_PCT;
        notional = equity * (sizePct / 100);
        units = notional / entry;
        riskPct = round((units * riskPerUnit / equity) * 100);
    }

    return {
        sizePct: round(sizePct, 2),
        riskPct: round(riskPct, 4),
        units: round(units, 8),
        notional: round(notional, 2),
        riskPerUnit: round(riskPerUnit, 8),
        caps,
        reasons,
        gap: null,
    };
}

export interface SizedPlan {
    sizePct: number;
    /** What the model asked for, kept only as a record of what was discarded. */
    modelSizePct: number | null;
    sizing: Sizing;
    note: string;
}

/**
 * Row 8: the model's size is discarded, always. It is not compared, averaged or
 * used as a fallback — it is recorded and replaced.
 */
export function applySizing(modelSizePct: number | null, input: SizingInputs): SizedPlan {
    const sizing = computeSize(input);
    return {
        sizePct: sizing.sizePct,
        modelSizePct,
        sizing,
        note: sizing.gap
            ? `no size computed: ${sizing.gap}` +
              (modelSizePct === null ? '' : ` — the model's ${modelSizePct}% was discarded and not substituted`)
            : `size ${sizing.sizePct}% computed from ATR, risk budget and equity` +
              (modelSizePct === null ? '' : `; the model's ${modelSizePct}% was discarded`) +
              (sizing.caps.length ? ` (bound by ${sizing.caps.join(', ')})` : ''),
    };
}
