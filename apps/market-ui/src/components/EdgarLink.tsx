// Deep-link to the actual EDGAR filing document (resolved via the backend,
// which matches ticker + form + filing date against the SEC submissions API).
// While resolving — and whenever resolution fails — falls back to the EDGAR
// company search page. Appends a #:~:text= fragment so supporting browsers
// scroll to and highlight the cited passage inside the filing itself.
//
// Extracted from SearchPage so Research Grid and Company reuse the same
// resolution instead of linking at a raw/search URL.
import { useState, useEffect } from 'react';
import { ExternalLink } from 'lucide-react';
import { safeUrl } from '../lib/safeUrl';
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

export default function EdgarLink({
    ticker,
    snippet,
    filingType,
    filingDate,
    allowLatest = false,
    className,
}: {
    ticker?: string;
    snippet?: string;
    filingType?: string;
    filingDate?: string;
    // The resolver matches on the *exact* SEC filed date; given none it returns
    // the company's LATEST filing of that type. That's what a "latest 10-K"
    // button wants, but for a citation of an older filing it silently links to
    // the wrong document — so citations must opt out. Verified against prod:
    // filed date 2022-02-07 resolves FY2021; 2022-02-01 (6 days off) and
    // period-end 2021-12-31 both fall back to the FY2025 filing.
    allowLatest?: boolean;
    className?: string;
}) {
    const [resolved, setResolved] = useState<string | null>(null);
    // Without an exact filed date, a resolved URL is not the cited filing.
    const canResolve = Boolean(filingDate) || allowLatest;

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

    if (!ticker) return null;

    const fallback = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(ticker)}&type=${encodeURIComponent(filingType || '10-K')}&dateb=&owner=include&count=40`;
    let href = resolved ?? fallback;
    // Scroll-to-text fragment: only for verbatim prose citations (synthesized
    // XBRL snippets like "[EXACT FILING FIGURE] ..." don't exist in the filing).
    const snip = (snippet ?? '').trim();
    if (resolved && snip && !snip.startsWith('[')) {
        const frag = snip.split(/\s+/).slice(0, 10).join(' ');
        href += `#:~:text=${encodeURIComponent(frag).replace(/-/g, '%2D')}`;
    }
    return (
        <a
            href={safeUrl(href)}
            target="_blank"
            rel="noopener noreferrer"
            className={className ?? 'flex items-center gap-2 text-xs text-[var(--accent)] hover:text-[var(--accent)] transition-colors'}
        >
            <ExternalLink className="w-3.5 h-3.5" />
            {resolved ? 'View filing on SEC EDGAR' : 'View on SEC EDGAR'}
        </a>
    );
}
