// G2a — numeric-series extraction. Fixtures are the two table shapes the
// archived corpus actually uses: metric-rows × entity-columns (scorecards)
// and entity-rows × metric-columns (screens).

import { describe, it, expect } from 'vitest';
import {
    parseCellNumber, parseMarkdownTables, extractExhibits, exhibitValueViolations, barGeometry,
} from './exhibitExtract';

const SCORECARD = `**Financial Scorecard**

| Metric | Nvidia | AMD | Broadcom | Intel | Source / Citation |
|--------|--------|-----|----------|-------|-------------------|
| Data Center Revenue | $130.5B | $5.5B | $12.2B | ~$500M | Analyst Synthesis |
| Data Center Gross Margin | 73.0% | ~55% | ~65% | ~30% | Analyst Synthesis |
| GPU Unit Shipments | ~3.5M | ~400K | N/A | <100K | Analyst Synthesis |`;

const SCREEN = `| Ticker | Bank Name | NIM Sensitivity (bps) | Composite Score | Verdict |
|--------|-----------|-----------------------|-----------------|--------|
| JPM | JPMorgan Chase | -4 | +1.8 | Winner |
| BAC | Bank of America | -5 | +1.2 | Winner |
| USB | U.S. Bancorp | -12 | -0.4 | Loser |`;

describe('parseCellNumber', () => {
    it('reads magnitude, unit and the verbatim text', () => {
        expect(parseCellNumber('$130.5B')).toMatchObject({ value: 130.5, unit: '$B', raw: '$130.5B' });
        expect(parseCellNumber('73.0%')).toMatchObject({ value: 73, unit: '%' });
        expect(parseCellNumber('~$500M')).toMatchObject({ value: 500, unit: '$M' });
        expect(parseCellNumber('-12')).toMatchObject({ value: -12, unit: '' });
        expect(parseCellNumber('+1.8')).toMatchObject({ value: 1.8, unit: '' });
        expect(parseCellNumber('~2.5x')).toMatchObject({ value: 2.5, unit: 'x' });
    });

    it('distinguishes dollars from a bare count', () => {
        expect(parseCellNumber('$12.2B')!.unit).toBe('$B');
        expect(parseCellNumber('~3.5M')!.unit).toBe('M');
    });

    it('refuses placeholders and inequalities — those are not plottable', () => {
        expect(parseCellNumber('N/A')).toBeNull();
        expect(parseCellNumber('<100K')).toBeNull();
        expect(parseCellNumber('—')).toBeNull();
        expect(parseCellNumber('Winner')).toBeNull();
        expect(parseCellNumber('')).toBeNull();
    });

    it('takes the first figure when a cell states several', () => {
        expect(parseCellNumber('73.0% (Q4 FY2025); guided 70.6% Q1 FY2026')!.value).toBe(73);
    });
});

describe('parseMarkdownTables', () => {
    it('reads headers and body rows, dropping the separator', () => {
        const [t] = parseMarkdownTables(SCORECARD);
        expect(t.headers[0]).toBe('Metric');
        expect(t.rows).toHaveLength(3);
        expect(t.rows[0][1]).toBe('$130.5B');
    });

    it('separates two tables that are not adjacent', () => {
        expect(parseMarkdownTables(`${SCORECARD}\n\nprose\n\n${SCREEN}`)).toHaveLength(2);
    });

    it('ignores a table with no body rows', () => {
        expect(parseMarkdownTables('| A | B |\n|---|---|')).toHaveLength(0);
    });
});

describe('extractExhibits', () => {
    it('reads a metric row as a series across entity columns', () => {
        const revenue = extractExhibits(SCORECARD, 10).find(e => e.title === 'Data Center Revenue')!;
        expect(revenue.unit).toBe('$B');
        expect(revenue.bars.map(b => b.label)).toEqual(['Nvidia', 'AMD', 'Broadcom']);
        expect(revenue.bars.map(b => b.value)).toEqual([130.5, 5.5, 12.2]);
    });

    it('drops a cell whose unit disagrees rather than converting it', () => {
        // ~$500M cannot join a $B series without arithmetic on a reported number.
        const revenue = extractExhibits(SCORECARD, 10).find(e => e.title === 'Data Center Revenue')!;
        expect(revenue.bars.map(b => b.label)).not.toContain('Intel');
    });

    it('reads a metric column as a series across row labels', () => {
        const nim = extractExhibits(SCREEN, 10).find(e => e.title === 'NIM Sensitivity (bps)')!;
        expect(nim.bars.map(b => b.label)).toEqual(['JPM', 'BAC', 'USB']);
        expect(nim.bars.map(b => b.value)).toEqual([-4, -5, -12]);
    });

    it('carries the row citation onto every bar', () => {
        const revenue = extractExhibits(SCORECARD, 10).find(e => e.title === 'Data Center Revenue')!;
        expect(revenue.bars.every(b => b.sourceIds[0] === 'Analyst Synthesis')).toBe(true);
    });

    it('emits nothing for a row that cannot yield two comparable numbers', () => {
        // GPU shipments: ~3.5M, ~400K, N/A, <100K — no two share a unit.
        expect(extractExhibits(SCORECARD, 10).some(e => e.title === 'GPU Unit Shipments')).toBe(false);
    });

    it('ignores a table of pure prose', () => {
        expect(extractExhibits('| Risk | Mitigant |\n|---|---|\n| Supply | Dual-source |')).toEqual([]);
    });

    it('returns the widest comparisons first and respects max', () => {
        const specs = extractExhibits(`${SCORECARD}\n\n${SCREEN}`, 2);
        expect(specs).toHaveLength(2);
        expect(specs[0].bars.length).toBeGreaterThanOrEqual(specs[1].bars.length);
    });
});

describe('barGeometry', () => {
    it('puts the baseline at the left edge when nothing is negative', () => {
        const g = barGeometry([10, 5], 100);
        expect(g.zeroX).toBe(0);
        expect(g.bars[0]).toEqual({ x: 0, width: 100 });
        expect(g.bars[1]).toEqual({ x: 0, width: 50 });
    });

    it('grows negative bars leftward from the baseline', () => {
        const g = barGeometry([-4, -16], 100);
        expect(g.zeroX).toBe(100);
        expect(g.bars[1]).toEqual({ x: 0, width: 100 });
        expect(g.bars[0].x + g.bars[0].width).toBe(100);
    });

    it('places the baseline between a mixed series', () => {
        const g = barGeometry([-50, 50], 100);
        expect(g.zeroX).toBe(50);
        expect(g.bars[0]).toEqual({ x: 0, width: 50 });
        expect(g.bars[1]).toEqual({ x: 50, width: 50 });
    });

    it('does not divide by zero on a flat series', () => {
        expect(barGeometry([0, 0], 100).bars.every(b => Number.isFinite(b.width))).toBe(true);
    });
});

describe('exhibitValueViolations — the verbatim gate', () => {
    it('passes exhibits extracted from the report itself', () => {
        expect(exhibitValueViolations(SCORECARD, extractExhibits(SCORECARD, 10))).toEqual([]);
    });

    it('flags a value the report never states', () => {
        const forged = [{ title: 'Revenue', unit: '$B', bars: [{ label: 'X', value: 999.7, period: '', sourceIds: [] }] }];
        expect(exhibitValueViolations(SCORECARD, forged)).toHaveLength(1);
    });
});
