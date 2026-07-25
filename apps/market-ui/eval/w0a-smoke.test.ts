// W0a smoke — ONE real end-to-end performDeepResearch run, wall-clock timed.
// Requires: market-server running locally with DEV_AUTH_BYPASS=1 (port 3002).
// Run:  RUN_DR_EVAL=1 VITE_DEV_AUTH_BYPASS=true VITE_API_URL=http://localhost:3002 \
//         npx vitest run eval/w0a-smoke.test.ts
// Real LLM + real web search — costs real money (DeepSeek pricing, ~cents).
// Nothing in the pipeline is mocked; only browser APIs (localStorage) are shimmed.

import { describe, it, beforeAll, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'out');

// localStorage shim — node has none; supabase.ts dev-bypass + checkpoints use it.
function shimLocalStorage() {
    const store = new Map<string, string>();
    globalThis.localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => void store.clear(),
        key: (i: number) => [...store.keys()][i] ?? null,
        get length() { return store.size; },
    } as Storage;
}

describe.skipIf(process.env.RUN_DR_EVAL !== '1')('W0a live smoke', () => {
    beforeAll(() => {
        shimLocalStorage();
        // Seed the dev session tavilyService reads via getAccessToken().
        localStorage.setItem('gravity_dev_session_v1', JSON.stringify({
            access_token: 'dev-token-smoke',
            refresh_token: 'dev-refresh',
            user: { id: 'dev-smoke', email: 'smoke@localhost' },
            expires_at: Math.floor(Date.now() / 1000) + 12 * 3600,
        }));
        mkdirSync(OUT_DIR, { recursive: true });
    });

    it('runs one real deep-research query end to end', async () => {
        const { performDeepResearch } = await import('../src/services/deepResearchService');

        const query = 'Nvidia data center revenue growth and key risks FY2026';
        const progressLog: Array<{ t: number; stage: string; msg: string; pct: number }> = [];
        const t0 = Date.now();

        let report, error: string | null = null;
        try {
            report = await performDeepResearch(
                query,
                (p) => progressLog.push({ t: Date.now() - t0, stage: p.stage, msg: p.message, pct: p.progress }),
                // Only live provider (probed 2026-07-10): anthropic 401, groq 401, gemini keyless.
                'deepseek-v4-flash',
            );
        } catch (e: any) {
            error = e?.message ?? String(e);
        }
        const wallMs = Date.now() - t0;

        const summary = {
            ranAt: new Date().toISOString(),
            query,
            model: 'deepseek-v4-flash',
            ok: !!report,
            error,
            wallMs,
            wallHuman: `${Math.round(wallMs / 1000)}s`,
            sources: report?.metadata.sourcesAnalyzed ?? null,
            words: report ? report.markdown.split(/\s+/).length : null,
            budget: report?.metadata.budget ?? null,
            confidence: report?.metadata.confidence ?? null,
            verification: report?.metadata.verification ?? null,
            citationDensity: report?.metadata.citationDensity?.density ?? null,
            rounds: report?.metadata.methodology.rounds ?? null,
            sectionFanout: report?.metadata.sectionFanout ?? null,
            readers: report?.metadata.readers ?? null,
            progressEvents: progressLog.length,
            stageTimeline: progressLog.filter((_, i) =>
                i === 0 || progressLog[i].stage !== progressLog[i - 1].stage),
        };
        writeFileSync(join(OUT_DIR, 'w0a-smoke.json'), JSON.stringify(summary, null, 2));
        if (report) writeFileSync(join(OUT_DIR, 'w0a-smoke-report.md'), report.markdown);

        console.log('W0A SMOKE:', JSON.stringify({
            ok: summary.ok, wall: summary.wallHuman, sources: summary.sources,
            words: summary.words, calls: summary.budget?.calls, error: summary.error,
        }));

        expect(error).toBeNull();
        expect(report!.markdown.length).toBeGreaterThan(500);
        expect(report!.metadata.sourcesAnalyzed).toBeGreaterThan(0);
    }, 900_000);
});
