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
