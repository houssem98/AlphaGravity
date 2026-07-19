// GT-1 regression tests — docs/GRID_TRUST_ROADMAP.md Section 4 rows 1-2
// plus scoring monotonicity. Run: npx vitest run src/services/gridTrust.test.ts

import { describe, it, expect } from 'vitest';
import { scoreCellTrust, needsRerun, TRUST_THRESHOLD } from './gridTrust';
import type { GridCell } from './gridResearch';
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
