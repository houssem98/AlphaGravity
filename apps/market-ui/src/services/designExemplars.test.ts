// G3a — exemplar bank. The bank feeds a prompt in G3b, so the properties that
// matter are: weak outcomes stay out, report content stays out, and the best
// prior work comes back first.

import { describe, it, expect } from 'vitest';
import {
    addExemplar, topExemplars, EXEMPLAR_MIN_SCORE, recordDesignOutcome, loadBank, saveBank,
    type DesignExemplar,
} from './designExemplars';
import { defaultDesignSpec } from './pdfDesigner';

function ex(over: Partial<DesignExemplar> = {}): DesignExemplar {
    return {
        ranAt: '2026-07-30T00:00:00.000Z',
        title: 'Nvidia FY2026',
        tone: 'bullish',
        theme: 'institutional',
        score: 9,
        iterations: 1,
        spec: defaultDesignSpec('bullish'),
        ...over,
    };
}

describe('addExemplar', () => {
    it('keeps a strong outcome', () => {
        expect(addExemplar([], ex())).toHaveLength(1);
    });

    it('refuses an outcome the critic did not rate highly', () => {
        expect(addExemplar([], ex({ score: EXEMPLAR_MIN_SCORE - 1 }))).toHaveLength(0);
        expect(addExemplar([], ex({ score: 0 }))).toHaveLength(0);
        expect(addExemplar([], ex({ score: NaN }))).toHaveLength(0);
    });

    it('never stores report content — a spec must not carry another report\'s sentences', () => {
        const spec = {
            ...defaultDesignSpec('bullish'),
            pullQuotes: [{ section: 'Thesis', text: 'Aladdin revenue grew 14% year-over-year.' }],
            abstract: 'A specific claim about one company.',
            exhibitTitles: ['Revenue vs peers'],
        };
        const [stored] = addExemplar([], ex({ spec }));
        expect(stored.spec.pullQuotes).toEqual([]);
        expect(stored.spec.abstract).toBe('');
        expect(stored.spec.exhibitTitles).toEqual([]);
        // The design decisions themselves survive.
        expect(stored.spec.accent).toBe(spec.accent);
        expect(stored.spec.theme).toBe(spec.theme);
    });

    it('replaces an earlier entry for the same report+tone only when better', () => {
        const bank = addExemplar([], ex({ score: 7 }));
        const improved = addExemplar(bank, ex({ score: 9 }));
        expect(improved).toHaveLength(1);
        expect(improved[0].score).toBe(9);

        const worse = addExemplar(improved, ex({ score: 8 }));
        expect(worse[0].score).toBe(9);
    });

    it('treats the same report in a different tone as its own entry', () => {
        const bank = addExemplar(addExemplar([], ex()), ex({ tone: 'bearish' }));
        expect(bank).toHaveLength(2);
    });

    it('caps the bank, keeping the best', () => {
        let bank: DesignExemplar[] = [];
        for (let i = 0; i < 10; i++) bank = addExemplar(bank, ex({ title: `r${i}`, score: i % 10 }), 3);
        expect(bank).toHaveLength(3);
        expect(bank.map(e => e.score)).toEqual([9, 8, 7]);
    });
});

describe('storage', () => {
    function withStore(seed: Record<string, string> = {}) {
        const store = { ...seed };
        (globalThis as any).localStorage = {
            getItem: (k: string) => store[k] ?? null,
            setItem: (k: string, v: string) => { store[k] = v; },
        };
        return store;
    }

    it('round-trips a recorded outcome', () => {
        withStore();
        const bank = recordDesignOutcome({
            title: 'Apple Services', tone: 'neutral', theme: 'editorial',
            score: 8, iterations: 2, spec: defaultDesignSpec('neutral'),
        });
        expect(bank).toHaveLength(1);
        expect(loadBank()[0].title).toBe('Apple Services');
        expect(loadBank()[0].ranAt).toMatch(/^\d{4}-/);
    });

    it('accumulates across calls', () => {
        withStore();
        recordDesignOutcome({ title: 'A', tone: 'bullish', theme: 'mono', score: 9, iterations: 1, spec: defaultDesignSpec() });
        recordDesignOutcome({ title: 'B', tone: 'bearish', theme: 'mono', score: 7, iterations: 1, spec: defaultDesignSpec() });
        expect(loadBank().map(e => e.title)).toEqual(['A', 'B']);
    });

    it('survives a corrupt bank rather than breaking an export', () => {
        withStore({ 'gamma.designExemplars.v1': '{not json' });
        expect(loadBank()).toEqual([]);
    });

    it('survives storage being absent entirely', () => {
        delete (globalThis as any).localStorage;
        expect(loadBank()).toEqual([]);
        expect(() => saveBank([])).not.toThrow();
    });
});

describe('topExemplars', () => {
    const bank = [
        ex({ title: 'a', tone: 'bearish', score: 10 }),
        ex({ title: 'b', tone: 'bullish', score: 7, theme: 'mono' }),
        ex({ title: 'c', tone: 'bullish', score: 8 }),
    ];

    it('prefers the matching tone over a higher score elsewhere', () => {
        expect(topExemplars(bank, { tone: 'bullish' }, 1)[0].title).toBe('c');
    });

    it('uses theme as a tiebreak within a tone', () => {
        expect(topExemplars(bank, { tone: 'bullish', theme: 'mono' }, 1)[0].title).toBe('b');
    });

    it('still returns the best available when nothing matches', () => {
        expect(topExemplars(bank, { tone: 'mixed' }, 1)[0].title).toBe('a');
    });

    it('returns nothing from an empty bank', () => {
        expect(topExemplars([], { tone: 'bullish' })).toEqual([]);
    });

    it('never returns more than asked', () => {
        expect(topExemplars(bank, {}, 2)).toHaveLength(2);
    });
});
