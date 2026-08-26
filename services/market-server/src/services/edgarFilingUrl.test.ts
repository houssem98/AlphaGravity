// The deep-research SEC path had the same bug as the search source path: it
// queried EDGAR full-text search, received hits that name their filing exactly,
// and then handed the reader
// `browse-edgar?action=getcompany&company=<name>&type=10-K` for every one.
//
// An EFTS hit carries the accession in `_id` ("<accession>:<document>") and the
// filer in `_source.ciks`, so the exact filing was already known.
import { describe, it, expect } from 'vitest';
import { edgarFilingUrlFromHit } from './deepResearchService';

const EXACT =
    'https://www.sec.gov/Archives/edgar/data/821189/000082118925000011/0000821189-25-000011-index.htm';

// The shape EDGAR full-text search really returns.
const EOG_HIT = {
    _id: '0000821189-25-000011:eog-20241231.htm',
    _source: {
        ciks: ['0000821189'],
        file_type: '10-K',
        file_date: '2025-02-27',
    },
};

describe('edgarFilingUrlFromHit', () => {
    it('builds the exact EOG filing URL from an EFTS hit', () => {
        expect(edgarFilingUrlFromHit(EOG_HIT)).toBe(EXACT);
    });

    it('strips the leading zeros from the CIK and the hyphens from the path', () => {
        const url = edgarFilingUrlFromHit(EOG_HIT);
        expect(url).toContain('/data/821189/');
        expect(url).toContain('/000082118925000011/');
    });

    it('never returns a generic company listing', () => {
        expect(edgarFilingUrlFromHit(EOG_HIT)).not.toContain('browse-edgar');
    });

    it('is not hardcoded to EOG', () => {
        expect(
            edgarFilingUrlFromHit({
                _id: '0001045810-25-000230:nvda-20251026.htm',
                _source: { ciks: ['0001045810'] },
            }),
        ).toBe(
            'https://www.sec.gov/Archives/edgar/data/1045810/000104581025000230/0001045810-25-000230-index.htm',
        );
    });

    it.each([
        [{}, 'an empty hit'],
        [{ _id: 'not-an-accession:doc.htm', _source: { ciks: ['0000821189'] } }, 'a malformed accession'],
        [{ _id: '0000821189-25-000011:doc.htm', _source: {} }, 'a missing CIK'],
        [{ _id: '0000821189-25-000011:doc.htm', _source: { ciks: ['abc'] } }, 'a non-numeric CIK'],
        [{ _id: '../../../etc/passwd:x', _source: { ciks: ['0000821189'] } }, 'a traversal attempt'],
    ])('returns nothing rather than a guess for %#: %s', (hit) => {
        expect(edgarFilingUrlFromHit(hit)).toBe('');
    });
});
