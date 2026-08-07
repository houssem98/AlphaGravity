// MP-1 · row R1 of docs/MOBILE_PARITY_ROADMAP.md — the legibility evaluator.
//
// V2's instrument (src/lib/overpaint.ts) asks "does element A paint over element
// B's text?". A cell that clips its OWN text is covered by nothing, so no pair
// exists, and `textContent` is still the whole string, so row R7 of
// e2e/mobileField.spec.ts is green too. F1 is exactly that shape: the markets
// table prints `7.07` where the server sent `107.07` and every V2 assertion
// passes. This file asks the question neither can: how much of the string an
// element holds is not on screen.
//
// Two ways a string goes missing without anything covering it:
//   self     — the element is narrower than its own content (`scrollWidth >
//              clientWidth`), which is what `text-overflow`, `overflow-hidden`
//              and a `nowrap` cell in a too-narrow column all produce.
//   ancestor — the glyphs fit the element, and the element sticks out of the
//              nearest ancestor that clips.
//
// Self-contained by contract: this runs inside the page via `page.evaluate`, so
// it may not close over anything in this module. Its only inputs are the
// selector and the DOM.

import type { OverpaintPair } from './overpaint';

export type Clipped = {
    tag: string;
    cls: string;
    /** The element's OWN text (direct text nodes only), trimmed. */
    text: string;
    /** How many px of that text cannot be read. Always > 1. */
    clippedPx: number;
    reason: 'self' | 'ancestor';
    /** F1 is a numeric fault. A clipped word is a different severity. */
    numeral: boolean;
    x: number;
    y: number;
    w: number;
    h: number;
};

export function clippedText(rootSel: string): Clipped[] {
    const root = document.querySelector(rootSel) || document.body;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const els = [root].concat(Array.from(root.querySelectorAll('*')) as Element[]);
    const out: Clipped[] = [];

    for (const el of els) {
        const s = getComputedStyle(el);
        if (s.visibility === 'hidden' || s.display === 'none') continue;

        // Own text only. A container inherits its children's textContent, and
        // reporting the container as well as the leaf would count one clipped
        // price twice and name the wrong element in the log.
        const text = Array.from(el.childNodes)
            .filter((n) => n.nodeType === 3)
            .map((n) => n.textContent || '')
            .join('')
            .trim();
        if (!text) continue;

        // The glyphs, not the box. A `<td>` is 120px wide and its four visible
        // digits are 38px; the difference is the whole question.
        const r = document.createRange();
        r.selectNodeContents(el);
        const g = r.getBoundingClientRect();
        if (g.width <= 0 || g.height <= 0) continue;
        if (g.right < 0 || g.bottom < 0 || g.left > vw || g.top > vh) continue;

        let px = el.scrollWidth - el.clientWidth;
        let reason: 'self' | 'ancestor' = 'self';
        if (px <= 1) px = 0;

        let p: Element | null = el.parentElement;
        while (p) {
            const ps = getComputedStyle(p);
            if (ps.overflowX !== 'visible' || ps.overflowY !== 'visible') break;
            p = p.parentElement;
        }
        if (p) {
            const c = p.getBoundingClientRect();
            const esc = Math.max(c.left - g.left, g.right - c.right, c.top - g.top, g.bottom - c.bottom);
            if (esc > 1 && esc > px) {
                px = esc;
                reason = 'ancestor';
            }
        }
        if (px <= 1) continue;

        out.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.getAttribute('class') || '').slice(0, 90),
            text: text.slice(0, 60),
            clippedPx: Math.round(px),
            reason,
            numeral: /\d/.test(text),
            x: g.left,
            y: g.top,
            w: g.width,
            h: g.height,
        });
    }
    return out;
}

/**
 * MP-4 · the same blind spot, pointed the other way.
 *
 * `overpaintPairs` compares raw rects, so it reports a cover over text that is
 * not painted where it claims to be: a tab scrolled out of its own
 * `overflow-x: auto` strip still reports its rect, and the control sitting
 * beside the strip "covers" it. V2's instrument stays unchanged — R5 says it
 * must — and its output is re-checked here against what is actually on screen.
 *
 * `clips` is `[rectKey, [left, top, right, bottom]]` for every element with own
 * text that has a clipping ancestor, keyed exactly as `desc()` rounds it:
 * `"x,y WxH"`. A pair survives when the covering rect still overlaps the
 * covered element's rect **clamped to that clipper** by more than 2px on both
 * axes — the same floor `overpaintPairs` uses.
 */
export function visiblePairs(
    pairs: OverpaintPair[],
    clips: [string, [number, number, number, number]][],
): OverpaintPair[] {
    const rectOf = (d: string) => {
        const m = /@(-?\d+),(-?\d+) (\d+)x(\d+)$/.exec(d);
        return m ? { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } : null;
    };
    const map = new Map(clips);
    return pairs.filter((p) => {
        const u = rectOf(p.under);
        const o = rectOf(p.over);
        if (!u || !o) return true;
        const c = map.get(`${u.x},${u.y} ${u.w}x${u.h}`);
        if (!c) return true;
        const vl = Math.max(u.x, c[0]);
        const vt = Math.max(u.y, c[1]);
        const vr = Math.min(u.x + u.w, c[2]);
        const vb = Math.min(u.y + u.h, c[3]);
        const ox = Math.min(o.x + o.w, vr) - Math.max(o.x, vl);
        const oy = Math.min(o.y + o.h, vb) - Math.max(o.y, vt);
        return ox > 2 && oy > 2;
    });
}
