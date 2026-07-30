import { describe, it, expect } from 'vitest';
import {
    computeStructureStats, buildDesignJudgePrompt, DESIGN_DIMS, DESIGN_RUBRIC_VERSION,
} from './evalRubric';

const SAMPLE = `# Nvidia FY2026

## Executive Summary

Data center revenue reached $130.5B in FY2025, up 142% [1]. Margins held at 73% [2].

- Guidance implies 15% growth
- Supply constraints easing

## Risks

| Risk | Severity |
|---|---|
| China controls | High |

Concentration risk is **material**: top four customers are 46% of revenue [3].
`;

describe('computeStructureStats (G0a)', () => {
    it('counts sections, tables, bullets, bold, and units', () => {
        const s = computeStructureStats(SAMPLE);
        expect(s.sections).toBe(2);
        expect(s.tables).toBe(3);          // header + separator + 1 row
        expect(s.bulletLines).toBe(2);
        expect(s.boldSpans).toBe(1);
        expect(s.numbersWithUnits).toBeGreaterThanOrEqual(5); // $130.5B, 142%, 73%, 15%, 46%
    });

    it('balanceRatio flags a lopsided document', () => {
        const section = (n: number, len: number) => `## S${n}\n` + 'x'.repeat(len);
        const even = computeStructureStats([1, 2, 3, 4].map(n => section(n, 500)).join('\n\n'));
        expect(even.balanceRatio).toBeLessThanOrEqual(1.1);
        const lopsided = computeStructureStats(
            [section(1, 400), section(2, 400), section(3, 400), section(4, 3000)].join('\n\n'));
        expect(lopsided.balanceRatio).toBeGreaterThan(5);
    });

    it('uses a true median on even section counts (not the upper value)', () => {
        // 100 vs 2000: upper-element median would give ratio 1.0 — blind.
        const s = computeStructureStats('## A\n' + 'x'.repeat(100) + '\n\n## B\n' + 'y'.repeat(2000));
        expect(s.balanceRatio).toBeGreaterThan(1.5);
    });

    it('returns zeros on an empty document instead of NaN', () => {
        const s = computeStructureStats('');
        expect(s.sections).toBe(0);
        expect(s.balanceRatio).toBe(0);
        expect(s.avgParagraphChars).toBe(0);
    });

    it('excludes headings, tables, and bullets from paragraph length', () => {
        const s = computeStructureStats('## H\n\n| a | b |\n\n- bullet\n\nReal prose paragraph here.');
        expect(s.avgParagraphChars).toBe('Real prose paragraph here.'.length);
    });
});

describe('buildDesignJudgePrompt (G0a)', () => {
    it('asks for every design dim and forbids pixel judgments', () => {
        const p = buildDesignJudgePrompt('q', SAMPLE);
        for (const dim of DESIGN_DIMS) expect(p).toContain(dim);
        expect(p).toContain('not pixels');
        expect(DESIGN_RUBRIC_VERSION).toBe('gamma-design-v1');
    });

    it('clamps very long reports so the judge call stays bounded', () => {
        const p = buildDesignJudgePrompt('q', 'z'.repeat(50_000));
        expect(p.length).toBeLessThan(32_000);
    });
});
