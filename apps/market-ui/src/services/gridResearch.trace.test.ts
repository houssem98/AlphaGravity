// AC-2 regression tests — docs/GRID_AGENT_CELL_ROADMAP.md rows 4, 9:
// instrumentation records steps without changing any behavior.
// Run: npx vitest run src/services/gridResearch.trace.test.ts

import { describe, it, expect } from 'vitest';
import { runGridCell, toCSV, buildMemo, cellKey, type GridDef, type GridState, type CellRunnerDeps } from './gridResearch';
import type { GravityRAGResult } from './gravitySearchService';

const DEF: GridDef = {
    id: 'g1', name: 'Trace Grid', tickers: ['AAPL'],
    prompts: [{ id: 'valuation', label: 'Financials', prompt: '{ticker} revenue figures' }],
};

const rag = (over: Partial<GravityRAGResult>): GravityRAGResult => ({
    available: true, answer: '', sources: [], structured_data: [], citations: [],
    confidence: 'HIGH', latency_ms: 5, ...over,
});

const GROUNDED = rag({ answer: 'Revenue was $416,161M [1].\n\nSources\n[1] AAPL 10-K, Revenue (SEC XBRL): $416,161 million' });

describe('gridResearch — AC-2 instrumentation (rows 4, 9)', () => {
    it('row 9: grounded RAG path — same answer/citations as before, plus one ok rag step', async () => {
        const deps: CellRunnerDeps = {
            callLLM: async () => { throw new Error('LLM must not be called on grounded path'); },
            searchGravity: async () => GROUNDED,
        };
        const cell = await runGridCell(DEF, 'AAPL', 'valuation', deps);
        expect(cell.status).toBe('done');
        expect(cell.answer).toBe('Revenue was $416,161M [1].');
        expect(cell.ragUsed).toBe(true);
        expect(cell.citations).toHaveLength(1);
        expect(cell.steps).toHaveLength(1);
        expect(cell.steps![0]).toMatchObject({ tool: 'rag', label: 'Searching SEC filings', status: 'ok' });
    });

    it('RAG throws → soft-fail preserved (honest no-data cell) + failed step recorded', async () => {
        const deps: CellRunnerDeps = {
            callLLM: async () => ({ text: 'x', model: 'deepseek-chat' as never }),
            searchGravity: async () => { throw new Error('HTTP 503'); },
        };
        const cell = await runGridCell(DEF, 'AAPL', 'valuation', deps);
        expect(cell.status).toBe('done');
        expect(cell.modelUsed).toBe('no-sources');
        expect(cell.answer).toContain('No data available');
        expect(cell.steps).toHaveLength(1);
        expect(cell.steps![0]).toMatchObject({ tool: 'rag', status: 'failed', error: 'HTTP 503' });
    });

    it('LLM fallback path — rag step empty + llm step ok, answer unchanged', async () => {
        const deps: CellRunnerDeps = {
            callLLM: async () => ({ text: 'Margin held at 46% [1].', model: 'deepseek-chat' as never }),
            searchGravity: async () => rag({
                available: false,
                sources: [{ id: 's1', title: 'AAPL 10-K', section: 'MD&A', text: 'Margin 46%', ticker: 'AAPL', date: '2026-01-01', document_type: '10-K', source_quality: 1, score: 1 }],
            }),
        };
        const cell = await runGridCell(DEF, 'AAPL', 'valuation', deps);
        expect(cell.status).toBe('done');
        expect(cell.answer).toBe('Margin held at 46% [1].');
        expect(cell.steps!.map(s => [s.tool, s.status])).toEqual([['rag', 'empty'], ['llm', 'ok']]);
    });

    // ── AC-3: tool registry (rows 3, 6) ─────────────────────────────────────
    it('row 3: one tool rejects → failed step with real error, cell still done from the rest', async () => {
        let llmPrompt = '';
        const deps: CellRunnerDeps = {
            callLLM: async (p) => { llmPrompt = p; return { text: 'P/E is 40.5 [1].', model: 'deepseek-chat' as never }; },
            searchGravity: async () => rag({ available: false, sources: [] }),
            tools: {
                marketQuote: async () => { throw new Error('HTTP 502'); },
                fundamentals: async () => ({ text: 'AAPL trailing P/E 40.5, FCF $101.1B' }),
            },
        };
        const cell = await runGridCell(DEF, 'AAPL', 'valuation', deps);
        expect(cell.status).toBe('done');
        const quoteStep = cell.steps!.find(s => s.tool === 'marketQuote')!;
        expect(quoteStep.status).toBe('failed');
        expect(quoteStep.error).toBe('HTTP 502');
        expect(cell.steps!.find(s => s.tool === 'fundamentals')!.status).toBe('ok');
        // row 6: analyze prompt carries ONLY the successful tool's data
        expect(llmPrompt).toContain('FCF $101.1B');
        expect(llmPrompt).not.toContain('HTTP 502');
    });

    it('row 6 + honest-empty: everything fails/empty → no LLM call, honest cell', async () => {
        const deps: CellRunnerDeps = {
            callLLM: async () => { throw new Error('LLM must not run with zero data'); },
            searchGravity: async () => rag({ available: false, sources: [] }),
            tools: {
                marketQuote: async () => { throw new Error('down'); },
                fundamentals: async () => { throw new Error('down'); },
            },
        };
        const cell = await runGridCell(DEF, 'AAPL', 'valuation', deps);
        expect(cell.status).toBe('done');
        expect(cell.modelUsed).toBe('no-sources');
        expect(cell.steps!.filter(s => s.status === 'failed')).toHaveLength(2);
    });

    it('tools + grounded RAG: tool steps traced, RAG answer untouched (no LLM call)', async () => {
        const deps: CellRunnerDeps = {
            callLLM: async () => { throw new Error('LLM must not be called on grounded path'); },
            searchGravity: async () => GROUNDED,
            tools: { marketQuote: async () => ({ text: 'AAPL price $333.74' }) },
        };
        const cell = await runGridCell(DEF, 'AAPL', 'valuation', deps);
        expect(cell.answer).toBe('Revenue was $416,161M [1].');
        expect(cell.steps!.map(s => s.tool).sort()).toEqual(['marketQuote', 'rag']);
    });

    it('row 4: steps never leak into exports — CSV/memo identical with or without them', async () => {
        const base: GridState = {
            def: DEF,
            cells: {
                [cellKey('AAPL', 'valuation')]: {
                    ticker: 'AAPL', promptId: 'valuation', status: 'done',
                    answer: 'Revenue was $416,161M [1].',
                    citations: [{ id: 1, title: 'AAPL 10-K', url: 'https://sec.gov/x', source: 'gravity' }],
                },
            },
        };
        const withSteps: GridState = JSON.parse(JSON.stringify(base));
        withSteps.cells[cellKey('AAPL', 'valuation')].steps = [
            { label: 'Searching SEC filings', tool: 'rag', ms: 120, status: 'ok' },
        ];
        expect(toCSV(withSteps)).toBe(toCSV(base));
        expect(buildMemo(withSteps)).toBe(buildMemo(base));
    });
});
