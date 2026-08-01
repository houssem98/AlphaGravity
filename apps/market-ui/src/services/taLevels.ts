// Deterministic technical-analysis engine.
// docs/AI_TRADING_AGENT_ROADMAP.md DX-4, regression row 7.
//
// Doctrine rule 2: the LLM never emits a price. Every level Dexter can draw or
// quote is computed here, from real bars, by pure functions with no clock, no
// randomness, and no model in the loop. The same bars in always give the same
// levels out — which is what makes DX-5 able to reject a level the model made
// up: if it is not in this output, it did not come from the market.
//
// Nothing here is novel. Fractal pivots, Wilder ATR, three-bar imbalances and
// retracement ratios are the standard definitions, implemented plainly so the
// numbers can be checked by hand against a fixture.

export interface Bar {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
}

export interface Pivot {
    index: number;
    date: string;
    price: number;
    kind: 'high' | 'low';
}

export interface Level {
    price: number;          // cluster centre
    touches: number;        // pivots that formed it
    kind: 'support' | 'resistance';
    dates: string[];
}

export interface Zone {
    top: number;
    bottom: number;
    date: string;
    kind: 'bullish' | 'bearish';
}

export interface Fib {
    high: number;
    low: number;
    direction: 'up' | 'down';   // up = retracing a rally, anchor low → high
    levels: Array<{ ratio: number; price: number }>;
}

export interface TaLevels {
    bars: number;
    lastClose: number | null;
    atr: number | null;
    trend: 'up' | 'down' | 'range';
    pivots: Pivot[];
    support: Level[];
    resistance: Level[];
    orderBlocks: Zone[];
    fairValueGaps: Zone[];
    fib: Fib | null;
}

export interface TaOptions {
    pivotLookback?: number;     // bars either side that a swing must exceed
    atrPeriod?: number;
    clusterAtrFraction?: number; // how close two pivots must be to merge
    maxLevels?: number;
}

export const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

const DEFAULTS: Required<TaOptions> = {
    pivotLookback: 2,
    atrPeriod: 14,
    clusterAtrFraction: 0.5,
    maxLevels: 6,
};

// Float noise makes golden fixtures unstable and makes two identical levels
// compare unequal. Everything that leaves this module is rounded the same way.
function round(n: number): number {
    return Number(n.toFixed(8));
}

// Wilder's ATR. Returns null when there are not enough bars to average a full
// period — an honest null beats a number computed from three candles.
export function atr(bars: Bar[], period = DEFAULTS.atrPeriod): number | null {
    if (bars.length < period + 1) return null;
    const trs: number[] = [];
    for (let i = 1; i < bars.length; i++) {
        const prevClose = bars[i - 1].close;
        trs.push(Math.max(
            bars[i].high - bars[i].low,
            Math.abs(bars[i].high - prevClose),
            Math.abs(bars[i].low - prevClose),
        ));
    }
    // Seed with a simple mean of the first `period` TRs, then smooth.
    let value = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) {
        value = (value * (period - 1) + trs[i]) / period;
    }
    return round(value);
}

// Fractal swings: a high that exceeds every high within `lookback` bars either
// side. Strict on both sides, so a flat shelf produces no pivot rather than a
// pivot per bar.
export function swingPivots(bars: Bar[], lookback = DEFAULTS.pivotLookback): Pivot[] {
    const out: Pivot[] = [];
    for (let i = lookback; i < bars.length - lookback; i++) {
        let isHigh = true;
        let isLow = true;
        for (let j = i - lookback; j <= i + lookback; j++) {
            if (j === i) continue;
            if (bars[j].high >= bars[i].high) isHigh = false;
            if (bars[j].low <= bars[i].low) isLow = false;
        }
        if (isHigh) out.push({ index: i, date: bars[i].date, price: round(bars[i].high), kind: 'high' });
        if (isLow) out.push({ index: i, date: bars[i].date, price: round(bars[i].low), kind: 'low' });
    }
    return out;
}

// Pivots that keep getting hit at the same price are the levels traders watch.
// Merge them within a tolerance and count the touches; a level with one touch is
// a data point, a level with four is structure.
export function clusterLevels(
    pivots: Pivot[],
    lastClose: number,
    tolerance: number,
    maxLevels = DEFAULTS.maxLevels,
): { support: Level[]; resistance: Level[] } {
    const sorted = [...pivots].sort((a, b) => a.price - b.price || a.index - b.index);
    const clusters: Pivot[][] = [];
    for (const p of sorted) {
        const last = clusters[clusters.length - 1];
        if (last && Math.abs(p.price - last[0].price) <= tolerance) last.push(p);
        else clusters.push([p]);
    }

    const levels = clusters.map<Level>(members => {
        const price = round(members.reduce((s, m) => s + m.price, 0) / members.length);
        return {
            price,
            touches: members.length,
            kind: price <= lastClose ? 'support' : 'resistance',
            dates: members.map(m => m.date),
        };
    });

    // Most-touched first; ties go to the level nearest current price, because
    // that is the one that matters next.
    const rank = (a: Level, b: Level) =>
        b.touches - a.touches || Math.abs(a.price - lastClose) - Math.abs(b.price - lastClose);

    return {
        support: levels.filter(l => l.kind === 'support').sort(rank).slice(0, maxLevels),
        resistance: levels.filter(l => l.kind === 'resistance').sort(rank).slice(0, maxLevels),
    };
}

// Three-bar imbalance: price moved so fast that bar i's range never overlapped
// bar i-2's. The untraded gap between them is the zone.
export function fairValueGaps(bars: Bar[]): Zone[] {
    const out: Zone[] = [];
    for (let i = 2; i < bars.length; i++) {
        const a = bars[i - 2];
        const c = bars[i];
        if (c.low > a.high) out.push({ bottom: round(a.high), top: round(c.low), date: c.date, kind: 'bullish' });
        else if (c.high < a.low) out.push({ bottom: round(c.high), top: round(a.low), date: c.date, kind: 'bearish' });
    }
    return out;
}

// The last opposite-colour candle before an imbalance — where the move was
// loaded. Anchored to a real gap so it is derived, never eyeballed.
export function orderBlocks(bars: Bar[], gaps: Zone[]): Zone[] {
    const out: Zone[] = [];
    for (const gap of gaps) {
        const gapIndex = bars.findIndex(b => b.date === gap.date);
        if (gapIndex < 1) continue;
        const wantDown = gap.kind === 'bullish';
        for (let i = gapIndex - 1; i >= 0 && i >= gapIndex - 10; i--) {
            const b = bars[i];
            const isDown = b.close < b.open;
            if (isDown === wantDown) {
                out.push({ top: round(b.high), bottom: round(b.low), date: b.date, kind: gap.kind });
                break;
            }
        }
    }
    // One block per candle, newest last.
    const seen = new Set<string>();
    return out.filter(z => (seen.has(z.date) ? false : (seen.add(z.date), true)));
}

// Retracement anchored to the most recent completed swing, so the ratios
// describe a leg that actually happened.
export function fibFromSwings(pivots: Pivot[]): Fib | null {
    const lastHigh = [...pivots].reverse().find(p => p.kind === 'high');
    const lastLow = [...pivots].reverse().find(p => p.kind === 'low');
    if (!lastHigh || !lastLow || lastHigh.price <= lastLow.price) return null;

    const direction = lastHigh.index > lastLow.index ? 'up' : 'down';
    const span = lastHigh.price - lastLow.price;
    return {
        high: lastHigh.price,
        low: lastLow.price,
        direction,
        // ratio 0 sits at the end of the leg, ratio 1 at its origin.
        levels: FIB_RATIOS.map(ratio => ({
            ratio,
            price: round(direction === 'up' ? lastHigh.price - span * ratio : lastLow.price + span * ratio),
        })),
    };
}

// Structure, not a moving average: two rising swing highs AND two rising swing
// lows is an uptrend. Anything mixed is a range, and says so.
export function trendFromPivots(pivots: Pivot[]): 'up' | 'down' | 'range' {
    const highs = pivots.filter(p => p.kind === 'high').slice(-2);
    const lows = pivots.filter(p => p.kind === 'low').slice(-2);
    if (highs.length < 2 || lows.length < 2) return 'range';
    const higherHighs = highs[1].price > highs[0].price;
    const higherLows = lows[1].price > lows[0].price;
    if (higherHighs && higherLows) return 'up';
    if (!higherHighs && !higherLows) return 'down';
    return 'range';
}

// DX-5: every price this engine legitimately produced, flattened. A level that
// is not in here did not come from the market, and the draw gate refuses it.
export function candidateLevels(ta: TaLevels): number[] {
    const prices = [
        ...ta.pivots.map(p => p.price),
        ...ta.support.map(l => l.price),
        ...ta.resistance.map(l => l.price),
        ...ta.orderBlocks.flatMap(z => [z.top, z.bottom]),
        ...ta.fairValueGaps.flatMap(z => [z.top, z.bottom]),
        ...(ta.fib?.levels.map(l => l.price) ?? []),
    ];
    return [...new Set(prices)].sort((a, b) => a - b);
}

// How far a proposed level may sit from a real one and still count as the same
// level. Half an ATR is the usual "same zone" heuristic; without an ATR (short
// history) fall back to a fraction of price so the rule survives a 10 TND
// listing as well as a 66,000 USD one.
export function levelTolerance(ta: TaLevels, fraction = DEFAULTS.clusterAtrFraction): number {
    if (ta.atr !== null) return ta.atr * fraction;
    return Math.abs(ta.lastClose ?? 0) * 0.005;
}

export function nearestCandidate(price: number, candidates: number[]): number | null {
    if (candidates.length === 0) return null;
    return candidates.reduce((best, c) =>
        Math.abs(c - price) < Math.abs(best - price) ? c : best);
}

export function taLevels(bars: Bar[], opts: TaOptions = {}): TaLevels {
    const o = { ...DEFAULTS, ...opts };
    const clean = bars.filter(b =>
        Number.isFinite(b.high) && Number.isFinite(b.low) && Number.isFinite(b.close) && Number.isFinite(b.open));

    if (clean.length === 0) {
        return {
            bars: 0, lastClose: null, atr: null, trend: 'range',
            pivots: [], support: [], resistance: [], orderBlocks: [], fairValueGaps: [], fib: null,
        };
    }

    const lastClose = round(clean[clean.length - 1].close);
    const a = atr(clean, o.atrPeriod);
    const pivots = swingPivots(clean, o.pivotLookback);
    // Without an ATR (short history) fall back to a fraction of price, so a
    // 10 TND listing and a 66,000 USD one cluster on comparable ground.
    const tolerance = a !== null ? a * o.clusterAtrFraction : Math.abs(lastClose) * 0.005;
    const { support, resistance } = clusterLevels(pivots, lastClose, tolerance, o.maxLevels);
    const gaps = fairValueGaps(clean);

    return {
        bars: clean.length,
        lastClose,
        atr: a,
        trend: trendFromPivots(pivots),
        pivots,
        support,
        resistance,
        orderBlocks: orderBlocks(clean, gaps),
        fairValueGaps: gaps,
        fib: fibFromSwings(pivots),
    };
}
