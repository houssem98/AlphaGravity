import { describe, it, expect } from 'vitest';
import {
    canonicalSecUrl,
    filingIndexUrl,
    hasExactFiling,
    isGenericEdgarUrl,
    isTrustedSecUrl,
    isValidAccession,
} from './secUrl';

// The reported bug, in one constant pair.
const CIK = 821189;
const ACCN = '0000821189-25-000011';
const EXACT =
    'https://www.sec.gov/Archives/edgar/data/821189/000082118925000011/0000821189-25-000011-index.htm';
const GENERIC =
    'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=EOG&type=10-K&dateb=&owner=include&count=40';

describe('filingIndexUrl', () => {
    it('builds the exact EOG filing URL from CIK + accession', () => {
        expect(filingIndexUrl(CIK, ACCN)).toBe(EXACT);
    });

    it('strips the hyphens for the path segment and keeps them in the filename', () => {
        const url = filingIndexUrl(CIK, ACCN);
        expect(url).toContain('/000082118925000011/');
        expect(url.endsWith(`/${ACCN}-index.htm`)).toBe(true);
    });

    it('is not hardcoded to EOG', () => {
        expect(filingIndexUrl(1045810, '0001045810-25-000230')).toBe(
            'https://www.sec.gov/Archives/edgar/data/1045810/000104581025000230/0001045810-25-000230-index.htm',
        );
    });

    it('accepts a CIK as a string, as the API may serialize it', () => {
        expect(filingIndexUrl('821189', ACCN)).toBe(EXACT);
    });

    it('returns nothing rather than a guess when an input is missing or malformed', () => {
        expect(filingIndexUrl(CIK, 'not-an-accession')).toBe('');
        expect(filingIndexUrl(CIK, undefined)).toBe('');
        expect(filingIndexUrl(undefined, ACCN)).toBe('');
        expect(filingIndexUrl(0, ACCN)).toBe('');
        expect(filingIndexUrl(CIK, '0000821189-25-00001')).toBe('');
    });
});

describe('isValidAccession', () => {
    it('accepts the real shape', () => {
        expect(isValidAccession(ACCN)).toBe(true);
    });

    it.each([
        '', '0000821189-25-00001', '../../../etc/passwd',
        `${ACCN}/../secret`, `${ACCN}\n`, 'https://evil.example/x',
    ])('refuses %j', (bad) => {
        expect(isValidAccession(bad)).toBe(false);
    });
});

describe('isTrustedSecUrl', () => {
    it.each([
        EXACT,
        'https://data.sec.gov/api/xbrl/companyconcept/CIK0000821189/us-gaap/Revenues.json',
        'https://www.sec.gov/Archives/edgar/data/821189/000082118925000011/eog-20241231_htm.xml',
    ])('accepts the SEC URL %j', (url) => {
        expect(isTrustedSecUrl(url)).toBe(true);
    });

    it.each([
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'file:///etc/passwd',
        'http://localhost:8000/admin',
        'https://localhost/x',
        'http://127.0.0.1/x',
        'https://169.254.169.254/latest/meta-data/',
        'https://evil.example/Archives/edgar/data/821189/x-index.htm',
        'https://www.sec.gov.evil.example/Archives/x',
        'http://www.sec.gov/Archives/x',
        '',
        undefined,
    ])('refuses %j', (url) => {
        expect(isTrustedSecUrl(url as string | undefined)).toBe(false);
    });
});

describe('isGenericEdgarUrl', () => {
    it('recognises the company listing this change exists to stop', () => {
        expect(isGenericEdgarUrl(GENERIC)).toBe(true);
    });

    it('does not flag a real filing URL', () => {
        expect(isGenericEdgarUrl(EXACT)).toBe(false);
    });
});

describe('canonicalSecUrl', () => {
    it('prefers what the backend decided', () => {
        expect(canonicalSecUrl({ canonical_url: EXACT, url: GENERIC })).toBe(EXACT);
    });

    it('falls through canonical -> filing -> document -> source', () => {
        expect(canonicalSecUrl({ filing_url: EXACT })).toBe(EXACT);
        const doc =
            'https://www.sec.gov/Archives/edgar/data/821189/000082118925000011/eog-20241231_htm.xml';
        expect(canonicalSecUrl({ document_url: doc })).toBe(doc);
        const src = 'https://data.sec.gov/api/xbrl/companyconcept/CIK0000821189/us-gaap/Revenues.json';
        expect(canonicalSecUrl({ source_url: src })).toBe(src);
    });

    it('rebuilds from CIK + accession for a legacy payload that carries no URL', () => {
        expect(canonicalSecUrl({ cik: CIK, accession: ACCN })).toBe(EXACT);
        expect(canonicalSecUrl({ cik: CIK, accession_number: ACCN })).toBe(EXACT);
    });

    it('rebuilds the exact filing even when the payload also carries a generic URL', () => {
        // The legacy case S6 names: a stored browse-edgar URL alongside a
        // verified accession. The accession wins.
        expect(canonicalSecUrl({ url: GENERIC, cik: CIK, accession: ACCN })).toBe(EXACT);
    });

    it('never returns the generic company listing', () => {
        expect(canonicalSecUrl({ url: GENERIC })).toBe('');
        expect(canonicalSecUrl({ filing_url: GENERIC })).toBe('');
        expect(canonicalSecUrl({ canonical_url: GENERIC })).toBe('');
    });

    it('never returns an untrusted URL, whatever field it arrives in', () => {
        expect(canonicalSecUrl({ canonical_url: 'https://evil.example/x' })).toBe('');
        expect(canonicalSecUrl({ url: 'javascript:alert(1)' })).toBe('');
        expect(
            canonicalSecUrl({ filing_url: 'https://evil.example/x', source_url: EXACT }),
        ).toBe(EXACT);
    });

    it('returns nothing for a passage with no filing, rather than inventing one', () => {
        expect(canonicalSecUrl(null)).toBe('');
        expect(canonicalSecUrl({})).toBe('');
        expect(hasExactFiling({})).toBe(false);
        expect(hasExactFiling({ cik: CIK, accession: ACCN })).toBe(true);
    });
});
