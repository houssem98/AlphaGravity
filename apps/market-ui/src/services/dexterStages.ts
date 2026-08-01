// DD-10 — the stage checklist (docs/DEXTER_DESIGN_ROADMAP.md).
//
// A run can take five minutes and showed one line for all of it. The fix is to
// render the pipeline the router actually chose BEFORE it runs, then tick each
// stage as its NDJSON event lands.
//
// The plan comes from the server, because only the server knows which mode the
// router picked and whether the journal is configured. Guessing it client-side
// would put a stage on screen that may never run — doctrine 4.
//
// A stage is only ever marked done by an event that says it finished. The
// checklist is a record of a run, not an animation of an expected one.

export interface PlannedStage {
    label: string;
    tool: string;
}

export type StageStatus = 'pending' | 'running' | 'ok' | 'empty' | 'failed';

export interface StageState extends PlannedStage {
    status: StageStatus;
    ms?: number;
    /** set only when the step reported one */
    detail?: string;
}

/** The graph path runs a fixed pipeline, so it can be stated up front. The
 *  tool-loop path lets the model choose its own calls, so there is nothing
 *  honest to promise and this returns []. */
export function plannedStages(mode: string, opts: { hasMemory: boolean }): PlannedStage[] {
    if (mode !== 'deep' && mode !== 'decide') return [];
    const stages: PlannedStage[] = [];
    if (opts.hasMemory) stages.push({ label: 'Recalling past calls', tool: 'memory' });
    stages.push({ label: 'Running analysts', tool: 'analysts' });
    if (mode === 'decide') {
        stages.push({ label: 'Bull/bear debate', tool: 'debate' });
        stages.push({ label: 'Risk trio + portfolio manager', tool: 'risk' });
    }
    stages.push({ label: 'Answering from the analyst reports', tool: 'llm' });
    return stages;
}

export const toStageStates = (stages: PlannedStage[]): StageState[] =>
    stages.map(s => ({ ...s, status: 'pending' as const }));

export interface StageEvent {
    type: 'stage' | 'step';
    label: string;
    tool: string;
    ms?: number;
    status?: 'ok' | 'empty' | 'failed';
    error?: string;
    meta?: string;
}

/** Apply one NDJSON event. Moves exactly one stage, never more: a `stage` event
 *  starts the first pending match, a `step` event finishes the first unfinished
 *  match. An event for a stage that was never planned is appended, so a run
 *  that does more than promised still shows all of it. */
export function applyStageEvent(prev: StageState[], ev: StageEvent): StageState[] {
    const idx = prev.findIndex(s =>
        s.tool === ev.tool
        && s.label === ev.label
        && (ev.type === 'stage' ? s.status === 'pending' : s.status !== 'ok' && s.status !== 'empty' && s.status !== 'failed'));

    if (idx === -1) {
        if (ev.type === 'stage') {
            return [...prev, { label: ev.label, tool: ev.tool, status: 'running' }];
        }
        return [...prev, {
            label: ev.label, tool: ev.tool,
            status: ev.status ?? 'ok', ms: ev.ms,
            detail: ev.error || ev.meta,
        }];
    }

    const next = [...prev];
    next[idx] = ev.type === 'stage'
        ? { ...next[idx], status: 'running' }
        : { ...next[idx], status: ev.status ?? 'ok', ms: ev.ms, detail: ev.error || ev.meta };
    return next;
}

export const stagesDone = (stages: StageState[]) =>
    stages.filter(s => s.status === 'ok' || s.status === 'empty' || s.status === 'failed').length;
