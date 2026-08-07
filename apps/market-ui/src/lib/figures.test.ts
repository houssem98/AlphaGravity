import { describe, it, expect } from 'vitest';
import { NULL_MARK, periodLabel, unitLabel, figureAttrs } from './figures';

// CT-5 · rows 7 and 7c. The point of these is what the helpers REFUSE to do.

describe('periodLabel', () => {
    it('marks a missing period rather than omitting it', () => {
        expect(periodLabel(undefined)).toBe(NULL_MARK);
        expect(periodLabel('')).toBe(NULL_MARK);
        expect(periodLabel('   ')).toBe(NULL_MARK);
    });

    it('states the fiscal-year-end month when the payload supplies one', () => {
        expect(periodLabel('FY2026', 'January')).toBe('FY2026 · FYE January');
    });

    it('says it does not know the period-end rather than guessing it', () => {
        expect(periodLabel('FY2026')).toBe(`FY2026 · FYE ${NULL_MARK}`);
        expect(periodLabel('FY2026', '')).toBe(`FY2026 · FYE ${NULL_MARK}`);
    });

    it('never derives the calendar year from the FY label', () => {
        // "FY2026" + "January" does NOT license "ended January 2026" — that is a
        // labelling convention the payload never states (doctrine 5).
        expect(periodLabel('FY2026', 'January')).not.toMatch(/2026\s*$/);
        expect(periodLabel('FY2026', 'January')).not.toContain('ended');
    });

    it('leaves a non-fiscal period exactly as the payload gave it', () => {
        expect(periodLabel('2025-10-31')).toBe('2025-10-31');
        expect(periodLabel('Q3 2025')).toBe('Q3 2025');
        expect(periodLabel('TTM')).toBe('TTM');
    });
});

describe('unitLabel', () => {
    it('marks a missing unit rather than inferring one from the number', () => {
        expect(unitLabel(undefined)).toBe(NULL_MARK);
        expect(unitLabel('')).toBe(NULL_MARK);
        expect(unitLabel('  ')).toBe(NULL_MARK);
    });

    it('passes a stated unit through', () => {
        expect(unitLabel('USD')).toBe('USD');
        expect(unitLabel(' % ')).toBe('%');
    });
});

describe('figureAttrs', () => {
    it('always emits both parts, so no figure can render unannotated', () => {
        const bare = figureAttrs(undefined, undefined);
        expect(bare['data-figure']).toBe(true);
        expect(bare['data-period']).toBe(NULL_MARK);
        expect(bare['data-unit']).toBe(NULL_MARK);
    });

    it('carries the same tokens the cell shows', () => {
        const a = figureAttrs('FY2026', 'USD', 'January');
        expect(a['data-period']).toBe('FY2026 · FYE January');
        expect(a['data-unit']).toBe('USD');
    });
});
