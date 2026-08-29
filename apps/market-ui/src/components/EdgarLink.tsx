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
import { canonicalSecUrl, filingLinks, isTrustedSecUrl, type SecProvenance } from '../lib/secUrl';
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
    // An exact filing is never traded for a company listing. And when there is
    // no exact filing there is no link: this used to build
    // `browse-edgar?action=getcompany&CIK=<ticker>` from the ticker, which is a
    // company listing wearing a filing's label. A URL the frontend invents from
    // market data is not provenance, so the fallback is now the empty string —
    // the caller renders nothing rather than something wrong.
    let href = canonical;
    let exact = Boolean(canonical);

    if (!href && resolved && isTrustedSecUrl(resolved)) {
        href = resolved;
        exact = true;
    }
    if (!href) return { href: '', exact: false };

    // Scroll-to-text fragment: only for verbatim prose citations, and only on an
    // exact document. A synthesized XBRL snippet ("[EXACT FILING FIGURE] ...")
    // does not appear in the filing, and a manifest page has nothing to scroll.
    const snip = (snippet ?? '').trim();
    if (exact && snip && !snip.startsWith('[')) {
        const frag = snip.split(/\s+/).slice(0, 10).join(' ');
        href += `#:~:text=${encodeURIComponent(frag).replace(/-/g, '%2D')}`;
    }
    return { href, exact };
}

/** The scroll-to-text fragment a verbatim prose citation adds to a document URL. */
function withHighlight(url: string, snippet?: string): string {
    const snip = (snippet ?? '').trim();
    if (!url || !snip || snip.startsWith('[')) return url;
    const frag = snip.split(/\s+/).slice(0, 10).join(' ');
    return `${url}#:~:text=${encodeURIComponent(frag).replace(/-/g, '%2D')}`;
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

    const links = filingLinks(provenance);
    const { href, exact } = edgarHref({ provenance, snippet, resolved });
    // "View filing" is the primary document; the legacy resolver's answer is
    // also a document, so it fills the same slot when there is no provenance.
    const viewFiling = links.viewFiling
        ? withHighlight(links.viewFiling, snippet)
        : (exact && !links.filingDetails ? href : '');
    const details = links.filingDetails;
    if (!viewFiling && !details) return null;

    const accession = provenance?.accession ?? provenance?.accession_number ?? '';
    const base = className ?? 'flex items-center gap-2 text-xs text-[var(--accent)] hover:text-[var(--accent)] transition-colors';

    return (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="edgar-links">
            {viewFiling && (
                <a
                    href={safeUrl(viewFiling)}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="edgar-link"
                    data-exact-filing="true"
                    data-accession={accession || undefined}
                    data-primary-document={links.primaryDocument || undefined}
                    className={base}
                >
                    <ExternalLink className="w-3.5 h-3.5" />
                    View filing
                </a>
            )}
            {details && (
                <a
                    href={safeUrl(details)}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="edgar-details-link"
                    data-accession={accession || undefined}
                    className={base}
                >
                    {!viewFiling && <ExternalLink className="w-3.5 h-3.5" />}
                    Filing details
                </a>
            )}
            {/* Why the document link is absent, rather than silently offering
                only the manifest and letting it read as the filing. */}
            {!viewFiling && details && links.reason && (
                <span
                    data-testid="edgar-primary-unresolved"
                    title={links.reason}
                    className="text-[10px] text-[var(--text-2)]"
                >
                    primary document unavailable
                </span>
            )}
            {accession && (
                <span className="font-mono text-[10px] text-[var(--text-2)]">{accession}</span>
            )}
        </span>
    );
}
