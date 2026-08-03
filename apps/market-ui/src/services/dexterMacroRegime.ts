// Dexter Macro Regime — the DI-7 stretch goal, unblocked once FRED went live.
// docs/DEXTER_INSTITUTIONAL_ROADMAP.md G13 / DI-7.
//
// DI-7 shipped a bars-only regime and ledger-noted the macro extension as
// blocked on a credential. The credential exists now, so this is that extension.
//
// TWO RULES KEEP IT HONEST, and they are the whole design:
//
//   1. THRESHOLDS ARE PERCENTILES OF EACH SERIES' OWN HISTORY, not constants.
//      "VIX above 28" is a number someone made up in a particular decade.
//      "VIX in the top quintile of its own last N years" is a description of the
//      distribution, and it travels across instruments and eras without being
//      re-tuned. Nothing here is fitted to returns — no threshold was ever moved
//      to make a backtest look better, which is the sin doctrine 5 names.
//
//   2. MACRO MAY ONLY RESTRICT, NEVER EXPAND. The bars-only regime decides what
//      is permitted; macro can take options away and can never add one back.
//      The same asymmetry as the LLM's veto in DI-4: a second opinion may stand
//      a trade down, it may not talk you into one.
//
// The macro read is DESCRIPTIVE, not predictive. Nothing here claims stress
// forecasts returns; it claims that when credit and volatility sit in the tail
// of their own distributions, a mean-reversion playbook built on orderly ranges
// is being run in conditions it does not assume.

import type { Playbook } from './dexterSignal.js';
import type { Regime } from './dexterRegime.js';
import { allowedPlaybooks } from './dexterRegime.js';

export type MacroRegime = 'calm' | 'normal' | 'stressed' | 'unknown';

/** Top-quintile readings in volatility or credit define stress. */
export const STRESS_PERCENTILE = 80;
/** Bottom-quintile volatility, with credit no worse than the median, defines calm. */
export const CALM_PERCENTILE = 20;
export const CALM_CREDIT_MAX_PERCENTILE = 50;
/** Below this many historical observations a percentile is not a percentile. */
export const MIN_HISTORY = 60;

export interface MacroInputs {
    /** Latest readings. Null or absent means "not known", never "fine". */
    vix?: number | null;
    hySpread?: number | null;
    yieldSpread?: number | null;
}

export interface MacroHistory {
    vix?: number[];
    hySpread?: number[];
    yieldSpread?: number[];
}

export interface MacroRead {
    regime: MacroRegime;
    /** Where each latest reading sits in its own history, 0-100. */
    percentiles: { vix: number | null; hySpread: number | null; yieldSpread: number | null };
    /** True when the 10Y-2Y spread is negative. Reported, never used as a gate. */
    curveInverted: boolean | null;
    reasons: string[];
}

/** Share of the history at or below `value`, 0-100. Null below MIN_HISTORY. */
export function percentileOf(value: number | null | undefined, history: number[] | undefined): number | null {
    if (value === null || value === undefined || !Number.isFinite(value)) return null;
    if (!history || history.length < MIN_HISTORY) return null;
    const clean = history.filter(Number.isFinite);
    if (clean.length < MIN_HISTORY) return null;
    const below = clean.filter(h => h <= value).length;
    return Number(((below / clean.length) * 100).toFixed(2));
}

export function classifyMacro(inputs: MacroInputs, history: MacroHistory): MacroRead {
    const percentiles = {
        vix: percentileOf(inputs.vix, history.vix),
        hySpread: percentileOf(inputs.hySpread, history.hySpread),
        yieldSpread: percentileOf(inputs.yieldSpread, history.yieldSpread),
    };
    const curveInverted = inputs.yieldSpread === null || inputs.yieldSpread === undefined
        ? null
        : inputs.yieldSpread < 0;

    const reasons: string[] = [];
    const say = (label: string, value: number | null | undefined, pct: number | null) => {
        if (pct === null) reasons.push(`${label}: no percentile — reading ${value ?? 'absent'} with too little history`);
        else reasons.push(`${label} ${value} sits at the ${pct}th percentile of its own history`);
    };
    say('VIX', inputs.vix, percentiles.vix);
    say('HY credit spread', inputs.hySpread, percentiles.hySpread);
    if (curveInverted !== null) {
        reasons.push(`10Y-2Y spread ${inputs.yieldSpread} — curve ${curveInverted ? 'INVERTED' : 'positive'} (reported, not gated)`);
    }

    // Nothing measurable ⇒ no macro opinion. An absent reading is not a calm one.
    if (percentiles.vix === null && percentiles.hySpread === null) {
        return {
            regime: 'unknown',
            percentiles,
            curveInverted,
            reasons: [...reasons, 'no macro series had enough history to place a percentile — macro adds no constraint'],
        };
    }

    const stressed = (percentiles.vix !== null && percentiles.vix >= STRESS_PERCENTILE)
        || (percentiles.hySpread !== null && percentiles.hySpread >= STRESS_PERCENTILE);
    if (stressed) {
        return { regime: 'stressed', percentiles, curveInverted, reasons: [...reasons, `at or above the ${STRESS_PERCENTILE}th percentile — stressed`] };
    }

    const calm = percentiles.vix !== null && percentiles.vix <= CALM_PERCENTILE
        && (percentiles.hySpread === null || percentiles.hySpread <= CALM_CREDIT_MAX_PERCENTILE);
    if (calm) {
        return { regime: 'calm', percentiles, curveInverted, reasons: [...reasons, `volatility at or below the ${CALM_PERCENTILE}th percentile with credit no worse than the median — calm`] };
    }

    return { regime: 'normal', percentiles, curveInverted, reasons: [...reasons, 'neither tail — normal'] };
}

/** What macro alone would permit. Only ever intersected with the bars-only set. */
const MACRO_ALLOWS: Record<MacroRegime, Playbook[] | null> = {
    // Stress does not assume orderly ranges, so the fade is out and trend
    // continuation is unreliable; a break of held structure still means something.
    stressed: ['breakout'],
    calm: null,     // no opinion
    normal: null,   // no opinion
    unknown: null,  // no data, therefore no opinion
};

export interface MacroGate {
    allowed: Playbook[];
    /** Playbooks the bars-only regime permitted that macro removed. */
    removed: Playbook[];
    reasons: string[];
}

/**
 * Intersects the bars-only permission set with the macro one. Because this is an
 * intersection, macro can only ever shrink the set — asserted in the tests.
 */
export function gateWithMacro(barsRegime: Regime, macro: MacroRead): MacroGate {
    const base = allowedPlaybooks(barsRegime);
    const macroSet = MACRO_ALLOWS[macro.regime];
    if (macroSet === null) {
        return { allowed: base, removed: [], reasons: [`macro regime ${macro.regime} adds no constraint to a ${barsRegime} tape`] };
    }
    const allowed = base.filter(p => macroSet.includes(p));
    const removed = base.filter(p => !macroSet.includes(p));
    return {
        allowed,
        removed,
        reasons: [
            `macro regime ${macro.regime} permits [${macroSet.join(', ')}]; ` +
            `a ${barsRegime} tape permitted [${base.join(', ') || 'none'}]`,
            removed.length > 0
                ? `removed ${removed.join(', ')} — macro may restrict the bars-only gate, never widen it`
                : 'macro removed nothing',
        ],
    };
}

export function describeMacro(read: MacroRead): string {
    return `macro ${read.regime} — ${read.reasons.join('; ')}`;
}

export const MACRO_UNKNOWN: MacroRead = {
    regime: 'unknown',
    percentiles: { vix: null, hySpread: null, yieldSpread: null },
    curveInverted: null,
    reasons: ['macro not read — no constraint applied'],
};

/** How long a fetched macro history is reused. Macro percentiles move slowly. */
export const MACRO_TTL_MS = 6 * 60 * 60 * 1000;
/** Years of history the percentiles are placed against. */
export const MACRO_YEARS = 10;

let cached: { at: number; read: MacroRead } | null = null;

export interface MacroFetchDeps {
    /** Returns the observation series, oldest first, for a FRED series id. */
    series: (seriesId: string, since: string) => Promise<number[]>;
    now?: () => number;
}

/**
 * FAIL-OPEN BY DESIGN. Macro can only ever remove a playbook, so a macro read
 * that fails must leave the bars-only decision exactly as it was — never block
 * it, never delay it into a timeout, and never turn a network problem into a
 * trading constraint. Any failure returns `unknown`, which constrains nothing.
 */
export async function readMacro(deps: MacroFetchDeps, ids: { vix: string; hy: string; curve: string }): Promise<MacroRead> {
    const now = deps.now ?? Date.now;
    if (cached && now() - cached.at < MACRO_TTL_MS) return cached.read;

    const since = new Date(now() - MACRO_YEARS * 365 * 86_400_000).toISOString().split('T')[0];
    try {
        const [vix, hySpread, yieldSpread] = await Promise.all([
            deps.series(ids.vix, since),
            deps.series(ids.hy, since),
            deps.series(ids.curve, since),
        ]);
        const read = classifyMacro(
            { vix: vix.at(-1) ?? null, hySpread: hySpread.at(-1) ?? null, yieldSpread: yieldSpread.at(-1) ?? null },
            { vix, hySpread, yieldSpread },
        );
        cached = { at: now(), read };
        return read;
    } catch {
        return MACRO_UNKNOWN;
    }
}

/** Test seam — the cache is process-wide by design. */
export function resetMacroCache(): void {
    cached = null;
}
