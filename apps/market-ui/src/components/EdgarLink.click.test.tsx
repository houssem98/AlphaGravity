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
// The bug being pinned: this component fetched `/v1/documents/filing-url` to
// resolve the link, gravity-api has no such route, so the fetch 404'd on every
// render and the anchor always carried
// `browse-edgar?action=getcompany&CIK=EOG&type=10-K`.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import EdgarLink, { edgarHref } from './EdgarLink';

// Supabase pulls a browser client in at import time; the token is only read on
// the legacy resolve path, which provenance skips entirely.
vi.mock('../services/supabase', () => ({ getAccessToken: async () => null }));

const CIK = 821189;
const ACCN = '0000821189-25-000011';
const EXACT =
    'https://www.sec.gov/Archives/edgar/data/821189/000082118925000011/0000821189-25-000011-index.htm';

// Exactly what gravity-api now puts on an EOG source / citation.
const EOG_PROVENANCE = {
    issuer: 'EOG RESOURCES INC',
    cik: CIK,
    form: '10-K',
    filing_date: '2025-02-27',
    fiscal_period: 'FY2024',
    accession: ACCN,
    accession_number: ACCN,
    filing_url: EXACT,
    canonical_url: EXACT,
    verification_status: 'verified',
};

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

async function render(ui: React.ReactElement) {
    await act(async () => { root.render(ui); });
    return container.querySelector('a[data-testid="edgar-link"]') as HTMLAnchorElement | null;
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

describe('EdgarLink source click — with verified provenance', () => {
    it('the click target is the exact SEC filing URL', async () => {
        const a = await render(<EdgarLink ticker="EOG" provenance={EOG_PROVENANCE} />);
        expect(a).not.toBeNull();
        expect(clickAndCaptureTarget(a!)).toBe(EXACT);
    });

    it('the click target is NOT the generic EDGAR company page', async () => {
        const a = await render(<EdgarLink ticker="EOG" provenance={EOG_PROVENANCE} />);
        const target = clickAndCaptureTarget(a!);
        expect(target).not.toContain('browse-edgar');
        expect(target).not.toContain('getcompany');
    });

    it('never asks the backend to resolve a link it already has', async () => {
        await render(<EdgarLink ticker="EOG" filingType="10-K" filingDate="2025-02-27" provenance={EOG_PROVENANCE} />);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('opens in a new tab, safely', async () => {
        const a = await render(<EdgarLink ticker="EOG" provenance={EOG_PROVENANCE} />);
        expect(a!.target).toBe('_blank');
        expect(a!.rel).toContain('noopener');
    });

    it('shows the accession, so the card names what it opens', async () => {
        const a = await render(<EdgarLink ticker="EOG" provenance={EOG_PROVENANCE} />);
        expect(a!.textContent).toContain(ACCN);
        expect(a!.dataset.exactFiling).toBe('true');
    });

    it('rebuilds the exact filing from a legacy payload carrying only CIK + accession', async () => {
        const a = await render(
            <EdgarLink ticker="EOG" provenance={{ cik: CIK, accession: ACCN }} />,
        );
        expect(clickAndCaptureTarget(a!)).toBe(EXACT);
    });

    it('ignores a stored generic browse-edgar URL when an accession exists', async () => {
        const a = await render(
            <EdgarLink
                ticker="EOG"
                provenance={{
                    url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=EOG&type=10-K',
                    cik: CIK,
                    accession: ACCN,
                }}
            />,
        );
        expect(clickAndCaptureTarget(a!)).toBe(EXACT);
    });

    it('refuses an untrusted URL even when it arrives as the canonical field', async () => {
        const a = await render(
            <EdgarLink ticker="EOG" provenance={{ canonical_url: 'https://evil.example/x' }} />,
        );
        // No provenance survives, so the component is on its legacy path and
        // must not be pointing at the attacker's host.
        const target = a ? clickAndCaptureTarget(a) : '';
        expect(target).not.toContain('evil.example');
    });

    it('does not append a text fragment to a synthesized XBRL snippet', async () => {
        const a = await render(
            <EdgarLink ticker="EOG" provenance={EOG_PROVENANCE} snippet="[EXACT FILING FIGURE] EOG revenue for FY2024 (10-K): $23,698,000,000" />,
        );
        expect(clickAndCaptureTarget(a!)).toBe(EXACT);
    });

    it('scrolls to a verbatim prose citation inside the filing', async () => {
        const a = await render(
            <EdgarLink ticker="EOG" provenance={EOG_PROVENANCE} snippet="Total operating revenues increased" />,
        );
        const target = clickAndCaptureTarget(a!);
        expect(target.startsWith(EXACT)).toBe(true);
        expect(target).toContain('#:~:text=');
    });
});

describe('EdgarLink source click — without provenance', () => {
    it('still offers the company search, since no filing was ever named', async () => {
        const a = await render(<EdgarLink ticker="EOG" filingType="10-K" />);
        const target = clickAndCaptureTarget(a!);
        expect(target).toContain('browse-edgar');
        expect(a!.dataset.exactFiling).toBe('false');
    });

    it('renders nothing at all when there is neither a ticker nor a filing', async () => {
        const a = await render(<EdgarLink />);
        expect(a).toBeNull();
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
        ).toEqual({ href: EXACT, exact: true });
    });

    it('falls back to the company listing only when nothing exact exists', () => {
        const { href, exact } = edgarHref({ ticker: 'EOG', filingType: '10-K' });
        expect(exact).toBe(false);
        expect(href).toContain('browse-edgar');
    });

    it('refuses an untrusted resolver answer', () => {
        const { href } = edgarHref({ ticker: 'EOG', resolved: 'https://evil.example/x' });
        expect(href).not.toContain('evil.example');
    });
});
