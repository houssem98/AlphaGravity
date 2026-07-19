// Grid Lessons — GT-6 self-improvement memory (docs/GRID_TRUST_ROADMAP.md).
// Per-run learning without a backend: after a hardened run, derive one lesson
// per prompt (counts of conflicts / unverified cells / max rounds), persist in
// localStorage (grid_lessons_v1, capped 100, LRU by timestamp), and surface as
//   (a) a "chronic offender" hint on prompts with historical conflict rate >30%
//   (b) a metric-forward RAG-query rewording preference for chronically
//       unverified prompts (Section 5's own phrasing, applied preemptively).
// Everything here is pure except the storage adapter, which is injectable.

import { cellKey, type GridPrompt, type GridState } from './gridResearch';
import { scoreCellTrust } from './gridTrust';

export interface GridLesson {
    at: number;                 // epoch ms — LRU ordering
    runId: string;
    promptId: string;
    label: string;
    cells: number;              // graded (done, non-synthesis) cells for this prompt
    conflicts: number;          // cells with contradictions[]
    unverified: number;         // cells whose trust reasons flag unverified/no-overlap figures
    maxRounds: number;
    examples: string[];         // ≤2 human hints ("NVDA: round1 $X vs round2 $Y", "AAPL needed 3 rounds")
}

export const LESSONS_KEY = 'grid_lessons_v1';
export const LESSONS_CAP = 100;
export const CHRONIC_RATE = 0.3;

export interface LessonStore {
    load(): GridLesson[];
    save(lessons: GridLesson[]): void;
}

export const localLessonStore: LessonStore = {
    load: () => {
        try { return JSON.parse(localStorage.getItem(LESSONS_KEY) ?? '[]'); } catch { return []; }
    },
    save: (lessons) => {
        try { localStorage.setItem(LESSONS_KEY, JSON.stringify(lessons)); } catch { /* quota/SSR */ }
    },
};

const UNVERIFIED_RE = /unverified|no figure overlap/i;

// Pure: one lesson per non-synthesis prompt that has ≥1 done cell.
export function deriveLessons(state: GridState, now = Date.now()): GridLesson[] {
    const out: GridLesson[] = [];
    for (const p of state.def.prompts) {
        if (p.synthesis) continue;
        let cells = 0, conflicts = 0, unverified = 0, maxRounds = 1;
        const examples: string[] = [];
        for (const t of state.def.tickers) {
            const c = state.cells[cellKey(t, p.id)];
            if (!c || c.status !== 'done') continue;
            cells += 1;
            const trust = c.trust ?? scoreCellTrust(c);
            if (c.contradictions?.length) {
                conflicts += 1;
                if (examples.length < 2) examples.push(`${t}: ${c.contradictions[0]}`);
            }
            if (trust.reasons.some(r => UNVERIFIED_RE.test(r))) unverified += 1;
            const r = c.rounds ?? 1;
            if (r > maxRounds) maxRounds = r;
            if (r >= 3 && examples.length < 2) examples.push(`${t} needed ${r} rounds`);
        }
        if (cells > 0) {
            out.push({ at: now, runId: state.def.id, promptId: p.id, label: p.label, cells, conflicts, unverified, maxRounds, examples });
        }
    }
    return out;
}

// Append fresh lessons, LRU-capped to the newest 100.
export function recordLessons(state: GridState, store: LessonStore = localLessonStore, now = Date.now()): GridLesson[] {
    const merged = [...store.load(), ...deriveLessons(state, now)]
        .sort((a, b) => a.at - b.at)
        .slice(-LESSONS_CAP);
    store.save(merged);
    return merged;
}

function chronicBy(lessons: GridLesson[], pick: (l: GridLesson) => number, minRate: number): Set<string> {
    const agg = new Map<string, { cells: number; hits: number }>();
    for (const l of lessons) {
        const a = agg.get(l.promptId) ?? { cells: 0, hits: 0 };
        a.cells += l.cells;
        a.hits += pick(l);
        agg.set(l.promptId, a);
    }
    return new Set([...agg].filter(([, v]) => v.cells > 0 && v.hits / v.cells > minRate).map(([k]) => k));
}

// (a) prompts whose historical conflict rate exceeds 30%.
export function chronicConflictPrompts(lessons: GridLesson[], minRate = CHRONIC_RATE): Set<string> {
    return chronicBy(lessons, l => l.conflicts, minRate);
}

// (b) prompts whose figures chronically fail verification (NOT FOUND / unverified).
export function chronicUnverifiedPrompts(lessons: GridLesson[], minRate = CHRONIC_RATE): Set<string> {
    return chronicBy(lessons, l => l.unverified, minRate);
}

// (b) applied: metric-forward rewording for a chronically unverified prompt.
// The prompt text IS the RAG query in the grounded path, so leading with the
// metric keywords shifts retrieval without a parallel pipeline.
export function rewordPromptIfChronic(p: GridPrompt, chronicUnverified: Set<string>): GridPrompt {
    if (!chronicUnverified.has(p.id) || p.synthesis) return p;
    return { ...p, prompt: `${p.label} exact figures. ${p.prompt}` };
}
