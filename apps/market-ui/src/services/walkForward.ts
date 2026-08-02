// Walk-forward harness — DI-3, docs/DEXTER_INSTITUTIONAL_ROADMAP.md row 5.
//
// G11: the only evaluation this repo had was an ad-hoc replay at whatever n the
// last run used, over one window, with no split. That cannot answer the question
// a PM actually asks — does this hold up out of sample — and it cannot be
// reproduced by anyone else.
//
// The rules enforced here are the ones that are easy to violate by accident:
//   1. train and test never intersect, per fold;
//   2. test windows never overlap each other, or the same day is counted twice
//      and n is inflated;
//   3. train always precedes test in time, never straddles or follows it;
//   4. an optional embargo gap sits between train and test, because a position
//      opened on the last training day can still be resolving on the first test
//      day — adjacency alone is not separation.
// Every one of them throws rather than warns.

export interface Fold {
    index: number;
    trainStart: number;
    trainEnd: number;
    testStart: number;
    testEnd: number;
}

export interface WalkForwardSpec {
    /** Inclusive ISO date the whole evaluation starts at. */
    start: string;
    /** Exclusive ISO date it ends at. */
    end: string;
    trainDays: number;
    testDays: number;
    /** Days left dead between train and test so an open position cannot bridge them. */
    embargoDays?: number;
    /** Stated up front — a result without one is not reproducible (doctrine 9). */
    universe: string[];
}

export const DAY_MS = 86_400_000;

export class FoldError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FoldError';
    }
}

const iso = (d: string): number => {
    const t = Date.parse(`${d}T00:00:00Z`);
    if (!Number.isFinite(t)) throw new FoldError(`${d} is not a date`);
    return t;
};

export const fmt = (ms: number): string => new Date(ms).toISOString().split('T')[0];

/**
 * Rolling walk-forward: each fold trains on `trainDays`, sits out `embargoDays`,
 * then tests on the `testDays` that follow. Test windows tile the timeline with
 * no gaps and no overlaps; the train window rolls forward with them.
 */
export function makeFolds(spec: WalkForwardSpec): Fold[] {
    const { trainDays, testDays, embargoDays = 0 } = spec;
    if (trainDays <= 0 || testDays <= 0) throw new FoldError('trainDays and testDays must both be positive');
    if (embargoDays < 0) throw new FoldError('embargoDays cannot be negative');
    if (spec.universe.length === 0) throw new FoldError('a walk-forward run must state its universe');

    const start = iso(spec.start);
    const end = iso(spec.end);
    if (end <= start) throw new FoldError(`end ${spec.end} is not after start ${spec.start}`);

    const span = (trainDays + embargoDays + testDays) * DAY_MS;
    if (end - start < span) {
        throw new FoldError(
            `${spec.start} → ${spec.end} is too short for even one fold of ` +
            `${trainDays}+${embargoDays}+${testDays} days`,
        );
    }

    const folds: Fold[] = [];
    let trainStart = start;
    while (trainStart + span <= end) {
        const trainEnd = trainStart + trainDays * DAY_MS;
        const testStart = trainEnd + embargoDays * DAY_MS;
        folds.push({
            index: folds.length,
            trainStart,
            trainEnd,
            testStart,
            testEnd: testStart + testDays * DAY_MS,
        });
        trainStart += testDays * DAY_MS;
    }

    assertFoldsValid(folds);
    return folds;
}

export function assertFoldsValid(folds: Fold[]): Fold[] {
    if (folds.length === 0) throw new FoldError('a walk-forward run needs at least one fold');

    for (const f of folds) {
        if (f.trainEnd <= f.trainStart) throw new FoldError(`fold ${f.index} has an empty train window`);
        if (f.testEnd <= f.testStart) throw new FoldError(`fold ${f.index} has an empty test window`);
        if (f.testStart < f.trainEnd) {
            throw new FoldError(
                `fold ${f.index} tests ${fmt(f.testStart)} which is inside its own training window ` +
                `(${fmt(f.trainStart)} → ${fmt(f.trainEnd)}); a fold may never train on what it tests`,
            );
        }
    }

    const byStart = [...folds].sort((a, b) => a.testStart - b.testStart);
    for (let i = 1; i < byStart.length; i++) {
        const prev = byStart[i - 1];
        const cur = byStart[i];
        if (cur.testStart < prev.testEnd) {
            throw new FoldError(
                `folds ${prev.index} and ${cur.index} have overlapping test windows ` +
                `(${fmt(prev.testStart)} → ${fmt(prev.testEnd)} and ${fmt(cur.testStart)} → ${fmt(cur.testEnd)}); ` +
                'an overlapping fold counts the same day twice and inflates n',
            );
        }
    }
    return folds;
}

export function inTest(f: Fold, ts: number): boolean {
    return ts >= f.testStart && ts < f.testEnd;
}

export function inTrain(f: Fold, ts: number): boolean {
    return ts >= f.trainStart && ts < f.trainEnd;
}

/** Which fold's TEST window a decision date falls in, or null if it falls in none. */
export function foldForTest(folds: Fold[], ts: number): Fold | null {
    return folds.find(f => inTest(f, ts)) ?? null;
}

export function describeFold(f: Fold): string {
    return `fold ${f.index}: train ${fmt(f.trainStart)} → ${fmt(f.trainEnd)}, ` +
        `test ${fmt(f.testStart)} → ${fmt(f.testEnd)}`;
}

export function describeSpec(spec: WalkForwardSpec, folds: Fold[]): string {
    return `walk-forward ${spec.start} → ${spec.end}: ${folds.length} folds of ` +
        `${spec.trainDays}d train / ${spec.embargoDays ?? 0}d embargo / ${spec.testDays}d test, ` +
        `universe [${spec.universe.join(', ')}]`;
}
