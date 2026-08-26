// Source-click behaviour and grouping (spec sections 23-24; matrix N and O).
//
// The bug being guarded: a web citation with no URL falls through the SEC
// branch, `EdgarLink` reconstructs from the ticker, and the card opens a
// `browse-edgar` company listing while claiming to be the article it quoted.
// That is the same defect the exact-filing work removed, pointed the other way.

import { describe, expect, it } from 'vitest';

import {
    CATEGORY_LABELS,
    canonicalWebUrl,
    groupSources,
    isRenderableWebUrl,
    isWebSource,
    publishedLabel,
    sourceCategory,
    sourceClickUrl,
    tierLabel,
} from './sourceUrl';

const SEC = {
    source_class: 'SEC_EVIDENCE',
    accession: '0000821189-25-000011',
    cik: 821189,
    filing_url:
        'https://www.sec.gov/Archives/edgar/data/821189/000082118925000011/0000821189-25-000011-index.htm',
    category: 'sec_filings',
    tier: 1,
};

const WEB = {
    source_class: 'WEB_EVIDENCE',
    url: 'https://www.reuters.com/business/energy/eog-q4-2025',
    canonical_url: 'https://reuters.com/business/energy/eog-q4-2025',
    domain: 'reuters.com',
    published_at: '2026-02-20T10:00:00+00:00',
    retrieved_at: '2026-08-26T09:00:00+00:00',
    category: 'news',
    tier: 2,
};

describe('sourceClickUrl', () => {
    it('opens the exact filing for a SEC source', () => {
        expect(sourceClickUrl(SEC)).toBe(SEC.filing_url);
    });

    it('never opens a generic EDGAR listing for a SEC source', () => {
        const url = sourceClickUrl(SEC);
        expect(url).not.toContain('browse-edgar');
        expect(url).not.toContain('action=getcompany');
    });

    it('opens the exact page for a web source', () => {
        expect(sourceClickUrl(WEB)).toBe(WEB.url);
    });

    it('never sends a web source to sec.gov', () => {
        expect(sourceClickUrl(WEB)).not.toContain('sec.gov');
    });

    it('prefers SEC provenance when a source somehow carries both', () => {
        // An accession names a document that can be opened and audited, which
        // is a stronger claim than a URL.
        expect(sourceClickUrl({ ...SEC, ...WEB })).toBe(SEC.filing_url);
    });

    it('returns empty for a local chunk rather than reconstructing a guess', () => {
        expect(sourceClickUrl({ category: 'web' })).toBe('');
        expect(sourceClickUrl(null)).toBe('');
        expect(sourceClickUrl(undefined)).toBe('');
    });

    it('refuses an EDGAR listing offered as a web url', () => {
        expect(
            canonicalWebUrl({
                url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=EOG',
            }),
        ).toBe('');
    });

    it('falls back to the canonical url when the fetched url is unusable', () => {
        expect(canonicalWebUrl({ url: 'javascript:alert(1)', canonical_url: WEB.canonical_url }))
            .toBe(WEB.canonical_url);
    });
});

describe('isRenderableWebUrl', () => {
    it.each(['https://reuters.com/x', 'http://example.com/x'])('allows %s', url => {
        expect(isRenderableWebUrl(url)).toBe(true);
    });

    it.each([
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'file:///etc/passwd',
        'not a url',
        '',
    ])('refuses %s', url => {
        expect(isRenderableWebUrl(url)).toBe(false);
    });

    it('refuses null and undefined', () => {
        expect(isRenderableWebUrl(null)).toBe(false);
        expect(isRenderableWebUrl(undefined)).toBe(false);
    });
});

describe('categorisation', () => {
    it('places each source in its declared category', () => {
        expect(sourceCategory(SEC)).toBe('sec_filings');
        expect(sourceCategory(WEB)).toBe('news');
        expect(sourceCategory({ category: 'company' })).toBe('company');
    });

    it('falls back to SEC when an accession is present but no category is', () => {
        expect(sourceCategory({ accession: SEC.accession, cik: SEC.cik })).toBe('sec_filings');
    });

    it('identifies web sources', () => {
        expect(isWebSource(WEB)).toBe(true);
        expect(isWebSource(SEC)).toBe(false);
    });
});

describe('groupSources', () => {
    it('renders the four categories in spec order and omits the empty ones', () => {
        const groups = groupSources([WEB, SEC]);
        expect(groups.map(g => g.category)).toEqual(['sec_filings', 'news']);
        expect(groups[0].label).toBe(CATEGORY_LABELS.sec_filings);
    });

    it('orders the best tier first inside a group', () => {
        const groups = groupSources([
            { category: 'web', tier: 4, url: 'https://a.example/x' },
            { category: 'web', tier: 2, url: 'https://b.example/x' },
        ]);
        expect(groups[0].sources[0].tier).toBe(2);
    });

    it('handles an empty list', () => {
        expect(groupSources([])).toEqual([]);
    });
});

describe('display fields', () => {
    it('shows a declared publication date', () => {
        expect(publishedLabel(WEB)).toBe('2026-02-20');
    });

    it('never substitutes the retrieval time for a missing publication date', () => {
        // "We fetched this today" is not "this was published today", and
        // conflating them is how stale evidence starts looking current.
        expect(publishedLabel({ retrieved_at: '2026-08-26T09:00:00+00:00' })).toBe('');
    });

    it('shows the tier label when the backend stated a tier', () => {
        expect(tierLabel(WEB)).toBe('Established press');
        expect(tierLabel({ tier: 1 })).toBe('Primary / official');
        expect(tierLabel({})).toBe('');
    });
});
