// GT-3 regression tests — docs/GRID_TRUST_ROADMAP.md Section 4 rows 6, 7, 8,
// 13, 14. All deps mocked, zero network.
// Run: npx vitest run src/services/gridTrustRunner.test.ts

import { describe, it, expect } from 'vitest';
import { buildVerificationPrompt, runGridRounds } from './gridTrustRunner';
import { runGrid, initializeGrid, cellKey, type GridDef, type GridCell, type CellRunnerDeps } from './gridResearch';
import type { GravityRAGResult } from './gravitySearchService';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const DEF: GridDef = {
    id: 'g1', name: 'Test Grid',
    tickers: ['GOOD', 'BAD'],
    prompts: [
        { id: 'valuation', label: 'Financials', prompt: '{ticker} revenue figures' },
        { id: 'synthesis', label: 'Comparison', prompt: 'Compare all tickers.', synthesis: true },
    ],
};

const rag = (answer: string): GravityRAGResult => ({
    available: true, answer, sources: [], structured_data: [], citations: [],
    confidence: 'HIGH', latency_ms: 5,
});

// GOOD round 1 → grounded B cell (resolving [1], figure adjacent to marker).
const GOOD_R1 = rag('Revenue was $416,161M [1].\n\nSources\n[1] GOOD 10-K, Revenue (SEC XBRL): $416,161 million');
// BAD round 1 → grade D: fabricated [7], figure in an uncited sentence.
const BAD_R1 = rag('Revenue reached $999m last year.\nSee analysis [7].\n\nSources\n[1] BAD 10-K note');
// BAD verification → figure re-derived and supported by the citation label text.
const BAD_V = rag('Revenue $999m is SUPPORTED [1].\n\nSources\n[1] BAD 10-K, Revenue: $999 million');

interface MockLog { gravityQueries: string[]; llmPrompts: string[] }

function mkDeps(log: MockLog, overrides?: { verify?: (q: string) => Promise<GravityRAGResult>; llmThrowOn?: RegExp }): CellRunnerDeps {
    return {
        callLLM: async (prompt) => {
            log.llmPrompts.push(prompt);
            if (overrides?.llmThrowOn?.test(prompt)) throw new Error('mock LLM failure');
            return { text: 'Comparison verdict: GOOD wins.', model: 'deepseek-v4-flash' as never };
        },
        searchGravity: async (query) => {
            log.gravityQueries.push(query);
            if (/SUPPORTED/.test(query)) {
                if (overrides?.verify) return overrides.verify(query);
                return BAD_V;
            }
            return query.startsWith('GOOD') ? GOOD_R1 : BAD_R1;
        },
    };
}

const mkLog = (): MockLog => ({ gravityQueries: [], llmPrompts: [] });

// ─── Row 6: adversarial verification prompt ─────────────────────────────────

describe('gridTrustRunner — buildVerificationPrompt (row 6)', () => {
    const cell: GridCell = {
        ticker: 'AAPL', promptId: 'valuation', status: 'done',
        answer: 'Cupertino reported blockbuster revenue of $416,161M [1] and margin 46% [2].',
    };
    const prompt = DEF.prompts[0];

    it('contains the round-1 figures as claims-under-test', () => {
        const p = buildVerificationPrompt(cell, prompt);
        expect(p).toContain('$416,161m');
        expect(p).toContain('46');
    });

    it('instructs independent re-derivation with per-verdict citations', () => {
        const p = buildVerificationPrompt(cell, prompt);
        expect(p).toMatch(/independently determine/i);
        expect(p).toContain('SUPPORTED');
        expect(p).toContain('CONTRADICTED');
        expect(p).toContain('NOT FOUND');
        expect(p).toMatch(/cite \[N\]/i);
    });

    it('never invites sycophancy and never leaks round-1 prose', () => {
        const p = buildVerificationPrompt(cell, prompt);
        expect(p).not.toMatch(/confirm/i);
        expect(p).not.toContain('blockbuster');
    });
});

// ─── Rows 7, 8, 13, 14: runGridRounds orchestration ─────────────────────────

describe('gridTrustRunner — runGridRounds', () => {
    it('row 13: maxRounds 1 ≡ runGrid + scoring (no verification traffic)', async () => {
        const logA = mkLog();
        const plain = await runGrid(initializeGrid(DEF), mkDeps(logA));
        const logB = mkLog();
        const scored = await runGridRounds(DEF, mkDeps(logB));

        for (const t of DEF.tickers) {
            const k = cellKey(t, 'valuation');
            expect(scored.cells[k].answer).toBe(plain.cells[k].answer);
            expect(scored.cells[k].trust).toBeDefined();
        }
        expect(logB.gravityQueries.filter(q => /SUPPORTED/.test(q))).toHaveLength(0);
        expect(logB.llmPrompts).toHaveLength(1); // synthesis ran once, never re-ran
    });

    it('row 7: only D/F cells re-run; passing cell untouched byte-identical', async () => {
        const log = mkLog();
        const state = await runGridRounds(DEF, mkDeps(log), { maxRounds: 2 });

        const verifyQueries = log.gravityQueries.filter(q => /SUPPORTED/.test(q));
        expect(verifyQueries).toHaveLength(1);
        expect(verifyQueries[0].startsWith('BAD')).toBe(true);

        const good = state.cells[cellKey('GOOD', 'valuation')];
        expect(good.trust?.grade).toBe('B');
        expect(good.rounds).toBeUndefined();       // never entered a round-2 merge
        expect(good.roundHistory).toBeUndefined();

        const bad = state.cells[cellKey('BAD', 'valuation')];
        expect(bad.rounds).toBe(2);
        expect(bad.answer).toBe(BAD_R1.answer.split('\n\nSources')[0]); // r1 prose survives
    });

    it('row 8: no-progress round stops early — maxRounds 3 issues only one verification', async () => {
        const log = mkLog();
        await runGridRounds(DEF, mkDeps(log), { maxRounds: 3 });
        // BAD stays grade D with identical figures after round 2 → round 3 skipped.
        expect(log.gravityQueries.filter(q => /SUPPORTED/.test(q))).toHaveLength(1);
    });

    it('row 8: maxRounds respected — never more verification passes than allowed', async () => {
        // Verification always "finds" a new figure → progress every round.
        let n = 0;
        const log = mkLog();
        const deps = mkDeps(log, {
            verify: async () => {
                n += 1;
                return rag(`Revenue $${100 + n}m re-derived [1].\n\nSources\n[1] BAD 10-K, Revenue: $${100 + n} million`);
            },
        });
        await runGridRounds(DEF, deps, { maxRounds: 3 });
        expect(log.gravityQueries.filter(q => /SUPPORTED/.test(q)).length).toBeLessThanOrEqual(2); // rounds 2+3 only
    });

    it('row 14: synthesis re-runs LAST after a hardening pass changed a cell', async () => {
        const log = mkLog();
        await runGridRounds(DEF, mkDeps(log), { maxRounds: 2 });
        expect(log.llmPrompts).toHaveLength(2); // round-1 synthesis + post-harden re-synthesis
        // synthesis is never verification-prompted:
        expect(log.llmPrompts.every(p => !p.includes('CONTRADICTED'))).toBe(true);
    });

    it('row 11 (AC-6): hardening reuses the same deps (tools included) and keeps the round-1 trace', async () => {
        const log = mkLog();
        const deps = mkDeps(log);
        deps.tools = { marketQuote: async () => ({ text: 'BAD price $10' }) };
        const state = await runGridRounds(DEF, deps, { maxRounds: 2 });
        const bad = state.cells[cellKey('BAD', 'valuation')];
        expect(bad.rounds).toBe(2);
        expect(bad.steps).toBeDefined();
        expect(bad.steps!.some(s => s.tool === 'rag')).toBe(true);
        expect(bad.steps!.some(s => s.tool === 'marketQuote')).toBe(true); // round-1 trace intact after merge
    });

    it('row 14 + row 10: failed verification round → nothing changed → no re-synthesis', async () => {
        const log = mkLog();
        const deps = mkDeps(log, {
            // available:false but with a source → runGridCell falls through to the
            // LLM, which throws → verification cell errors → mergeRounds keeps r1.
            verify: async () => ({
                available: false, answer: '', structured_data: [], citations: [],
                confidence: 'NONE', latency_ms: 1,
                sources: [{
                    id: 's1', title: 'BAD 10-K', section: 'MD&A', text: 'Revenue narrative',
                    ticker: 'BAD', date: '2026-01-01', document_type: '10-K', source_quality: 1, score: 1,
                }],
            }),
            llmThrowOn: /SUPPORTED/,
        });
        const state = await runGridRounds(DEF, deps, { maxRounds: 2 });

        const bad = state.cells[cellKey('BAD', 'valuation')];
        expect(bad.status).toBe('done');
        expect(bad.rounds).toBeUndefined();     // r1 cell intact
        expect(log.llmPrompts.filter(p => !/SUPPORTED/.test(p))).toHaveLength(1); // synthesis only once
    });
});
