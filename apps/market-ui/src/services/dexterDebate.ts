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
    /** DI-9: the observable this side says would prove it wrong. Null if it declined to give one. */
    falsifier?: string | null;
}

export const FALSIFIER_PREFIX = 'FALSIFIER:';

export type Stance = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface DebateResult {
    turns: DebateTurn[];
    verdict: string;
    stance: Stance;
    /** 0-100, or null when the manager declined to state one. */
    confidence: number | null;
    rounds: number;
    /** DI-9: what each side was shown that the other was not. */
    privateEvidence: Record<Side, string[]>;
    /** DI-9: every falsifiable claim made, with its author. */
    falsifiers: Array<{ side: Side; claim: string }>;
    /** DI-9: sides that produced no falsifier, or were given no private evidence. */
    gaps: string[];
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
    'you less than an invented one. At most 140 words.\n' +
    `End with exactly one line:\n${FALSIFIER_PREFIX} <the specific observable that would prove ` +
    'your case wrong — a level, a print, a date>. It must be a condition someone could check, ' +
    'not a hedge: "if support fails" is not a falsifier, "a daily close below 61,400" is.';

// DI-9 (row 13): each side is handed structure the other is not. Bull sees what
// holds the position up, bear sees what stands in its way, and each is told the
// other cannot see it — so a debater who only restates the shared reports is
// visibly not using what it was given. This is the difference between two
// advocates reading one file and an actual adversarial process.
export interface PrivateEvidenceInput {
    /** From taLevels: held support/resistance the side cares about. */
    levels?: Array<{ price: number; touches: number; kind: 'support' | 'resistance' }>;
    /** From dexterRegime. */
    regime?: string;
    regimeReason?: string;
    /** From dexterCrossSection: where the name sits against its universe. */
    crossSection?: string;
    /** From dexterSignal: the deterministic read, which the bear is told to attack. */
    signal?: string;
}

export function buildPrivateEvidence(side: Side, input: PrivateEvidenceInput): string[] {
    const out: string[] = [];
    const want = side === 'bull' ? 'support' : 'resistance';
    for (const l of input.levels ?? []) {
        if (l.kind === want) out.push(`${l.kind} at ${l.price} held ${l.touches} times`);
    }
    if (side === 'bull') {
        if (input.crossSection) out.push(`cross-section: ${input.crossSection}`);
        if (input.signal) out.push(`the deterministic engine reads: ${input.signal}`);
    } else {
        if (input.regime) out.push(`regime: ${input.regime}${input.regimeReason ? ` — ${input.regimeReason}` : ''}`);
        if (input.signal) out.push(`the deterministic engine reads ${input.signal} — find what would break it`);
    }
    return out;
}

export function renderTurns(turns: DebateTurn[]): string {
    if (turns.length === 0) return '(no prior argument)';
    return turns.map(t => `${t.side === 'bull' ? 'Bull' : 'Bear'} (round ${t.round}): ${t.text}`).join('\n\n');
}

export function debatePrompt(
    side: Side,
    ctx: AssetContext,
    reports: AnalystReport[],
    turns: DebateTurn[],
    privateEvidence: string[] = [],
): ChatMessage[] {
    const priv = privateEvidence.length === 0
        ? ''
        : `\n\nEvidence held only by you (the other side has NOT seen this — use it):\n` +
          privateEvidence.map(e => `- ${e}`).join('\n');
    return [
        {
            role: 'system',
            content: `${SIDE_BRIEF[side]}\n\nAsset: ${ctx.symbol}${ctx.name ? ` (${ctx.name})` : ''}` +
                `${ctx.isTN ? ', Bourse de Tunis, quoted in TND' : ''}.\n${SHARED_RULES}`,
        },
        {
            role: 'user',
            content: `Analyst reports:\n\n${renderReports(reports)}${priv}\n\nDebate so far:\n\n${renderTurns(turns)}`,
        },
    ];
}

/** The falsifier line, or null when the side did not give one. Never inferred from prose. */
export function parseFalsifier(text: string): string | null {
    const m = text.match(/FALSIFIER:\s*(.+)/i);
    const claim = m?.[1]?.trim();
    return claim ? claim.replace(/\s+/g, ' ') : null;
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
    /** DI-9: deterministic structure to split between the two sides. */
    evidence?: PrivateEvidenceInput;
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
    const priv: Record<Side, string[]> = {
        bull: deps.evidence ? buildPrivateEvidence('bull', deps.evidence) : [],
        bear: deps.evidence ? buildPrivateEvidence('bear', deps.evidence) : [],
    };

    for (let round = 1; round <= n; round++) {
        for (const side of ['bull', 'bear'] as const) {
            const reply = await trace.step(
                `${side === 'bull' ? 'Bull' : 'Bear'} argues (round ${round})`,
                side,
                () => deps.callLLM(debatePrompt(side, ctx, reports, turns, priv[side])),
                { isEmpty: r => !r.text.trim() },
            );
            turns.push({ side, round, text: reply.text, falsifier: parseFalsifier(reply.text) });
        }
    }

    const verdict = await trace.step('Research manager decides', 'manager',
        () => deps.callLLM(managerPrompt(ctx, reports, turns)),
        { isEmpty: r => !r.text.trim() });

    // A side that would not say what would prove it wrong is recorded as such
    // rather than quietly passing (doctrine 4: a view with no invalidation
    // condition is not a view).
    const gaps: string[] = [];
    for (const side of ['bull', 'bear'] as const) {
        if (!turns.some(t => t.side === side && t.falsifier)) {
            gaps.push(`${side} produced no falsifiable claim`);
        }
    }
    if (deps.evidence) {
        for (const side of ['bull', 'bear'] as const) {
            if (priv[side].length === 0) gaps.push(`${side} was given no private evidence`);
        }
    }

    return {
        turns,
        verdict: verdict.text,
        ...parseVerdict(verdict.text),
        rounds: n,
        privateEvidence: priv,
        falsifiers: turns.filter(t => t.falsifier).map(t => ({ side: t.side, claim: t.falsifier! })),
        gaps,
        steps: trace.done(),
    };
}
