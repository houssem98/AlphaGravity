// DI-14 regression tests — docs/DEXTER_INSTITUTIONAL_ROADMAP.md Section 6 row 19.
import { describe, it, expect } from 'vitest';
import {
    fillStop, fillTarget, realisedR, participationFill, overnightRisk,
    MAX_PARTICIPATION, GAP_ATR,
} from './dexterExecution';
import type { Bar } from './taLevels';

const bar = (over: Partial<Bar> = {}): Bar =>
    ({ date: '2026-03-02', open: 100, high: 104, low: 96, close: 102, volume: 1000, ...over });

describe('row 19 — a stop gapped through fills at the open, not at the stop', () => {
    it('fills a long stop at the open when the session gaps below it', () => {
        const f = fillStop('long', 98, bar({ open: 90, high: 92, low: 88, close: 91 }));
        expect(f.kind).toBe('gapped');
        expect(f.price).toBe(90);
        expect(f.slippage).toBe(8);
        expect(f.reason).toContain('already through the 98 stop');
    });

    it('fills a short stop at the open when the session gaps above it', () => {
        const f = fillStop('short', 102, bar({ open: 112, high: 115, low: 110, close: 114 }));
        expect(f.kind).toBe('gapped');
        expect(f.price).toBe(112);
        expect(f.slippage).toBe(10);
    });

    it('fills at the level when the bar merely trades through it', () => {
        const f = fillStop('long', 98, bar({ open: 100, low: 96 }));
        expect(f.kind).toBe('at-level');
        expect(f.price).toBe(98);
        expect(f.slippage).toBe(0);
    });

    it('reports no fill when the level was never reached', () => {
        const f = fillStop('long', 90, bar({ low: 96 }));
        expect(f.kind).toBe('none');
        expect(f.price).toBeNull();
        expect(f.reason).toContain('never reached 90');
    });

    it('books the loss the market actually delivered, not the intended one', () => {
        // Long 100, stop 98 ⇒ 1R = 2. The gap to 90 is 5R, not 1R.
        const f = fillStop('long', 98, bar({ open: 90, low: 88 }));
        expect(realisedR('long', 100, 98, f.price!)).toBe(-5);
        expect(realisedR('long', 100, 98, 98)).toBe(-1);
    });

    it('never books a gapped stop as a clean −1R', () => {
        for (const open of [97, 95, 80, 50]) {
            const f = fillStop('long', 98, bar({ open, low: open - 2 }));
            expect(realisedR('long', 100, 98, f.price!)).toBeLessThan(-1);
        }
    });

    it('treats a target gap the same way, at the open', () => {
        const f = fillTarget('long', 106, bar({ open: 112, high: 115, low: 110, close: 113 }));
        expect(f.kind).toBe('gapped');
        expect(f.price).toBe(112);
        expect(realisedR('long', 100, 98, 112)).toBe(6);

        const clean = fillTarget('long', 106, bar({ open: 100, high: 108 }));
        expect(clean.kind).toBe('at-level');
        expect(clean.price).toBe(106);
    });

    it('handles the short side of a target gap', () => {
        const f = fillTarget('short', 94, bar({ open: 88, high: 90, low: 86, close: 87 }));
        expect(f.kind).toBe('gapped');
        expect(f.price).toBe(88);
    });

    it('refuses to compute R with no risk defined', () => {
        expect(realisedR('long', 100, 100, 95)).toBeNull();
    });
});

describe('row 19 — partial fills are reported, not assumed away', () => {
    it('fills completely inside the participation cap', () => {
        const p = participationFill(50, 1000);
        expect(p).toMatchObject({ filled: 50, remaining: 0, complete: true });
    });

    it('fills only the cap and leaves the rest working', () => {
        const p = participationFill(500, 1000);
        expect(p.filled).toBe(1000 * MAX_PARTICIPATION);
        expect(p.remaining).toBe(400);
        expect(p.complete).toBe(false);
        expect(p.reason).toContain('left working');
    });

    it('claims no fill at all when the bar has no volume', () => {
        for (const v of [undefined, 0]) {
            const p = participationFill(10, v);
            expect(p).toMatchObject({ filled: 0, remaining: 10, complete: false });
            expect(p.reason).toContain('cannot be assumed');
        }
    });

    it('honours a caller-supplied participation rate', () => {
        expect(participationFill(500, 1000, 0.25).filled).toBe(250);
    });
});

describe('row 19 — overnight gap risk is measured, not asserted', () => {
    const gappy: Bar[] = [
        bar({ date: '2026-03-01', close: 100 }),
        bar({ date: '2026-03-02', open: 106, close: 106 }),   // +6 = 3 ATR on ATR 2
        bar({ date: '2026-03-03', open: 106, close: 104 }),   // flat open
        bar({ date: '2026-03-04', open: 102, close: 102 }),   // −2 = 1 ATR
    ];

    it('counts sessions that opened away from the prior close', () => {
        const r = overnightRisk(gappy, 2);
        expect(r.bars).toBe(4);
        expect(r.gaps).toBe(2);
        expect(r.gapRate).toBeCloseTo(2 / 3, 4);
        expect(r.worstGapAtr).toBe(3);
    });

    it('honours the threshold', () => {
        expect(overnightRisk(gappy, 2, 2).gaps).toBe(1);
        expect(GAP_ATR).toBe(0.5);
    });

    it('returns an honest null rather than zero when it cannot measure', () => {
        expect(overnightRisk([bar()], 2).gapRate).toBeNull();
        expect(overnightRisk(gappy, null).gapRate).toBeNull();
        expect(overnightRisk(gappy, 0).worstGapAtr).toBeNull();
    });
});
