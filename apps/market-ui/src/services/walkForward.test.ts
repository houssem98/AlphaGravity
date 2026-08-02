// DI-3 regression tests — docs/DEXTER_INSTITUTIONAL_ROADMAP.md Section 6 row 5.
import { describe, it, expect } from 'vitest';
import {
    makeFolds, assertFoldsValid, foldForTest, inTest, inTrain, describeFold, describeSpec,
    FoldError, DAY_MS, fmt, type Fold, type WalkForwardSpec,
} from './walkForward';

const SPEC: WalkForwardSpec = {
    start: '2025-01-01',
    end: '2025-12-31',
    trainDays: 90,
    testDays: 30,
    universe: ['BTC'],
};

const at = (d: string): number => Date.parse(`${d}T00:00:00Z`);

describe('row 5 — the split is strictly in time', () => {
    it('puts every test window after its own training window', () => {
        for (const f of makeFolds(SPEC)) {
            expect(f.trainStart).toBeLessThan(f.trainEnd);
            expect(f.testStart).toBeGreaterThanOrEqual(f.trainEnd);
            expect(f.testStart).toBeLessThan(f.testEnd);
        }
    });

    it('rolls the train window forward by exactly one test window per fold', () => {
        const folds = makeFolds(SPEC);
        expect(folds.length).toBeGreaterThan(1);
        for (let i = 1; i < folds.length; i++) {
            expect(folds[i].trainStart - folds[i - 1].trainStart).toBe(SPEC.testDays * DAY_MS);
            expect(folds[i].testStart - folds[i - 1].testStart).toBe(SPEC.testDays * DAY_MS);
        }
    });

    it('never runs a fold past the end of the stated window', () => {
        for (const f of makeFolds(SPEC)) expect(f.testEnd).toBeLessThanOrEqual(at(SPEC.end));
    });

    it('honours an embargo between train and test', () => {
        const folds = makeFolds({ ...SPEC, embargoDays: 5 });
        for (const f of folds) expect(f.testStart - f.trainEnd).toBe(5 * DAY_MS);
    });

    it('leaves no embargo gap when none was asked for', () => {
        for (const f of makeFolds(SPEC)) expect(f.testStart).toBe(f.trainEnd);
    });
});

describe('row 5 — it never trains on a window it tests', () => {
    it('keeps train and test disjoint in every generated fold', () => {
        for (const f of makeFolds({ ...SPEC, embargoDays: 3 })) {
            for (const ts of [f.testStart, f.testStart + DAY_MS, f.testEnd - DAY_MS]) {
                expect(inTrain(f, ts)).toBe(false);
                expect(inTest(f, ts)).toBe(true);
            }
            expect(inTest(f, f.trainStart)).toBe(false);
            expect(inTrain(f, f.trainStart)).toBe(true);
        }
    });

    it('throws on a hand-built fold that tests inside its own training window', () => {
        const bad: Fold = {
            index: 0,
            trainStart: at('2025-01-01'),
            trainEnd: at('2025-04-01'),
            testStart: at('2025-03-01'),   // inside the train window
            testEnd: at('2025-05-01'),
        };
        expect(() => assertFoldsValid([bad])).toThrow(FoldError);
        expect(() => assertFoldsValid([bad])).toThrow(/may never train on what it tests/);
    });
});

describe('row 5 — it refuses overlapping folds', () => {
    const fold = (i: number, testStart: string, testEnd: string): Fold => ({
        index: i,
        trainStart: at('2024-01-01'),
        trainEnd: at(testStart),
        testStart: at(testStart),
        testEnd: at(testEnd),
    });

    it('accepts test windows that tile without overlap', () => {
        expect(assertFoldsValid([fold(0, '2025-01-01', '2025-02-01'), fold(1, '2025-02-01', '2025-03-01')])).toHaveLength(2);
    });

    it('throws when two test windows share a day', () => {
        const folds = [fold(0, '2025-01-01', '2025-02-15'), fold(1, '2025-02-01', '2025-03-01')];
        expect(() => assertFoldsValid(folds)).toThrow(/overlapping test windows/);
        expect(() => assertFoldsValid(folds)).toThrow(/inflates n/);
    });

    it('catches the overlap whatever order the folds arrive in', () => {
        const folds = [fold(1, '2025-02-01', '2025-03-01'), fold(0, '2025-01-01', '2025-02-15')];
        expect(() => assertFoldsValid(folds)).toThrow(/overlapping test windows/);
    });

    it('generated folds never overlap', () => {
        const folds = makeFolds({ ...SPEC, testDays: 45, embargoDays: 7 });
        expect(() => assertFoldsValid(folds)).not.toThrow();
    });
});

describe('row 5 — the harness refuses a run it cannot make honest', () => {
    it('demands a stated universe', () => {
        expect(() => makeFolds({ ...SPEC, universe: [] })).toThrow(/must state its universe/);
    });

    it('refuses a window too short for a single fold', () => {
        expect(() => makeFolds({ ...SPEC, start: '2025-01-01', end: '2025-03-01' })).toThrow(/too short for even one fold/);
    });

    it('refuses non-positive or backwards inputs', () => {
        expect(() => makeFolds({ ...SPEC, trainDays: 0 })).toThrow(/must both be positive/);
        expect(() => makeFolds({ ...SPEC, testDays: -1 })).toThrow(/must both be positive/);
        expect(() => makeFolds({ ...SPEC, embargoDays: -1 })).toThrow(/cannot be negative/);
        expect(() => makeFolds({ ...SPEC, end: '2024-01-01' })).toThrow(/is not after start/);
        expect(() => makeFolds({ ...SPEC, start: 'not-a-date' })).toThrow(/is not a date/);
    });

    it('refuses to validate an empty fold list rather than passing vacuously', () => {
        expect(() => assertFoldsValid([])).toThrow(/at least one fold/);
    });
});

describe('row 5 — assigning a decision to its fold', () => {
    const folds = makeFolds(SPEC);

    it('finds the one fold whose test window holds a date', () => {
        const f = foldForTest(folds, folds[1].testStart + DAY_MS);
        expect(f?.index).toBe(1);
    });

    it('returns null for a date no fold tests rather than the nearest one', () => {
        expect(foldForTest(folds, at('2024-06-01'))).toBeNull();
        expect(foldForTest(folds, at('2030-01-01'))).toBeNull();
    });

    it('treats the test window as half-open so no date lands in two folds', () => {
        const boundary = folds[0].testEnd;
        expect(inTest(folds[0], boundary)).toBe(false);
        expect(foldForTest(folds, boundary)?.index).toBe(1);
    });
});

describe('row 5 — the run states what it did', () => {
    it('describes a fold by its real dates', () => {
        const f = makeFolds(SPEC)[0];
        expect(describeFold(f)).toBe(`fold 0: train 2025-01-01 → ${fmt(f.trainEnd)}, test ${fmt(f.testStart)} → ${fmt(f.testEnd)}`);
    });

    it('states window, fold shape and universe in one line', () => {
        const folds = makeFolds({ ...SPEC, embargoDays: 5 });
        const line = describeSpec({ ...SPEC, embargoDays: 5 }, folds);
        expect(line).toContain('2025-01-01 → 2025-12-31');
        expect(line).toContain('90d train / 5d embargo / 30d test');
        expect(line).toContain('universe [BTC]');
    });
});
