// Dexter Cross-Section — DI-8, docs/DEXTER_INSTITUTIONAL_ROADMAP.md row 12.
//
// The other half of G6: a name was analysed entirely on its own bars. "BTC is up
// 8% this month" is not research until you know the universe was up 14% — the
// same number is a leader in one tape and a laggard in another, and professional
// work always positions a name against comparables.
//
// The rule that matters here is the honest null. A symbol outside the stated
// universe has NO rank — not a median rank, not a 50th percentile, not a
// neutral score. Returning a default would manufacture a comparison that was
// never made, which is exactly the kind of invented number this ledger exists to
// keep out.

export interface UniverseMember {
    symbol: string;
    /** Ascending closes. Needs at least `lookback + 1` to produce a return. */
    closes: number[];
}

export const DEFAULT_LOOKBACK = 20;
/** Below this many comparables a rank is noise dressed as a number. */
export const MIN_UNIVERSE = 3;

export interface CrossSectionRead {
    symbol: string;
    /** Simple return over the lookback, as a percent. */
    rs: number;
    /** 1 = strongest in the universe. */
    rank: number;
    of: number;
    /** 0..100, where 100 is the strongest. */
    percentile: number;
    /** Universe median return over the same lookback, as a percent. */
    universeMedian: number;
    /** rs minus the universe median — the part that is not just the tape. */
    excess: number;
    universe: string[];
    reasons: string[];
}

export interface CrossSectionGap {
    symbol: string;
    rank: null;
    gap: string;
    universe: string[];
}

export type CrossSectionResult = CrossSectionRead | CrossSectionGap;

export const isRanked = (r: CrossSectionResult): r is CrossSectionRead => r.rank !== null;

const round = (n: number, dp = 4): number => Number(n.toFixed(dp));

/** Percent return over the lookback. Null when there is not enough history. */
export function relativeStrength(closes: number[], lookback = DEFAULT_LOOKBACK): number | null {
    if (closes.length < lookback + 1) return null;
    const first = closes[closes.length - 1 - lookback];
    const last = closes[closes.length - 1];
    if (!(first > 0)) return null;
    return round(((last - first) / first) * 100);
}

function median(xs: number[]): number {
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function rankIn(
    symbol: string,
    universe: UniverseMember[],
    lookback = DEFAULT_LOOKBACK,
): CrossSectionResult {
    const names = universe.map(m => m.symbol);

    if (!universe.some(m => m.symbol === symbol)) {
        return {
            symbol,
            rank: null,
            gap: `${symbol} is not in the stated universe [${names.join(', ')}] — no cross-sectional rank exists for it, ` +
                'and a default rank would be a comparison that was never made',
            universe: names,
        };
    }

    const scored = universe
        .map(m => ({ symbol: m.symbol, rs: relativeStrength(m.closes, lookback) }))
        .filter((m): m is { symbol: string; rs: number } => m.rs !== null);

    const own = scored.find(m => m.symbol === symbol);
    if (!own) {
        return {
            symbol,
            rank: null,
            gap: `${symbol} has fewer than ${lookback + 1} closes — not enough history to measure ${lookback}-bar strength`,
            universe: names,
        };
    }
    if (scored.length < MIN_UNIVERSE) {
        return {
            symbol,
            rank: null,
            gap: `only ${scored.length} of ${universe.length} universe members have ${lookback + 1} closes; ` +
                `a rank needs at least ${MIN_UNIVERSE}`,
            universe: names,
        };
    }

    const sorted = [...scored].sort((a, b) => b.rs - a.rs);
    const rank = sorted.findIndex(m => m.symbol === symbol) + 1;
    const of = sorted.length;
    const universeMedian = round(median(scored.map(m => m.rs)));

    return {
        symbol,
        rs: own.rs,
        rank,
        of,
        percentile: round(((of - rank) / (of - 1)) * 100, 2),
        universeMedian,
        excess: round(own.rs - universeMedian),
        universe: names,
        reasons: [
            `${symbol} returned ${own.rs}% over ${lookback} bars, ranking ${rank} of ${of} in [${names.join(', ')}]`,
            `universe median ${universeMedian}% over the same window — excess ${round(own.rs - universeMedian)}%`,
        ],
    };
}

export function describeCrossSection(r: CrossSectionResult): string {
    return isRanked(r)
        ? `${r.symbol} ranks ${r.rank}/${r.of} (${r.percentile}th percentile), ${r.rs}% vs universe median ${r.universeMedian}%`
        : `${r.symbol}: no rank — ${r.gap}`;
}
