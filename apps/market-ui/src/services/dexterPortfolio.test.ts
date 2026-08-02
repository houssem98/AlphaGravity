// DI-6 regression tests — docs/DEXTER_INSTITUTIONAL_ROADMAP.md Section 6 row 10.
import { describe, it, expect } from 'vitest';
import {
    admit, portfolioHeat, grossExposure, correlation, returnsFrom, describeAdmission,
    MAX_PORTFOLIO_HEAT_PCT, MAX_CORRELATION, MAX_GROSS_EXPOSURE_PCT,
    type OpenPosition, type Candidate,
} from './dexterPortfolio';

const pos = (symbol: string, riskPct: number, sizePct = 20, direction: 'long' | 'short' = 'long'): OpenPosition =>
    ({ symbol, direction, riskPct, sizePct });

const cand = (over: Partial<Candidate> = {}): Candidate =>
    ({ symbol: 'SOL', direction: 'long', sizePct: 18, riskPct: 1, ...over });

describe('row 10 — portfolio heat never exceeds the budget', () => {
    it('sums risk and size across open positions', () => {
        const book = [pos('BTC', 1), pos('ETH', 1.5, 12)];
        expect(portfolioHeat(book)).toBe(2.5);
        expect(grossExposure(book)).toBe(32);
    });

    it('admits a position that fits at full size', () => {
        const r = admit(cand({ riskPct: 1 }), [pos('BTC', 1)]);
        expect(r.admission).toBe('accepted');
        expect(r.riskPct).toBe(1);
        expect(r.heatAfter).toBe(2);
        expect(r.heatAfter).toBeLessThanOrEqual(MAX_PORTFOLIO_HEAT_PCT);
    });

    it('resizes a position that would breach the heat budget', () => {
        // 5% already on, 6% budget ⇒ only 1% of risk left for a 2% candidate.
        const r = admit(cand({ riskPct: 2, sizePct: 40 }), [pos('BTC', 5, 30)]);
        expect(r.admission).toBe('resized');
        expect(r.riskPct).toBe(1);
        expect(r.sizePct).toBe(20);            // scaled by the same 0.5
        expect(r.binding).toContain('heat');
        expect(r.heatAfter).toBe(MAX_PORTFOLIO_HEAT_PCT);
    });

    it('rejects outright when the book is already at the heat budget', () => {
        const r = admit(cand(), [pos('BTC', 6, 30)]);
        expect(r.admission).toBe('rejected');
        expect(r.sizePct).toBe(0);
        expect(r.riskPct).toBe(0);
        expect(r.heatAfter).toBe(r.heatBefore);
        expect(r.reasons.at(-1)).toContain('no room for any new risk');
    });

    it('holds the budget across a run of ten identical calls', () => {
        // The G4 failure case: ten BUY calls in a row, each previously full size.
        const book: OpenPosition[] = [];
        for (let i = 0; i < 10; i++) {
            const r = admit(cand({ symbol: `SYM${i}`, riskPct: 1, sizePct: 9 }), book);
            if (r.admission !== 'rejected') book.push(pos(`SYM${i}`, r.riskPct, r.sizePct));
            expect(portfolioHeat(book)).toBeLessThanOrEqual(MAX_PORTFOLIO_HEAT_PCT);
        }
        expect(portfolioHeat(book)).toBe(MAX_PORTFOLIO_HEAT_PCT);
        expect(book.length).toBeLessThan(10);   // the rest were refused
    });

    it('respects a caller-supplied budget', () => {
        const r = admit(cand({ riskPct: 3 }), [pos('BTC', 1)], { maxHeatPct: 2 });
        expect(r.riskPct).toBe(1);
        expect(r.heatAfter).toBe(2);
    });
});

describe('row 10 — the correlation gate', () => {
    it('computes correlation from returns rather than taking it on assertion', () => {
        const a = returnsFrom(Array.from({ length: 40 }, (_, i) => 100 + i));
        const b = returnsFrom(Array.from({ length: 40 }, (_, i) => 200 + 2 * i));
        expect(correlation(a, b)).toBeCloseTo(1, 3);

        // A falling series is NOT anti-correlated with a rising one here: both
        // return series drift the same way bar to bar. Anti-correlation needs
        // the moves themselves to oppose, so these two alternate against it.
        const zig = returnsFrom(Array.from({ length: 40 }, (_, i) => (i % 2 ? 101 : 100)));
        const zag = returnsFrom(Array.from({ length: 40 }, (_, i) => (i % 2 ? 100 : 101)));
        expect(correlation(zig, zag)).toBeCloseTo(-1, 3);
    });

    it('returns null rather than zero when correlation is undefined', () => {
        expect(correlation([0.1, 0.2], [0.1, 0.2])).toBeNull();                       // too few pairs
        expect(correlation(Array(30).fill(0.01), Array(30).fill(0.02))).toBeNull();   // both flat
    });

    it('treats a correlated same-direction candidate as more of the open trade', () => {
        const r = admit(cand({ riskPct: 2 }), [pos('BTC', 5, 30)], { correlations: { BTC: 0.92 } });
        expect(r.binding).toContain('correlation');
        expect(r.reasons.join(' ')).toContain('addition to an existing BTC exposure');
        expect(r.reasons.join(' ')).toContain('r=0.92');
        expect(r.admission).toBe('resized');
        expect(r.heatAfter).toBeLessThanOrEqual(MAX_PORTFOLIO_HEAT_PCT);
    });

    it('refuses a correlated position on the opposite side', () => {
        const r = admit(cand({ direction: 'short' }), [pos('BTC', 1, 20, 'long')], { correlations: { BTC: 0.88 } });
        expect(r.admission).toBe('rejected');
        expect(r.reasons.at(-1)).toContain('two lots of costs');
    });

    it('leaves an uncorrelated position alone', () => {
        const r = admit(cand({ riskPct: 1 }), [pos('BTC', 1)], { correlations: { BTC: 0.1 } });
        expect(r.admission).toBe('accepted');
        expect(r.binding).not.toContain('correlation');
    });

    it('treats an unknown correlation as unknown, not as zero', () => {
        const known = admit(cand(), [pos('BTC', 1)], { correlations: { BTC: null } });
        expect(known.binding).not.toContain('correlation');
        const missing = admit(cand(), [pos('BTC', 1)], { correlations: {} });
        expect(missing.binding).not.toContain('correlation');
    });

    it('always treats the same symbol as the same trade, correlation or not', () => {
        const r = admit(cand({ symbol: 'BTC', riskPct: 2 }), [pos('BTC', 5, 30)]);
        expect(r.binding).toContain('correlation');
        expect(r.reasons.join(' ')).toContain('already open — this is a top-up');
    });

    it('honours a caller-supplied correlation threshold', () => {
        const strict = admit(cand(), [pos('BTC', 1)], { correlations: { BTC: 0.4 }, maxCorrelation: 0.3 });
        expect(strict.binding).toContain('correlation');
        expect(MAX_CORRELATION).toBe(0.7);
    });
});

describe('row 10 — gross exposure', () => {
    it('resizes a position that would breach the gross cap', () => {
        const r = admit(cand({ sizePct: 30, riskPct: 0.5 }), [pos('BTC', 1, 90)]);
        expect(r.binding).toContain('gross-exposure');
        expect(r.sizePct).toBe(10);
        expect(grossExposure([pos('BTC', 1, 90), pos('SOL', r.riskPct, r.sizePct)])).toBeLessThanOrEqual(MAX_GROSS_EXPOSURE_PCT);
    });

    it('rejects when the book is already fully invested', () => {
        const r = admit(cand(), [pos('BTC', 1, 100)]);
        expect(r.admission).toBe('rejected');
        expect(r.reasons.at(-1)).toContain('no room for any new position');
    });

    it('scales risk down with size so the two stay consistent', () => {
        const r = admit(cand({ sizePct: 40, riskPct: 2 }), [pos('BTC', 0.5, 80)]);
        expect(r.sizePct / 40).toBeCloseTo(r.riskPct / 2, 6);
    });
});

describe('row 10 — every decision is explained', () => {
    it('refuses a candidate with no size or risk rather than admitting a nothing', () => {
        expect(admit(cand({ riskPct: 0 }), []).admission).toBe('rejected');
        expect(admit(cand({ sizePct: 0 }), []).reasons.at(-1)).toContain('nothing to admit');
    });

    it('states size, risk, heat and the binding limits in one line', () => {
        const line = describeAdmission(admit(cand({ riskPct: 2 }), [pos('BTC', 5, 30)]));
        expect(line).toContain('RESIZED');
        expect(line).toContain('heat 5% → 6%');
    });
});
