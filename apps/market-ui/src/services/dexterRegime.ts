// Dexter Regime — DI-7, docs/DEXTER_INSTITUTIONAL_ROADMAP.md row 11.
//
// G6, half of it: analysts saw one symbol's bars with no notion of what kind of
// market they were in. The playbooks in DI-4 are not equally valid everywhere —
// mean reversion inside a trend is the classic way to lose money slowly — so the
// regime gates which playbook may fire at all.
//
// Two measurements, both from bars, both deliberately slow:
//   drift — least-squares slope of the closes over the lookback, expressed in
//           ATR per bar so it is comparable across instruments and price levels;
//   vol   — recent ATR against the whole window's ATR, so "volatile" means
//           volatile relative to this instrument's own habit, not an absolute.
// Slow inputs are the point: a classifier that flips on one bar would gate the
// playbooks differently every session, and the row-11 test perturbs a bar to
// prove it does not.
//
// MACRO IS DELIBERATELY ABSENT. A regime conditioned on VIX / credit spreads /
// the curve is the better classifier and `fredService.ts` already implements
// point-in-time vintages for exactly this — but it is dead (G13: both keys
// empty, placeholder fallback, HTTP 400, and `import.meta.env` is unreachable
// from the Vercel Node runtime). Reviving it needs a free FRED key, which is
// user-only input. The bars-only classifier ships; the macro extension is a
// ledger note, not a blocker.

import type { Bar } from './taLevels.js';
import { atr as atrOf } from './taLevels.js';
import type { Playbook } from './dexterSignal.js';

export type Regime = 'trending-up' | 'trending-down' | 'ranging' | 'volatile' | 'unknown';

/** Bars the drift measurement runs over. */
export const REGIME_LOOKBACK = 20;
/** Drift, in ATR per bar, at or above which the window is trending. */
export const TREND_DRIFT_ATR = 0.15;
/** Recent ATR over the PRIOR baseline ATR at or above which the window is volatile. */
export const VOLATILE_RATIO = 1.5;
/** Minimum bars before a regime may be named: a lookback plus a baseline to compare it to. */
export const MIN_BARS = 40;

export interface RegimeRead {
    regime: Regime;
    /** Least-squares drift over the lookback, in ATR per bar. Signed. */
    driftAtr: number | null;
    /** Recent ATR ÷ whole-window ATR. */
    volRatio: number | null;
    reasons: string[];
}

const round = (n: number, dp = 4): number => Number(n.toFixed(dp));

/** Least-squares slope of a series against its own index. */
export function slope(values: number[]): number | null {
    const n = values.length;
    if (n < 2) return null;
    const mx = (n - 1) / 2;
    const my = values.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
        num += (i - mx) * (values[i] - my);
        den += (i - mx) ** 2;
    }
    return den === 0 ? null : num / den;
}

export function classifyRegime(bars: Bar[], lookback = REGIME_LOOKBACK): RegimeRead {
    if (bars.length < MIN_BARS) {
        return {
            regime: 'unknown',
            driftAtr: null,
            volRatio: null,
            reasons: [`${bars.length} bars is under the ${MIN_BARS}-bar floor — no regime named`],
        };
    }

    const windowAtr = atrOf(bars);
    const recent = bars.slice(-lookback);
    const recentAtr = atrOf(recent);
    // Against the bars BEFORE the lookback, not against the whole window: Wilder
    // smoothing weights recent bars heavily, so a window that includes the
    // expansion is already half-expanded and the ratio understates the move.
    const baselineAtr = atrOf(bars.slice(0, -lookback));
    if (windowAtr === null || windowAtr <= 0) {
        return { regime: 'unknown', driftAtr: null, volRatio: null, reasons: ['ATR unavailable over the window'] };
    }

    const raw = slope(recent.map(b => b.close));
    const driftAtr = raw === null ? null : round(raw / windowAtr);
    const volRatio = recentAtr === null || baselineAtr === null || baselineAtr <= 0
        ? null
        : round(recentAtr / baselineAtr);
    const reasons: string[] = [
        `drift ${driftAtr} ATR/bar over the last ${recent.length} bars`,
        `recent ATR ${recentAtr === null ? 'n/a' : round(recentAtr, 2)} vs prior baseline ATR ` +
        `${baselineAtr === null ? 'n/a' : round(baselineAtr, 2)} → ratio ${volRatio}`,
    ];

    // Volatility first: a violent tape is its own regime whatever the drift says,
    // because both the trend and the fade playbooks assume orderly ranges.
    if (volRatio !== null && volRatio >= VOLATILE_RATIO) {
        return { regime: 'volatile', driftAtr, volRatio, reasons: [...reasons, `ratio ≥ ${VOLATILE_RATIO} — volatile`] };
    }
    if (driftAtr !== null && Math.abs(driftAtr) >= TREND_DRIFT_ATR) {
        const regime: Regime = driftAtr > 0 ? 'trending-up' : 'trending-down';
        return { regime, driftAtr, volRatio, reasons: [...reasons, `|drift| ≥ ${TREND_DRIFT_ATR} — ${regime}`] };
    }
    return { regime: 'ranging', driftAtr, volRatio, reasons: [...reasons, `neither threshold met — ranging`] };
}

// Which playbook each regime permits. Mean reversion inside a trend and trend
// following inside a range are the two ways a correct signal is applied in the
// wrong weather.
const ALLOWED: Record<Regime, Playbook[]> = {
    'trending-up': ['trend', 'breakout'],
    'trending-down': ['trend', 'breakout'],
    ranging: ['mean-reversion', 'breakout'],
    volatile: ['breakout'],
    unknown: [],
};

export function allowsPlaybook(regime: Regime, playbook: Playbook): boolean {
    if (playbook === 'none') return true;   // a flat signal needs no permission
    return ALLOWED[regime].includes(playbook);
}

export function allowedPlaybooks(regime: Regime): Playbook[] {
    return [...ALLOWED[regime]];
}

export function explainGate(regime: Regime, playbook: Playbook): string {
    return allowsPlaybook(regime, playbook)
        ? `${playbook} is permitted in a ${regime} regime`
        : `${playbook} is not permitted in a ${regime} regime (allowed: ${ALLOWED[regime].join(', ') || 'none'})`;
}
