// DX-4 regression tests — docs/AI_TRADING_AGENT_ROADMAP.md Section 6 row 7.
// Golden fixture: a handcrafted bar series whose pivots, gaps and ratios can be
// checked by hand. Real market bars would move under the test; these do not.
import { describe, it, expect } from 'vitest';
import {
    taLevels, atr, swingPivots, clusterLevels, fairValueGaps, orderBlocks,
    fibFromSwings, trendFromPivots, FIB_RATIOS, type Bar,
} from './taLevels';

const bar = (date: string, open: number, high: number, low: number, close: number): Bar =>
    ({ date, open, high, low, close, volume: 1000 });

// Every bar's range deliberately overlaps the bar two back, so the ONLY
// three-bar imbalance in the series is the one planted at 2026-01-21. Four
// swings by construction: high 112, low 90, high 120, low 88. 2026-01-20 is the
// down candle that anchors the order block.
const FIXTURE: Bar[] = [
    //   date          open  high  low  close
    bar('2026-01-01', 100, 104, 98, 103),
    bar('2026-01-02', 103, 106, 99, 105),
    bar('2026-01-05', 105, 112, 100, 110),   // swing high 112
    bar('2026-01-06', 107, 108, 97, 99),
    bar('2026-01-07', 99, 107, 96, 105),
    bar('2026-01-08', 103, 104, 90, 92),     // swing low 90
    bar('2026-01-09', 96, 110, 95, 108),
    bar('2026-01-12', 108, 115, 99, 113),
    bar('2026-01-13', 113, 120, 103, 118),   // swing high 120
    bar('2026-01-14', 115, 116, 101, 104),
    bar('2026-01-15', 104, 112, 98, 100),
    bar('2026-01-16', 100, 105, 88, 90),     // swing low 88
    bar('2026-01-19', 93, 108, 92, 106),
    bar('2026-01-20', 112, 114, 96, 98),     // down candle → order block
    bar('2026-01-21', 114, 125, 113, 123),   // gaps above 2026-01-19's high
    bar('2026-01-22', 118, 122, 110, 115),
];

describe('row 7 — deterministic output', () => {
    it('returns byte-identical results for identical input', () => {
        expect(JSON.stringify(taLevels(FIXTURE))).toBe(JSON.stringify(taLevels(FIXTURE)));
    });

    it('never consults a clock or a model', () => {
        const before = taLevels(FIXTURE);
        const after = taLevels([...FIXTURE]);
        expect(after).toEqual(before);
    });

    it('degrades honestly on an empty series instead of guessing', () => {
        const out = taLevels([]);
        expect(out).toEqual({
            bars: 0, lastClose: null, atr: null, trend: 'range',
            pivots: [], support: [], resistance: [], orderBlocks: [], fairValueGaps: [], fib: null,
        });
    });

    it('drops malformed bars rather than propagating NaN', () => {
        const dirty = [...FIXTURE, { date: 'x', open: NaN, high: NaN, low: NaN, close: NaN } as Bar];
        expect(taLevels(dirty).bars).toBe(FIXTURE.length);
        expect(taLevels(dirty).lastClose).toBe(115);
    });
});

describe('row 7 — swing pivots', () => {
    it('finds the hand-checked swings and nothing else', () => {
        const highs = swingPivots(FIXTURE).filter(p => p.kind === 'high');
        const lows = swingPivots(FIXTURE).filter(p => p.kind === 'low');
        expect(highs.map(p => [p.date, p.price])).toEqual([
            ['2026-01-05', 112],
            ['2026-01-13', 120],
        ]);
        expect(lows.map(p => [p.date, p.price])).toEqual([
            ['2026-01-08', 90],
            ['2026-01-16', 88],
        ]);
    });

    it('refuses to call a flat shelf a pivot', () => {
        const flat = Array.from({ length: 9 }, (_, i) => bar(`d${i}`, 10, 11, 9, 10));
        expect(swingPivots(flat)).toEqual([]);
    });

    it('honours the lookback window', () => {
        expect(swingPivots(FIXTURE, 1).length).toBeGreaterThan(swingPivots(FIXTURE, 3).length);
    });
});

describe('row 7 — ATR', () => {
    it('returns null rather than averaging too few bars', () => {
        expect(atr(FIXTURE.slice(0, 5), 14)).toBeNull();
        expect(atr(FIXTURE, 14)).not.toBeNull();
    });

    it('matches a hand-computed Wilder average on a 3-bar period', () => {
        // True ranges for bars 1..4 of the fixture: 7, 12, 13, 11.
        // Seed = mean of the first 3, then one Wilder smoothing step over 11.
        const seeded = (7 + 12 + 13) / 3;
        const expected = (seeded * 2 + 11) / 3;
        expect(atr(FIXTURE.slice(0, 5), 3)).toBe(Number(expected.toFixed(8)));
        expect(atr(FIXTURE.slice(0, 5), 3)).toBe(10.77777778);
    });
});

describe('row 7 — support and resistance clusters', () => {
    it('splits pivots either side of the last close', () => {
        // Tolerance 1 is tight enough to keep 88 and 90 apart.
        const { support, resistance } = clusterLevels(swingPivots(FIXTURE), 115, 1);
        expect(support.map(l => l.price)).toEqual([112, 90, 88]);
        expect(resistance.map(l => l.price)).toEqual([120]);
    });

    it('merges the two swing lows once the tolerance is the real ATR fraction', () => {
        // ATR 15.52 → tolerance 7.76, and |90 − 88| = 2, so they are one level.
        const { support } = clusterLevels(swingPivots(FIXTURE), 115, 7.76020408);
        expect(support[0]).toMatchObject({ price: 89, touches: 2 });
    });

    it('merges pivots inside the tolerance and counts the touches', () => {
        const pivots = [
            { index: 2, date: 'a', price: 100, kind: 'high' as const },
            { index: 6, date: 'b', price: 101, kind: 'high' as const },
            { index: 9, date: 'c', price: 130, kind: 'high' as const },
        ];
        const { resistance } = clusterLevels(pivots, 90, 2);
        expect(resistance[0]).toEqual({ price: 100.5, touches: 2, kind: 'resistance', dates: ['a', 'b'] });
        expect(resistance[1].touches).toBe(1);
    });

    it('caps how many levels it will hand out', () => {
        const many = Array.from({ length: 40 }, (_, i) => ({
            index: i, date: `d${i}`, price: 100 + i * 10, kind: 'high' as const,
        }));
        expect(clusterLevels(many, 0, 1, 4).resistance).toHaveLength(4);
    });
});

describe('row 7 — imbalances', () => {
    it('finds the one planted gap and no others', () => {
        // Every other bar overlaps the bar two back, so a second gap here would
        // mean the detector is firing on overlapping ranges.
        expect(fairValueGaps(FIXTURE)).toEqual([
            { bottom: 108, top: 113, date: '2026-01-21', kind: 'bullish' },
        ]);
    });

    it('finds a bearish gap when price drops away', () => {
        const dropping = [
            bar('d1', 100, 110, 105, 106),
            bar('d2', 106, 107, 100, 101),
            bar('d3', 101, 102, 95, 96),
        ];
        expect(fairValueGaps(dropping)).toEqual([
            { bottom: 102, top: 105, date: 'd3', kind: 'bearish' },
        ]);
    });

    it('anchors each order block to the last opposite candle before its gap', () => {
        const gaps = fairValueGaps(FIXTURE);
        const blocks = orderBlocks(FIXTURE, gaps);
        for (const b of blocks) {
            const candle = FIXTURE.find(x => x.date === b.date)!;
            expect(b.top).toBe(candle.high);
            expect(b.bottom).toBe(candle.low);
            expect(b.kind === 'bullish' ? candle.close < candle.open : candle.close >= candle.open).toBe(true);
        }
    });

    it('emits no gap when ranges overlap', () => {
        expect(fairValueGaps(FIXTURE.slice(0, 3))).toEqual([]);
    });
});

describe('row 7 — fib and trend', () => {
    it('anchors the retracement to the real swing high and low', () => {
        const fib = fibFromSwings(swingPivots(FIXTURE))!;
        expect([fib.high, fib.low, fib.direction]).toEqual([120, 88, 'down']);
        expect(fib.levels.map(l => l.ratio)).toEqual([...FIB_RATIOS]);
        expect(fib.levels.find(l => l.ratio === 0)!.price).toBe(88);
        expect(fib.levels.find(l => l.ratio === 0.5)!.price).toBe(104);   // 88 + 32/2
        expect(fib.levels.find(l => l.ratio === 1)!.price).toBe(120);
    });

    it('returns null rather than inventing a leg', () => {
        expect(fibFromSwings([])).toBeNull();
        expect(fibFromSwings([{ index: 1, date: 'a', price: 10, kind: 'high' }])).toBeNull();
    });

    it('calls a mixed structure a range instead of picking a side', () => {
        expect(trendFromPivots(swingPivots(FIXTURE))).toBe('range');
        expect(trendFromPivots([
            { index: 0, date: 'a', price: 10, kind: 'low' },
            { index: 1, date: 'b', price: 20, kind: 'high' },
            { index: 2, date: 'c', price: 12, kind: 'low' },
            { index: 3, date: 'd', price: 25, kind: 'high' },
        ])).toBe('up');
        expect(trendFromPivots([
            { index: 0, date: 'a', price: 20, kind: 'high' },
            { index: 1, date: 'b', price: 12, kind: 'low' },
            { index: 2, date: 'c', price: 18, kind: 'high' },
            { index: 3, date: 'd', price: 10, kind: 'low' },
        ])).toBe('down');
    });
});

describe('row 7 — the whole engine on the fixture', () => {
    it('produces the golden snapshot', () => {
        const out = taLevels(FIXTURE);
        expect({
            bars: out.bars,
            lastClose: out.lastClose,
            atr: out.atr,
            trend: out.trend,
            pivots: out.pivots.map(p => `${p.kind}@${p.price}`),
            support: out.support.map(l => `${l.price}x${l.touches}`),
            resistance: out.resistance.map(l => `${l.price}x${l.touches}`),
            gaps: out.fairValueGaps.map(g => `${g.kind} ${g.bottom}-${g.top}`),
            blocks: out.orderBlocks.map(b => `${b.kind} ${b.bottom}-${b.top}`),
            fib: out.fib && `${out.fib.low}→${out.fib.high} ${out.fib.direction}`,
        }).toMatchInlineSnapshot(`
          {
            "atr": 15.52040816,
            "bars": 16,
            "blocks": [
              "bullish 96-114",
            ],
            "fib": "88→120 down",
            "gaps": [
              "bullish 108-113",
            ],
            "lastClose": 115,
            "pivots": [
              "high@112",
              "low@90",
              "high@120",
              "low@88",
            ],
            "resistance": [
              "120x1",
            ],
            "support": [
              "89x2",
              "112x1",
            ],
            "trend": "range",
          }
        `);
    });

    it('scales its tolerance to the instrument, not to a hardcoded currency', () => {
        const tnd = FIXTURE.map(b => ({ ...b, open: b.open / 10, high: b.high / 10, low: b.low / 10, close: b.close / 10 }));
        const usd = taLevels(FIXTURE);
        const dinar = taLevels(tnd);
        expect(dinar.pivots.length).toBe(usd.pivots.length);
        expect(dinar.support.length).toBe(usd.support.length);
    });
});
