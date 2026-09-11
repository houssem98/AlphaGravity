// CF-26/27 · the brief reports what it is doing, per section.
//
// `gridResearch` fires `deps.onStep(ticker, promptId, label)` on every trace
// step, and its own comment says that exists "so the UI can show the current
// step inside the running cell". CompanyBrief passed no `onStep`, so all of it
// was discarded: six sections shared one motionless spinner for ~30s.
//
// Worse, each section was handed the RUN's `running` flag, so with concurrency 3
// and six prompts at least three sections claimed to be analyzing before they had
// started.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { initializeGrid, runGrid, cellKey, type CellRunnerDeps } from '../../services/gridResearch';

const SRC = readFileSync(new URL('./CompanyBrief.tsx', import.meta.url), 'utf8');
/** SRC with comments stripped — this file's own docstrings quote the strings and
 *  shapes it forbids, so an assertion against the raw text matches itself. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const STORE = readFileSync(new URL('../../stores/companyBriefStore.ts', import.meta.url), 'utf8');

describe('the run reports its steps', () => {
    it('fires onStep with named work, not a generic label', async () => {
        const seen: Array<{ promptId: string; label: string }> = [];

        const def = {
            id: 'brief-TEST',
            name: 'TEST Company Brief',
            tickers: ['TEST'],
            prompts: [{ id: 'thesis', label: 'Thesis', prompt: '{ticker} thesis' }],
        };

        const deps: CellRunnerDeps = {
            callLLM: async () => ({ text: 'An answer [1].', model: 'deepseek-chat' as never }),
            searchGravity: async () => ({
                available: true,
                answer: '',
                sources: [{
                    id: 's1', title: '10-K', section: 'Item 1', text: 'evidence',
                    ticker: 'TEST', date: '2026-01-01', document_type: '10-K',
                    source_quality: 9, score: 1,
                }],
                structured_data: [],
                citations: [],
                confidence: 'HIGH',
                latency_ms: 1,
            }),
            onStep: (_t, promptId, label) => { seen.push({ promptId, label }); },
        };

        await runGrid(initializeGrid(def), deps, { concurrency: 1 });

        expect(seen.length).toBeGreaterThan(0);
        const labels = seen.map(s => s.label);
        // The steps are the real ones the runner emits, not invented UI copy.
        expect(labels).toContain('Searching SEC filings');
        expect(labels).toContain('Analyzing');
        // And they ADVANCE — a single repeated label is a spinner with extra steps.
        expect(new Set(labels).size).toBeGreaterThan(1);
        expect(labels.indexOf('Searching SEC filings'))
            .toBeLessThan(labels.indexOf('Analyzing'));
    });

    it('attributes every step to the cell it belongs to', async () => {
        const seen: Array<{ promptId: string; label: string }> = [];
        const def = {
            id: 'brief-TEST',
            name: 'TEST Company Brief',
            tickers: ['TEST'],
            prompts: [
                { id: 'thesis', label: 'Thesis', prompt: '{ticker} thesis' },
                { id: 'moat', label: 'Moat', prompt: '{ticker} moat' },
            ],
        };
        const deps: CellRunnerDeps = {
            callLLM: async () => ({ text: 'A.', model: 'deepseek-chat' as never }),
            searchGravity: async () => ({
                available: true, answer: 'grounded answer', sources: [], structured_data: [],
                citations: [{ id: 1, source: '10-K', text: 'evidence' }],
                confidence: 'HIGH', latency_ms: 1,
            }),
            onStep: (_t, promptId, label) => { seen.push({ promptId, label }); },
        };
        await runGrid(initializeGrid(def), deps, { concurrency: 2 });

        // Without the promptId a two-cell run cannot say WHICH section is busy,
        // which is the whole defect — one flag for six sections.
        expect(new Set(seen.map(s => s.promptId))).toEqual(new Set(['thesis', 'moat']));
    });
});

describe('the component is wired to it', () => {
    it('passes an onStep that records per cell', () => {
        expect(SRC).toMatch(/onStep:\s*\(t, promptId, label\)/);
        expect(SRC).toContain('[cellKey(t, promptId)]: label');
    });

    it('keeps the steps in the store, so leaving the page does not reset them', () => {
        expect(STORE).toMatch(/steps: Record<string, string>/);
        expect(STORE).toContain('steps: {}');
    });

    it('renders each section from its OWN status, never the run flag', () => {
        expect(SRC).toMatch(/status: CellStatus \| 'idle'/);
        expect(SRC).toMatch(/cell\?\.status \?\? \(running \? 'pending' : 'idle'\)/);
        // The old shape: one boolean for all six sections.
        expect(CODE).not.toMatch(/running=\{running && cell\?\.status/);
    });

    it('shows the live step while running, and does not invent one before it starts', () => {
        expect(SRC).toContain("{step ?? 'Starting'}");
        expect(SRC).toMatch(/status === 'pending' \?\s*\(?\s*'Queued\.'/);
        // "Analyzing filings…" was rendered for sections that had not begun.
        expect(CODE).not.toContain('Analyzing filings…');
    });
});
