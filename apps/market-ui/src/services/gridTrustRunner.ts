// Grid Trust Runner — GT-3 verification rounds (docs/GRID_TRUST_ROADMAP.md
// Sections 3 + 5; regression rows 6, 7, 8, 13, 14).
//
// Orchestration ONLY: round 1 is the existing runGrid untouched; verification
// rounds are new prompts over the SAME runGridCell seam (no parallel pipeline).
// Only grade-D/F non-synthesis cells re-run; merging + re-scoring is GT-2's
// mergeRounds. Synthesis cells are never verification-prompted — they
// re-synthesize LAST, once per hardening pass, iff any input cell changed.

import {
    runGrid, runGridCell, initializeGrid, updateCell, extractFigures, cellKey,
    type GridDef, type GridPrompt, type GridState, type GridCell, type CellRunnerDeps,
} from './gridResearch';
import { scoreCellTrust, mergeRounds, TRUST_THRESHOLD } from './gridTrust';

export const MAX_ROUNDS_CAP = 3; // Section 0 cost discipline

export interface RunRoundsOptions {
    maxRounds?: number;                                     // default 1 (row 13: ≡ runGrid + scoring)
    concurrency?: number;
    signal?: AbortSignal;
    onCellUpdate?: (state: GridState, cell: GridCell) => void;
    resumeState?: GridState;                                // GT-4 Harden: skip round 1, harden existing run
}

// Section 5 doctrine: adversarial, independent, citation-forcing. Never shows
// round-1 prose (anchoring) — only the extracted figures as claims-under-test.
// Leads metric-forward so the RAG retrieval isn't a byte-identical replay.
export function buildVerificationPrompt(cell: GridCell, prompt: GridPrompt): string {
    const figures = extractFigures(cell.answer ?? '');
    const claims = figures.length > 0 ? figures.join(', ') : '(no figures were reported)';
    return (
        `${prompt.label} exact figures. Independently determine ${prompt.label.toLowerCase()} ` +
        `for ${cell.ticker} from the provided sources — do not assume any prior answer is correct. ` +
        `Then state whether each of these previously reported figures is SUPPORTED, CONTRADICTED, ` +
        `or NOT FOUND in your sources: ${claims}. Cite [N] for every verdict.`
    );
}

const isSynthesis = (def: GridDef, promptId: string): boolean =>
    Boolean(def.prompts.find(p => p.id === promptId)?.synthesis);

// Lazy-score every non-synthesis cell that has no trust yet (row 11 spirit).
function scoreMissing(state: GridState): GridState {
    let out = state;
    for (const cell of Object.values(state.cells)) {
        if (cell.trust || isSynthesis(state.def, cell.promptId) || cell.status === 'pending' || cell.status === 'running') continue;
        out = updateCell(out, cell.ticker, cell.promptId, { trust: scoreCellTrust(cell) });
    }
    return out;
}

const failingKeys = (state: GridState): string[] =>
    Object.entries(state.cells)
        .filter(([, c]) => !isSynthesis(state.def, c.promptId))
        .filter(([, c]) => c.trust && TRUST_THRESHOLD.has(c.trust.grade))
        .map(([k]) => k);

// Row 8 no-progress fingerprint: the failing set + each cell's grade + figures.
const roundSnapshot = (state: GridState, keys: string[]): string =>
    keys.map(k => {
        const c = state.cells[k];
        return `${k}=${c.trust?.grade}:${extractFigures(c.answer ?? '').join('|')}`;
    }).join(';');

export async function runGridRounds(
    def: GridDef,
    deps: CellRunnerDeps,
    opts: RunRoundsOptions = {},
): Promise<GridState> {
    const maxRounds = Math.min(opts.maxRounds ?? 1, MAX_ROUNDS_CAP);

    // ── Round 1: existing pipeline, untouched (row 13) ──────────────────────
    let state = opts.resumeState ?? await runGrid(initializeGrid(def), deps, {
        concurrency: opts.concurrency,
        signal: opts.signal,
        onCellUpdate: opts.onCellUpdate,
    });
    state = scoreMissing(state);

    // ── Verification rounds: only D/F non-synthesis cells (rows 7, 8) ──────
    let anyHardened = false;
    let prevSnap = '';
    for (let round = 2; round <= maxRounds; round += 1) {
        if (opts.signal?.aborted) break;
        const failing = failingKeys(state);
        if (failing.length === 0) break;
        const snap = roundSnapshot(state, failing);
        if (snap === prevSnap) break; // row 8: same failing set + figures → no progress
        prevSnap = snap;

        for (const key of failing) {
            if (opts.signal?.aborted) break;
            const cell = state.cells[key];
            const gridPrompt = def.prompts.find(p => p.id === cell.promptId);
            if (!gridPrompt) continue;
            const vPrompt = buildVerificationPrompt(cell, gridPrompt);
            const vDef: GridDef = {
                ...def,
                prompts: def.prompts.map(p => (p.id === gridPrompt.id ? { ...p, prompt: vPrompt } : p)),
            };
            const r2 = await runGridCell(vDef, cell.ticker, cell.promptId, deps, opts.signal);
            const merged = mergeRounds(cell, r2);
            if (merged === cell) continue; // row 10: failed round → r1 untouched
            anyHardened = true;
            state = updateCell(state, cell.ticker, cell.promptId, merged);
            opts.onCellUpdate?.(state, state.cells[key]);
        }
    }

    // ── Row 14: synthesis re-runs LAST, only if an input cell changed ───────
    if (anyHardened) {
        for (const p of def.prompts.filter(p => p.synthesis)) {
            if (opts.signal?.aborted) break;
            state = updateCell(state, 'ALL', p.id, { status: 'running' });
            const cell = await runGridCell(def, 'ALL', p.id, deps, opts.signal, state);
            state = updateCell(state, 'ALL', p.id, cell);
            opts.onCellUpdate?.(state, state.cells[cellKey('ALL', p.id)]);
        }
    }

    return state;
}
