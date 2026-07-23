// Global company-brief store — one entry per ticker, module-level like
// gridRunStore/researchStore. A brief's live state (grid progress, running
// flag) lives here, not in the CompanyBrief component, so leaving the company
// page no longer drops the run: the runGrid loop keeps writing here and the UI
// picks the SAME in-flight session back up on return. Keyed by ticker, so
// several companies' briefs run independently and concurrently.
import { create } from 'zustand';
import type { GridState } from '../services/gridResearch';

export type BriefModel = 'deepseek' | 'claude' | 'gemini';

export interface BriefEntry {
    state: GridState | null;
    running: boolean;
    cached: boolean;
    model: BriefModel;
    // Devil's Advocate — the company page's other long-running call, keyed by the
    // same ticker so it too survives leaving the page (FI-3).
    devilAnswer: string | null;
    devilRunning: boolean;
    devilError: string | null;
    // Earnings-call summary — one RAG call, measured at 1.7–14.7s (FI-4), so it
    // is a real long-run and lives here too rather than in the component.
    transcriptAnswer: string | null;
    transcriptLoading: boolean;
    transcriptFailed: boolean;
}

export const briefDefault: BriefEntry = {
    state: null, running: false, cached: false, model: 'deepseek',
    devilAnswer: null, devilRunning: false, devilError: null,
    transcriptAnswer: null, transcriptLoading: false, transcriptFailed: false,
};

interface CompanyBriefState {
    byTicker: Record<string, BriefEntry>;
    patch: (ticker: string, p: Partial<BriefEntry>) => void;
}

export const useCompanyBriefStore = create<CompanyBriefState>((set) => ({
    byTicker: {},
    patch: (ticker, p) => set((s) => ({
        byTicker: { ...s.byTicker, [ticker]: { ...(s.byTicker[ticker] ?? briefDefault), ...p } },
    })),
}));

// Per-ticker abort handle, module-level so a brief is aborted only on an explicit
// re-run (Regenerate / model change) — never by a component unmount.
export const briefAborts: Record<string, AbortController> = {};
