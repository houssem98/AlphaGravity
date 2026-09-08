// CF-14 · converted from a bare assertion script to a vitest suite.
//
// The assertions below are unchanged. What changed is that something runs them:
// as a script with its own `check()` helper it was excluded from vitest, and the
// runner it was meant to use is referenced only from ci.yml.disabled — so these
// checks had never failed a build, because nothing ever executed them.
import { describe, it, expect } from 'vitest';
import { computeQuarterRows } from './LatestQuarterCard';

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
