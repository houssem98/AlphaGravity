// QA-14 — regression tests 16/17/18 for the self-improvement loop, fully
// mocked (judge + performDeepResearch). Live loop runs stay blocked on Tavily
// quota; this proves the loop mechanics without network or spend.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSelfImprovementHarness } from '../src/services/selfImprovementHarness';

vi.mock('../src/services/deepResearchService', () => ({
    performDeepResearch: vi.fn(),
    extractCitedSentences: vi.fn(() => []),
}));

import { performDeepResearch, extractCitedSentences } from '../src/services/deepResearchService';

const mockedPDR = vi.mocked(performDeepResearch);
const mockedECS = vi.mocked(extractCitedSentences);

function judgeResponse(scores: { c: number; i: number; f: number; r: number }) {
    return {
        ok: true,
        json: async () => ({
            text: JSON.stringify({
                comprehensiveness: scores.c, insight: scores.i,
                instruction_following: scores.f, readability: scores.r,
                rationale: {
                    comprehensiveness: 'missing capex angle',
                    insight: 'no competitive benchmark',
                    instruction_following: 'timeframe too narrow',
                    readability: 'tables truncated',
                },
            }),
        }),
    } as Response;
}

function citationSpotResponse(verdicts: string[]) {
    return { ok: true, json: async () => ({ text: JSON.stringify({ verdicts }) }) } as Response;
}

function queueFetch(responses: Response[]) {
    const queue = [...responses];
    globalThis.fetch = vi.fn(async () => {
        const next = queue.shift();
        if (!next) throw new Error('fetch queue empty');
        return next;
    }) as any;
}

const REPORT = { markdown: 'Report body [1].', citations: [{ id: 1, title: 'Reuters piece', url: 'https://reuters.com/x' }] };

beforeEach(() => {
    vi.clearAllMocks();
    mockedECS.mockReturnValue([]);
    mockedPDR.mockResolvedValue(REPORT as any);
});

describe('regression test 16 — iteration 2 query includes feedback; re-run ≥7 passes', () => {
    it('loop passes on iteration 2 with feedback injected', async () => {
        queueFetch([
            judgeResponse({ c: 7, i: 6, f: 7, r: 7 }),   // iter 1: min 6 → continue
            judgeResponse({ c: 8, i: 8, f: 8, r: 8 }),   // iter 2: min 8 → PASS
        ]);
        const result = await runSelfImprovementHarness('Nvidia data center risks FY2027', 'deepseek-chat', { maxIter: 3, minScore: 7 });

        expect(result.summary.passedOnIter).toBe(2);
        expect(result.iterations).toHaveLength(2);
        expect(mockedPDR).toHaveBeenCalledTimes(2);
        const secondQuery = mockedPDR.mock.calls[1][0] as string;
        expect(secondQuery).toContain('FEEDBACK FROM PRIOR ITERATIONS');
        expect(secondQuery).toContain('no competitive benchmark');
    });
});

describe('regression test 17 — max iterations, all <7 → best avg wins, no pass', () => {
    it('winner is the highest-avg iteration; loop reports exhaustion', async () => {
        queueFetch([
            judgeResponse({ c: 5, i: 5, f: 5, r: 5 }),   // avg 5.0
            judgeResponse({ c: 6, i: 6, f: 6, r: 6 }),   // avg 6.0 ← winner
            judgeResponse({ c: 4, i: 5, f: 5, r: 5 }),   // avg 4.75
        ]);
        const result = await runSelfImprovementHarness('q', 'deepseek-chat', { maxIter: 3, minScore: 7 });

        expect(result.summary.passedOnIter).toBeUndefined();
        expect(result.iterations).toHaveLength(3);
        expect(result.summary.bestAvgScore).toBe(6);
        expect(result.winner?.iteration).toBe(2);
        expect(result.summary.reason).toContain('Exhausted');
    });
});

describe('regression test 18 — dubious citations feed the next iteration', () => {
    it('5 dubious verdicts → feedback says prioritize peer-reviewed sources', async () => {
        mockedECS.mockReturnValue([
            { sentence: 'Margins reached 44.5% [1].', citationIds: ['1'] },
        ] as any);
        queueFetch([
            judgeResponse({ c: 6, i: 6, f: 6, r: 6 }),                                        // iter 1 judge
            citationSpotResponse(['dubious', 'dubious', 'dubious', 'dubious', 'dubious']),    // iter 1 spot
            judgeResponse({ c: 8, i: 8, f: 8, r: 8 }),                                        // iter 2 judge
            citationSpotResponse(['plausible']),                                              // iter 2 spot
        ]);
        const result = await runSelfImprovementHarness('q', 'deepseek-chat', { maxIter: 2, minScore: 7 });

        const secondQuery = mockedPDR.mock.calls[1][0] as string;
        expect(secondQuery).toContain('dubious citations');
        expect(secondQuery).toContain('prioritize peer-reviewed');
        expect(result.summary.passedOnIter).toBe(2);
    });
});
