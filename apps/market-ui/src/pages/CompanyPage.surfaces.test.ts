// CF-3 · an anonymous load must state its refusal, not render a half page.
//
// Before this, `fetch(...).then(r => r.ok ? r.json() : null)` mapped a 401 to
// null, and the failure check only caught rejected promises or bodies carrying
// `.error` — so an unauthenticated visitor got empty filings and financials cards
// with nothing anywhere saying why.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { surfaceFailure, surfaceData, withLoading } from './CompanyPage';

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

// CF-7 · the flag used to be cleared on the last line of the settle handler, so
// anything that threw above it left the page spinning with no error and no way
// out but a reload.
describe('withLoading', () => {
    const spy = () => {
        const calls: boolean[] = [];
        return { calls, set: (v: boolean) => { calls.push(v); } };
    };

    it('clears loading when the work throws', async () => {
        const s = spy();
        const err = await withLoading(s.set, async () => { throw new Error('payload changed shape'); });
        expect(s.calls).toEqual([true, false]);
        expect(err?.message).toBe('payload changed shape');
    });

    it('clears loading when the work throws synchronously, before any await', async () => {
        const s = spy();
        const err = await withLoading(s.set, () => { throw new TypeError("can't read 'rows' of null"); });
        expect(s.calls).toEqual([true, false]);
        expect(err).toBeInstanceOf(TypeError);
    });

    it('clears loading when the work rejects', async () => {
        const s = spy();
        const err = await withLoading(s.set, () => Promise.reject(new Error('network')));
        expect(s.calls).toEqual([true, false]);
        expect(err?.message).toBe('network');
    });

    it('reports a non-Error throw as an Error rather than losing it', async () => {
        const s = spy();
        const err = await withLoading(s.set, async () => { throw 'a bare string'; });
        expect(s.calls).toEqual([true, false]);
        expect(err).toBeInstanceOf(Error);
        expect(err?.message).toBe('a bare string');
    });

    it('clears loading and reports no error on success', async () => {
        const s = spy();
        const err = await withLoading(s.set, async () => { /* the happy path */ });
        expect(s.calls).toEqual([true, false]);
        expect(err).toBeNull();
    });

    it('lowers the flag before the caller can observe the error', async () => {
        const s = spy();
        let flagWhenCallerRan: boolean | undefined;
        await withLoading(s.set, async () => { throw new Error('boom'); })
            .then(() => { flagWhenCallerRan = s.calls.at(-1); });
        expect(flagWhenCallerRan).toBe(false);
    });
});

// The helper passing its own tests proves nothing if the page stopped calling it.
describe('the page is wired to the guarantee', () => {
    const src = readFileSync(new URL('./CompanyPage.tsx', import.meta.url), 'utf8');

    it('loads company data through withLoading', () => {
        expect(src).toMatch(/withLoading\(setLoading, async \(\) => \{/);
    });

    it('clears the flag only in a finally, never inline on a happy path', () => {
        // One occurrence, and it is withLoading's `finally`. A second one would be
        // the shape this row removed: a guarantee that holds only on the path that
        // reaches the last statement.
        expect([...src.matchAll(/setLoading\(false\)/g)]).toHaveLength(1);
        expect(src).toMatch(/finally \{\s*setLoading\(false\);\s*\}/);
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
