// GT-1 regression tests — docs/GRID_TRUST_ROADMAP.md Section 4 rows 1-2
// plus scoring monotonicity. Run: npx vitest run src/services/gridTrust.test.ts

import { describe, it, expect } from 'vitest';
import { scoreCellTrust, needsRerun, TRUST_THRESHOLD, normalizeFigure, consensusFigures, mergeRounds, chipPropsFor } from './gridTrust';
import { extractFigures, type GridCell } from './gridResearch';
import type { Citation } from './deepResearchService';

const mkCite = (id: number): Citation => ({
    id, title: `Source ${id}`, url: `gravity://source/${id}`, source: 'gravity',
});

const mkCell = (patch: Partial<GridCell>): GridCell => ({
    ticker: 'AAPL', promptId: 'valuation', status: 'done', ...patch,
});

describe('gridTrust — scoreCellTrust', () => {
    // ── Row 1: LLM-only caps at grade C ─────────────────────────────────────
    it('row 1: ragUsed falsy caps at C even with confident figures', () => {
        const t = scoreCellTrust(mkCell({
            answer: 'Revenue grew to $416,161M [1], operating margin 46% [2].',
            ragUsed: false,
            citations: [mkCite(1), mkCite(2)],
        }));
        expect(['C', 'D', 'F']).toContain(t.grade);
    });

    it('row 1: zero citations caps at C even when ragUsed is true', () => {
        const t = scoreCellTrust(mkCell({
            answer: 'Operating margin improved to 46% [3].',
            ragUsed: true,
            citations: [],
        }));
        expect(['C', 'D', 'F']).toContain(t.grade);
    });

    // ── Row 2: honest-empty scores B-honest, never below C ──────────────────
    it('row 2: "sources do not contain" answer scores B with honest flag', () => {
        const t = scoreCellTrust(mkCell({
            answer: 'The sources do not contain quarterly segment data; only annual figures are provided.',
            ragUsed: true,
            citations: [mkCite(1)],
        }));
        expect(t.grade).toBe('B');
        expect(t.honest).toBe(true);
    });

    it('row 2: runner no-sources honest answer is never punished below C', () => {
        const t = scoreCellTrust(mkCell({
            answer: 'No data available for "AAPL price target" in SEC filings or public sources. Check investor relations page.',
            ragUsed: false,
            citations: [],
            modelUsed: 'no-sources',
        }));
        expect(['A', 'B', 'C']).toContain(t.grade);
        expect(t.honest).toBe(true);
    });

    it('row 2: honest-empty ranks above a confident LLM-only guess', () => {
        const honest = scoreCellTrust(mkCell({
            answer: 'Quarterly dividend history is not provided in the filings.',
            ragUsed: false, citations: [],
        }));
        const guess = scoreCellTrust(mkCell({
            answer: 'Dividend was raised 4% to $0.26 per share, payout ratio 15%.',
            ragUsed: false, citations: [],
        }));
        expect(honest.score).toBeGreaterThan(guess.score);
    });

    it('row 2 guard: figure-dense answer mentioning "not provided" is NOT honest-empty', () => {
        const t = scoreCellTrust(mkCell({
            answer: 'Revenue $416,161M [1], margin 46% [2], EPS $6.11 [3], FCF $99B [4]; segment detail not provided.',
            ragUsed: true,
            citations: [mkCite(1), mkCite(2), mkCite(3), mkCite(4)],
        }));
        expect(t.honest).toBeUndefined();
    });

    // ── Monotonicity: adding a resolving citation never lowers score ────────
    it('monotonicity: resolving a fabricated [N] raises score, never lowers it', () => {
        const answer = 'Revenue $416,161M [1], margin 46% [2].';
        const before = scoreCellTrust(mkCell({ answer, ragUsed: true, citations: [mkCite(1)] }));
        const after = scoreCellTrust(mkCell({ answer, ragUsed: true, citations: [mkCite(1), mkCite(2)] }));
        expect(after.score).toBeGreaterThanOrEqual(before.score);
        expect(after.grade).toBe('B'); // grounded + fully resolving = round-1 ceiling
    });

    // ── Round-1 ceiling: A unreachable from single-round scoring ────────────
    it('grade A is unreachable in round 1 (stability requires ≥2 rounds)', () => {
        const t = scoreCellTrust(mkCell({
            answer: 'Revenue was $416,161M [1]. Margin 46% [2].',
            ragUsed: true,
            citations: [mkCite(1), mkCite(2)],
        }));
        expect(t.grade).not.toBe('A');
    });

    // ── Broken cells + threshold ────────────────────────────────────────────
    it('error cell scores F and triggers re-run', () => {
        const t = scoreCellTrust(mkCell({ status: 'error', error: 'boom' }));
        expect(t.grade).toBe('F');
        expect(needsRerun(t)).toBe(true);
    });

    it('fabricated cites drag a grounded cell to re-run territory reasons', () => {
        const t = scoreCellTrust(mkCell({
            answer: 'Margin was 46% [9].',
            ragUsed: true,
            citations: [mkCite(1)],
        }));
        expect(t.reasons.join(' ')).toMatch(/fabricated/);
    });

    it('TRUST_THRESHOLD is exactly {D, F}; B/C cells do not re-run', () => {
        expect([...TRUST_THRESHOLD].sort()).toEqual(['D', 'F']);
        expect(needsRerun({ grade: 'B', score: 75, reasons: [] })).toBe(false);
        expect(needsRerun({ grade: 'C', score: 55, reasons: [] })).toBe(false);
    });
});

// ─── GT-2: consensus + round merging (rows 3, 4, 5, 9, 10) ──────────────────

const evCite = (id: number, text: string): Citation => ({
    id, title: `Source ${id}`, url: `gravity://source/${id}`, source: 'gravity',
    sourceData: { text },
});

describe('gridTrust — normalizeFigure', () => {
    it('unit normalizer: $97,690M ≡ $97.69B ≡ $97,690 million', () => {
        expect(normalizeFigure('$97,690m')).toBe(normalizeFigure('$97.69b'));
        expect(normalizeFigure('$97,690m')).toBe(normalizeFigure('$97,690 million'));
    });

    it('percent is its own kind: 46% ≠ 46', () => {
        expect(normalizeFigure('46%')).not.toBe(normalizeFigure('46'));
    });
});

describe('gridTrust — consensusFigures', () => {
    it('row 4: identical figure sets → all agree, no conflict', () => {
        // real pipeline tokens: extractFigures drops '%' ('46%' → '46')
        const c = consensusFigures(
            extractFigures('Revenue was $416,161M [1]. Operating margin 46% [2].'),
            extractFigures('Revenue $416,161M and margin 46% independently derived [1].'),
            'Revenue was $416,161 million and margin 46% per filing.',
        );
        expect(c.agree.sort()).toEqual(['$416,161m', '46'].sort());
        expect(c.conflict).toEqual([]);
        expect(c.unverified).toEqual([]);
    });

    it('row 4: differing figure present in both rounds → conflict with both values', () => {
        const c = consensusFigures(['$416,161m'], ['$420,000m'], 'Revenue of $420,000 million reported.');
        expect(c.agree).toEqual([]);
        expect(c.conflict).toEqual([{ r1: '$416,161m', r2: '$420,000m' }]);
    });

    it('unit-equivalent figures agree across notations ($97,690M vs $97.69B)', () => {
        const c = consensusFigures(['$97,690m'], ['$97.69b'], 'FCF was $97.69B in FY2025.');
        expect(c.agree).toEqual(['$97,690m']);
        expect(c.conflict).toEqual([]);
    });

    it('row 5: r2 figure absent from r2 evidence text → unverified, never agree/conflict', () => {
        const c = consensusFigures(['$416,161m'], ['$416,161m', '$500b'], 'Revenue $416,161 million.');
        expect(c.agree).toEqual(['$416,161m']);
        expect(c.unverified).toEqual(['$500b']);
        expect(c.conflict).toEqual([]);
    });
});

describe('gridTrust — mergeRounds', () => {
    const r1Grounded = mkCell({
        answer: 'Revenue was $416,161M [1]. Operating margin 46% [2].',
        ragUsed: true,
        citations: [mkCite(1), mkCite(2)],
    });

    it('row 3: grade A only after 2-round figure stability on a grounded B cell', () => {
        const r2 = mkCell({
            answer: 'Independently derived: revenue $416,161M [1], margin 46% [1].',
            citations: [evCite(1, 'AAPL 10-K: total net sales $416,161 million, operating margin 46%')],
        });
        const merged = mergeRounds(r1Grounded, r2);
        expect(merged.trust?.grade).toBe('A');
        expect(merged.rounds).toBe(2);
        expect(merged.answer).toBe(r1Grounded.answer); // r1 prose survives
    });

    it('row 3: no A without grounding — LLM-only r1 stays capped even when stable', () => {
        const r1 = mkCell({ answer: 'Revenue $416,161M.', ragUsed: false, citations: [] });
        const r2 = mkCell({
            answer: 'Revenue $416,161M [1].',
            citations: [evCite(1, 'revenue $416,161 million')],
        });
        expect(['C', 'D', 'F']).toContain(mergeRounds(r1, r2).trust?.grade);
    });

    it('row 9: figure conflict → grade capped at D + contradictions[] holds both values', () => {
        const r2 = mkCell({
            answer: 'Revenue was $420,000M [1]. Margin 46% [1].',
            citations: [evCite(1, 'net sales $420,000 million, margin 46%')],
        });
        const merged = mergeRounds(r1Grounded, r2);
        expect(merged.trust?.grade).toBe('D');
        expect(merged.contradictions).toHaveLength(1);
        expect(merged.contradictions?.[0]).toContain('$416,161m');
        expect(merged.contradictions?.[0]).toContain('$420,000m');
    });

    it('row 5: unverified r2 figure never influences the merge (no conflict from it)', () => {
        const r2 = mkCell({
            answer: 'Revenue $416,161M [1], margin 46% [1]. Also EPS jumped to $9.99.',
            citations: [evCite(1, 'net sales $416,161 million, operating margin 46%')],
        });
        const merged = mergeRounds(r1Grounded, r2);
        expect(merged.trust?.grade).toBe('A'); // $9.99 unverified → ignored, stability intact
        expect(merged.contradictions).toBeUndefined();
    });

    it('row 10: cancelled verification round leaves round-1 cell intact', () => {
        const r2 = mkCell({ status: 'cancelled' });
        expect(mergeRounds(r1Grounded, r2)).toBe(r1Grounded);
    });

    it('row 10: error verification round leaves round-1 cell intact', () => {
        const r2 = mkCell({ status: 'error', error: 'timeout' });
        expect(mergeRounds(r1Grounded, r2)).toBe(r1Grounded);
    });

    it('row 12: chip tones — A/B green, C amber, D/F red, honest never failure-styled', () => {
        expect(chipPropsFor({ grade: 'A', score: 92, reasons: ['stable'] }).tone).toBe('green');
        expect(chipPropsFor({ grade: 'B', score: 74, reasons: [] }).tone).toBe('green');
        expect(chipPropsFor({ grade: 'C', score: 55, reasons: [] }).tone).toBe('amber');
        expect(chipPropsFor({ grade: 'D', score: 35, reasons: [] }).tone).toBe('red');
        expect(chipPropsFor({ grade: 'F', score: 0, reasons: [] }).tone).toBe('red');
        const honest = chipPropsFor({ grade: 'B', score: 75, reasons: ['honest-empty'], honest: true });
        expect(honest.tone).toBe('honest');
        expect(honest.label).toBe('B·honest');
    });

    it('row 12: chip tooltip carries the earned reasons', () => {
        const p = chipPropsFor({ grade: 'D', score: 32, reasons: ['no RAG grounding', 'fabricated [9]'] });
        expect(p.title).toBe('no RAG grounding · fabricated [9]');
        expect(p.label).toBe('D');
    });

    it('roundHistory bounded to 3 entries, answers truncated to 2k chars', () => {
        const longAnswer = `Revenue $416,161M [1]. ${'x'.repeat(3000)}`;
        const r2 = mkCell({
            answer: longAnswer,
            citations: [evCite(1, 'net sales $416,161 million')],
        });
        let cell = r1Grounded;
        for (let i = 0; i < 4; i += 1) cell = mergeRounds(cell, r2);
        expect(cell.roundHistory).toHaveLength(3);
        expect(cell.roundHistory!.every(h => h.answer.length <= 2000)).toBe(true);
        expect(cell.rounds).toBe(5);
    });
});
