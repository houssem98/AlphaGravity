// MF-1 · row R2 of docs/MOBILE_FIELD_ROADMAP.md — the overpaint evaluator.
//
// V1's instrument (mobileSweep.spec.ts:53) walks `getBoundingClientRect().right`
// against the frame. It is structurally incapable of seeing G1: an opaque
// `sticky left-0 z-20` cell painting over the four leading digits of the price
// cell beside it never leaves the viewport, so nothing about its right edge is
// wrong. The document does not scroll. The number on screen is still false.
//
// The question this file asks instead is between siblings: does element A paint
// over element B's text? Split in two halves on purpose —
//
//   collectPaintBoxes()  runs in the page, reads geometry and computed style,
//                        returns plain serialisable records. No judgement.
//   overpaintPairs()     runs in Node on those records, decides which pairs are
//                        faults. All judgement, no DOM — which is what makes it
//                        unit-testable in a vitest suite that has no jsdom.
//
// Both Playwright specs and scripts/capture-field-record.mjs use the same pair.

export type PaintBox = {
    /** Document order. Later index paints later at equal stacking order. */
    i: number;
    tag: string;
    cls: string;
    /** Positioned or z-indexed — the only elements that can paint over a non-descendant. */
    pos: boolean;
    /** Computed background-color is not fully transparent. */
    opaque: boolean;
    /** The element's OWN text (direct text nodes only), trimmed. */
    text: string;
    /** z-index of each stacking context from documentElement down to self. */
    z: number[];
    /** Indices of this box's ancestors that are also boxes. */
    anc: number[];
    x: number;
    y: number;
    w: number;
    h: number;
};

export type OverpaintPair = {
    over: string;
    /** The covering element's own text. G5 is a label printed on a label. */
    overText: string;
    under: string;
    overlapX: number;
    overlapY: number;
    covered: string;
    numeral: boolean;
};

const desc = (b: PaintBox) =>
    `${b.tag}${b.cls ? '.' + b.cls.trim().split(/\s+/).slice(0, 4).join('.') : ''}` +
    `@${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}`;

// Lexicographic compare of the two stacking-context chains, root first; ties
// break on document order. This is the painting order CSS 2.1 appendix E
// produces for the ordinary case (positioned descendants, no negative z-index
// tricks, no float/inline interleaving). It is an approximation and is stated
// as one: it answers "which of these two would a browser paint last", not
// "reproduce the full paint tree".
function above(a: PaintBox, b: PaintBox): boolean {
    const n = Math.max(a.z.length, b.z.length);
    for (let k = 0; k < n; k++) {
        const za = k < a.z.length ? a.z[k] : 0;
        const zb = k < b.z.length ? b.z[k] : 0;
        if (za !== zb) return za > zb;
    }
    return a.i > b.i;
}

/**
 * Every pair (A, B) where A and B are non-ancestor elements whose rects
 * intersect by more than `minOverlap` px on both axes, A paints above B, A's
 * background is not transparent, and B carries text.
 *
 * `requireOpaque: false` relaxes the background test — that is G5, where the
 * `+ Columns` chooser has *no* background and prints its glyphs straight onto
 * the tab labels underneath. Text over text is still text a user cannot read.
 */
export function overpaintPairs(
    boxes: PaintBox[],
    opts: { minOverlap?: number; requireOpaque?: boolean; numeralsOnly?: boolean } = {},
): OverpaintPair[] {
    const min = opts.minOverlap === undefined ? 2 : opts.minOverlap;
    const requireOpaque = opts.requireOpaque !== false;
    const out: OverpaintPair[] = [];

    for (const a of boxes) {
        // Raised, not necessarily positioned. G5's `+ Columns` button is
        // `position: static` inside a `sticky right-0 z-50` wrapper: the glyphs
        // that print on the tab labels belong to the static child, and a prune
        // on the child's own `position` drops the very box that does the
        // painting. Anything inside a non-root stacking context qualifies.
        if (!a.pos && a.z.length <= 1) continue;
        if (requireOpaque && !a.opaque) continue;
        if (a.w <= 0 || a.h <= 0) continue;
        for (const b of boxes) {
            if (b.i === a.i) continue;
            if (!b.text) continue;
            if (opts.numeralsOnly && !/\d/.test(b.text)) continue;
            if (a.anc.indexOf(b.i) >= 0 || b.anc.indexOf(a.i) >= 0) continue;
            const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
            const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
            if (ox <= min || oy <= min) continue;
            if (!above(a, b)) continue;
            out.push({
                over: desc(a),
                overText: a.text,
                under: desc(b),
                overlapX: Math.round(ox),
                overlapY: Math.round(oy),
                covered: b.text.slice(0, 40),
                numeral: /\d/.test(b.text),
            });
        }
    }
    return out;
}

/**
 * Runs inside the page. Self-contained by contract: it is handed to
 * `page.evaluate` by reference, so it may not close over anything in this
 * module.
 *
 * Two prunes, both deliberate and both narrowing what this can see:
 *  - only elements intersecting the viewport are collected;
 *  - the "over" side is restricted to positioned or z-indexed elements. A
 *    static element dragged over its sibling by a negative margin would be
 *    missed. Every fault in §1 of the ledger is a `sticky`/`fixed`/`absolute`.
 *
 * Text boxes are measured with a Range over the element's contents, not
 * `getBoundingClientRect()` — a `<td>` is 120px wide and its four glyphs are
 * 38px, and the difference between those two numbers is the whole question of
 * whether the digits are covered.
 */
export function collectPaintBoxes(rootSel: string): PaintBox[] {
    const root = document.querySelector(rootSel) || document.body;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const els = [root].concat(Array.from(root.querySelectorAll('*')) as Element[]);
    const index = new Map<Element, number>();
    const out: PaintBox[] = [];

    const transparent = (c: string) =>
        !c ||
        c === 'transparent' ||
        /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)$/.test(c) ||
        /\/\s*0\s*\)$/.test(c);

    const makesContext = (s: CSSStyleDeclaration, el: Element) =>
        (s.position !== 'static' && s.zIndex !== 'auto') ||
        s.position === 'fixed' ||
        s.position === 'sticky' ||
        parseFloat(s.opacity) < 1 ||
        s.transform !== 'none' ||
        s.filter !== 'none' ||
        s.isolation === 'isolate' ||
        s.mixBlendMode !== 'normal' ||
        el === document.documentElement;

    for (const el of els) {
        const s = getComputedStyle(el);
        if (s.visibility === 'hidden' || s.display === 'none') continue;

        const own = Array.from(el.childNodes)
            .filter((n) => n.nodeType === 3)
            .map((n) => n.textContent || '')
            .join('')
            .trim();

        const pos = s.position !== 'static' || s.zIndex !== 'auto';
        if (!own && !pos) continue;

        let rect = el.getBoundingClientRect();
        if (own) {
            const r = document.createRange();
            r.selectNodeContents(el);
            const rr = r.getBoundingClientRect();
            if (rr.width > 0 && rr.height > 0) rect = rr;
        }
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (rect.right < 0 || rect.bottom < 0 || rect.left > vw || rect.top > vh) continue;

        // Stacking chain, root first.
        const z: number[] = [];
        const anc: number[] = [];
        let p: Element | null = el;
        while (p) {
            const ps = p === el ? s : getComputedStyle(p);
            if (makesContext(ps, p)) {
                const zi = parseInt(ps.zIndex, 10);
                z.unshift(isNaN(zi) ? 0 : zi);
            }
            if (p !== el) {
                const ai = index.get(p);
                if (ai !== undefined) anc.push(ai);
            }
            p = p.parentElement;
        }

        const i = out.length;
        index.set(el, i);
        out.push({
            i,
            tag: el.tagName.toLowerCase(),
            cls: (el.getAttribute('class') || '').slice(0, 90),
            pos,
            opaque: !transparent(s.backgroundColor),
            text: own.slice(0, 60),
            z,
            anc,
            x: rect.left,
            y: rect.top,
            w: rect.width,
            h: rect.height,
        });
    }
    return out;
}
