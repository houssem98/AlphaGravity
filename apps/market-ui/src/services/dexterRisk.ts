// Dexter Risk — three risk analysts, then a portfolio manager who must show
// the risk before the trade counts as a decision.
// docs/AI_TRADING_AGENT_ROADMAP.md DX-10, regression rows 15 and 22.
//
// Order follows TradingAgents' `should_continue_risk_analysis`
// (`graph/conditional_logic.py:57`): Aggressive → Conservative → Neutral, with
// `count >= 3 * max_risk_discuss_rounds`, so N rounds means 3N turns.
//
// The rule this file exists to enforce (doctrine rule 5): a BUY or SELL without
// an entry, a stop, a size and a risk/reward ratio is not a decision — it is
// commentary, and it gets relabelled as such. Nothing here talks anyone out of
// a trade; it refuses to let a trade be stated as if the risk had been thought
// about when it has not.

import type { ChatMessage } from './dexterLlm.js';
import type { AssetContext } from './dexterTools.js';
import { newTrace, type CellStep } from './gridTrace.js';
import { renderReports, type AnalystReport } from './dexterGraph.js';
import { renderTurns, type DebateResult } from './dexterDebate.js';
import { renderPlanBlock } from './dexterBlocks.js';

export type RiskSide = 'aggressive' | 'conservative' | 'neutral';

// TradingAgents' rotation, not alphabetical: the conservative answers the
// aggressive directly, and the neutral arbitrates having heard both.
export const RISK_ORDER: readonly RiskSide[] = ['aggressive', 'conservative', 'neutral'];

export const DEFAULT_RISK_ROUNDS = 1;
export const MAX_RISK_ROUNDS = 2;

export type Action = 'BUY' | 'SELL' | 'HOLD';

export interface TradePlan {
    action: Action;
    entry: number;
    stop: number;
    target: number;
    sizePct: number;
    /** Computed here from entry/stop/target — never taken from the model. */
    rr: number;
}

export interface RiskTurn {
    side: RiskSide;
    round: number;
    text: string;
}

export interface RiskResult {
    turns: RiskTurn[];
    /** The manager's raw reply, always. */
    text: string;
    /** Present only when the plan survived validation. */
    plan: TradePlan | null;
    /** True when a BUY/SELL was downgraded because its risk block did not hold up. */
    commentary: boolean;
    rejectReason?: string;
    rounds: number;
    steps: CellStep[];
}

// Row 22. Appended to every decision output, not to the model's discretion.
export const DISCLOSURE =
    'Not financial advice. This is a model-generated analysis of public market data, ' +
    'it can be wrong, and it does not know your circumstances or risk tolerance.';

const RISK_BRIEF: Record<RiskSide, string> = {
    aggressive: 'You are the aggressive risk analyst. Argue for the largest position the evidence justifies, and name the specific level that would prove you wrong.',
    conservative: 'You are the conservative risk analyst. Argue for the smallest position — or none — and name the specific way this trade loses money.',
    neutral: 'You are the neutral risk analyst. Having heard both, say which sizing the evidence actually supports and why the other two are over- or under-reaching.',
};

export function riskPrompt(
    side: RiskSide,
    ctx: AssetContext,
    reports: AnalystReport[],
    debate: DebateResult | null,
    turns: RiskTurn[],
): ChatMessage[] {
    const verdict = debate
        ? `Research manager ruled ${debate.stance}${debate.confidence === null ? '' : ` at ${debate.confidence}% confidence`}:\n${debate.verdict}`
        : '(no debate was run)';
    return [
        {
            role: 'system',
            content: `${RISK_BRIEF[side]}\n\nAsset: ${ctx.symbol}${ctx.name ? ` (${ctx.name})` : ''}` +
                `${ctx.isTN ? ', Bourse de Tunis, quoted in TND' : ''}.\n` +
                `Talk about position size as a percentage of the portfolio, and about the stop as a ` +
                `price. Keep the [N] marker on every figure. At most 120 words.`,
        },
        {
            role: 'user',
            content: `Analyst reports:\n\n${renderReports(reports)}\n\n${verdict}\n\n` +
                `Risk discussion so far:\n\n${turns.length === 0 ? '(nothing yet)' : renderRiskTurns(turns)}`,
        },
    ];
}

export function renderRiskTurns(turns: RiskTurn[]): string {
    return turns.map(t => `${t.side} (round ${t.round}): ${t.text}`).join('\n\n');
}

// DX-17: the minimum distance a stop may sit from the entry, in ATR. A stop
// closer than one ATR is inside a single day's ordinary range — it is not a
// thesis-invalidation level, it is a coin flip on noise. 1.5 gives the trade
// room to be right slowly.
//
// This is not a number tuned until a backtest went green. DX-15 measured four
// trades, all stopped, at 0.48 / 0.67 / 0.25 / 0.93 ATR — but the rule stands on
// the definition of ATR rather than on that sample, which is why it is stated as
// a constant here and not fitted.
export const MIN_STOP_ATR = 1.5;

export function minStopDistance(atr: number | null): number | null {
    return atr === null ? null : Number((atr * MIN_STOP_ATR).toFixed(8));
}

export function managerPrompt(
    ctx: AssetContext,
    reports: AnalystReport[],
    debate: DebateResult | null,
    turns: RiskTurn[],
    minStop: number | null = null,
): ChatMessage[] {
    const stopRule = minStop === null
        ? `Place the stop where the idea is actually wrong, not where it is convenient.`
        : `Your stop must sit at least ${minStop} away from your entry — that is ` +
          `${MIN_STOP_ATR}x the current ATR. A closer stop is inside one day's ordinary range ` +
          `and will be taken out by noise whichever way the market goes; a plan with one will ` +
          `be rejected. If the level where your idea is genuinely wrong is nearer than that, ` +
          `the trade does not have room — answer HOLD.`;

    return [
        {
            role: 'system',
            content:
                `You are the portfolio manager for ${ctx.symbol}. Make the call.\n\n` +
                `Begin with exactly this block and nothing before it:\n` +
                `ACTION: BUY|SELL|HOLD\nENTRY: <price>\nSTOP: <price>\nTARGET: <price>\n` +
                `SIZE: <percent of portfolio>\n\n` +
                `A BUY or a SELL without every one of those numbers is not a decision and will be ` +
                `relabelled as commentary. For a BUY the stop sits BELOW the entry and the target ` +
                `ABOVE it; for a SELL, the reverse. ${stopRule} If the evidence does not support a ` +
                `position, answer HOLD and leave the numbers at 0 — that is a real answer, not a ` +
                `failure.\n\n` +
                `Then at most 120 words: why this action, why this stop, and what would invalidate ` +
                `it. Keep the [N] marker on every figure.`,
        },
        {
            role: 'user',
            content: `Analyst reports:\n\n${renderReports(reports)}\n\n` +
                `${debate ? `Debate:\n${renderTurns(debate.turns)}\n\nManager verdict:\n${debate.verdict}\n\n` : ''}` +
                `Risk discussion:\n\n${renderRiskTurns(turns)}`,
        },
    ];
}

function num(text: string, field: string): number | null {
    // Tolerates "$62,510.28", "62510.28 USD", "3%" — but not a missing line.
    const m = text.match(new RegExp(`${field}:\\s*\\$?\\s*(-?[\\d,]+(?:\\.\\d+)?)`, 'i'));
    if (!m) return null;
    const v = Number(m[1].replace(/,/g, ''));
    return Number.isFinite(v) ? v : null;
}

export interface PlanParse {
    plan: TradePlan | null;
    /** Why the plan was rejected — empty when it was accepted. */
    problems: string[];
    action: Action | null;
}

// Row 15. The risk/reward ratio is COMPUTED from the levels, never read from
// the model: a plan that claims 3:1 while its own numbers say 0.4:1 is the
// exact failure this gate exists for.
export function parsePlan(text: string, minStop: number | null = null): PlanParse {
    const actionMatch = text.match(/ACTION:\s*(BUY|SELL|HOLD)/i);
    const action = (actionMatch?.[1].toUpperCase() as Action) ?? null;

    if (action === null) return { plan: null, action: null, problems: ['no ACTION line'] };
    if (action === 'HOLD') return { plan: null, action, problems: [] };   // a HOLD is not a position

    const entry = num(text, 'ENTRY');
    const stop = num(text, 'STOP');
    const target = num(text, 'TARGET');
    const sizePct = num(text, 'SIZE');

    const problems: string[] = [];
    if (entry === null || entry <= 0) problems.push('entry');
    if (stop === null || stop <= 0) problems.push('stop');
    if (target === null || target <= 0) problems.push('target');
    if (sizePct === null || sizePct <= 0) problems.push('size');
    if (problems.length > 0) {
        return { plan: null, action, problems: [`missing or non-positive: ${problems.join(', ')}`] };
    }

    // An incoherent plan is worse than a missing one, because it looks complete.
    if (action === 'BUY' && !(stop! < entry! && target! > entry!)) {
        problems.push(`a BUY needs stop < entry < target, got stop ${stop}, entry ${entry}, target ${target}`);
    }
    if (action === 'SELL' && !(stop! > entry! && target! < entry!)) {
        problems.push(`a SELL needs target < entry < stop, got stop ${stop}, entry ${entry}, target ${target}`);
    }
    if (problems.length > 0) return { plan: null, action, problems };

    const risk = Math.abs(entry! - stop!);
    if (risk === 0) return { plan: null, action, problems: ['stop equals entry — no risk defined'] };

    // DX-17: a stop inside the instrument's own noise is not a risk level. The
    // prompt asks for this; this enforces it, because an instruction the model
    // can ignore is a suggestion.
    if (minStop !== null && risk < minStop) {
        return {
            plan: null,
            action,
            problems: [
                `stop is ${risk.toFixed(2)} from entry but must be at least ${minStop} ` +
                `(${MIN_STOP_ATR}x ATR) — a closer stop sits inside one day's ordinary range ` +
                `and gets taken out by noise regardless of direction`,
            ],
        };
    }

    return {
        plan: {
            action,
            entry: entry!,
            stop: stop!,
            target: target!,
            sizePct: sizePct!,
            rr: Number((Math.abs(target! - entry!) / risk).toFixed(2)),
        },
        action,
        problems: [],
    };
}

// The risk block as the user should see it — assembled from the validated
// numbers, so it cannot disagree with what was validated.
export function renderPlan(plan: TradePlan, ctx: AssetContext): string {
    const unit = ctx.isTN ? ' TND' : '';
    // DD-8: the same validated numbers, additionally emitted as a structured
    // block so the client can render a plan card. The prose lines stay — a
    // consumer that does not know the block still reads the whole plan.
    return [
        renderPlanBlock({
            action: plan.action,
            entry: plan.entry,
            stop: plan.stop,
            target: plan.target,
            sizePct: plan.sizePct,
            rr: plan.rr,
            unit,
        }),
        `**${plan.action}** · entry ${plan.entry}${unit} · stop ${plan.stop}${unit} · target ${plan.target}${unit}`,
        `Size ${plan.sizePct}% of portfolio · risk/reward ${plan.rr}:1 (computed from these levels)`,
    ].join('\n');
}

export function clampRiskRounds(n: number | undefined): number {
    if (!Number.isFinite(n)) return DEFAULT_RISK_ROUNDS;
    return Math.max(1, Math.min(MAX_RISK_ROUNDS, Math.floor(n as number)));
}

export interface RiskDeps {
    callLLM: (messages: ChatMessage[]) => Promise<{ text: string }>;
    now?: () => number;
    /** DX-17: minimum stop distance, from the market analyst's ATR. */
    minStop?: number | null;
}

export async function runRisk(
    ctx: AssetContext,
    reports: AnalystReport[],
    debate: DebateResult | null,
    deps: RiskDeps,
    rounds: number = DEFAULT_RISK_ROUNDS,
): Promise<RiskResult> {
    const n = clampRiskRounds(rounds);
    const trace = newTrace(deps.now ?? Date.now);
    const turns: RiskTurn[] = [];

    for (let round = 1; round <= n; round++) {
        for (const side of RISK_ORDER) {
            const reply = await trace.step(`${side} risk view (round ${round})`, side,
                () => deps.callLLM(riskPrompt(side, ctx, reports, debate, turns)),
                { isEmpty: r => !r.text.trim() });
            turns.push({ side, round, text: reply.text });
        }
    }

    const minStop = deps.minStop ?? null;
    const decision = await trace.step('Portfolio manager decides', 'portfolio',
        () => deps.callLLM(managerPrompt(ctx, reports, debate, turns, minStop)),
        { isEmpty: r => !r.text.trim() });

    const { plan, problems, action } = parsePlan(decision.text, minStop);
    const commentary = action !== 'HOLD' && plan === null;

    return {
        turns,
        text: decision.text,
        plan,
        commentary,
        rejectReason: commentary ? problems.join('; ') : undefined,
        rounds: n,
        steps: trace.done(),
    };
}
