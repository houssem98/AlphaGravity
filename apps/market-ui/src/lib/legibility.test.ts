import { describe, it, expect, afterEach } from 'vitest';
import { clippedText, visiblePairs } from './legibility';

// MP-1 · row R1 of docs/MOBILE_PARITY_ROADMAP.md.
//
// The fixture is F1 reduced to four elements: a markets row whose price cell is
// narrower than the price it holds (known-clipped), a symbol cell that fits
// (known-clean), a label that escapes a scroller that clips (known-clipped by
// ancestor), and a label that escapes an ancestor whose overflow is visible
// (known-clean — an escapee is not a clip if nothing cuts it).
//
// There is no jsdom in this workspace and none is added for this: `clippedText`
// runs inside the page by contract, so it reads globals, and globals can be
// stubbed. The stub implements only the seven DOM members the evaluator calls —
// which is also a readable statement of its blast radius.

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };

type FakeEl = {
    tagName: string;
    cls: string;
    own: string;
    scrollWidth: number;
    clientWidth: number;
    rect: Rect;
    /** The glyph box a Range over the contents would report. Defaults to rect. */
    glyph?: Rect;
    overflow: string;
    display: string;
    visibility: string;
    kids: FakeEl[];
    parentElement: FakeEl | null;
    childNodes: { nodeType: number; textContent: string }[];
    getAttribute(name: string): string | null;
    getBoundingClientRect(): Rect;
    querySelectorAll(sel: string): FakeEl[];
};

const rect = (left: number, top: number, width: number, height: number): Rect => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
});

function el(p: {
    tag?: string;
    cls?: string;
    text?: string;
    rect: Rect;
    glyph?: Rect;
    scrollWidth?: number;
    clientWidth?: number;
    overflow?: string;
    display?: string;
    visibility?: string;
    kids?: FakeEl[];
}): FakeEl {
    const node: FakeEl = {
        tagName: (p.tag || 'div').toUpperCase(),
        cls: p.cls || '',
        own: p.text || '',
        scrollWidth: p.scrollWidth === undefined ? p.rect.width : p.scrollWidth,
        clientWidth: p.clientWidth === undefined ? p.rect.width : p.clientWidth,
        rect: p.rect,
        glyph: p.glyph,
        overflow: p.overflow || 'visible',
        display: p.display || 'block',
        visibility: p.visibility || 'visible',
        kids: p.kids || [],
        parentElement: null,
        childNodes: p.text ? [{ nodeType: 3, textContent: p.text }] : [],
        getAttribute: (n) => (n === 'class' ? node.cls : null),
        getBoundingClientRect: () => node.rect,
        querySelectorAll: () => {
            const flat: FakeEl[] = [];
            const walk = (e: FakeEl) => e.kids.forEach((k) => (flat.push(k), walk(k)));
            walk(node);
            return flat;
        },
    };
    node.kids.forEach((k) => (k.parentElement = node));
    return node;
}

function mount(root: FakeEl, viewport = { w: 360, h: 780 }) {
    let ranged: FakeEl | null = null;
    (globalThis as Record<string, unknown>).document = {
        querySelector: () => root,
        documentElement: { clientWidth: viewport.w, clientHeight: viewport.h },
        createRange: () => ({
            selectNodeContents: (e: FakeEl) => (ranged = e),
            getBoundingClientRect: () => (ranged as unknown as FakeEl).glyph || (ranged as unknown as FakeEl).rect,
        }),
    };
    (globalThis as Record<string, unknown>).getComputedStyle = (e: FakeEl) => ({
        visibility: e.visibility,
        display: e.display,
        overflowX: e.overflow,
        overflowY: e.overflow,
    });
}

afterEach(() => {
    delete (globalThis as Record<string, unknown>).document;
    delete (globalThis as Record<string, unknown>).getComputedStyle;
});

describe('R1 — the legibility evaluator sees what overpaintPairs structurally cannot', () => {
    it('reports a price cell narrower than the price it holds, in px', () => {
        // "$107.07" needs 78px of glyphs; the cell gives it 40. Nothing covers
        // it, so overpaintPairs finds no pair and textContent is intact.
        const price = el({
            tag: 'td',
            cls: 'text-right font-mono tabular-nums',
            text: '$107.07',
            rect: rect(140, 100, 40, 20),
            scrollWidth: 78,
            clientWidth: 40,
        });
        const symbol = el({ tag: 'td', cls: 'font-semibold', text: 'BTC', rect: rect(0, 100, 90, 20) });
        const row = el({ tag: 'tr', rect: rect(0, 100, 360, 20), kids: [symbol, price] });
        mount(el({ tag: 'table', rect: rect(0, 90, 360, 400), kids: [row] }));

        const hits = clippedText('table');
        expect(hits).toHaveLength(1);
        expect(hits[0].text).toBe('$107.07');
        expect(hits[0].clippedPx).toBe(38);
        expect(hits[0].reason).toBe('self');
        expect(hits[0].numeral).toBe(true);
        expect(hits[0].cls).toContain('font-mono');
    });

    it('reports glyphs that escape the nearest ancestor that clips, and ignores it when nothing clips', () => {
        const label = el({ tag: 'span', text: 'Categories', rect: rect(300, 10, 88, 18) });
        const clipper = el({ tag: 'div', cls: 'overflow-hidden', rect: rect(0, 10, 360, 18), overflow: 'hidden', kids: [label] });
        mount(el({ tag: 'nav', rect: rect(0, 0, 360, 40), kids: [clipper] }));
        const cut = clippedText('nav');
        expect(cut).toHaveLength(1);
        expect(cut[0].reason).toBe('ancestor');
        expect(cut[0].clippedPx).toBe(28);
        expect(cut[0].numeral).toBe(false);

        const loose = el({ tag: 'span', text: 'Categories', rect: rect(300, 10, 88, 18) });
        const open = el({ tag: 'div', rect: rect(0, 10, 360, 18), kids: [loose] });
        mount(el({ tag: 'nav', rect: rect(0, 0, 360, 40), kids: [open] }));
        expect(clippedText('nav')).toEqual([]);
    });

    it('measures glyphs, not the box: a wide cell holding short text is clean', () => {
        const wide = el({
            tag: 'td',
            text: '$1.00',
            rect: rect(0, 100, 120, 20),
            glyph: rect(0, 100, 38, 20),
            scrollWidth: 120,
            clientWidth: 120,
        });
        mount(el({ tag: 'table', rect: rect(0, 90, 360, 40), kids: [wide] }));
        expect(clippedText('table')).toEqual([]);
    });

    it('ignores a 1px rounding difference — that is not a clipped glyph', () => {
        const hair = el({ tag: 'td', text: '$107.07', rect: rect(0, 100, 78, 20), scrollWidth: 79, clientWidth: 78 });
        mount(el({ tag: 'table', rect: rect(0, 90, 360, 40), kids: [hair] }));
        expect(clippedText('table')).toEqual([]);
    });

    it('counts a clipped string once, on the leaf that renders it', () => {
        // The container's textContent is the same string. Reporting both would
        // double every F1 count and name a <tr> as the fault.
        const price = el({ tag: 'td', text: '$107.07', rect: rect(0, 100, 40, 20), scrollWidth: 78, clientWidth: 40 });
        const row = el({ tag: 'tr', rect: rect(0, 100, 40, 20), scrollWidth: 78, clientWidth: 40, kids: [price] });
        mount(el({ tag: 'table', rect: rect(0, 90, 360, 40), kids: [row] }));
        const hits = clippedText('table');
        expect(hits).toHaveLength(1);
        expect(hits[0].tag).toBe('td');
    });

    it('ignores hidden elements and elements scrolled out of the viewport', () => {
        const gone = el({ tag: 'td', text: '$107.07', rect: rect(0, 100, 40, 20), scrollWidth: 78, clientWidth: 40, display: 'none' });
        const invisible = el({ tag: 'td', text: '$99.99', rect: rect(0, 130, 40, 20), scrollWidth: 78, clientWidth: 40, visibility: 'hidden' });
        const below = el({ tag: 'td', text: '$88.88', rect: rect(0, 900, 40, 20), scrollWidth: 78, clientWidth: 40 });
        const offLeft = el({ tag: 'td', text: '$77.77', rect: rect(-90, 100, 40, 20), scrollWidth: 78, clientWidth: 40 });
        mount(el({ tag: 'table', rect: rect(0, 90, 360, 400), kids: [gone, invisible, below, offLeft] }));
        expect(clippedText('table')).toEqual([]);
    });

    it('reports the worse of the two clips when an element is cut both ways', () => {
        const both = el({
            tag: 'td',
            text: '$107.07',
            rect: rect(340, 100, 40, 20),
            scrollWidth: 55,
            clientWidth: 40,
            glyph: rect(340, 100, 40, 20),
        });
        const clipper = el({ tag: 'div', rect: rect(0, 90, 360, 400), overflow: 'hidden', kids: [both] });
        mount(el({ tag: 'table', rect: rect(0, 90, 360, 400), kids: [clipper] }));
        const hits = clippedText('table');
        expect(hits).toHaveLength(1);
        expect(hits[0].clippedPx).toBe(20); // 380 - 360 beats 55 - 40
        expect(hits[0].reason).toBe('ancestor');
    });
});

// MP-4 · row R5. `visiblePairs` exists to drop covers over text that is not on
// screen — which is exactly the shape of a filter that could quietly drop
// everything and report a green gate. These four fix what it may not drop.
describe('R5 — visiblePairs keeps a real cover and drops one over clipped text', () => {
    const pair = (over: string, under: string, covered = 'Categories') => ({
        over, overText: '+ Columns', under, overlapX: 60, overlapY: 13, covered, numeral: false,
    });

    it('keeps a pair whose covered element has no clipping ancestor at all', () => {
        // F3 as the phone showed it: the tab is painted where it says it is.
        expect(visiblePairs([pair('button@246,880 97x31', 'button@260,880 88x20')], [])).toHaveLength(1);
    });

    it('keeps a pair whose covered text is still visible inside its clipper', () => {
        const clips: [string, [number, number, number, number]][] = [['260,880 88x20', [17, 870, 340, 916]]];
        expect(visiblePairs([pair('button@246,880 97x31', 'button@260,880 88x20')], clips)).toHaveLength(1);
    });

    it('drops a pair whose covered text was scrolled out of its own strip', () => {
        // The strip ends at x=246; the tab's rect says 260..348 but none of it
        // is painted. That is the pair MP-4's fix left behind on prod.
        const clips: [string, [number, number, number, number]][] = [['260,880 88x20', [17, 870, 246, 916]]];
        expect(visiblePairs([pair('button@246,880 97x31', 'button@260,880 88x20')], clips)).toEqual([]);
    });

    it('drops only the clipped pair when both kinds are present', () => {
        const clips: [string, [number, number, number, number]][] = [['260,880 88x20', [17, 870, 246, 916]]];
        const kept = pair('div@0,0 360x48', 'span@10,10 100x20', 'Retrieval online');
        expect(visiblePairs([pair('button@246,880 97x31', 'button@260,880 88x20'), kept], clips)).toEqual([kept]);
    });
});
