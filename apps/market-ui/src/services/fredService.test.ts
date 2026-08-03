// G13 regression tests — docs/DEXTER_INSTITUTIONAL_ROADMAP.md §1 G13.
// The fault was never that macro data was missing. It was that missing macro
// data looked exactly like a quiet day.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    fredApiKey, hasFredKey, getMacroSnapshot, MissingCredentialError, FRED_KEY_MISSING,
    getMacroSummaryText, MACRO_UNAVAILABLE,
} from './fredService';

const KEY = 'FRED_API_KEY';
const original = process.env[KEY];

afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
    vi.unstubAllGlobals();
});

describe('G13 — a missing credential fails loudly', () => {
    it('throws by name rather than returning a placeholder', () => {
        delete process.env[KEY];
        expect(() => fredApiKey()).toThrow(MissingCredentialError);
        expect(() => fredApiKey()).toThrow(/FRED_API_KEY is not set/);
    });

    it('never substitutes the old placeholder that FRED rejects anyway', () => {
        delete process.env[KEY];
        let thrown: unknown;
        try { fredApiKey(); } catch (e) { thrown = e; }
        expect((thrown as Error).message).not.toContain('abcdefghijklmnopqrstuvwxyz');
    });

    it('tells the reader where to get a key', () => {
        expect(FRED_KEY_MISSING).toContain('https://fredaccount.stlouisfed.org/apikeys');
        expect(FRED_KEY_MISSING).toContain('HTTP 400');
    });

    it('treats whitespace as no key at all', () => {
        process.env[KEY] = '   ';
        expect(hasFredKey()).toBe(false);
        expect(() => fredApiKey()).toThrow(MissingCredentialError);
    });

    it('reads the key from the Node environment', () => {
        process.env[KEY] = 'abcdef0123456789abcdef0123456789';
        expect(hasFredKey()).toBe(true);
        expect(fredApiKey()).toBe('abcdef0123456789abcdef0123456789');
    });

    it('trims a key pasted with surrounding whitespace', () => {
        process.env[KEY] = '  abcdef0123456789abcdef0123456789\n';
        expect(fredApiKey()).toBe('abcdef0123456789abcdef0123456789');
    });
});

describe('G13 — an empty snapshot says why it is empty', () => {
    it('reports the missing credential instead of a blank macro section', async () => {
        delete process.env[KEY];
        const snap = await getMacroSnapshot(['vix']);
        expect(snap.series).toHaveLength(0);
        expect(snap.summary).toBe('');
        expect(snap.error).toBe(FRED_KEY_MISSING);
    });

    it('distinguishes a dead feed from a missing key', async () => {
        process.env[KEY] = 'abcdef0123456789abcdef0123456789';
        vi.stubGlobal('fetch', async () => ({ ok: false, status: 503, json: async () => ({}) }));
        const snap = await getMacroSnapshot(['vix']);
        expect(snap.error).toContain('every FRED series failed');
        expect(snap.error).toContain('HTTP 503');
        expect(snap.error).not.toBe(FRED_KEY_MISSING);
    });

    it('says nothing about errors when the feed actually answers', async () => {
        process.env[KEY] = 'abcdef0123456789abcdef0123456789';
        vi.stubGlobal('fetch', async () => ({
            ok: true,
            status: 200,
            json: async () => ({ observations: [{ date: '2026-08-01', value: '17.4' }] }),
        }));
        const snap = await getMacroSnapshot(['vix']);
        expect(snap.error).toBeUndefined();
        expect(snap.series).toHaveLength(1);
        expect(snap.summary).toContain('VIX');
    });
});

describe('G13 — the delta guard that was never reachable', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it('does not crash on a series with a single observation', async () => {
        process.env[KEY] = 'abcdef0123456789abcdef0123456789';
        vi.stubGlobal('fetch', async () => ({
            ok: true, status: 200,
            json: async () => ({ observations: [{ date: '2026-08-01', value: '17.4' }] }),
        }));
        const snap = await getMacroSnapshot(['vix']);
        expect(snap.summary).toContain('17.4');
        expect(snap.summary).not.toContain('MoM');   // no prior period, so no delta
    });

    it('computes the delta when there are two observations', async () => {
        process.env[KEY] = 'abcdef0123456789abcdef0123456789';
        vi.stubGlobal('fetch', async () => ({
            ok: true, status: 200,
            json: async () => ({
                observations: [
                    { date: '2026-08-01', value: '22.0' },
                    { date: '2026-07-01', value: '20.0' },
                ],
            }),
        }));
        const snap = await getMacroSnapshot(['vix']);
        expect(snap.summary).toContain('+10.0% MoM');
    });

    it('does not divide by a zero prior value', async () => {
        process.env[KEY] = 'abcdef0123456789abcdef0123456789';
        vi.stubGlobal('fetch', async () => ({
            ok: true, status: 200,
            json: async () => ({
                observations: [
                    { date: '2026-08-01', value: '5' },
                    { date: '2026-07-01', value: '0' },
                ],
            }),
        }));
        const snap = await getMacroSnapshot(['vix']);
        expect(snap.summary).not.toContain('Infinity');
        expect(snap.summary).not.toContain('MoM');
    });
});

describe('G13 — the supplementary path stays non-throwing but stops being silent', () => {
    it('returns a one-line reason instead of a blank when the key is absent', async () => {
        delete process.env[KEY];
        await expect(getMacroSummaryText()).resolves.toBe(MACRO_UNAVAILABLE);
        expect(MACRO_UNAVAILABLE).toContain('FRED_API_KEY is not set');
    });

    // A transient feed failure stays quiet on purpose: it is supplementary and
    // self-healing, and injecting a line into every research report over a 503
    // is noise. An absent credential is permanent and actionable, so it speaks.
    it('stays silent on a transient feed failure, and never throws', async () => {
        process.env[KEY] = 'abcdef0123456789abcdef0123456789';
        vi.stubGlobal('fetch', async () => { throw new Error('socket hang up'); });
        await expect(getMacroSummaryText()).resolves.toBe('');
    });
});
