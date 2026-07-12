// LIVE search-fallback proof: with Tavily quota-capped (432), the pipeline's
// source acquisition must still return real web sources via the Firecrawl
// fallback (market-server /api/firecrawl/search). This is the gate that
// unblocks live loop runs.
// Run:  RUN_SEARCH_LIVE=1 VITE_DEV_AUTH_BYPASS=true npx vitest run eval/liveSearchFallback.test.ts

import { describe, it, expect } from 'vitest';

describe.skipIf(process.env.RUN_SEARCH_LIVE !== '1')('live search fallback (Tavily down)', () => {
    it('searchMultipleQueriesParallel returns sources with Tavily 432', async () => {
        const { searchMultipleQueriesParallel } = await import('../src/services/tavilyService');
        const results = await searchMultipleQueriesParallel([
            'NVIDIA data center revenue growth FY2026',
            'NVIDIA Blackwell demand hyperscaler capex 2026',
        ], 5);
        console.log(`sources: ${results.length}`);
        for (const r of results.slice(0, 6)) console.log('-', r.title?.slice(0, 60), '|', r.url.slice(0, 60));
        expect(results.length).toBeGreaterThanOrEqual(3);
        expect(results.every(r => r.url.startsWith('http'))).toBe(true);
    }, 120_000);
});
