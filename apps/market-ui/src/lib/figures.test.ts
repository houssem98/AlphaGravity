import { describe, it, expect } from 'vitest';
import { NULL_MARK, periodLabel, unitLabel, figureAttrs, sourceLabel } from './figures';

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

    it('emits a source part too, marked when none was supplied (CT2-3, row R4)', () => {
        expect(figureAttrs(undefined, undefined)['data-source']).toBe(NULL_MARK);
        expect(figureAttrs('FY2026', 'USD', 'January', '   ')['data-source']).toBe(NULL_MARK);
        expect(figureAttrs('FY2026', 'USD', 'January', '10-K · 2026-02-26')['data-source'])
            .toBe('10-K · 2026-02-26');
    });
});

// CT2-3 · row R4. §3 rule 1: resolution is an id lookup and nothing else.
describe('sourceLabel', () => {
    const filings = [
        { id: 'abbc9d90-5bb1-487b-847b-f666bfe7c542', filing_type: '10-K', filing_date: '2026-02-26' },
        { id: 'c0ffee00-0000-4000-8000-000000000001', filing_type: '10-Q', filing_date: null },
    ];

    it('names the filing type and date of the filing the id resolves to', () => {
        expect(sourceLabel('abbc9d90-5bb1-487b-847b-f666bfe7c542', filings))
            .toBe('10-K · 2026-02-26');
    });

    it('marks each half it was not given rather than omitting the half', () => {
        expect(sourceLabel('c0ffee00-0000-4000-8000-000000000001', filings))
            .toBe(`10-Q · ${NULL_MARK}`);
    });

    it('marks a missing, blank or unresolvable id', () => {
        expect(sourceLabel(undefined, filings)).toBe(NULL_MARK);
        expect(sourceLabel('', filings)).toBe(NULL_MARK);
        expect(sourceLabel('   ', filings)).toBe(NULL_MARK);
        expect(sourceLabel('no-such-id', filings)).toBe(NULL_MARK);
        expect(sourceLabel('abbc9d90-5bb1-487b-847b-f666bfe7c542', [])).toBe(NULL_MARK);
    });

    it('refuses the constant CT2-2 measured in production', () => {
        // 402 NVDA rows, 1 distinct document_id, the literal string "xbrl:NVDA".
        // It is a source TAG. Rendering it as a citation is the failure R5 grades.
        expect(sourceLabel('xbrl:NVDA', filings)).toBe(NULL_MARK);
    });

    it('never resolves by period, however well the dates line up', () => {
        const byPeriod = [{ id: 'real-id', filing_type: '10-K', filing_date: '2026-02-26' }];
        expect(sourceLabel('2026-02-26', byPeriod)).toBe(NULL_MARK);
        expect(sourceLabel('FY2026', byPeriod)).toBe(NULL_MARK);
        expect(sourceLabel('10-K', byPeriod)).toBe(NULL_MARK);
    });
});
