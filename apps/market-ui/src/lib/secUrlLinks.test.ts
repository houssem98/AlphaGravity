// The two-link contract, client side.
//
//     View filing      -> the primary document        nvda-20260126.htm
//     Filing details   -> EDGAR's manifest            ...-index.htm
//
// The mirror of `tests/test_sec_filing_resolver.py`. The backend decides both
// URLs; this module's job is to consume that decision and to refuse anything
// that does not survive validation, so the same negative cases are asserted on
// both sides of the wire rather than trusted to travel intact.
//
// The issuers span sectors and the primary-document filenames span four naming
// conventions on purpose: `nvda-20260126.htm` is ticker-dated, `corp10q...` is
// a bank's generic one, `tm2429925d1_def14a.htm` and `d123456d10k.htm` are
// filing agents'. A rule that reads the filename out of the ticker is wrong for
// three of the four.
import { describe, it, expect } from 'vitest';
import {
    belongsToFiling,
    filingDetailsUrl,
    filingLinks,
    parseArchiveUrl,
    viewFilingUrl,
} from './secUrl';

const dir = (cik: number, accn: string) =>
    `https://www.sec.gov/Archives/edgar/data/${cik}/${accn.replace(/-/g, '')}`;
const details = (cik: number, accn: string) => `${dir(cik, accn)}/${accn}-index.htm`;
const primary = (cik: number, accn: string, doc: string) => `${dir(cik, accn)}/${doc}`;

/** ticker, cik, accession, form, primary document, sector */
const MATRIX: [string, number, string, string, string, string][] = [
    ['NVDA', 1045810, '0001045810-26-000023', '10-K', 'nvda-20260126.htm', 'semiconductors'],
    ['NVDA', 1045810, '0001045810-25-000116', '10-Q', 'nvda-20250727.htm', 'semiconductors'],
    ['AAPL', 320193, '0000320193-25-000073', '10-K', 'aapl-20250927.htm', 'consumer electronics'],
    ['AAPL', 320193, '0000320193-25-000008', '8-K', 'a8-kq1202501302025.htm', 'consumer electronics'],
    ['TSLA', 1318605, '0001628280-25-003063', '10-K', 'tsla-20241231.htm', 'automotive'],
    ['MSFT', 789019, '0000950170-25-100235', '10-K', 'msft-20250630.htm', 'software'],
    ['JNJ', 200406, '0000200406-25-000011', '10-K', 'jnj-20241229.htm', 'pharmaceuticals'],
    ['JPM', 19617, '0000019617-25-000239', '10-Q', 'corp10q6302025.htm', 'banking'],
    ['XOM', 34088, '0000034088-25-000010', 'DEF 14A', 'd123456d10k.htm', 'energy'],
    ['KO', 21344, '0000021344-25-000009', 'DEF 14A', 'tm2429925d1_def14a.htm', 'beverages'],
];

const payloadFor = (cik: number, accn: string, doc: string) => ({
    cik,
    accession: accn,
    filing_details_url: details(cik, accn),
    primary_document: doc,
    primary_document_url: primary(cik, accn, doc),
    view_filing_url: primary(cik, accn, doc),
});

describe('the regression matrix — every issuer, every form', () => {
    it.each(MATRIX)('%s %s: the two links are different pages', (_t, cik, accn, _f, doc) => {
        const p = payloadFor(cik, accn, doc);
        const view = viewFilingUrl(p);
        const det = filingDetailsUrl(p);
        expect(view).toBe(primary(cik, accn, doc));
        expect(det).toBe(details(cik, accn));
        expect(view).not.toBe(det);
    });

    it.each(MATRIX)('%s %s: View filing is not the index page', (_t, cik, accn, _f, doc) => {
        expect(viewFilingUrl(payloadFor(cik, accn, doc))).not.toContain('-index.htm');
    });

    it.each(MATRIX)('%s %s: both URLs belong to this exact filing', (_t, cik, accn, _f, doc) => {
        const p = payloadFor(cik, accn, doc);
        expect(belongsToFiling(viewFilingUrl(p), cik, accn)).toBe(true);
        expect(belongsToFiling(filingDetailsUrl(p), cik, accn)).toBe(true);
    });

    it.each(MATRIX)('%s %s: the filename is never derived from the ticker', (t, cik, accn, _f, doc) => {
        const p = payloadFor(cik, accn, doc);
        expect(viewFilingUrl(p).endsWith(`/${doc}`)).toBe(true);
        // Four of the ten filenames contain no ticker at all; the rule must be
        // the same for those as for the six that happen to.
        if (!doc.toLowerCase().includes(t.toLowerCase())) {
            expect(viewFilingUrl(p)).not.toContain(t.toLowerCase());
        }
    });
});

describe('viewFilingUrl refuses what it cannot verify', () => {
    const [, cik, accn, , doc] = MATRIX[0];

    it('is empty when no primary document was named', () => {
        const p = { cik, accession: accn, filing_details_url: details(cik, accn) };
        expect(viewFilingUrl(p)).toBe('');
        expect(filingDetailsUrl(p)).toBe(details(cik, accn));
    });

    it('is empty when the document belongs to another accession', () => {
        const p = {
            ...payloadFor(cik, accn, doc),
            view_filing_url: primary(cik, '0001045810-25-000116', 'nvda-20250727.htm'),
            primary_document_url: primary(cik, '0001045810-25-000116', 'nvda-20250727.htm'),
        };
        expect(viewFilingUrl(p)).toBe('');
    });

    it('is empty when the document belongs to another registrant', () => {
        const p = {
            ...payloadFor(cik, accn, doc),
            view_filing_url: primary(320193, '0000320193-25-000073', 'aapl-20250927.htm'),
            primary_document_url: primary(320193, '0000320193-25-000073', 'aapl-20250927.htm'),
        };
        expect(viewFilingUrl(p)).toBe('');
    });

    it.each([
        'https://evil.example/Archives/edgar/data/1045810/000104581026000023/x.htm',
        'http://www.sec.gov/Archives/edgar/data/1045810/000104581026000023/x.htm',
        'javascript:alert(1)',
        'data:text/html,<script>1</script>',
        '',
    ])('is empty for an untrusted URL: %s', (bad) => {
        const p = { ...payloadFor(cik, accn, doc), view_filing_url: bad, primary_document_url: bad };
        expect(viewFilingUrl(p)).toBe('');
    });

    it('is empty when the "primary document" is the index page itself', () => {
        const p = {
            ...payloadFor(cik, accn, doc),
            view_filing_url: details(cik, accn),
            primary_document_url: details(cik, accn),
        };
        expect(viewFilingUrl(p)).toBe('');
        expect(filingDetailsUrl(p)).toBe(details(cik, accn));
    });

    it('is empty for a document name that is not a bare HTML filename', () => {
        for (const bad of ['x.xml', 'x.txt', 'Financial_Report.xlsx']) {
            const p = {
                ...payloadFor(cik, accn, doc),
                view_filing_url: primary(cik, accn, bad),
                primary_document_url: primary(cik, accn, bad),
            };
            expect(viewFilingUrl(p)).toBe('');
        }
    });

    it('is empty when there is no filing identity at all', () => {
        expect(viewFilingUrl({})).toBe('');
        expect(viewFilingUrl(null)).toBe('');
        expect(viewFilingUrl({ url: 'https://example.com/x' })).toBe('');
    });
});

describe('filingDetailsUrl', () => {
    const [, cik, accn, , doc] = MATRIX[2];

    it('is rebuilt from CIK + accession when the backend sent no URL', () => {
        expect(filingDetailsUrl({ cik, accession: accn })).toBe(details(cik, accn));
    });

    it('recovers the identity from a stored index URL alone', () => {
        expect(filingDetailsUrl({ filing_url: details(cik, accn) })).toBe(details(cik, accn));
    });

    it('recovers the identity from a stored document URL alone', () => {
        expect(filingDetailsUrl({ primary_document_url: primary(cik, accn, doc) }))
            .toBe(details(cik, accn));
    });

    it('is never a company listing', () => {
        expect(filingDetailsUrl({
            filing_details_url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=AAPL',
        })).toBe('');
    });

    it('is empty when the accession is malformed', () => {
        expect(filingDetailsUrl({ cik, accession: 'nope' })).toBe('');
    });
});

describe('parseArchiveUrl', () => {
    const [, cik, accn, , doc] = MATRIX[0];

    it('reads the identity out of a document URL', () => {
        expect(parseArchiveUrl(primary(cik, accn, doc))).toEqual({
            cik, accession: accn, document: doc, isIndex: false,
        });
    });

    it('reads the identity out of an index URL and reports no document', () => {
        expect(parseArchiveUrl(details(cik, accn))).toEqual({
            cik, accession: accn, document: '', isIndex: true,
        });
    });

    it.each([
        'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=NVDA',
        'https://data.sec.gov/api/xbrl/companyconcept/CIK0001045810/us-gaap/Revenues.json',
        'https://www.sec.gov/Archives/edgar/data/1045810/00010458102600/x.htm',
        'https://example.com/',
        '',
    ])('has no identity for %s', (url) => {
        expect(parseArchiveUrl(url)).toBeNull();
    });
});

describe('filingLinks', () => {
    const [, cik, accn, , doc] = MATRIX[0];

    it('returns both links and no reason when the primary resolved', () => {
        expect(filingLinks(payloadFor(cik, accn, doc))).toEqual({
            viewFiling: primary(cik, accn, doc),
            filingDetails: details(cik, accn),
            primaryDocument: doc,
            reason: '',
        });
    });

    it('carries the backend reason when the primary did not resolve', () => {
        const out = filingLinks({
            cik, accession: accn,
            primary_unresolved_reason: 'accession is not among this registrant\'s filings',
        });
        expect(out.viewFiling).toBe('');
        expect(out.filingDetails).toBe(details(cik, accn));
        expect(out.reason).toContain('not among');
    });

    it('states a reason even when the backend supplied none', () => {
        const out = filingLinks({ cik, accession: accn });
        expect(out.viewFiling).toBe('');
        expect(out.reason).not.toBe('');
    });
});
