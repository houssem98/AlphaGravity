// CF-3 · an anonymous load must state its refusal, not render a half page.
//
// Before this, `fetch(...).then(r => r.ok ? r.json() : null)` mapped a 401 to
// null, and the failure check only caught rejected promises or bodies carrying
// `.error` — so an unauthenticated visitor got empty filings and financials cards
// with nothing anywhere saying why.
import { describe, it, expect } from 'vitest';
import { surfaceFailure, surfaceData } from './CompanyPage';

const ok = (data: unknown) => ({ status: 'fulfilled', value: { ok: true, data } }) as const;
const http = (status: number) => ({ status: 'fulfilled', value: { ok: false, status } }) as const;
const rejected = { status: 'rejected', reason: new Error('network') } as const;

describe('surfaceFailure', () => {
    it('states a 401 as something the visitor can fix', () => {
        expect(surfaceFailure('Filings index', http(401))).toBe('Filings index — sign in to view');
    });

    it('treats 403 as the same credential fault', () => {
        expect(surfaceFailure('XBRL financials', http(403))).toBe('XBRL financials — sign in to view');
    });

    it('does not offer sign-in for a server fault the visitor cannot fix', () => {
        expect(surfaceFailure('Filings index', http(500))).toBe('Filings index — server error (500)');
        expect(surfaceFailure('Quote', http(502))).toBe('Quote — server error (502)');
    });

    // CT-7's rule, still holding: EMPTY is not FAILURE.
    it('does not report an empty result as a failure', () => {
        expect(surfaceFailure('XBRL financials', ok({ rows: [] }))).toBeNull();
        expect(surfaceFailure('Filings index', ok({ documents: [{ id: 'x' }] }))).toBeNull();
    });

    it('keeps stating the shapes it already caught', () => {
        expect(surfaceFailure('Quote', rejected)).toBe('Quote — request failed');
        expect(surfaceFailure('Company overview (Alpha Vantage)',
            { status: 'fulfilled', value: { error: 'rate limited' } }))
            .toBe('Company overview (Alpha Vantage) — rate limited');
    });
});

describe('surfaceData', () => {
    it('unwraps a successful surface', () => {
        expect(surfaceData(ok({ rows: [1, 2] })).rows).toHaveLength(2);
    });

    it('yields null for anything that failed', () => {
        expect(surfaceData(http(401))).toBeNull();
        expect(surfaceData(rejected)).toBeNull();
    });

    it('passes a bare non-SurfaceResult value through', () => {
        expect(surfaceData({ status: 'fulfilled', value: { Symbol: 'AAPL' } }).Symbol).toBe('AAPL');
    });
});

describe('an anonymous page load', () => {
    it('names exactly the surfaces that require auth, and stays quiet about the rest', () => {
        const failures = [
            surfaceFailure('Company overview (Alpha Vantage)', ok({ Symbol: 'AAPL' })),
            surfaceFailure('Quote', ok({ quoteResponse: { result: [{ regularMarketPrice: 1 }] } })),
            surfaceFailure('Filings index', http(401)),
            surfaceFailure('XBRL financials', http(401)),
        ].filter(Boolean);

        expect(failures).toEqual([
            'Filings index — sign in to view',
            'XBRL financials — sign in to view',
        ]);
    });
});
