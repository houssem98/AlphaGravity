// Global grid-run store — persists the in-flight Research Grid across mode
// switches. Same reason as researchStore: switching to Company/Quick Answer
// unmounts GridView, and component-local state would drop a running grid.
// The runGrid loop itself is never aborted on unmount, so it keeps writing
// here and the UI picks it back up on remount.
import { create } from 'zustand';
import type { GridState } from '../services/gridResearch';

// Mirrors React's setter signature so call sites read unchanged.
type Updater<T> = T | ((prev: T) => T);
const apply = <T,>(v: Updater<T>, prev: T): T =>
    typeof v === 'function' ? (v as (p: T) => T)(prev) : v;

export interface RunStats { cells: number; wallS: number; per100S: number }

interface GridRunState {
    gridState: GridState | null;
    running: boolean;
    runStats: RunStats | null;
    changedCells: Set<string>;
    // AC-5: current trace-step label per running cell (cellKey → label)
    cellSteps: Record<string, string>;

    setGridState: (v: Updater<GridState | null>) => void;
    setRunning: (v: boolean) => void;
    setRunStats: (v: RunStats | null) => void;
    setChangedCells: (v: Updater<Set<string>>) => void;
    setCellStep: (key: string, label: string | null) => void;
}

export const useGridRunStore = create<GridRunState>((set) => ({
    gridState: null,
    running: false,
    runStats: null,
    changedCells: new Set(),
    cellSteps: {},

    setGridState: (v) => set((s) => ({ gridState: apply(v, s.gridState) })),
    setRunning: (v) => set({ running: v }),
    setRunStats: (v) => set({ runStats: v }),
    setChangedCells: (v) => set((s) => ({ changedCells: apply(v, s.changedCells) })),
    setCellStep: (key, label) => set((s) => {
        const next = { ...s.cellSteps };
        if (label === null) delete next[key];
        else next[key] = label;
        return { cellSteps: next };
    }),
}));

// Abort handle for the in-flight run. Module-level and non-reactive so Cancel
// still targets the live run after a remount.
export const gridAbort: { current: AbortController | null } = { current: null };
