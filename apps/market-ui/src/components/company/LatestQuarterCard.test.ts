// CF-14 · converted from a bare assertion script to a vitest suite.
//
// The assertions below are unchanged. What changed is that something runs them:
// as a script with its own `check()` helper it was excluded from vitest, and the
// runner it was meant to use is referenced only from ci.yml.disabled — so these
// checks had never failed a build, because nothing ever executed them.
import { describe, it, expect } from 'vitest';
import { computeQuarterRows } from './LatestQuarterCard';
import { parsePeriod } from '../../lib/periods';

// V3-1 · the fixture now carries `unit`, which the API has always sent
// (`/company/{t}/financials` selects it) and this fixture used to omit. The card
// reads the unit off the fact instead of inferring one from the row's position,
// so a fixture without units was modelling a response the server never returns.
// Every assertion below is unchanged.
const metrics = [
    { metric: 'Revenue (Total Revenue, Net Sales)', value: 416161000000, unit: 'USD', period: 'FY2025' },
    { metric: 'Net Income (Net Earnings, Profit)', value: 112010000000, unit: 'USD', period: 'FY2025' },
    { metric: 'Earnings Per Share (EPS) Diluted', value: 7.46, unit: 'USD/shares', period: 'FY2025' },
    { metric: 'Revenue (Total Revenue, Net Sales)', value: 400000000000, unit: 'USD', period: 'FY2024' },
    { metric: 'Net Income (Net Earnings, Profit)', value: 100000000000, unit: 'USD', period: 'FY2024' },
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
    { metric: 'Revenue (Total Revenue, Net Sales)', value: 110000000000, unit: 'USD', period: 'Q4 2025' },
    { metric: 'Revenue (Total Revenue, Net Sales)', value: 416161000000, unit: 'USD', period: 'FY2025' },
    { metric: 'Revenue (Total Revenue, Net Sales)', value: 400000000000, unit: 'USD', period: 'FY2024' },
    { metric: 'Revenue (Total Revenue, Net Sales)', value: 410000000000, unit: 'USD', period: 'TTM 2025' },
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
            { metric: 'Revenue (Total Revenue, Net Sales)', value: 3, unit: 'USD', period: 'Q1 2025' },
            { metric: 'Revenue (Total Revenue, Net Sales)', value: 4, unit: 'USD', period: 'Q4 2024' },
        ];
        const q = computeQuarterRows(quarters)!;
        expect(q.latest).toBe('Q1 2025');
        expect(q.prior).toBe('Q4 2024');
    });
});

// V3-1 · a margin is not a profit, and its change is in points.
describe('computeQuarterRows on a margin', () => {
    const out = computeQuarterRows([
        { metric: 'Gross margin', value: 45, unit: '%', period: 'Q2 FY2026' },
        { metric: 'Gross margin', value: 40, unit: '%', period: 'Q1 FY2026' },
    ])!;

    it('never files a margin under the Gross Profit label', () => {
        expect(out.rows.find(r => r.label === 'Gross Profit')).toBeUndefined();
        expect(out.rows.find(r => r.label === 'Gross Margin')).toBeDefined();
    });

    it('keeps the percent unit off the fact and renders no dollar sign', () => {
        const gm = out.rows.find(r => r.label === 'Gross Margin')!;
        expect(gm.unit).toBe('%');
        expect(gm.cur).toBe('45.0%');
        expect(gm.prev).toBe('40.0%');
    });

    it('states a percentage move in points, not as a relative percent', () => {
        const gm = out.rows.find(r => r.label === 'Gross Margin')!;
        expect(gm.delta).toBe(5);
        expect(gm.deltaUnit).toBe('pp');
    });

    it('draws no delta across two different units', () => {
        const mixedUnit = computeQuarterRows([
            { metric: 'Gross margin', value: 45, unit: '%', period: 'FY2025' },
            { metric: 'Gross margin', value: 40000000, unit: 'USD', period: 'FY2024' },
        ])!;
        expect(mixedUnit.rows.find(r => r.label === 'Gross Margin')!.delta).toBeNull();
    });

    // V3-2's client half: an absent unit is a state, not a licence to say USD.
    it('renders a unit-less fact without inventing a currency', () => {
        const bare = computeQuarterRows([
            { metric: 'Revenue (Total Revenue, Net Sales)', value: 1234, period: 'FY2025' },
        ])!;
        const row = bare.rows.find(r => r.label === 'Revenue')!;
        expect(row.unit).toBeNull();
        expect(row.cur).not.toContain('$');
    });
});
