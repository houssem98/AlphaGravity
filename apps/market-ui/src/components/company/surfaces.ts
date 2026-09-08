// How the company page talks to gravity-api, and how it reports a surface that
// did not arrive. Extracted verbatim from CompanyPage.tsx (CF-9) — no logic
// changed; CompanyPage.surfaces.test.ts covers every function here.

export const GRAVITY_BASE = import.meta.env.VITE_GRAVITY_API_URL ?? 'http://localhost:8000';

// CF-3 · ONE auth construction for every request the page makes. It used to be
// two: a Supabase bearer on filings/financials and a hardcoded service key on
// longitudinal/sentiment, so which half of the page an anonymous visitor got was
// decided by which scheme a given line happened to use.
export const authed = (tok: string | null): HeadersInit =>
    tok ? { Authorization: `Bearer ${tok}` } : {};

// A surface either has data, or has a REASON it does not.
//
// `fetch(...).then(r => r.ok ? r.json() : null)` threw the reason away: a 401
// arrived as `null`, and the failure check read `null` as "no data", so an
// unauthenticated visitor saw empty cards where the honest answer was "sign in".
// Keeping the status is the whole fix.
export type SurfaceResult = { ok: true; data: unknown } | { ok: false; status: number };

export async function fetchSurface(url: string, headers: HeadersInit): Promise<SurfaceResult> {
    const r = await fetch(url, { headers });
    return r.ok ? { ok: true, data: await r.json() } : { ok: false, status: r.status };
}

/**
 * Why a surface is missing, in words — or null when it is merely EMPTY.
 *
 * CT-7's rule holds: an empty result and a failed request are different events
 * and must not look alike. This adds the case that was missing, an HTTP error,
 * and separates a credential fault (the visitor can fix it by signing in) from a
 * server fault (they cannot).
 */
export function surfaceFailure(label: string, r: PromiseSettledResult<unknown>): string | null {
    if (r.status === 'rejected') return `${label} — request failed`;
    const v = r.value as Record<string, unknown> | null;
    if (!v || typeof v !== 'object') return null;
    if (v.ok === false && typeof v.status === 'number') {
        return v.status === 401 || v.status === 403
            ? `${label} — sign in to view`
            : `${label} — server error (${v.status})`;
    }
    if ('error' in v) return `${label} — ${String(v.error)}`;
    return null;
}

/** The payload a surface carried, or null when it failed. */
export function surfaceData(r: PromiseSettledResult<unknown>): any {
    if (r.status !== 'fulfilled') return null;
    const v = r.value as Record<string, unknown> | null;
    if (v && typeof v === 'object' && 'ok' in v) return v.ok === true ? (v as any).data : null;
    return v;
}

/**
 * Runs `work` with the loading flag raised, and lowers it however `work` ends.
 * Returns the error rather than swallowing it, so the caller can state it.
 *
 * The flag used to be cleared on the last line of the settle handler. Anything
 * that threw above that line — a payload changing shape, a null deref — left the
 * page spinning forever, with no error shown and no way out but a reload. The
 * guarantee belongs in a `finally`, not in the last statement of a happy path.
 */
export async function withLoading(
    setLoading: (v: boolean) => void,
    work: () => Promise<void>,
): Promise<Error | null> {
    setLoading(true);
    try {
        await work();
        return null;
    } catch (e) {
        return e instanceof Error ? e : new Error(String(e));
    } finally {
        setLoading(false);
    }
}

/**
 * The fiscal years the revenue trend asks for.
 *
 * CF-8 · these used to be derived from the financials response — read its newest
 * FY, span back from there — which forced a second round trip after the first had
 * landed. Measured 2026-09-08 against prod: financials 1.89s THEN longitudinal
 * 2.19s for AAPL, 4.08s before the chart could draw.
 *
 * The calendar gives the same window without asking anyone. Fiscal years can lead
 * it (NVDA closed FY2026 in January 2026), so the span runs a year ahead, and
 * periods the server has no fact for come back null and are filtered out — so a
 * wider window costs a longer query string and nothing else.
 */
export const LONGITUDINAL_SPAN = 8;

export function revenuePeriods(now: Date = new Date()): string[] {
    const newest = now.getFullYear() + 1;
    return Array.from({ length: LONGITUDINAL_SPAN },
        (_, i) => `FY${newest - LONGITUDINAL_SPAN + 1 + i}`);
}
