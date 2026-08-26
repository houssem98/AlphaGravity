// Deep-link to the actual EDGAR filing document.
//
// This used to resolve the link by asking the backend to match ticker + form +
// filed date against the SEC submissions API, and to fall back to the EDGAR
// company search page whenever that failed. It failed every time: the endpoint
// it called, `/v1/documents/filing-url`, does not exist in gravity-api. So every
// SEC source click opened
// `browse-edgar?action=getcompany&CIK=EOG&type=10-K` — a company listing —
// while the exact accession that produced the evidence (0000821189-25-000011)
// had already been resolved, verified and persisted upstream.
//
// Verified provenance now travels with the source and the citation, so the
// exact filing URL is known before render: no fetch, no guess, no fallback.
// The legacy resolve-by-date path is kept ONLY for callers that genuinely have
// no accession — the "latest 10-K" button on the company page — and is never
// reached when provenance exists.
//
// Appends a #:~:text= fragment so supporting browsers scroll to and highlight
// the cited passage inside the filing itself.
import { useState, useEffect } from 'react';
import { ExternalLink } from 'lucide-react';
import { safeUrl } from '../lib/safeUrl';
import { canonicalSecUrl, isTrustedSecUrl, type SecProvenance } from '../lib/secUrl';
import { getAccessToken } from '../services/supabase';

const GRAVITY_API = import.meta.env.VITE_GRAVITY_API_URL || 'http://localhost:8000';

// Pull the form type and filing date out of a document title like
// "TSLA 10-K 2025-01-29" — the shape gravity-api returns.
export function parseFilingTitle(title: string | undefined): { filingType: string; filingDate: string } {
    const t = title ?? '';
    return {
        filingType: t.match(/\b(10-K|10-Q|8-K|DEF 14A|S-1|20-F|6-K|40-F|13F-HR|SC 13[DG]|4)\b/)?.[0] ?? '',
        filingDate: t.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '',
    };
}

/**
 * The href this component will render for a given set of props.
 *
 * Exported so the link target can be asserted without a DOM, and so the
 * decision lives in one place rather than being re-derived inside JSX.
 * `resolved` is the legacy resolver's answer, which only matters when there is
 * no provenance.
 */
export function edgarHref({
    provenance,
    ticker,
    filingType,
    snippet,
    resolved,
}: {
    provenance?: SecProvenance | null;
    ticker?: string;
    filingType?: string;
    snippet?: string;
    resolved?: string | null;
}): { href: string; exact: boolean } {
    const canonical = canonicalSecUrl(provenance);
    // An exact filing is never traded for a company listing.
    let href = canonical;
    let exact = Boolean(canonical);

    if (!href) {
        if (resolved && isTrustedSecUrl(resolved)) {
            href = resolved;
            exact = true;
        } else if (ticker) {
            href =
                `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(ticker)}` +
                `&type=${encodeURIComponent(filingType || '10-K')}&dateb=&owner=include&count=40`;
        }
    }
    if (!href) return { href: '', exact: false };

    // Scroll-to-text fragment: only for verbatim prose citations, and only on an
    // exact document. A synthesized XBRL snippet ("[EXACT FILING FIGURE] ...")
    // does not appear in the filing, and a company listing has nothing to scroll.
    const snip = (snippet ?? '').trim();
    if (exact && snip && !snip.startsWith('[')) {
        const frag = snip.split(/\s+/).slice(0, 10).join(' ');
        href += `#:~:text=${encodeURIComponent(frag).replace(/-/g, '%2D')}`;
    }
    return { href, exact };
}

export default function EdgarLink({
    ticker,
    snippet,
    filingType,
    filingDate,
    provenance,
    allowLatest = false,
    className,
}: {
    ticker?: string;
    snippet?: string;
    filingType?: string;
    filingDate?: string;
    // Verified filing provenance from the API: canonical_url / filing_url /
    // document_url / accession / cik. When present the link is exact and
    // nothing below is consulted.
    provenance?: SecProvenance | null;
    // The legacy resolver matches on the *exact* SEC filed date; given none it
    // returns the company's LATEST filing of that type. That's what a "latest
    // 10-K" button wants, but for a citation of an older filing it silently
    // links to the wrong document — so citations must opt out.
    allowLatest?: boolean;
    className?: string;
}) {
    const [resolved, setResolved] = useState<string | null>(null);
    const canonical = canonicalSecUrl(provenance);
    // Without an exact filed date, a resolved URL is not the cited filing. And
    // with provenance there is nothing to resolve — the answer is already here.
    const canResolve = !canonical && (Boolean(filingDate) || allowLatest);

    useEffect(() => {
        let alive = true;
        setResolved(null);
        if (!ticker || !canResolve) return;
        (async () => {
            try {
                const tok = await getAccessToken();
                const qs = new URLSearchParams({
                    ticker,
                    filing_type: filingType ?? '',
                    filing_date: filingDate ?? '',
                });
                const res = await fetch(`${GRAVITY_API}/v1/documents/filing-url?${qs}`, {
                    headers: tok ? { Authorization: `Bearer ${tok}` } : {},
                });
                const data = res.ok ? await res.json() : null;
                if (alive && data?.url) setResolved(data.url);
            } catch { /* keep fallback */ }
        })();
        return () => { alive = false; };
    }, [ticker, filingType, filingDate, canResolve]);

    if (!ticker && !canonical) return null;

    const { href, exact } = edgarHref({ provenance, ticker, filingType, snippet, resolved });
    if (!href) return null;

    const accession = provenance?.accession ?? provenance?.accession_number ?? '';

    return (
        <a
            href={safeUrl(href)}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="edgar-link"
            data-exact-filing={exact ? 'true' : 'false'}
            data-accession={accession || undefined}
            className={className ?? 'flex items-center gap-2 text-xs text-[var(--accent)] hover:text-[var(--accent)] transition-colors'}
        >
            <ExternalLink className="w-3.5 h-3.5" />
            {exact ? 'View filing on SEC EDGAR' : 'View on SEC EDGAR'}
            {accession && (
                <span className="font-mono text-[10px] text-[var(--text-2)]">{accession}</span>
            )}
        </a>
    );
}
