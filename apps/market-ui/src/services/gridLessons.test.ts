// GT-6 regression tests — deriveLessons chronic detection (3-run fixture),
// LRU cap 100, injectable store (no real localStorage).
// Run: npx vitest run src/services/gridLessons.test.ts

import { describe, it, expect } from 'vitest';
import {
    deriveLessons, recordLessons, chronicConflictPrompts, chronicUnverifiedPrompts,
    rewordPromptIfChronic, LESSONS_CAP, type GridLesson, type LessonStore,
} from './gridLessons';
import { cellKey, type GridState, type GridCell } from './gridResearch';

const mkState = (runId: string, cells: Record<string, GridCell>): GridState => ({
    def: {
        id: runId, name: 'fixture',
        tickers: ['NVDA', 'AAPL'],
        prompts: [
            { id: 'valuation', label: 'Financials', prompt: '{ticker} revenue' },
            { id: 'moat', label: 'Moat', prompt: '{ticker} moat' },
            { id: 'synthesis', label: 'Comparison', prompt: 'compare', synthesis: true },
        ],
    },
    cells,
});

const done = (ticker: string, promptId: string, patch: Partial<GridCell> = {}): GridCell => ({
    ticker, promptId, status: 'done',
    answer: 'Revenue was $416,161M [1].', ragUsed: true,
    citations: [{ id: 1, title: 'S1', url: 'gravity://source/1', source: 'gravity' }],
    ...patch,
});

// One hardened run: valuation conflicted on NVDA (2 rounds), moat clean.
const hardenedRun = (runId: string): GridState => mkState(runId, {
    [cellKey('NVDA', 'valuation')]: done('NVDA', 'valuation', {
        rounds: 2,
        contradictions: ['round1: $416,161m vs round2: $420,000m'],
        trust: { grade: 'D', score: 45, reasons: ['1 figure contradiction(s) across rounds'] },
    }),
    [cellKey('AAPL', 'valuation')]: done('AAPL', 'valuation'),
    [cellKey('NVDA', 'moat')]: done('NVDA', 'moat'),
    [cellKey('AAPL', 'moat')]: done('AAPL', 'moat'),
});

const memStore = (initial: GridLesson[] = []): LessonStore & { data: GridLesson[] } => {
    const s = {
        data: initial,
        load: () => s.data,
        save: (l: GridLesson[]) => { s.data = l; },
    };
    return s;
};

describe('gridLessons — deriveLessons', () => {
    it('one lesson per non-synthesis prompt with conflict counts + examples', () => {
        const lessons = deriveLessons(hardenedRun('r1'), 1000);
        expect(lessons).toHaveLength(2); // valuation + moat, never synthesis
        const val = lessons.find(l => l.promptId === 'valuation')!;
        expect(val.cells).toBe(2);
        expect(val.conflicts).toBe(1);
        expect(val.maxRounds).toBe(2);
        expect(val.examples[0]).toContain('$416,161m');
        expect(val.examples[0]).toContain('$420,000m');
        const moat = lessons.find(l => l.promptId === 'moat')!;
        expect(moat.conflicts).toBe(0);
    });

    it('flags unverified cells from trust reasons', () => {
        const state = mkState('r1', {
            [cellKey('NVDA', 'valuation')]: done('NVDA', 'valuation', {
                rounds: 2,
                trust: { grade: 'C', score: 55, reasons: ['unverified round-2 figure(s) ignored: $9.99'] },
            }),
        });
        expect(deriveLessons(state)[0].unverified).toBe(1);
    });
});

describe('gridLessons — chronic detection (3-run fixture)', () => {
    it('conflict rate >30% across runs → chronic; clean prompt → not', () => {
        const store = memStore();
        recordLessons(hardenedRun('r1'), store, 1000);
        recordLessons(hardenedRun('r2'), store, 2000);
        recordLessons(hardenedRun('r3'), store, 3000);
        // valuation: 3 conflicts / 6 cells = 50% > 30% → chronic
        const chronic = chronicConflictPrompts(store.load());
        expect(chronic.has('valuation')).toBe(true);
        expect(chronic.has('moat')).toBe(false);
    });

    it('rate at exactly the threshold is NOT chronic (strict >)', () => {
        const lessons: GridLesson[] = [
            { at: 1, runId: 'r', promptId: 'p', label: 'P', cells: 10, conflicts: 3, unverified: 0, maxRounds: 1, examples: [] },
        ];
        expect(chronicConflictPrompts(lessons).has('p')).toBe(false); // 30% not >30%
    });

    it('chronically unverified prompt gets metric-forward rewording; others untouched', () => {
        const lessons: GridLesson[] = [
            { at: 1, runId: 'r', promptId: 'valuation', label: 'Financials', cells: 2, conflicts: 0, unverified: 2, maxRounds: 2, examples: [] },
        ];
        const chronic = chronicUnverifiedPrompts(lessons);
        const p = { id: 'valuation', label: 'Financials', prompt: '{ticker} revenue' };
        const reworded = rewordPromptIfChronic(p, chronic);
        expect(reworded.prompt.startsWith('Financials exact figures.')).toBe(true);
        const clean = rewordPromptIfChronic({ id: 'moat', label: 'Moat', prompt: 'x' }, chronic);
        expect(clean.prompt).toBe('x');
    });
});

describe('gridLessons — LRU cap + injectable store', () => {
    it('caps at 100, keeps newest, never touches localStorage', () => {
        const old: GridLesson[] = Array.from({ length: 99 }, (_, i) => ({
            at: i, runId: `old-${i}`, promptId: 'p', label: 'P', cells: 1, conflicts: 0, unverified: 0, maxRounds: 1, examples: [],
        }));
        const store = memStore(old);
        const merged = recordLessons(hardenedRun('fresh'), store, 999999);
        expect(merged.length).toBeLessThanOrEqual(LESSONS_CAP);
        expect(merged.length).toBe(LESSONS_CAP);
        expect(merged[merged.length - 1].runId).toBe('fresh'); // newest survives
        expect(merged[0].at).toBeGreaterThan(0);               // oldest evicted
        expect(store.data).toBe(merged);                       // saved via adapter
    });
});
