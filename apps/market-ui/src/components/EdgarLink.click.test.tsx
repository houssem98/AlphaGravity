// @vitest-environment jsdom
//
// S9: test the actual source-click behaviour, not only the citation object.
//
// The component is really rendered into a real DOM, the anchor is really
// clicked, and the assertion is on the navigation target the browser would
// follow — `HTMLAnchorElement.href` at click time, which is the resolved
// absolute URL a click navigates to.
//
// jsdom does not perform the navigation itself (it logs "Not implemented"),
// so the click handler below captures the target instead. That is the same
// value the browser would use; nothing about the target is simulated.
//
// The bug originally pinned here: this component fetched
// `/v1/documents/filing-url` to resolve the link, gravity-api has no such
// route, so the fetch 404'd on every render and the anchor always carried
// `browse-edgar?action=getcompany&CIK=EOG&type=10-K`.
//
// WHAT CHANGED, AND WHY THESE TESTS WERE REWRITTEN
// ------------------------------------------------
// The card used to render ONE link. It now renders two, because they are two
// different pages and the old single link only ever opened the second of them:
//
//     View filing      -> the primary document        eog-20241231.htm
//     Filing details   -> EDGAR's manifest            ...-index.htm
//
// Every assertion the previous version made is still made below, against
// whichever of the two links now carries that meaning, plus the assertions the
// split makes possible: that the two targets are never equal, that "View
// filing" appears only when SEC's own metadata named the primary document, and
// that a payload which names no document offers "Filing details" alone rather
// than letting the manifest read as the filing. The count went from 15 to 26.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import EdgarLink, { edgarHref } from './EdgarLink';

// Supabase pulls a browser client in at import time; the token is only read on
// the legacy resolve path, which provenance skips entirely.
vi.mock('../services/supabase', () => ({ getAccessToken: async () => null }));

const CIK = 821189;
const ACCN = '0000821189-25-000011';
const DIR = 'https://www.sec.gov/Archives/edgar/data/821189/000082118925000011';
const DETAILS = `${DIR}/${ACCN}-index.htm`;
const PRIMARY = `${DIR}/eog-20241231.htm`;

// Exactly what gravity-api now puts on an EOG source / citation: the filing
// identity, both links, and the primary document SEC itself named.
const EOG_PROVENANCE = {
    issuer: 'EOG RESOURCES INC',
    cik: CIK,
    form: '10-K',
    filing_date: '2025-02-27',
    fiscal_period: 'FY2024',
    accession: ACCN,
    accession_number: ACCN,
    filing_url: DETAILS,
    canonical_url: DETAILS,
    filing_details_url: DETAILS,
    primary_document: 'eog-20241231.htm',
    primary_document_url: PRIMARY,
    view_filing_url: PRIMARY,
    verification_status: 'verified',
};

// A legacy payload: the accession survived, the primary document never existed.
const IDENTITY_ONLY = { cik: CIK, accession: ACCN };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    // The resolver endpoint does not exist. Answering 404 here is what the real
    // backend does, so a test that passes must be passing without it.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
});

afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    vi.unstubAllGlobals();
});

async function paint(ui: React.ReactElement) {
    await act(async () => { root.render(ui); });
}

const viewLink = () =>
    container.querySelector('a[data-testid="edgar-link"]') as HTMLAnchorElement | null;
const detailsLink = () =>
    container.querySelector('a[data-testid="edgar-details-link"]') as HTMLAnchorElement | null;

async function render(ui: React.ReactElement) {
    await paint(ui);
    return viewLink();
}

/** Click the anchor for real and return where the browser would navigate. */
function clickAndCaptureTarget(a: HTMLAnchorElement): string {
    let target = '';
    a.addEventListener('click', (e) => {
        target = (e.currentTarget as HTMLAnchorElement).href;
        e.preventDefault(); // jsdom cannot navigate; the target is what we assert
    });
    a.click();
    return target;
}

describe('EdgarLink — View filing opens the primary document', () => {
    it('the click target is the exact primary filing document', async () => {
        const a = await render(<EdgarLink ticker="EOG" provenance={EOG_PROVENANCE} />);
        expect(a).not.toBeNull();
        expect(clickAndCaptureTarget(a!)).toBe(PRIMARY);
    });

    it('the click target is NOT the generic EDGAR company page', async () => {
        const a = await render(<EdgarLink ticker="EOG" provenance={EOG_PROVENANCE} />);
        const target = clickAndCaptureTarget(a!);
        expect(target).not.toContain('browse-edgar');
        expect(target).not.toContain('getcompany');
    });

    it('the click target is NOT the filing index page', async () => {
        const a = await render(<EdgarLink ticker="EOG" provenance={EOG_PROVENANCE} />);
        const target = clickAndCaptureTarget(a!);
        expect(target).not.toContain('-index.htm');
        expect(target).toContain('eog-20241231.htm');
    });

    it('is labelled "View filing", not "View on SEC EDGAR"', async () => {
        const a = await render(<EdgarLink ticker="EOG" provenance={EOG_PROVENANCE} />);
        expect(a!.textContent).toContain('View filing');
        expect(a!.textContent).not.toContain('View on SEC EDGAR');
    });

    it('names the primary document it opens', async () => {
        const a = await render(<EdgarLink ticker="EOG" provenance={EOG_PROVENANCE} />);
        expect(a!.dataset.primaryDocument).toBe('eog-20241231.htm');
        expect(a!.dataset.exactFiling).toBe('true');
    });

    it('never asks the backend to resolve a link it already has', async () => {
        await paint(<EdgarLink ticker="EOG" filingType="10-K" filingDate="2025-02-27" provenance={EOG_PROVENANCE} />);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('opens in a new tab, safely', async () => {
        const a = await render(<EdgarLink ticker="EOG" provenance={EOG_PROVENANCE} />);
        expect(a!.target).toBe('_blank');
        expect(a!.rel).toContain('noopener');
    });

    it('shows the accession, so the card names what it opens', async () => {
        await paint(<EdgarLink ticker="EOG" provenance={EOG_PROVENANCE} />);
        expect(container.textContent).toContain(ACCN);
    });

    it('scrolls to a verbatim prose citation inside the primary document', async () => {
        const a = await render(
            <EdgarLink ticker="EOG" provenance={EOG_PROVENANCE} snippet="Total operating revenues increased" />,
        );
        const target = clickAndCaptureTarget(a!);
        expect(target.startsWith(PRIMARY)).toBe(true);
        expect(target).toContain('#:~:text=');
    });

    it('does not append a text fragment to a synthesized XBRL snippet', async () => {
        const a = await render(
            <EdgarLink ticker="EOG" provenance={EOG_PROVENANCE} snippet="[EXACT FILING FIGURE] EOG revenue for FY2024 (10-K): $23,698,000,000" />,
        );
        expect(clickAndCaptureTarget(a!)).toBe(PRIMARY);
    });
});

describe('EdgarLink — Filing details opens the EDGAR index', () => {
    it('renders alongside View filing, at a different URL', async () => {
        await paint(<EdgarLink ticker="EOG" provenance={EOG_PROVENANCE} />);
        const view = viewLink();
        const details = detailsLink();
        expect(view).not.toBeNull();
        expect(details).not.toBeNull();
        expect(clickAndCaptureTarget(details!)).toBe(DETAILS);
        expect(clickAndCaptureTarget(view!)).not.toBe(DETAILS);
    });

    it('is the -index.htm page for this exact accession', async () => {
        await paint(<EdgarLink ticker="EOG" provenance={EOG_PROVENANCE} />);
        const target = clickAndCaptureTarget(detailsLink()!);
        expect(target).toBe(`${DIR}/${ACCN}-index.htm`);
    });

    it('is labelled "Filing details"', async () => {
        await paint(<EdgarLink ticker="EOG" provenance={EOG_PROVENANCE} />);
        expect(detailsLink()!.textContent).toContain('Filing details');
    });

    it('is rebuilt from a legacy payload carrying only CIK + accession', async () => {
        await paint(<EdgarLink ticker="EOG" provenance={IDENTITY_ONLY} />);
        expect(clickAndCaptureTarget(detailsLink()!)).toBe(DETAILS);
    });

    it('ignores a stored generic browse-edgar URL when an accession exists', async () => {
        await paint(
            <EdgarLink
                ticker="EOG"
                provenance={{
                    url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=EOG&type=10-K',
                    cik: CIK,
                    accession: ACCN,
                }}
            />,
        );
        expect(clickAndCaptureTarget(detailsLink()!)).toBe(DETAILS);
    });
});

describe('EdgarLink — an unresolved primary document is never invented', () => {
    it('offers Filing details alone when no primary document was named', async () => {
        await paint(<EdgarLink ticker="EOG" provenance={IDENTITY_ONLY} />);
        expect(viewLink()).toBeNull();
        expect(detailsLink()).not.toBeNull();
    });

    it('says why the document link is missing rather than silently dropping it', async () => {
        await paint(<EdgarLink ticker="EOG" provenance={IDENTITY_ONLY} />);
        const note = container.querySelector('[data-testid="edgar-primary-unresolved"]');
        expect(note).not.toBeNull();
        expect(note!.textContent).toContain('primary document unavailable');
    });

    it('refuses a primary document URL belonging to another filing', async () => {
        await paint(
            <EdgarLink
                ticker="EOG"
                provenance={{
                    ...EOG_PROVENANCE,
                    primary_document_url:
                        'https://www.sec.gov/Archives/edgar/data/320193/000032019325000073/aapl-20250927.htm',
                    view_filing_url:
                        'https://www.sec.gov/Archives/edgar/data/320193/000032019325000073/aapl-20250927.htm',
                }}
            />,
        );
        expect(viewLink()).toBeNull();
        expect(clickAndCaptureTarget(detailsLink()!)).toBe(DETAILS);
    });

    it('refuses a primary document URL on an untrusted host', async () => {
        await paint(
            <EdgarLink
                ticker="EOG"
                provenance={{ ...EOG_PROVENANCE, view_filing_url: 'https://evil.example/x.htm', primary_document_url: 'https://evil.example/x.htm' }}
            />,
        );
        expect(viewLink()).toBeNull();
        expect(container.innerHTML).not.toContain('evil.example');
    });

    it('refuses an untrusted URL even when it arrives as the canonical field', async () => {
        await paint(
            <EdgarLink ticker="EOG" provenance={{ canonical_url: 'https://evil.example/x' }} />,
        );
        expect(container.innerHTML).not.toContain('evil.example');
    });
});

describe('EdgarLink — without provenance the frontend invents nothing', () => {
    it('renders no filing link from a ticker alone', async () => {
        // Previously this built `browse-edgar?action=getcompany&CIK=EOG` in the
        // browser and labelled it as the filing. A company listing names no
        // filing, and a URL the frontend assembles from market data is not
        // provenance — so the honest render is nothing at all.
        await paint(<EdgarLink ticker="EOG" filingType="10-K" />);
        expect(viewLink()).toBeNull();
        expect(detailsLink()).toBeNull();
        expect(container.innerHTML).not.toContain('browse-edgar');
        expect(container.innerHTML).not.toContain('getcompany');
    });

    it('renders nothing at all when there is neither a ticker nor a filing', async () => {
        await paint(<EdgarLink />);
        expect(container.querySelector('a')).toBeNull();
    });

    it('uses a trusted answer from the legacy resolver when one arrives', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true, status: 200, json: async () => ({ url: PRIMARY }),
        })));
        await paint(<EdgarLink ticker="EOG" filingType="10-K" filingDate="2025-02-27" />);
        expect(clickAndCaptureTarget(viewLink()!)).toBe(PRIMARY);
    });
});

describe('edgarHref — the decision, without a DOM', () => {
    it('provenance beats every other input', () => {
        expect(
            edgarHref({
                provenance: EOG_PROVENANCE,
                ticker: 'EOG',
                filingType: '10-K',
                resolved: 'https://www.sec.gov/Archives/edgar/data/821189/999/other.htm',
            }),
        ).toEqual({ href: DETAILS, exact: true });
    });

    it('returns nothing rather than a company listing when nothing exact exists', () => {
        expect(edgarHref({ ticker: 'EOG', filingType: '10-K' }))
            .toEqual({ href: '', exact: false });
    });

    it('refuses an untrusted resolver answer', () => {
        const { href } = edgarHref({ ticker: 'EOG', resolved: 'https://evil.example/x' });
        expect(href).not.toContain('evil.example');
        expect(href).toBe('');
    });
});
