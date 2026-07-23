// Registry of tasks running independently of the view that started them.
// Module-level (like researchStore), so a job survives the route change that
// unmounts the component that launched it — the store is the source of truth
// for the global BackgroundActivity indicator.
import { create } from 'zustand';

export interface BgJob {
    id: string;
    label: string;                 // what is running, e.g. the research query
    kind: 'research' | 'brief' | 'qa';
    href: string;                  // where clicking the job takes you back to
    startedAt: number;
}

interface BackgroundState {
    jobs: BgJob[];
    startJob: (job: BgJob) => void;
    endJob: (id: string) => void;
}

export const useBackgroundStore = create<BackgroundState>((set) => ({
    jobs: [],
    startJob: (job) => set((s) => (s.jobs.some((j) => j.id === job.id) ? s : { jobs: [...s.jobs, job] })),
    endJob: (id) => set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) })),
}));
