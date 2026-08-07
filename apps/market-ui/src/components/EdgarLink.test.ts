import { describe, it, expect } from 'vitest';
import { parseFilingTitle } from './EdgarLink';

describe('parseFilingTitle', () => {
    it('extracts form type and ISO filed date', () => {
        expect(parseFilingTitle('TSLA 10-K 2022-02-07')).toEqual({
            filingType: '10-K',
            filingDate: '2022-02-07',
        });
    });

    it('yields no date for fiscal-year titles — the resolver needs the filed date', () => {
        // "FY2021" is the period, not the filed date. Passing a period-end to the
        // resolver silently returns the LATEST filing, so this must stay empty
        // and let the caller fall back to EDGAR search.
        expect(parseFilingTitle('TSLA 10-K FY2021')).toEqual({
            filingType: '10-K',
            filingDate: '',
        });
    });

    it('handles missing/blank titles', () => {
        expect(parseFilingTitle(undefined)).toEqual({ filingType: '', filingDate: '' });
    });
});
