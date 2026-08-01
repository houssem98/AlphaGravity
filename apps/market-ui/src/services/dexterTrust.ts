// Dexter Trust — an earned grade for a chat answer.
// docs/AI_TRADING_AGENT_ROADMAP.md DX-7, regression rows 10 and 11.
//
// Chat-shaped port of gridTrust's scoreCellTrust. The grid grades a cell by
// whether RAG grounded it; a chat turn is grounded by whether a TOOL ran and
// returned something. Everything else is the grid's doctrine unchanged:
//
//   A — unreachable in one round. Requires the figures to survive a second,
//       independently-run pass (row 11).
//   B — the round-1 ceiling for a tool-grounded answer whose markers resolve,
//       AND the grade for an honest "I don't have that" (honesty is never
//       punished, doctrine rule 4).
//   C — the ceiling for an answer with no tool behind it or no citations.
//   D/F — re-run triggers. A fabricated citation is an outright F: claiming a
//       source that does not exist is worse than claiming nothing.

import { extractFigures, findUnmappedCites } from './gridResearch.js';
import type { CellStep } from './gridTrace.js';
import type { DexterCitation } from './dexterTools.js';

export type TrustGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface AnswerTrust {
    grade: TrustGrade;
    score: number;          // 0-100
    reasons: string[];
    honest?: boolean;       // honest-empty — styled as honesty, never as failure
    rounds: number;
}

// The grid's honest-empty patterns, plus the two refusals this agent generates
// itself: the draw gate turning down an invented level, and a feed that has
// nothing for a symbol.
const HONEST_EMPTY_RE = new RegExp(
    [
        'do(?:es)? not contain',
        'only annual',
        'not provided',
        'not disclosed',
        'no data available',
        'sources? (?:do(?:es)? not|lack)',
        'not applicable',
        'nothing was drawn',
        'not available (?:yet )?for',
        'could not (?:reach|retrieve)',
        'feed unreachable',
    ].join('|'),
    'i',
);

export const VERIFY_THRESHOLD: ReadonlySet<TrustGrade> = new Set(['D', 'F']);
export const MAX_ROUNDS = 2;

// Best first, so a verification round can be compared against the round it was
// meant to improve.
export const GRADE_RANK: Record<TrustGrade, number> = { A: 0, B: 1, C: 2, D: 3, F: 4 };

export function needsVerification(trust: AnswerTrust): boolean {
    return VERIFY_THRESHOLD.has(trust.grade) && trust.rounds < MAX_ROUNDS;
}

// Sentence-level adjacency, same rule the grid uses: a figure sitting in a
// sentence that carries at least one marker counts as cited.
function figureCiteCounts(text: string): { total: number; cited: number } {
    let total = 0;
    let cited = 0;
    for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
        const figs = extractFigures(sentence);
        total += figs.length;
        if (/\[\d+\]/.test(sentence)) cited += figs.length;
    }
    return { total, cited };
}

const gradeForScore = (score: number): TrustGrade =>
    score >= 70 ? 'B' : score >= 50 ? 'C' : score >= 30 ? 'D' : 'F';

export interface ScoreInput {
    answer: string;
    citations: DexterCitation[];
    steps: CellStep[];
    rounds?: number;
    /** Figures from the previous round — supplied only on a verification pass. */
    priorFigures?: string[];
}

export function scoreAnswerTrust(input: ScoreInput): AnswerTrust {
    const { answer, citations, steps, rounds = 1, priorFigures } = input;

    if (!answer.trim()) {
        return { grade: 'F', score: 0, rounds, reasons: ['no answer produced'] };
    }

    const figures = extractFigures(answer);

    // Checked FIRST so the ungrounded cap below never punishes honesty. The
    // figure guard keeps a figure-dense answer that merely mentions "not
    // provided" out of this path.
    if (HONEST_EMPTY_RE.test(answer) && figures.length <= 2) {
        return {
            grade: 'B',
            score: 75,
            honest: true,
            rounds,
            reasons: ['honest-empty: the answer states what is missing rather than filling the gap'],
        };
    }

    const reasons: string[] = [];
    let score = 0;

    const toolSteps = steps.filter(s => s.tool !== 'llm');
    const worked = toolSteps.filter(s => s.status === 'ok');
    if (worked.length > 0) {
        score += 30;
        reasons.push(`${worked.length} tool call(s) returned data`);
    } else {
        reasons.push(toolSteps.length === 0
            ? 'no tool was called (LLM-only, caps at C)'
            : 'every tool call came back empty or failed (caps at C)');
    }

    if (citations.length > 0) {
        score += Math.min(citations.length, 5) * 2;
        reasons.push(`${citations.length} citation(s) available`);
    } else {
        reasons.push('no citations (caps at C)');
    }

    const unmapped = findUnmappedCites(answer, citations);
    if (unmapped.length === 0) {
        score += 20;
        reasons.push('every [N] marker resolves to a real source');
    } else {
        // A citation pointing at nothing is the one failure that cannot be
        // outweighed by anything else in the answer.
        return {
            grade: 'F',
            score: 0,
            rounds,
            reasons: [`fabricated citation marker(s): [${unmapped.join('], [')}] — no such source`],
        };
    }

    const { total, cited } = figureCiteCounts(answer);
    score += Math.round(20 * (total === 0 ? 1 : cited / total));
    reasons.push(total === 0 ? 'no figures claimed' : `${cited}/${total} figures sit in a cited sentence`);

    let grade = gradeForScore(score);

    const grounded = worked.length > 0 && citations.length > 0;
    if (!grounded && (grade === 'A' || grade === 'B')) {
        grade = 'C';
        reasons.push('capped at C: nothing but the model stands behind this');
    }

    // Row 11: A is earned only by figures that survived a second pass.
    if (grade === 'B' && rounds >= 2 && priorFigures) {
        if (figures.length > 0 && figures.join('|') === priorFigures.join('|')) {
            grade = 'A';
            score = Math.min(100, score + 10);
            reasons.push('figures identical across two independent rounds');
        } else {
            reasons.push('figures moved between rounds — held at B');
        }
    }

    return { grade, score, rounds, reasons };
}

// Asks the model to re-derive the answer from the tools rather than to defend
// it. "Check your work" invites a restatement; this invites a recomputation.
export function buildVerifyPrompt(answer: string, trust: AnswerTrust): string {
    return (
        `That answer graded ${trust.grade} (${trust.reasons.join('; ')}).\n\n` +
        `Re-derive it from scratch. Call the tools again, and this time state only figures you ` +
        `read from a tool result, each with its [N] marker. If a figure is not available from a ` +
        `tool, say so plainly instead of estimating — an honest gap scores better than a ` +
        `confident guess.\n\nPrevious answer, for reference only:\n${answer}`
    );
}

export interface TrustChipProps {
    label: string;                                   // 'A'…'F', or 'B·honest'
    tone: 'green' | 'amber' | 'red' | 'honest';
    title: string;                                   // the earned reasons
}

export function chipPropsFor(trust: AnswerTrust): TrustChipProps {
    const tone = trust.honest ? 'honest'
        : trust.grade === 'A' || trust.grade === 'B' ? 'green'
        : trust.grade === 'C' ? 'amber'
        : 'red';
    return {
        label: trust.honest ? `${trust.grade}·honest` : trust.grade,
        tone,
        title: trust.reasons.join(' · '),
    };
}
