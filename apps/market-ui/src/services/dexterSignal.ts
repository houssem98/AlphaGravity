// Dexter Signal — DI-4, docs/DEXTER_INSTITUTIONAL_ROADMAP.md rows 6-7.
//
// G2: the model picked direction, entry, stop, target and size, which is the one
// use of an LLM the field says does not pay. `taLevels` already computed real
// structure — and only decorated the prompt with it. This file turns that
// structure into a direction on its own, with no model in the path.
//
// THE ARBITRATION RULE, and why inversion is treated differently from veto:
//   accept    — the model agrees. Nothing to decide.
//   veto      — the model says do not take it. Allowed: standing down is always
//               permitted, and a model that spots a reason to stay out is doing
//               the job the field says it is good at.
//   downgrade — the model agrees on direction but with less conviction. Allowed.
//   invert    — the model says trade the other way. REJECTED. Adopting it would
//               make the model the signal generator again, which is the exact
//               failure G2 names. The deterministic direction survives, its
//               conviction is cut because disagreement is information, and the
//               attempt is recorded rather than silently dropped.
// Inversion is not folded into veto: a model that could flip a signal by
// arguing the opposite would be generating alpha through the back door.
//
// No import from dexterLlm, dexterGraph or dexterDebate appears in this file,
// and dexterSignal.test.ts asserts that at the source level.

import type { Bar, TaLevels, Level } from './taLevels.js';
import { taLevels } from './taLevels.js';

export type Direction = 'long' | 'short' | 'flat';
export type Playbook = 'breakout' | 'trend' | 'mean-reversion' | 'none';

/** A level needs this many touches before it is structure rather than a wick. */
export const MIN_TOUCHES = 2;
/** How far beyond a level a close must sit to count as a break, in ATR. */
export const BREAKOUT_ATR = 0.25;
/** How close to a level a price must sit to count as a test, in ATR. */
export const NEAR_ATR = 0.5;
/** Conviction retained when the model tried to invert the signal. */
export const INVERSION_PENALTY = 0.5;

export interface Signal {
    direction: Direction;
    playbook: Playbook;
    /** 0..1, from level quality and distance only — never fitted to a backtest. */
    strength: number;
    /** Every reason names the number it came from (doctrine: no bare assertions). */
    reasons: string[];
    /** The structure the call was made on, so a reader can check it. */
    evidence: {
        lastClose: number | null;
        atr: number | null;
        trend: 'up' | 'down' | 'range';
        level: number | null;
        touches: number | null;
    };
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round2 = (n: number): number => Number(n.toFixed(2));

function flat(reason: string, ta: TaLevels): Signal {
    return {
        direction: 'flat',
        playbook: 'none',
        strength: 0,
        reasons: [reason],
        evidence: { lastClose: ta.lastClose, atr: ta.atr, trend: ta.trend, level: null, touches: null },
    };
}

const strongest = (levels: Level[]): Level | null =>
    levels.filter(l => l.touches >= MIN_TOUCHES).sort((a, b) => b.touches - a.touches)[0] ?? null;

/** Direction from structure alone. No model, no prompt, no network. */
export function signalFrom(ta: TaLevels): Signal {
    const { lastClose, atr } = ta;
    if (lastClose === null || atr === null || atr <= 0) {
        return flat('no ATR or last close — not enough bars to read structure', ta);
    }

    const res = strongest(ta.resistance);
    const sup = strongest(ta.support);

    // 1. Breakout beats everything: a close clear of held structure is the event.
    for (const [level, dir] of [[res, 'long'], [sup, 'short']] as Array<[Level | null, Direction]>) {
        if (!level) continue;
        const beyond = dir === 'long' ? lastClose - level.price : level.price - lastClose;
        if (beyond >= BREAKOUT_ATR * atr) {
            return {
                direction: dir,
                playbook: 'breakout',
                strength: round2(clamp(0.6 + 0.1 * (level.touches - MIN_TOUCHES), 0.6, 0.9)),
                reasons: [
                    `close ${lastClose} is ${round2(beyond / atr)} ATR beyond the ${level.kind} at ` +
                    `${level.price} (${level.touches} touches), past the ${BREAKOUT_ATR} ATR break threshold`,
                ],
                evidence: { lastClose, atr, trend: ta.trend, level: level.price, touches: level.touches },
            };
        }
    }

    // 2. Trend: the pivot sequence, not an indicator crossover.
    if (ta.trend === 'up' || ta.trend === 'down') {
        const dir: Direction = ta.trend === 'up' ? 'long' : 'short';
        const with_ = dir === 'long' ? sup : res;
        const confluence = with_ !== null;
        return {
            direction: dir,
            playbook: 'trend',
            strength: round2(clamp(0.5 + (confluence ? 0.1 : 0), 0.5, 0.7)),
            reasons: [
                `pivot sequence is ${ta.trend} over ${ta.pivots.length} swings`,
                confluence
                    ? `${with_!.kind} at ${with_!.price} (${with_!.touches} touches) sits behind the position`
                    : 'no held level behind the position, so conviction stays at base',
            ],
            evidence: { lastClose, atr, trend: ta.trend, level: with_?.price ?? null, touches: with_?.touches ?? null },
        };
    }

    // 3. Mean reversion, allowed only in a range — the playbook that loses most
    //    reliably when it is run inside a trend.
    for (const [level, dir] of [[sup, 'long'], [res, 'short']] as Array<[Level | null, Direction]>) {
        if (!level) continue;
        if (Math.abs(lastClose - level.price) <= NEAR_ATR * atr) {
            return {
                direction: dir,
                playbook: 'mean-reversion',
                strength: round2(clamp(0.4 + 0.1 * (level.touches - MIN_TOUCHES), 0.4, 0.6)),
                reasons: [
                    `range: close ${lastClose} is within ${NEAR_ATR} ATR of the ${level.kind} at ` +
                    `${level.price} (${level.touches} touches)`,
                ],
                evidence: { lastClose, atr, trend: ta.trend, level: level.price, touches: level.touches },
            };
        }
    }

    return flat('range with no held level in reach — no setup', ta);
}

/** Convenience: bars in, signal out. Still no model in the path. */
export function signalFromBars(bars: Bar[]): Signal {
    return signalFrom(taLevels(bars));
}

export type Arbitration = 'accepted' | 'vetoed' | 'downgraded' | 'inversion-rejected';

export interface LlmView {
    direction: Direction;
    /** Optional conviction 0..1. Lower than the signal's is a downgrade. */
    confidence?: number;
    reason: string;
}

export interface ArbitratedSignal extends Signal {
    arbitration: Arbitration;
    /** What the model said, kept whether or not it was adopted. */
    modelView: LlmView;
}

// The model arbitrates; it never generates. Every branch records why.
export function arbitrate(signal: Signal, view: LlmView): ArbitratedSignal {
    const base = { ...signal, modelView: view, reasons: [...signal.reasons] };

    if (signal.direction === 'flat') {
        return { ...base, arbitration: 'accepted', reasons: [...base.reasons, 'no signal to arbitrate'] };
    }

    if (view.direction === 'flat') {
        return {
            ...base,
            direction: 'flat',
            strength: 0,
            arbitration: 'vetoed',
            reasons: [...base.reasons, `VETOED by the model: ${view.reason}`],
        };
    }

    if (view.direction !== signal.direction) {
        return {
            ...base,
            strength: round2(signal.strength * INVERSION_PENALTY),
            arbitration: 'inversion-rejected',
            reasons: [
                ...base.reasons,
                `INVERSION REJECTED: the model argued ${view.direction} against a deterministic ` +
                `${signal.direction} — "${view.reason}". The model may veto or downgrade a signal, ` +
                `never reverse it, so the direction stands and conviction is cut to ${INVERSION_PENALTY}x.`,
            ],
        };
    }

    if (view.confidence !== undefined && view.confidence < signal.strength) {
        return {
            ...base,
            strength: round2(view.confidence),
            arbitration: 'downgraded',
            reasons: [...base.reasons, `downgraded ${signal.strength} → ${round2(view.confidence)} by the model: ${view.reason}`],
        };
    }

    return { ...base, arbitration: 'accepted', reasons: [...base.reasons, `model agrees: ${view.reason}`] };
}

export function describeSignal(s: Signal): string {
    return `${s.direction.toUpperCase()} · ${s.playbook} · conviction ${s.strength} — ${s.reasons.join('; ')}`;
}
