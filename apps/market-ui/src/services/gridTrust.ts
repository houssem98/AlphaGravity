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

// ─── GT-4: trust chip props (Section 4 row 12) ──────────────────────────────
// Pure mapping TrustScore → chip rendering props. F/D red, C amber, A/B green;
// honest-empty gets its own tone (honesty is never styled as failure).

export interface TrustChipProps {
    label: string;                              // 'A'…'F', or 'B·honest'
    tone: 'green' | 'amber' | 'red' | 'honest';
    title: string;                              // tooltip = the earned reasons
}

export function chipPropsFor(trust: TrustScore): TrustChipProps {
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

// ─── GT-2: figure consensus + round merging (Section 4 rows 3, 4, 5, 9, 10) ──

// Canonical form for one extractFigures() token so $97,690M ≡ $97.69B.
// Percentages are their own kind ("pct:46" never equals plain "46").
const UNIT_MULT: Record<string, number> = {
    k: 1e3, m: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, trillion: 1e12,
};

export function normalizeFigure(fig: string): string {
    const s = fig.toLowerCase().replace(/[\s,]/g, '');
    const m = s.match(/^\$?(\d+(?:\.\d+)?)(%|bn|billion|trillion|million|[mbk])?$/);
    if (!m) return s;
    if (m[2] === '%') return `pct:${Number(parseFloat(m[1]).toPrecision(12))}`;
    const value = parseFloat(m[1]) * (UNIT_MULT[m[2] ?? ''] ?? 1);
    return String(Number(value.toPrecision(12)));
}

const canonValue = (fig: string): number =>
    parseFloat(normalizeFigure(fig).replace(/^pct:/, ''));

export interface FigureConsensus {
    agree: string[];                          // r1 figures re-derived by round 2
    conflict: Array<{ r1: string; r2: string }>; // both values captured (row 4)
    unverified: string[];                     // r2 figures absent from r2 evidence (row 5)
}

// r2EvidenceText = the round-2 citations' text (titles + source passages).
// Row 5: an r2 figure that does not appear there can never reach agree/conflict.
export function consensusFigures(r1: string[], r2: string[], r2EvidenceText: string): FigureConsensus {
    const evidence = new Set(extractFigures(r2EvidenceText).map(normalizeFigure));
    const verified: string[] = [];
    const unverified: string[] = [];
    for (const f of r2) (evidence.has(normalizeFigure(f)) ? verified : unverified).push(f);

    const verifiedNorms = new Set(verified.map(normalizeFigure));
    const agree = r1.filter(f => verifiedNorms.has(normalizeFigure(f)));
    const agreeNorms = new Set(agree.map(normalizeFigure));
    const r1Left = r1.filter(f => !agreeNorms.has(normalizeFigure(f)));
    const r2Left = verified.filter(f => !agreeNorms.has(normalizeFigure(f)));

    // Pair leftovers within the same kind (pct vs magnitude) in value order —
    // deterministic conflict pairing without metric labels.
    const conflict: Array<{ r1: string; r2: string }> = [];
    for (const kind of ['pct', 'num']) {
        const ofKind = (f: string) => (normalizeFigure(f).startsWith('pct:') ? 'pct' : 'num') === kind;
        const a = r1Left.filter(ofKind).sort((x, y) => canonValue(x) - canonValue(y));
        const b = r2Left.filter(ofKind).sort((x, y) => canonValue(x) - canonValue(y));
        for (let i = 0; i < Math.min(a.length, b.length); i += 1) conflict.push({ r1: a[i], r2: b[i] });
    }
    return { agree, conflict, unverified };
}

const HISTORY_MAX = 3;      // bounded per Section 3
const ANSWER_TRUNC = 2000;  // keep JSONB rows small

// Merge a verification round into the round-1 cell. The r1 prose is ALWAYS the
// answer that survives — round 2 only verifies; its figures are never adopted
// into the cell (row 5). Grade A is earned here and only here (row 3).
export function mergeRounds(r1: GridCell, r2: GridCell): GridCell {
    // Row 10: cancelled/error/empty verification round → round-1 cell intact.
    if (r2.status !== 'done' || !r2.answer) return r1;

    // Verifying a broken r1 (error/cancelled — graded F, so re-run): the fresh
    // round IS the answer now; score it as a round-1 cell.
    if (r1.status !== 'done' || !r1.answer) {
        return {
            ...r2,
            rounds: (r1.rounds ?? 1) + 1,
            roundHistory: [{ answer: r2.answer.slice(0, ANSWER_TRUNC), figures: extractFigures(r2.answer) }],
            trust: scoreCellTrust(r2),
        };
    }

    const r1Figs = extractFigures(r1.answer);
    const r2Figs = extractFigures(r2.answer);
    const evidenceText = (r2.citations ?? [])
        .map(c => [c.title, c.sourceData?.text].filter(Boolean).join(' '))
        .join('\n');
    const consensus = consensusFigures(r1Figs, r2Figs, evidenceText);

    const rounds = (r1.rounds ?? 1) + 1;
    const roundHistory = [
        ...(r1.roundHistory ?? [{ answer: r1.answer.slice(0, ANSWER_TRUNC), figures: r1Figs }]),
        { answer: r2.answer.slice(0, ANSWER_TRUNC), figures: r2Figs },
    ].slice(-HISTORY_MAX);

    const merged: GridCell = { ...r1, rounds, roundHistory };
    const base = scoreCellTrust(merged);

    const newContradictions = consensus.conflict.map(c => `round1: ${c.r1} vs round2: ${c.r2}`);
    const contradictions = [...(r1.contradictions ?? []), ...newContradictions];

    if (contradictions.length > 0) {
        // Row 9: contradiction → grade capped at D, both values surfaced.
        merged.contradictions = contradictions;
        merged.trust = {
            grade: base.grade === 'F' ? 'F' : 'D',
            score: Math.min(base.score, 45),
            reasons: [`${contradictions.length} figure contradiction(s) across rounds`, ...contradictions],
        };
        return merged;
    }

    const stable = consensus.agree.length > 0;
    if (stable && base.grade === 'B' && !base.honest) {
        // Row 3: A = RAG + resolving citations (grade B implies both) + stability.
        merged.trust = {
            grade: 'A',
            score: Math.max(base.score, 90),
            reasons: [`${consensus.agree.length} figure(s) stable across ${rounds} rounds`, ...base.reasons],
        };
    } else {
        const reasons = [...base.reasons,
            stable ? 'figures stable but grounding insufficient for A' : 'no figure overlap across rounds — not promoted'];
        if (consensus.unverified.length > 0) {
            reasons.push(`unverified round-2 figure(s) ignored: ${consensus.unverified.join(', ')}`);
        }
        merged.trust = { ...base, reasons };
    }
    return merged;
}
