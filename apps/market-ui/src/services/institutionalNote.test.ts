// DI-13 regression tests — docs/DEXTER_INSTITUTIONAL_ROADMAP.md Section 6 rows 17-18.
import { describe, it, expect } from 'vitest';
import {
    buildNote, renderNoteBlock, renderNoteText, isNoteBlock, isFalsifiable,
    NOTE_LANG, RATINGS, type NoteInput,
} from './institutionalNote';
import { parseBlock, dexterLang } from './dexterBlocks';

const FULL: NoteInput = {
    symbol: 'BTC',
    rating: 'ACCUMULATE',
    target: { price: 84_000, horizon: '3 months' },
    thesis: 'Structure held the 61,400 shelf while the funding reset',
    variantPerception: 'The tape is pricing forced supply that the on-chain data says has already cleared',
    catalysts: [{ event: 'Quarterly options expiry', expected: '2026-09-25' }],
    invalidations: [{ condition: 'two consecutive daily closes below 61,400', kills: 'the shelf that the whole thesis rests on' }],
    stop: 61_400,
    unit: ' USD',
    calibration: 'Calibration: not yet calibrated (n=7 of 20)',
};

describe('row 17 — the note carries all six fields', () => {
    it('renders rating, target with horizon, thesis, variant perception, a dated catalyst and a trigger', () => {
        const note = buildNote(FULL);
        expect(note.fields.map(f => f.key)).toEqual([
            'rating', 'target', 'thesis', 'variantPerception', 'catalysts', 'invalidations',
        ]);
        expect(note.complete).toBe(true);
        expect(note.gaps).toEqual([]);
        expect(note.fields[0].value).toBe('ACCUMULATE');
        expect(note.fields[1].value).toBe('84000 USD over 3 months');
        expect(note.fields[4].value).toContain('expected 2026-09-25');
    });

    it('emits a dexter-note block the DD-8 renderer can pick up', () => {
        const block = renderNoteBlock(buildNote(FULL));
        expect(block.startsWith('```' + NOTE_LANG)).toBe(true);
        const body = block.split('\n').slice(1, -1).join('\n');
        const parsed = parseBlock(body);
        expect(isNoteBlock(parsed)).toBe(true);
        expect(dexterLang(`language-${NOTE_LANG}`)).toBe(NOTE_LANG);
    });

    it('carries the calibration line rather than a bare confidence', () => {
        expect(buildNote(FULL).calibration).toContain('not yet calibrated');
        expect(renderNoteText(buildNote(FULL))).toContain('not yet calibrated');
    });
});

describe('row 17 — a missing field is an explicit gap, never an omission', () => {
    it('keeps the field and states why it is empty', () => {
        const note = buildNote({ symbol: 'BTC' });
        expect(note.fields).toHaveLength(6);
        expect(note.complete).toBe(false);
        expect(note.gaps).toHaveLength(6);
        for (const f of note.fields) {
            expect(f.value).toBeNull();
            expect(f.gap).toBeTruthy();
        }
    });

    it('says the specific thing that was missing', () => {
        const note = buildNote({ symbol: 'BTC' });
        const gap = (k: string) => note.fields.find(f => f.key === k)!.gap;
        expect(gap('target')).toContain('no valuation anchor with a horizon');
        expect(gap('variantPerception')).toContain('nothing identified that the market is missing');
        expect(gap('catalysts')).toContain('an undated catalyst is a hope');
        expect(gap('invalidations')).toContain('a view with no invalidation condition is not a view');
    });

    it('refuses a target with no horizon rather than inventing one', () => {
        const note = buildNote({ ...FULL, target: { price: 84_000, horizon: '  ' } });
        expect(note.fields[1].value).toBeNull();
        expect(note.fields[1].gap).toContain('no price target');
    });

    it('refuses an undated catalyst', () => {
        const note = buildNote({ ...FULL, catalysts: [{ event: 'ETF flows improve', expected: '' }] });
        expect(note.fields[4].value).toBeNull();
    });

    it('refuses a rating that is not on the scale', () => {
        expect(buildNote({ ...FULL, rating: 'STRONG BUY' as any }).fields[0].value).toBeNull();
        for (const r of RATINGS) expect(buildNote({ ...FULL, rating: r }).fields[0].value).toBe(r);
    });

    it('shows the gap in the plain-text fallback too', () => {
        const text = renderNoteText(buildNote({ symbol: 'BTC' }));
        expect(text).toContain('Rating: — no rating');
        expect(text).not.toMatch(/Rating:\s*$/m);
    });
});

describe('row 18 — invalidation triggers are conditions, and are not the stop', () => {
    const t = (condition: string) => ({ condition, kills: 'the thesis' });

    it('accepts a stated observable condition', () => {
        expect(isFalsifiable(t('two consecutive daily closes below 61,400'), 61_400)).toBe(true);
        expect(isFalsifiable(t('a weekly close back above 72,800'), 61_400)).toBe(true);
        expect(isFalsifiable(t('funding fails to reset by 2026-09-30'), null)).toBe(true);
    });

    it('rejects a bare price', () => {
        expect(isFalsifiable(t('61,400'), 61_400)).toBe(false);
        expect(isFalsifiable(t('61400'), null)).toBe(false);
        expect(isFalsifiable(t('$61,400.00'), null)).toBe(false);
    });

    it('rejects a trigger that merely restates the stop', () => {
        expect(isFalsifiable(t('61,400 stop'), 61_400)).toBe(false);
    });

    it('rejects a hedge with no observable in it', () => {
        expect(isFalsifiable(t('if things get worse'), null)).toBe(false);
        expect(isFalsifiable(t('sentiment sours'), null)).toBe(false);
        expect(isFalsifiable(t('bad'), null)).toBe(false);
    });

    it('keeps only the falsifiable triggers and gaps when none survive', () => {
        const note = buildNote({
            ...FULL,
            invalidations: [t('61,400'), t('if it feels wrong'), { condition: 'a daily close below 58,000', kills: 'the higher-low sequence' }],
        });
        expect(note.fields[5].value).toBe('a daily close below 58,000 → the higher-low sequence');

        const none = buildNote({ ...FULL, invalidations: [t('61,400'), t('vibes')] });
        expect(none.fields[5].value).toBeNull();
        expect(none.fields[5].gap).toContain('is not a view');
    });

    it('distinguishes the invalidation from the stop in the rendered note', () => {
        const note = buildNote(FULL);
        expect(note.fields[5].value).toContain('two consecutive daily closes');
        expect(note.fields[5].value).toContain('→ the shelf that the whole thesis rests on');
    });
});
