// Which URL a source click opens, for any source class, and how sources group.
//
// `secUrl.ts` answers this for filings and is unchanged. This is the other half:
// web sources, plus the single entry point a card should call so it never has to
// know which kind of source it is holding.
//
// The failure this prevents is the mirror image of the one `secUrl.ts` exists
// for. There, a filing citation fell back to a generic company listing. Here, a
// web citation with no URL would fall through the SEC branch and — because
// `EdgarLink` reconstructs from the ticker — open a `browse-edgar` company page
// while claiming to be the Reuters article it quoted. A source card that opens
// something other than the thing it cites is the same bug either way.

import { canonicalSecUrl, isGenericEdgarUrl, type SecProvenance } from './secUrl';

/** The four groups the source panel renders, in display order. */
export const SOURCE_CATEGORIES = ['sec_filings', 'company', 'news', 'web'] as const;
export type SourceCategory = (typeof SOURCE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<SourceCategory, string> = {
    sec_filings: 'SEC Filings',
    company: 'Company',
    news: 'News',
    web: 'Web',
};

/** Authority tier, mirroring `app/core/research/source_quality.py`. */
export const TIER_LABELS: Record<number, string> = {
    1: 'Primary / official',
    2: 'Established press',
    3: 'Secondary',
    4: 'Unknown',
};

export interface WebProvenance {
    source_class?: string;
    url?: string;
    canonical_url?: string;
    domain?: string;
    published_at?: string;
    retrieved_at?: string;
    source_type?: string;
    category?: string;
    tier?: number;
    tier_label?: string;
    injection_flags?: string[];
}

export type AnySourceProvenance = SecProvenance & WebProvenance;

/**
 * Whether this URL is safe to render as a clickable link.
 *
 * A scheme allow-list, not a host one: a web citation points at the open web by
 * definition, so the question here is only whether the browser would treat the
 * href as code. `javascript:` and `data:` are the answer to that, and both are
 * reachable — the URL passed through a fetch, a database and a model before
 * arriving at an anchor.
 */
export function isRenderableWebUrl(url?: string | null): boolean {
    if (!url) return false;
    try {
        const u = new URL(url);
        return (u.protocol === 'https:' || u.protocol === 'http:') && !!u.hostname;
    } catch {
        return false;
    }
}

/** True when the backend labelled this source as coming off the live web. */
export function isWebSource(p?: AnySourceProvenance | null): boolean {
    if (!p) return false;
    return (
        p.source_class === 'WEB_EVIDENCE' ||
        p.category === 'web' ||
        p.category === 'news' ||
        (!!p.domain && !p.accession)
    );
}

/**
 * The exact page a web source click must open.
 *
 * `url` is what was actually fetched; `canonical_url` is the deduplication
 * identity and is used only as a fallback, because tracking-parameter stripping
 * can in principle change what a server returns. An EDGAR listing is refused
 * outright — a web source must never open one.
 */
export function canonicalWebUrl(p?: AnySourceProvenance | null): string {
    if (!p) return '';
    for (const candidate of [p.url, p.canonical_url]) {
        if (isRenderableWebUrl(candidate) && !isGenericEdgarUrl(candidate)) {
            return candidate as string;
        }
    }
    return '';
}

/**
 * The URL a source card opens, whatever kind of source it is.
 *
 * SEC provenance wins when present: an accession names a document that can be
 * opened and audited, which is a stronger claim than a URL. A web source then
 * gets its exact page. Returns '' when neither holds — a local corpus chunk has
 * no external address, and '' is the honest answer rather than a reconstructed
 * guess.
 */
export function sourceClickUrl(p?: AnySourceProvenance | null): string {
    if (!p) return '';
    const sec = canonicalSecUrl(p);
    if (sec) return sec;
    return canonicalWebUrl(p);
}

/** Which of the four groups this source belongs in. */
export function sourceCategory(p?: AnySourceProvenance | null): SourceCategory {
    if (!p) return 'web';
    const declared = (p.category || '') as SourceCategory;
    if (SOURCE_CATEGORIES.includes(declared)) return declared;
    // Fall back to the identity we can see. An accession is decisive.
    if (p.accession || p.filing_url || canonicalSecUrl(p)) return 'sec_filings';
    return 'web';
}

/** The tier badge text, or '' when the backend stated no tier. */
export function tierLabel(p?: AnySourceProvenance | null): string {
    if (!p?.tier) return '';
    return p.tier_label || TIER_LABELS[p.tier] || '';
}

/**
 * A publication date rendered for display, or '' when the source declared none.
 *
 * Never substitutes the retrieval time: "we fetched this today" is not "this
 * was published today", and conflating them is how stale evidence starts
 * looking current.
 */
export function publishedLabel(p?: AnySourceProvenance | null): string {
    const raw = p?.published_at || '';
    if (!raw) return '';
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/**
 * Sources grouped into the four categories, best-tier first inside each.
 *
 * Empty categories are omitted rather than rendered as an empty heading.
 */
export function groupSources<T extends AnySourceProvenance>(
    sources: T[],
): Array<{ category: SourceCategory; label: string; sources: T[] }> {
    const buckets = new Map<SourceCategory, T[]>();
    for (const s of sources || []) {
        const c = sourceCategory(s);
        if (!buckets.has(c)) buckets.set(c, []);
        buckets.get(c)!.push(s);
    }
    return SOURCE_CATEGORIES.filter(c => (buckets.get(c) || []).length > 0).map(c => ({
        category: c,
        label: CATEGORY_LABELS[c],
        sources: (buckets.get(c) || []).sort(
            (a, b) => (a.tier ?? 9) - (b.tier ?? 9),
        ),
    }));
}
