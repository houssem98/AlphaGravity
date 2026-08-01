// DX-7 regression tests — docs/AI_TRADING_AGENT_ROADMAP.md Section 6 rows 10 and 11.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    scoreAnswerTrust, needsVerification, buildVerifyPrompt, chipPropsFor,
    GRADE_RANK, MAX_ROUNDS, VERIFY_THRESHOLD,
} from './dexterTrust';
import type { CellStep } from './gridTrace';
import type { DexterCitation } from './dexterTools';

const cite = (id: number): DexterCitation =>
    ({ id, title: `BTC reading price history`, source: 'getChartData', text: '60 bars' });

const step = (tool: string, status: CellStep['status']): CellStep =>
    ({ label: tool, tool, ms: 100, status });

const GROUNDED = [step('llm', 'ok'), step('getChartData', 'ok'), step('llm', 'ok')];
const LLM_ONLY = [step('llm', 'ok')];

describe('row 10 — the grade is earned', () => {
    it('caps a tool-grounded, fully cited answer at B in round one', () => {
        const t = scoreAnswerTrust({
            answer: 'The highest close was $66,556.16 and the lowest was $58,624.71 [1].',
            citations: [cite(1)],
            steps: GROUNDED,
        });
        expect(t.grade).toBe('B');
        expect(t.rounds).toBe(1);
        expect(t.reasons.join(' ')).toContain('1 tool call(s) returned data');
    });

    // C is a CEILING for ungrounded answers, not a floor: a weak one still
    // grades below it and earns a verification round.
    it('caps an LLM-only answer at C however well it is written', () => {
        const best = scoreAnswerTrust({
            answer: 'BTC support sits near $62,510.28 [1] and resistance near $65,655.81 [1].',
            citations: [cite(1), cite(2), cite(3), cite(4), cite(5)],
            steps: LLM_ONLY,
        });
        expect(best.grade).toBe('C');
        expect(best.reasons.join(' ')).toContain('no tool was called');

        const thin = scoreAnswerTrust({
            answer: 'BTC support sits near $62,510.28 [1].',
            citations: [cite(1)],
            steps: LLM_ONLY,
        });
        expect(thin.grade).toBe('D');   // below the ceiling → gets re-run
    });

    it('caps an answer with no citations at C', () => {
        const t = scoreAnswerTrust({
            answer: 'The highest close was $66,556.16.',
            citations: [],
            steps: GROUNDED,
        });
        expect(t.grade).toBe('C');
        expect(t.reasons.join(' ')).toContain('no citations');
    });

    it('fails an answer that cites a source which does not exist', () => {
        const t = scoreAnswerTrust({
            answer: 'Revenue grew 12% [4] last quarter.',
            citations: [cite(1)],
            steps: GROUNDED,
        });
        expect(t.grade).toBe('F');
        expect(t.score).toBe(0);
        expect(t.reasons[0]).toContain('fabricated citation marker(s): [4]');
    });

    it('gives an honest gap a B and marks it as honesty, not failure', () => {
        const t = scoreAnswerTrust({
            answer: 'Financial statements are not available yet for BVMT listings.',
            citations: [],
            steps: LLM_ONLY,
        });
        expect(t.grade).toBe('B');
        expect(t.honest).toBe(true);
        expect(chipPropsFor(t).tone).toBe('honest');
        expect(chipPropsFor(t).label).toBe('B·honest');
    });

    it('treats the draw gate refusing an invented level as honesty', () => {
        const t = scoreAnswerTrust({
            answer: '$1,000 is not a real support level on this chart, so nothing was drawn.',
            citations: [],
            steps: [step('llm', 'ok'), step('drawTechnicalAnalysis', 'empty')],
        });
        expect(t.honest).toBe(true);
        expect(t.grade).toBe('B');
    });

    it('does not let a figure-dense answer hide behind one honest phrase', () => {
        const t = scoreAnswerTrust({
            answer: 'P/E is not disclosed, but revenue was $1.2bn, margin 34%, EPS $2.15, debt $900m.',
            citations: [],
            steps: LLM_ONLY,
        });
        expect(t.honest).toBeUndefined();
        // Four uncited figures, no tool, no sources — this is the shape the
        // honest-empty path exists to keep OUT, so it fails and gets re-run.
        expect(t.grade).toBe('F');
        expect(needsVerification(t)).toBe(true);
    });

    it('fails an empty answer outright', () => {
        expect(scoreAnswerTrust({ answer: '   ', citations: [], steps: [] })).toMatchObject({ grade: 'F', score: 0 });
    });

    it('penalises figures that sit in uncited sentences', () => {
        const cited = scoreAnswerTrust({
            answer: 'Close was $63,076.01 [1].',
            citations: [cite(1)], steps: GROUNDED,
        });
        const half = scoreAnswerTrust({
            answer: 'Close was $63,076.01 [1]. Support is probably $55,000.',
            citations: [cite(1)], steps: GROUNDED,
        });
        expect(half.score).toBeLessThan(cited.score);
    });
});

describe('row 11 — the verification round', () => {
    it('asks for another round on D and F only', () => {
        for (const g of ['D', 'F'] as const) expect(VERIFY_THRESHOLD.has(g)).toBe(true);
        for (const g of ['A', 'B', 'C'] as const) expect(VERIFY_THRESHOLD.has(g)).toBe(false);
    });

    it('stops after the cap, however bad the answer stays', () => {
        const bad = { grade: 'F' as const, score: 0, reasons: [], rounds: 1 };
        expect(needsVerification(bad)).toBe(true);
        expect(needsVerification({ ...bad, rounds: MAX_ROUNDS })).toBe(false);
    });

    it('never re-runs an answer that already passed', () => {
        expect(needsVerification({ grade: 'B', score: 78, reasons: [], rounds: 1 })).toBe(false);
    });

    it('asks the model to re-derive, not to defend', () => {
        const p = buildVerifyPrompt('old answer', { grade: 'F', score: 0, reasons: ['no citations'], rounds: 1 });
        expect(p).toContain('Re-derive it from scratch');
        expect(p).toContain('no citations');
        expect(p).toContain('an honest gap scores better than a confident guess');
    });

    it('awards A only when the figures survive a second round unchanged', () => {
        const answer = 'The high was $66,556.16 and the low was $58,624.71 [1].';
        const stable = scoreAnswerTrust({
            answer, citations: [cite(1)], steps: GROUNDED,
            rounds: 2, priorFigures: ['$58,624.71', '$66,556.16'],
        });
        expect(stable.grade).toBe('A');
        expect(stable.reasons.join(' ')).toContain('identical across two independent rounds');
    });

    it('holds at B when the figures moved between rounds', () => {
        const moved = scoreAnswerTrust({
            answer: 'The high was $66,556.16 and the low was $58,624.71 [1].',
            citations: [cite(1)], steps: GROUNDED,
            rounds: 2, priorFigures: ['$59,000.00', '$67,000.00'],
        });
        expect(moved.grade).toBe('B');
        expect(moved.reasons.join(' ')).toContain('figures moved between rounds');
    });

    it('cannot reach A in a single round however good the answer is', () => {
        const t = scoreAnswerTrust({
            answer: 'The high was $66,556.16 [1].',
            citations: [cite(1), cite(2), cite(3), cite(4), cite(5)],
            steps: GROUNDED,
        });
        expect(t.grade).not.toBe('A');
    });

    it('ranks grades so a worse verification round can be rejected', () => {
        expect(GRADE_RANK.A).toBeLessThan(GRADE_RANK.B);
        expect(GRADE_RANK.B).toBeLessThan(GRADE_RANK.C);
        expect(GRADE_RANK.D).toBeLessThan(GRADE_RANK.F);
    });
});

describe('row 11 — wired into the handler', () => {
    const handler = readFileSync(join(__dirname, '../../api/agent/[fn].ts'), 'utf8');

    it('runs a verification round when the grade demands it', () => {
        expect(handler).toMatch(/if \(needsVerification\(trust\)\)/);
        expect(handler).toMatch(/rounds: 2, priorFigures/);
    });

    it('keeps the better round rather than assuming the retry improved things', () => {
        expect(handler).toMatch(/GRADE_RANK\[secondTrust\.grade\] <= GRADE_RANK\[trust\.grade\]/);
        expect(handler).toMatch(/verification round scored worse — kept round 1/);
    });

    it('ships the grade with every answer', () => {
        expect(handler).toMatch(/^\s*trust,$/m);
    });
});
