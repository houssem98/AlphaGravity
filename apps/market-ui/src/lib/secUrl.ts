// Which SEC URL a source click opens, and whether it is safe to open at all.
//
// The bug this exists to remove: a source card carried no URL, so `EdgarLink`
// rebuilt one from the ticker and landed the user on
// `browse-edgar?action=getcompany&CIK=EOG&type=10-K` — a company listing — while
// the exact accession (0000821189-25-000011) was already known upstream, had
// already been verified, and had already been persisted.
//
// The backend now resolves the canonical URL and ships it on the source and the
// citation. This module is the client-side half of the same policy: it prefers
// what the backend decided, reconstructs from CIK + accession only when a
// legacy payload carries the identity but not the URL, and refuses to hand an
// untrusted URL to an `<a href>` at all.
//
// It deliberately mirrors `app/core/retrieval/citation_provenance.py`. Two
// copies of a rule is a real cost; the alternative is a frontend that cannot
// decide a link target without a round trip, which is what the specification
// forbids.

/** The only hosts a filing citation may point at. */
export const SEC_HOSTS = new Set([
    'www.sec.gov',
    'sec.gov',
    'data.sec.gov',
    'efts.sec.gov',
]);

/** `0000821189-25-000011` — the only shape an EDGAR accession takes. */
export const ACCESSION_RE = /^\d{10}-\d{2}-\d{6}$/;

export function isValidAccession(accn?: string | null): boolean {
    return typeof accn === 'string' && ACCESSION_RE.test(accn);
}

/**
 * Whether this URL is safe to render as a clickable citation link.
 *
 * A host allow-list, not a scheme check. Citation URLs pass through an LLM and
 * a database before they reach an anchor, and an `https://` link to somewhere
 * else is exactly as wrong as a `javascript:` one for something labelled "the
 * SEC filing this number came from".
 */
export function isTrustedSecUrl(url?: string | null): boolean {
    if (!url) return false;
    try {
        const u = new URL(url);
        return u.protocol === 'https:' && SEC_HOSTS.has(u.hostname);
    } catch {
        return false;
    }
}

/** True for the generic company-listing URL this whole change exists to stop. */
export function isGenericEdgarUrl(url?: string | null): boolean {
    if (!url) return false;
    return /cgi-bin\/browse-edgar|action=getcompany/i.test(url);
}

/**
 * The exact filing index URL for a verified CIK + accession.
 *
 *   821189 + 0000821189-25-000011
 *   -> https://www.sec.gov/Archives/edgar/data/821189/000082118925000011/0000821189-25-000011-index.htm
 *
 * The path segment strips the hyphens; the visible filing identity keeps them.
 * Returns '' rather than a guess when either input is missing or malformed —
 * an invented URL is worse than no link.
 */
export function filingIndexUrl(
    cik?: number | string | null,
    accession?: string | null,
): string {
    if (!isValidAccession(accession)) return '';
    const n = Number(cik);
    if (!Number.isInteger(n) || n <= 0) return '';
    return (
        `https://www.sec.gov/Archives/edgar/data/${n}/` +
        `${accession!.replace(/-/g, '')}/${accession}-index.htm`
    );
}

/** The provenance fields a source or citation carries. All optional: a prose
 *  chunk has none of them and must not acquire a filing link. */
export interface SecProvenance {
    canonical_url?: string;
    filing_url?: string;
    document_url?: string;
    source_url?: string;
    accession?: string;
    accession_number?: string;
    cik?: number | string | null;
    url?: string;
}

/**
 * The URL a source click must open.
 *
 * Priority:
 *   1. `canonical_url` — what the backend already decided, when it is trusted
 *   2. `filing_url`, then `document_url`, then `source_url`
 *   3. reconstruction from a verified CIK + accession, for legacy payloads that
 *      carry the identity but no URL
 *   4. `url`, but only when it is a trusted SEC URL and NOT the generic listing
 *
 * Returns '' when nothing above holds. An empty result means "no filing link",
 * which is the honest outcome; it is never a reason to fall back to a company
 * page while an exact accession is known.
 */
export function canonicalSecUrl(p?: SecProvenance | null): string {
    if (!p) return '';

    for (const candidate of [
        p.canonical_url,
        p.filing_url,
        p.document_url,
        p.source_url,
    ]) {
        if (isTrustedSecUrl(candidate) && !isGenericEdgarUrl(candidate)) {
            return candidate as string;
        }
    }

    // Legacy rows: the accession survived, the URL did not.
    const rebuilt = filingIndexUrl(p.cik, p.accession ?? p.accession_number);
    if (rebuilt) return rebuilt;

    // A model-emitted `url` is last, and only if it is a real SEC URL that is
    // not the generic listing.
    if (isTrustedSecUrl(p.url) && !isGenericEdgarUrl(p.url)) return p.url as string;

    return '';
}

/** Whether verified filing provenance exists at all. Drives whether the UI may
 *  present the link as "the filing" rather than as a company search. */
export function hasExactFiling(p?: SecProvenance | null): boolean {
    return canonicalSecUrl(p) !== '';
}
