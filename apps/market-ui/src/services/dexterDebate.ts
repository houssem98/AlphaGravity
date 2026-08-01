// Dexter Debate — bull vs bear, then a research manager verdict.
// docs/AI_TRADING_AGENT_ROADMAP.md DX-9, regression row 14.
//
// Adapted from TradingAgents' investment debate (`graph/conditional_logic.py`:
// `count >= 2 * max_debate_rounds`, so N rounds means exactly 2N debater
// turns). Two deliberate departures from the original prompts:
//
//   1. The original debaters are pure advocates. Ours inherit the citation
//      discipline from DX-6 — an argument that invents a figure is worse than
//      no argument, because it will be graded and it will be wrong.
//   2. The manager must be allowed to conclude that neither side won. A verdict
//      of HOLD with low confidence is a real answer; forcing a direction would
//      manufacture conviction the evidence does not support.

import type { ChatMessage } from './dexterLlm.js';
import type { AssetContext } from './dexterTools.js';
import { newTrace, type CellStep } from './gridTrace.js';
import { renderReports, type AnalystReport } from './dexterGraph.js';

export type Side = 'bull' | 'bear';

export interface DebateTurn {
    side: Side;
    round: number;
    text: string;
}

export type Stance = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface DebateResult {
    turns: DebateTurn[];
    verdict: string;
    stance: Stance;
    /** 0-100, or null when the manager declined to state one. */
    confidence: number | null;
    rounds: number;
    steps: CellStep[];
}

export const DEFAULT_DEBATE_ROUNDS = 1;
export const MAX_DEBATE_ROUNDS = 3;

export function clampRounds(n: number | undefined): number {
    if (!Number.isFinite(n)) return DEFAULT_DEBATE_ROUNDS;
    return Math.max(1, Math.min(MAX_DEBATE_ROUNDS, Math.floor(n as number)));
}

const SIDE_BRIEF: Record<Side, string> = {
    bull: 'You are the bull. Make the strongest honest case FOR taking a long position: what the evidence supports, which levels would confirm it, and what the bear is getting wrong.',
    bear: 'You are the bear. Make the strongest honest case AGAINST taking a long position: what the evidence actually shows, which levels would confirm the downside, and where the bull is over-reaching.',
};

const SHARED_RULES =
    'Rules: argue only from the analyst reports below. Every figure you use keeps the [N] marker ' +
    'it came from — a number without one is worth nothing here and will be graded as such. ' +
    'If the reports do not support your side on some point, concede it; a conceded point costs ' +
    'you less than an invented one. At most 140 words.';

export function renderTurns(turns: DebateTurn[]): string {
    if (turns.length === 0) return '(no prior argument)';
    return turns.map(t => `${t.side === 'bull' ? 'Bull' : 'Bear'} (round ${t.round}): ${t.text}`).join('\n\n');
}

export function debatePrompt(
    side: Side,
    ctx: AssetContext,
    reports: AnalystReport[],
    turns: DebateTurn[],
): ChatMessage[] {
    return [
        {
            role: 'system',
            content: `${SIDE_BRIEF[side]}\n\nAsset: ${ctx.symbol}${ctx.name ? ` (${ctx.name})` : ''}` +
                `${ctx.isTN ? ', Bourse de Tunis, quoted in TND' : ''}.\n${SHARED_RULES}`,
        },
        {
            role: 'user',
            content: `Analyst reports:\n\n${renderReports(reports)}\n\nDebate so far:\n\n${renderTurns(turns)}`,
        },
    ];
}

// The manager is asked for a machine-readable header so the stance and
// confidence are parsed, not inferred from prose tone.
export function managerPrompt(
    ctx: AssetContext,
    reports: AnalystReport[],
    turns: DebateTurn[],
): ChatMessage[] {
    return [
        {
            role: 'system',
            content:
                `You are the research manager. Two analysts have argued opposite sides on ` +
                `${ctx.symbol}. Decide which case the evidence actually supports.\n\n` +
                `Begin your reply with exactly two lines:\nSTANCE: BULLISH|BEARISH|NEUTRAL\n` +
                `CONFIDENCE: <0-100>\n\nThen at most 120 words explaining which specific argument ` +
                `decided it and what would change your mind. Keep the [N] markers on any figure ` +
                `you cite. NEUTRAL with low confidence is a legitimate verdict — say the evidence ` +
                `is thin when it is thin, rather than manufacturing a direction.`,
        },
        {
            role: 'user',
            content: `Analyst reports:\n\n${renderReports(reports)}\n\nDebate:\n\n${renderTurns(turns)}`,
        },
    ];
}

// Parsed, never guessed from tone: an unparseable header yields NEUTRAL/null
// rather than a confidence nobody stated.
export function parseVerdict(text: string): { stance: Stance; confidence: number | null } {
    const stanceMatch = text.match(/STANCE:\s*(BULLISH|BEARISH|NEUTRAL)/i);
    const confMatch = text.match(/CONFIDENCE:\s*(\d{1,3})/i);
    const confidence = confMatch ? Math.max(0, Math.min(100, Number(confMatch[1]))) : null;
    return {
        stance: (stanceMatch?.[1].toUpperCase() as Stance) ?? 'NEUTRAL',
        confidence,
    };
}

export interface DebateDeps {
    callLLM: (messages: ChatMessage[]) => Promise<{ text: string }>;
    now?: () => number;
}

// N rounds = exactly 2N debater calls, plus one manager call. The bear always
// answers the bull inside a round, so the order is load-bearing: swapping it
// would let the bull rebut an argument that had not been made.
export async function runDebate(
    ctx: AssetContext,
    reports: AnalystReport[],
    deps: DebateDeps,
    rounds: number = DEFAULT_DEBATE_ROUNDS,
): Promise<DebateResult> {
    const n = clampRounds(rounds);
    const trace = newTrace(deps.now ?? Date.now);
    const turns: DebateTurn[] = [];

    for (let round = 1; round <= n; round++) {
        for (const side of ['bull', 'bear'] as const) {
            const reply = await trace.step(
                `${side === 'bull' ? 'Bull' : 'Bear'} argues (round ${round})`,
                side,
                () => deps.callLLM(debatePrompt(side, ctx, reports, turns)),
                { isEmpty: r => !r.text.trim() },
            );
            turns.push({ side, round, text: reply.text });
        }
    }

    const verdict = await trace.step('Research manager decides', 'manager',
        () => deps.callLLM(managerPrompt(ctx, reports, turns)),
        { isEmpty: r => !r.text.trim() });

    return {
        turns,
        verdict: verdict.text,
        ...parseVerdict(verdict.text),
        rounds: n,
        steps: trace.done(),
    };
}
