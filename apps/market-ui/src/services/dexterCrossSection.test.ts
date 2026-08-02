// DI-8 regression tests — docs/DEXTER_INSTITUTIONAL_ROADMAP.md Section 6 row 12.
import { describe, it, expect } from 'vitest';
import {
    rankIn, relativeStrength, isRanked, describeCrossSection,
    DEFAULT_LOOKBACK, MIN_UNIVERSE, type UniverseMember,
} from './dexterCrossSection';

/** 21 closes compounding at `pct` percent per bar-ish: enough for a 20-bar read. */
const member = (symbol: string, totalPct: number, n = DEFAULT_LOOKBACK + 1): UniverseMember => ({
    symbol,
    closes: Array.from({ length: n }, (_, i) => 100 * (1 + (totalPct / 100) * (i / (n - 1)))),
});

const UNIVERSE: UniverseMember[] = [
    member('BTC', 10),
    member('ETH', 25),
    member('SOL', -5),
    member('XRP', 3),
];

describe('row 12 — rank is computed against a stated universe', () => {
    it('measures strength as the return over the lookback', () => {
        expect(relativeStrength(member('X', 20).closes)).toBeCloseTo(20, 4);
        expect(relativeStrength(member('X', -10).closes)).toBeCloseTo(-10, 4);
    });

    it('ranks the strongest name first', () => {
        const r = rankIn('ETH', UNIVERSE);
        expect(isRanked(r) && r.rank).toBe(1);
        expect(isRanked(r) && r.of).toBe(4);
        expect(isRanked(r) && r.percentile).toBe(100);
    });

    it('ranks the weakest name last', () => {
        const r = rankIn('SOL', UNIVERSE);
        expect(isRanked(r) && r.rank).toBe(4);
        expect(isRanked(r) && r.percentile).toBe(0);
    });

    it('separates the name from the tape', () => {
        const r = rankIn('BTC', UNIVERSE);
        // Universe returns: 10, 25, -5, 3 ⇒ median (3 + 10) / 2 = 6.5
        expect(isRanked(r) && r.universeMedian).toBeCloseTo(6.5, 3);
        expect(isRanked(r) && r.excess).toBeCloseTo(3.5, 3);
        expect(isRanked(r) && r.rank).toBe(2);
    });

    it('names the universe it ranked against in the output', () => {
        const r = rankIn('BTC', UNIVERSE);
        expect(r.universe).toEqual(['BTC', 'ETH', 'SOL', 'XRP']);
        expect(isRanked(r) && r.reasons[0]).toContain('ranking 2 of 4 in [BTC, ETH, SOL, XRP]');
        expect(isRanked(r) && r.reasons[1]).toContain('universe median');
    });

    it('honours a caller-supplied lookback', () => {
        const short = rankIn('BTC', UNIVERSE, 5);
        expect(isRanked(short) && short.rs).toBeLessThan(10);   // 5 bars of a 20-bar move
    });
});

describe('row 12 — a symbol off the universe gets an honest null, never a default', () => {
    it('refuses to rank a name that is not in the universe', () => {
        const r = rankIn('DOGE', UNIVERSE);
        expect(r.rank).toBeNull();
        expect(isRanked(r)).toBe(false);
        expect((r as any).gap).toContain('not in the stated universe');
        expect((r as any).gap).toContain('a comparison that was never made');
    });

    it('does not invent a median or a percentile for it either', () => {
        const r = rankIn('DOGE', UNIVERSE) as any;
        expect(r.percentile).toBeUndefined();
        expect(r.universeMedian).toBeUndefined();
        expect(r.rs).toBeUndefined();
    });

    it('still states which universe it was checked against', () => {
        expect(rankIn('DOGE', UNIVERSE).universe).toEqual(['BTC', 'ETH', 'SOL', 'XRP']);
    });

    it('refuses when the name is in the universe but has no history', () => {
        const thin = [...UNIVERSE, { symbol: 'NEW', closes: [100, 101] }];
        const r = rankIn('NEW', thin);
        expect(r.rank).toBeNull();
        expect((r as any).gap).toContain('not enough history');
    });

    it('refuses when too few comparables have history to rank against', () => {
        const sparse: UniverseMember[] = [
            member('BTC', 10),
            { symbol: 'ETH', closes: [100, 101] },
            { symbol: 'SOL', closes: [100] },
        ];
        const r = rankIn('BTC', sparse);
        expect(r.rank).toBeNull();
        expect((r as any).gap).toContain(`at least ${MIN_UNIVERSE}`);
    });

    it('refuses an empty universe rather than ranking a name against itself', () => {
        expect(rankIn('BTC', []).rank).toBeNull();
    });

    it('says plainly that there is no rank', () => {
        expect(describeCrossSection(rankIn('DOGE', UNIVERSE))).toContain('no rank');
        expect(describeCrossSection(rankIn('ETH', UNIVERSE))).toContain('ranks 1/4');
    });
});
