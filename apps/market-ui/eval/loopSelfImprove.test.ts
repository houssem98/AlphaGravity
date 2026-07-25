// Self-improvement loop test harness.
// Usage:
//   LOOP_QUERY="query" LOOP_MODEL="deepseek-v4-flash" npm run eval:loop
//   or via LOOP_SELF_IMPROVE.sh

import { describe, it, beforeAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSelfImprovementHarness } from '../src/services/selfImprovementHarness';
import type { ResearchModelId } from '../src/services/deepResearchService';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'out');

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

describe.skipIf(!process.env.LOOP_QUERY)('self-improvement harness', () => {
    beforeAll(() => {
        shimLocalStorage();
        localStorage.setItem('gravity_dev_session_v1', JSON.stringify({
            access_token: 'dev-token-loop', refresh_token: 'dev-refresh',
            user: { id: 'dev-loop', email: 'loop@localhost' },
            expires_at: Math.floor(Date.now() / 1000) + 12 * 3600,
        }));
        mkdirSync(OUT_DIR, { recursive: true });
    });

    it('runs self-improvement loop until pass or max iterations', async () => {
        const query = process.env.LOOP_QUERY || 'Default test query';
        const model = (process.env.LOOP_MODEL || 'deepseek-v4-flash') as ResearchModelId;
        const maxIter = parseInt(process.env.LOOP_MAX_ITER || '3', 10);
        const minScore = parseFloat(process.env.LOOP_MIN_SCORE || '7.0');

        console.log(`\n🔁 LOOP START: query="${query}"\n   model=${model}, maxIter=${maxIter}, minScore=${minScore}\n`);

        const result = await runSelfImprovementHarness(query, model, { maxIter, minScore });

        // Write outputs.
        writeFileSync(
            join(OUT_DIR, `loop-${Date.now()}.json`),
            JSON.stringify(result, null, 2),
        );
        if (result.winner?.report) {
            writeFileSync(
                join(OUT_DIR, `loop-winner-${Date.now()}.md`),
                result.winner.report.markdown,
            );
        }

        // Log summary.
        console.log(`\n📊 LOOP RESULT:`);
        console.log(`   Status: ${result.summary.reason}`);
        console.log(`   Best avg score: ${result.summary.bestAvgScore?.toFixed(2) || 'n/a'}`);
        console.log(`   Total wall time: ${Math.round(result.summary.totalWallMs / 1000)}s`);
        console.log(`   Total cost: $${result.summary.totalCost}`);
        console.log(`   Iterations: ${result.iterations.length}`);
        result.iterations.forEach((it, i) => {
            const avg = it.judge
                ? +(([it.judge.comprehensiveness, it.judge.insight, it.judge.instruction_following, it.judge.readability].reduce((a, b) => a + b, 0) / 4).toFixed(2))
                : null;
            console.log(`     [${i + 1}] ok=${it.ok} wall=${Math.round(it.wallMs / 1000)}s avg=${avg || 'n/a'}`);
        });
        console.log('');
    }, 3_600_000);
});
