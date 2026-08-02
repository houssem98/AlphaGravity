// Dexter Calibration — DI-10, docs/DEXTER_INSTITUTIONAL_ROADMAP.md row 14.
//
// G8: "72% confidence" that has never been checked against what happened is
// decoration. The journal already holds everything needed to check it — a stated
// confidence per call and a graded outcome — so this scores it.
//
// Brier is the standard: mean squared error between the stated probability and
// the realised 0/1. Lower is better, 0 is perfect, 0.25 is what you get by
// saying 50% every time. Raw Brier alone flatters a forecaster on a lopsided
// sample, so the **skill score against the base rate** is reported next to it:
// positive means the confidences beat simply predicting the historical hit rate,
// zero or negative means they added nothing.
//
// Below the sample floor there is no score at all — an honest "not yet
// calibrated (n=7 of 20)" rather than a number computed from seven trades.

export interface ScoredCall {
    /** As stated at the time, 0-100. A call with none cannot be scored. */
    confidence: number | null;
    /** Realised: true = the call was right. Null = still open, excluded. */
    won: boolean | null;
}

/** Below this many resolved, confidence-bearing calls there is no calibration. */
export const MIN_CALIBRATION_N = 20;
/** Reliability buckets, by stated confidence. */
export const BUCKETS: ReadonlyArray<[number, number]> = [[0, 40], [40, 60], [60, 80], [80, 101]];

export interface ReliabilityBucket {
    range: string;
    n: number;
    /** Mean stated confidence in the bucket, 0..1. */
    stated: number | null;
    /** Realised hit rate in the bucket, 0..1. */
    realised: number | null;
    /** realised − stated. Negative means overconfident. */
    gap: number | null;
}

export interface Calibration {
    n: number;
    /** Resolved calls that carried no confidence and could not be scored. */
    unscored: number;
    brier: number | null;
    /** Brier of always predicting the base rate. The bar to beat. */
    baseRateBrier: number | null;
    /** 1 − brier/baseRateBrier. > 0 means the stated confidences carried information. */
    skillScore: number | null;
    baseRate: number | null;
    /** Mean stated confidence minus realised hit rate. Positive means overconfident overall. */
    overconfidence: number | null;
    buckets: ReliabilityBucket[];
    calibrated: boolean;
    summary: string;
}

const round = (n: number, dp = 4): number => Number(n.toFixed(dp));
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

export function brier(pairs: Array<{ p: number; outcome: 0 | 1 }>): number | null {
    if (pairs.length === 0) return null;
    return round(mean(pairs.map(x => (x.p - x.outcome) ** 2)));
}

export function calibrationOf(calls: ScoredCall[]): Calibration {
    const resolved = calls.filter(c => c.won !== null);
    const scorable = resolved.filter(c => c.confidence !== null && c.confidence >= 0 && c.confidence <= 100);
    const unscored = resolved.length - scorable.length;

    const empty = (summary: string): Calibration => ({
        n: scorable.length,
        unscored,
        brier: null,
        baseRateBrier: null,
        skillScore: null,
        baseRate: null,
        overconfidence: null,
        buckets: [],
        calibrated: false,
        summary,
    });

    if (scorable.length < MIN_CALIBRATION_N) {
        return empty(
            `not yet calibrated (n=${scorable.length} of ${MIN_CALIBRATION_N} resolved calls with a stated confidence)` +
            (unscored > 0 ? `; ${unscored} resolved call(s) carried no confidence and could not be scored` : ''),
        );
    }

    const pairs = scorable.map(c => ({ p: c.confidence! / 100, outcome: (c.won ? 1 : 0) as 0 | 1 }));
    const score = brier(pairs)!;
    const baseRate = round(mean(pairs.map(x => x.outcome)));
    const baseRateBrier = brier(pairs.map(x => ({ p: baseRate, outcome: x.outcome })))!;
    const skillScore = baseRateBrier === 0 ? null : round(1 - score / baseRateBrier);
    const overconfidence = round(mean(pairs.map(x => x.p)) - baseRate);

    const buckets: ReliabilityBucket[] = BUCKETS.map(([lo, hi]) => {
        const inBucket = pairs.filter(x => x.p * 100 >= lo && x.p * 100 < hi);
        const stated = inBucket.length ? round(mean(inBucket.map(x => x.p))) : null;
        const realised = inBucket.length ? round(mean(inBucket.map(x => x.outcome))) : null;
        return {
            range: `${lo}-${hi === 101 ? 100 : hi}%`,
            n: inBucket.length,
            stated,
            realised,
            gap: stated === null || realised === null ? null : round(realised - stated),
        };
    });

    return {
        n: scorable.length,
        unscored,
        brier: score,
        baseRateBrier,
        skillScore,
        baseRate,
        overconfidence,
        buckets,
        calibrated: true,
        summary:
            `Brier ${score} over n=${scorable.length} (base rate ${baseRate}, base-rate Brier ${baseRateBrier}, ` +
            `skill ${skillScore}); ${overconfidence > 0 ? 'over' : 'under'}confident by ` +
            `${Math.abs(overconfidence)} on average`,
    };
}

/** The line the note and the UI show. Never a number when there is no score. */
export function renderCalibration(c: Calibration): string {
    if (!c.calibrated) return `Calibration: ${c.summary}`;
    const worst = [...c.buckets]
        .filter(b => b.gap !== null && b.n > 0)
        .sort((a, b) => Math.abs(b.gap!) - Math.abs(a.gap!))[0];
    return `Calibration: ${c.summary}` +
        (worst ? ` · widest bucket ${worst.range} (n=${worst.n}, stated ${worst.stated}, realised ${worst.realised})` : '');
}
