// CF-14 · converted from a bare assertion script to a vitest suite.
//
// The assertions below are unchanged. What changed is that something runs them:
// as a script with its own `check()` helper it was excluded from vitest, and the
// runner it was meant to use is referenced only from ci.yml.disabled — so these
// checks had never failed a build, because nothing ever executed them.
import { describe, it, expect } from 'vitest';
import { computeQuarterRows } from './LatestQuarterCard';
import { parsePeriod } from '../../lib/periods';

const metrics = [
    { metric: 'Revenue (Total Revenue, Net Sales)', value: 416161000000, period: 'FY2025' },
    { metric: 'Net Income (Net Earnings, Profit)', value: 112010000000, period: 'FY2025' },
    { metric: 'Earnings Per Share (EPS) Diluted', value: 7.46, period: 'FY2025' },
    { metric: 'Revenue (Total Revenue, Net Sales)', value: 400000000000, period: 'FY2024' },
    { metric: 'Net Income (Net Earnings, Profit)', value: 100000000000, period: 'FY2024' },
];

describe('computeQuarterRows', () => {
    const out = computeQuarterRows(metrics)!;

    it('picks the newest period and the one before it', () => {
        expect(out.latest).toBe('FY2025');
        expect(out.prior).toBe('FY2024');
    });

    it('formats revenue and computes its delta', () => {
        expect(out.rows[0].label).toBe('Revenue');
        expect(out.rows[0].cur).toBe('$416.16B');
        expect(out.rows[0].delta).not.toBeNull();
        expect(Math.abs(out.rows[0].delta! - 4.04)).toBeLessThan(0.1);
    });

    it('renders EPS as dollars, with no delta when the prior period lacks it', () => {
        const eps = out.rows.find(r => r.label === 'Diluted EPS');
        expect(eps).toBeDefined();
        expect(eps!.cur).toBe('$7.46');
        expect(eps!.delta).toBeNull();
    });

    it('returns null for empty metrics', () => {
        expect(computeQuarterRows([])).toBeNull();
    });
});

// V2-5 · a deliberately mixed set. Under the old lexical sort "Q4 2025" sorted
// above "FY2025" (Q above F) and the card printed a delta between a quarter and
// a fiscal year. The set below holds all three bases at once.
const mixed = [
    { metric: 'Revenue (Total Revenue, Net Sales)', value: 110000000000, period: 'Q4 2025' },
    { metric: 'Revenue (Total Revenue, Net Sales)', value: 416161000000, period: 'FY2025' },
    { metric: 'Revenue (Total Revenue, Net Sales)', value: 400000000000, period: 'FY2024' },
    { metric: 'Revenue (Total Revenue, Net Sales)', value: 410000000000, period: 'TTM 2025' },
];

describe('computeQuarterRows on a mixed period set', () => {
    const out = computeQuarterRows(mixed)!;

    it('never pairs two periods stated on different bases', () => {
        expect(out.prior === undefined || parsePeriod(out.latest).basis === parsePeriod(out.prior).basis)
            .toBe(true);
    });

    it('does not compare Q4 2025 against FY2025', () => {
        expect([out.latest, out.prior]).not.toEqual(['Q4 2025', 'FY2025']);
    });

    it('draws no delta when the chosen basis holds only one period', () => {
        expect(out.prior).toBeUndefined();
        expect(out.rows.every(r => r.delta === null)).toBe(true);
    });

    it('still compares within a basis when that basis has two periods', () => {
        const annualOnly = mixed.filter(m => m.period.startsWith('FY'));
        const annual = computeQuarterRows(annualOnly)!;
        expect(annual.latest).toBe('FY2025');
        expect(annual.prior).toBe('FY2024');
        expect(annual.rows[0].delta).not.toBeNull();
    });

    // 'Q4 2024' sorts above 'Q1 2025' as a string, and is a year older.
    it('orders quarters by quarter, not by string', () => {
        const quarters = [
            { metric: 'Revenue (Total Revenue, Net Sales)', value: 3, period: 'Q1 2025' },
            { metric: 'Revenue (Total Revenue, Net Sales)', value: 4, period: 'Q4 2024' },
        ];
        const q = computeQuarterRows(quarters)!;
        expect(q.latest).toBe('Q1 2025');
        expect(q.prior).toBe('Q4 2024');
    });
});
