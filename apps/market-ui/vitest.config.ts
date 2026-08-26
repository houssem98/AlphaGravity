// Vitest was referenced by `npm run eval:loop` and by ~30 `*.test.ts(x)` files
// under src/, but was never installed and had no config — so the frontend test
// suite could not be run at all. This is that config.
//
// `e2e/` is excluded on purpose: those are Playwright specs and import
// `@playwright/test`, which is a different runner.
//
// The default environment is `node`, because almost every existing test is a
// pure-function test and a DOM costs startup time. A file that needs a DOM opts
// in with a `// @vitest-environment jsdom` docblock on its first line.
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: { '@': path.resolve(__dirname, './src') },
    },
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'eval/**/*.test.ts'],
        exclude: [
            '**/node_modules/**',
            'e2e/**',
            'dist/**',
            // Standalone assertion scripts, not vitest suites: they define their
            // own `check()` helper, print their own results and call
            // `process.exit`, and they are run directly (`npx tsx <file>`, or
            // `npm run phase2`). They predate vitest being installed here and
            // contain no `describe`/`it`, so collecting them yields
            // "No test suite found" rather than any signal. Excluded so the
            // vitest run means something; each still runs under its own runner.
            'src/lib/newFilings.test.ts',
            'src/lib/peers.test.ts',
            'src/services/deepResearchService.phase1.test.ts',
            'src/services/deepResearchService.phase2.test.ts',
            'src/services/gridResearch.sources.test.ts',
            'src/services/gridResearch.synthesis.test.ts',
            'src/components/company/LatestQuarterCard.test.ts',
            'src/components/company/TranscriptSummary.test.ts',
        ],
    },
});
