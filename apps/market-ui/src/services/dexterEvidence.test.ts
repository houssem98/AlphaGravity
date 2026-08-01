// DX-6 regression tests — docs/AI_TRADING_AGENT_ROADMAP.md Section 6 row 9.
// A figure in a trading answer is either traceable to a feed or it is a guess.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { uncitedFigures, citationFor, isMarketFigure } from './dexterTools';
import { extractFigures, findUnmappedCites } from './gridResearch';

describe('row 9 — uncited figures are found', () => {
    it('passes a figure whose citation follows it', () => {
        expect(uncitedFigures('The high was $66,556.16 [1] on 2026-07-21 [1].')).toEqual([]);
    });

    it('flags a figure with no citation anywhere', () => {
        expect(uncitedFigures('Support sits around 62,500.')).toEqual(['62,500']);
    });

    it('reads prose dates as dates, not as uncited numbers', () => {
        expect(uncitedFigures('The swing printed on July 21, 2026 and held.')).toEqual([]);
    });

    it('flags only the figure that lacks a source, not its cited neighbour', () => {
        const out = uncitedFigures('Close was 63,076.01 [1] but support is probably 55,000.');
        expect(out).toEqual(['55,000']);
    });

    it('does not mistake a citation marker for a figure', () => {
        expect(uncitedFigures('As shown [1][2][3].')).toEqual([]);
    });

    it('lets one citation cover every figure in its own sentence', () => {
        // The exact sentence the first prod probe produced. The old fixed
        // character window flagged the high as uncited; it plainly is not.
        const real = 'The highest close was $66,556.16 on July 21, and the lowest close was $58,624.71 on June 30 [1].';
        expect(uncitedFigures(real)).toEqual([]);
    });

    it('does not let a citation in the NEXT sentence launder a figure', () => {
        expect(uncitedFigures('Support is 55,000. The close was 63,076.01 [1].')).toEqual(['55,000']);
    });

    it('ignores counts and years, which are not market figures', () => {
        expect(uncitedFigures('Over 60 days there were 3 touches in 2026.')).toEqual([]);
        expect(isMarketFigure('60')).toBe(false);
        expect(isMarketFigure('$60')).toBe(true);
        expect(isMarketFigure('60%')).toBe(true);
        expect(isMarketFigure('62,500')).toBe(true);
        expect(isMarketFigure('1.2bn')).toBe(true);
    });

    it('handles percentages and magnitude suffixes', () => {
        expect(uncitedFigures('Volume rose 12% and market cap hit $1.2bn.')).toEqual(['$1.2bn', '12%']);
        expect(uncitedFigures('Volume rose 12% [2] and cap hit $1.2bn [2].')).toEqual([]);
    });

    it('does not report an ISO date as three uncited figures', () => {
        expect(uncitedFigures('The swing low printed on 2026-07-21.')).toEqual([]);
        expect(uncitedFigures('Filed 2026/01/05 with no source.')).toEqual([]);
    });

    it('says nothing about an answer with no numbers', () => {
        expect(uncitedFigures('I could not reach the feed, so I have no figure to give you.')).toEqual([]);
        expect(uncitedFigures('')).toEqual([]);
    });
});

describe('row 9 — fabricated citations are found', () => {
    const citations = [
        { id: 1, title: 'BTC reading price history', source: 'getChartData', text: '120 bars' },
    ];

    it('accepts a marker that maps to a real source', () => {
        expect(findUnmappedCites('The high was 66,556.16 [1].', citations)).toEqual([]);
    });

    it('flags a marker pointing at nothing', () => {
        expect(findUnmappedCites('Revenue grew [4] last year.', citations)).toEqual([4]);
    });

    it('keeps the two failure modes separate', () => {
        const text = 'Close 63,076.01 [1], target 90,000 [9].';
        expect(findUnmappedCites(text, citations)).toEqual([9]);   // source does not exist
        expect(uncitedFigures(text)).toEqual([]);                  // both figures do carry a marker
    });
});

describe('row 9 — citations come from real tool snapshots', () => {
    it('numbers a snapshot and names where it came from', () => {
        const c = citationFor(1, 'getChartData', 'BTC', [{ close: 1 }, { close: 2 }]);
        expect(c).toEqual({
            id: 1,
            title: 'BTC reading price history',
            source: 'getChartData',
            text: '2 bars',
        });
    });

    it('carries a feed refusal through as the evidence text', () => {
        const c = citationFor(3, 'getFundamentalData', 'SAH', { error: 'BVMT feed unreachable.' });
        expect(c.text).toBe('BVMT feed unreachable.');
    });

    it('agrees with the grid on what counts as a figure', () => {
        expect(extractFigures('Close 63,076.01 and volume 12%')).toContain('63,076.01');
        // Documented divergence: the grid's regex ends in \b and so drops the
        // "%". Harmless for its figure-diffing, wrong for a user-facing list.
        expect(extractFigures('volume 12%')).toContain('12');
        expect(uncitedFigures('volume 12%')).toEqual(['12%']);
    });
});

describe('row 9 — wired into the handler', () => {
    const handler = readFileSync(join(__dirname, '../../api/agent/[fn].ts'), 'utf8');

    it('cites only snapshots that carried something', () => {
        expect(handler).toMatch(/if \(ctx && !isEmptyToolData\(outcome\.data\)\)/);
    });

    it('hands the model the citation id while it reads the result', () => {
        expect(handler).toMatch(/Cite any figure taken from this result as \[\$\{cite\.id\}\]/);
    });

    it('ships both checks with every answer', () => {
        expect(handler).toMatch(/fabricatedCites: findUnmappedCites\(text, citations\)/);
        expect(handler).toMatch(/uncitedFigures: uncitedFigures\(text\)/);
    });
});
