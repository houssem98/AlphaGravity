// Grid Trust — GT-1 foundation (docs/GRID_TRUST_ROADMAP.md Section 4 rows 1-2).
// Pure, deterministic scoring of a completed GridCell into a TrustScore.
// No LLM calls, no I/O — every signal is derived from the cell itself using
// the existing gridResearch primitives (extractFigures, findUnmappedCites).
//
// Grade semantics (earned, not assigned):
//   A — unreachable here: requires ≥2-round figure stability (GT-2 mergeRounds).
//   B — round-1 ceiling for RAG-grounded cells with resolving citations,
//       AND the grade for honest-empty answers (honesty is never punished).
//   C — ceiling for LLM-only cells (no RAG grounding or zero citations).
//   D/F — re-run triggers (TRUST_THRESHOLD): fabricated cites, uncited figures,
//       broken/error/empty cells.

import { extractFigures, findUnmappedCites, type GridCell } from './gridResearch';

export type TrustGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface TrustScore {
    grade: TrustGrade;
    score: number;        // 0-100
    reasons: string[];
    honest?: boolean;     // honest-empty answer — style as honesty, not failure
}

// Grades that trigger a verification re-run (Section 6 GT-1: D or F).
export const TRUST_THRESHOLD: ReadonlySet<TrustGrade> = new Set(['D', 'F']);

export function needsRerun(trust: TrustScore): boolean {
    return TRUST_THRESHOLD.has(trust.grade);
}

// Honest-empty detection (Section 4 row 2). Patterns per ledger spec plus the
// runner's own no-sources answer ("No data available for …").
const HONEST_EMPTY_RE = new RegExp(
    [
        'do(?:es)? not contain',
        'only annual',
        'not provided',
        'not disclosed',
        'no data available',
        'sources? (?:do(?:es)? not|lack)',
    ].join('|'),
    'i',
);

// Figures with an adjacent [N] marker: sentence-level adjacency. A figure in a
// sentence that carries at least one citation marker counts as cited.
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

export function scoreCellTrust(cell: GridCell): TrustScore {
    if (cell.status !== 'done' || !cell.answer) {
        return { grade: 'F', score: 0, reasons: [`cell not completed (status: ${cell.status})`] };
    }

    const answer = cell.answer;
    const citations = cell.citations ?? [];
    const figures = extractFigures(answer);

    // Row 2: honest-empty outranks every confident guess. Checked FIRST so the
    // LLM-only cap below never punishes honesty. The figure guard (≤2) keeps a
    // figure-dense answer that merely mentions "not provided" out of this path.
    if (HONEST_EMPTY_RE.test(answer) && figures.length <= 2) {
        return {
            grade: 'B',
            score: 75,
            honest: true,
            reasons: ['honest-empty: answer states what the sources lack — honesty is never punished'],
        };
    }

    const reasons: string[] = [];
    let score = 0;

    if (cell.ragUsed) {
        score += 30;
        reasons.push('RAG-grounded retrieval');
    } else {
        reasons.push('no RAG grounding (LLM-only, caps at C)');
    }

    if (citations.length > 0) {
        score += Math.min(citations.length, 5) * 2;
        reasons.push(`${citations.length} citation(s) returned`);
    } else {
        reasons.push('no citations (caps at C)');
    }

    const unmapped = findUnmappedCites(answer, citations);
    if (unmapped.length === 0) {
        score += 20;
        reasons.push('all [N] markers resolve to citations');
    } else {
        reasons.push(`fabricated citation marker(s): [${unmapped.join('], [')}]`);
    }

    const { total, cited } = figureCiteCounts(answer);
    const citedRatio = total === 0 ? 1 : cited / total;
    score += Math.round(20 * citedRatio);
    if (total === 0) reasons.push('no figures claimed');
    else reasons.push(`${cited}/${total} figures carry an adjacent [N] marker`);

    let grade = gradeForScore(score);
    // Row 1: LLM-only (ragUsed falsy or zero citations) caps at C.
    const grounded = Boolean(cell.ragUsed) && citations.length > 0;
    if (!grounded && (grade === 'A' || grade === 'B')) grade = 'C';

    return { grade, score, reasons };
}
