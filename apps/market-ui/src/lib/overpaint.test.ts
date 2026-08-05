import { describe, it, expect } from 'vitest';
import { overpaintPairs, type PaintBox } from './overpaint';

// MF-1 · row R2 of docs/MOBILE_FIELD_ROADMAP.md.
//
// The fixture is G1 reduced to four boxes: a table row where the identity cell
// is `sticky left-0 z-20 bg-[color:var(--bg)]` and the price cell beside it is
// a static `<td>` whose glyphs start under the sticky one once the table is
// scrolled. Known-bad is the pair (name, price). Known-good is everything else
// in the same fixture — a transparent overlay, a descendant, and a neighbour
// that merely touches — so a change that makes the evaluator fire on
// everything fails here rather than in a 90-second Playwright run.
//
// There is no jsdom in this workspace and this file needs none: the collector
// is the half that touches the DOM, and the half under test is arithmetic.
const box = (b: Partial<PaintBox> & Pick<PaintBox, 'i' | 'x' | 'w'>): PaintBox => ({
    tag: 'td',
    cls: '',
    pos: false,
    opaque: false,
    text: '',
    z: [],
    anc: [],
    y: 100,
    h: 20,
    ...b,
});

// x=0..170 sticky identity cell, opaque, z-20. The price glyphs run 140..210,
// so 30px of "$107.07" sits under it — which is what the phone photographed as
// `7.07`.
const NAME = box({ i: 0, x: 0, w: 170, pos: true, opaque: true, z: [20], cls: 'sticky left-0 z-20', text: 'Bitcoin' });
const PRICE = box({ i: 1, x: 140, w: 70, text: '$107.07', cls: 'text-right font-mono' });

describe('R2 — the overpaint evaluator sees what the escapee walker cannot', () => {
    it('reports the opaque sticky cell painting over the price digits', () => {
        const pairs = overpaintPairs([NAME, PRICE]);
        expect(pairs).toHaveLength(1);
        expect(pairs[0].covered).toBe('$107.07');
        expect(pairs[0].overlapX).toBe(30);
        expect(pairs[0].numeral).toBe(true);
        expect(pairs[0].over).toContain('sticky');
    });

    it('does not report the pair the other way round', () => {
        // PRICE is static and transparent; it cannot be the over side.
        const pairs = overpaintPairs([NAME, PRICE]).filter((p) => p.over.includes('font-mono'));
        expect(pairs).toEqual([]);
    });

    it('ignores a transparent cover by default and finds it when asked', () => {
        const glass = box({ i: 0, x: 0, w: 170, pos: true, opaque: false, z: [50], cls: 'sticky right-0 z-50', text: '+ Columns' });
        const under = box({ i: 1, x: 140, w: 70, text: 'Categories' });
        expect(overpaintPairs([glass, under])).toEqual([]);
        // G5's shape: no background, so it prints on top of the label.
        expect(overpaintPairs([glass, under], { requireOpaque: false })).toHaveLength(1);
    });

    it('ignores a child painting inside its own ancestor', () => {
        const parent = box({ i: 0, x: 0, w: 200, text: 'Bitcoin BTC' });
        const child = box({ i: 1, x: 10, w: 40, pos: true, opaque: true, z: [10], anc: [0] });
        expect(overpaintPairs([parent, child])).toEqual([]);
    });

    it('ignores neighbours that only graze — 2px is the floor', () => {
        const a = box({ i: 0, x: 0, w: 100, pos: true, opaque: true, z: [20] });
        const graze = box({ i: 1, x: 98, w: 70, text: '$107.07' });
        expect(overpaintPairs([a, graze])).toEqual([]);
        const bite = box({ i: 1, x: 97, w: 70, text: '$107.07' });
        expect(overpaintPairs([a, bite])).toHaveLength(1);
    });

    it('ignores an element that overlaps horizontally but not vertically', () => {
        const a = box({ i: 0, x: 0, w: 170, y: 0, h: 20, pos: true, opaque: true, z: [20] });
        const below = box({ i: 1, x: 140, w: 70, y: 40, h: 20, text: '$107.07' });
        expect(overpaintPairs([a, below])).toEqual([]);
    });

    it('ignores a covered element that carries no text', () => {
        const a = box({ i: 0, x: 0, w: 170, pos: true, opaque: true, z: [20] });
        const blank = box({ i: 1, x: 140, w: 70 });
        expect(overpaintPairs([a, blank])).toEqual([]);
    });

    it('ranks by stacking chain first and document order only on a tie', () => {
        // Later in the document but stacked below: not an overpaint.
        const low = box({ i: 1, x: 0, w: 170, pos: true, opaque: true, z: [5] });
        const high = box({ i: 0, x: 140, w: 70, pos: true, opaque: true, z: [40], text: '$107.07' });
        expect(overpaintPairs([high, low])).toEqual([]);
        // Same chain, later element wins.
        const first = box({ i: 0, x: 140, w: 70, pos: true, opaque: true, z: [7], text: '$107.07' });
        const second = box({ i: 1, x: 0, w: 170, pos: true, opaque: true, z: [7] });
        expect(overpaintPairs([first, second])).toHaveLength(1);
    });

    it('counts a static child of a raised wrapper as a cover (G5)', () => {
        // The wrapper is sticky z-50; this button is static and carries the text.
        const label = box({ i: 1, x: 263, w: 97, pos: false, opaque: false, z: [0, 50], text: '+ Columns' });
        const tab = box({ i: 0, x: 260, w: 88, text: 'Categories' });
        expect(overpaintPairs([label, tab], { requireOpaque: false })).toHaveLength(1);
        expect(overpaintPairs([label, tab], { requireOpaque: false })[0].overText).toBe('+ Columns');
    });

    it('numeralsOnly keeps the truth faults and drops the cosmetic ones', () => {
        const a = box({ i: 0, x: 0, w: 170, pos: true, opaque: true, z: [20] });
        const word = box({ i: 1, x: 140, w: 70, text: 'Watchlist' });
        const num = box({ i: 2, x: 140, w: 70, y: 200, text: '$107.07' });
        expect(overpaintPairs([a, word, num], { numeralsOnly: true })).toHaveLength(0);
        const tall = box({ i: 0, x: 0, w: 170, h: 300, pos: true, opaque: true, z: [20] });
        expect(overpaintPairs([tall, word, num], { numeralsOnly: true })).toHaveLength(1);
    });
});
