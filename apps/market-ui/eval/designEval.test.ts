// G0b design baseline — scores ARCHIVED reports for design/structure quality.
// No pipeline run, no Tavily: reads markdown off disk, one judge call each.
// Requires market-server local (DEV_AUTH_BYPASS=1, port 3002) for the judge.
//
// Baseline:  RUN_DESIGN_EVAL=1 npx vitest run eval/designEval.test.ts
// Re-render: DESIGN_EVAL_DIR=out/g1-rendered DESIGN_EVAL_OUT=design-g1.json ... (compare vs baseline)
// Cost: ~5 judge calls (deepseek, cents).

import { describe, it, beforeAll, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    EVAL_QUERIES, DESIGN_RUBRIC_VERSION, DESIGN_DIMS,
    buildDesignJudgePrompt, computeStructureStats, parseJudgeJson, type DesignScores,
} from '../src/services/evalRubric';

const EVAL_ROOT = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(EVAL_ROOT, 'out');
const API = process.env.VITE_API_URL || 'http://localhost:3002';
const MODEL = 'deepseek-v4-flash';

// Which rendered corpus to score. Default = the archived pre-W1 reports,
// which is the state the content baseline was measured on.
const SRC_DIR = join(EVAL_ROOT, process.env.DESIGN_EVAL_DIR || 'out/v2-prew1');
const OUT_FILE = process.env.DESIGN_EVAL_OUT || 'design-baseline.json';

async function judgeCall(prompt: string): Promise<string> {
    const res = await fetch(`${API}/api/llm/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Generous cap: deepseek-v4-flash is a reasoning model — thinking
        // tokens count against max_tokens and starve the JSON at low caps.
        body: JSON.stringify({ provider: 'deepseek', model: MODEL, prompt, max_tokens: 3000 }),
    });
    if (!res.ok) throw new Error(`judge call failed: HTTP ${res.status}`);
    return (await res.json()).text ?? '';
}

describe.skipIf(process.env.RUN_DESIGN_EVAL !== '1')('G0b design baseline', () => {
    beforeAll(() => { mkdirSync(OUT_DIR, { recursive: true }); });

    it('scores every archived report on the design rubric', async () => {
        const runs: any[] = [];
        for (const { id, q } of EVAL_QUERIES) {
            const path = join(SRC_DIR, `baseline-${id}.md`);
            if (!existsSync(path)) {
                runs.push({ id, ok: false, error: `missing ${path}` });
                console.warn(`SKIP ${id}: no report at ${path}`);
                continue;
            }
            const markdown = readFileSync(path, 'utf8');
            const stats = computeStructureStats(markdown);

            let design: DesignScores | null = null;
            let error: string | null = null;
            try {
                design = parseJudgeJson<DesignScores>(await judgeCall(buildDesignJudgePrompt(q, markdown)));
                if (design && DESIGN_DIMS.some(d => typeof design![d] !== 'number')) {
                    error = 'judge returned malformed dims';
                    design = null;
                }
            } catch (e: any) { error = e?.message ?? String(e); }

            runs.push({ id, ok: !!design, error, chars: markdown.length, stats, design });
            console.log(`DESIGN ${id}: ${design
                ? DESIGN_DIMS.map(d => `${d[0]}${design![d]}`).join(' ')
                : `FAILED (${error})`} | balance=${stats.balanceRatio} tables=${stats.tables} units=${stats.numbersWithUnits}`);
        }

        const ok = runs.filter(r => r.ok);
        const avg = (f: (r: any) => number | undefined) => {
            const v = ok.map(f).filter((x): x is number => typeof x === 'number');
            return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : null;
        };
        const summary = {
            ranAt: new Date().toISOString(),
            rubric: DESIGN_RUBRIC_VERSION,
            model: MODEL,
            source: SRC_DIR,
            scope: 'STRUCTURE judged from markdown — not rendered pixels (no vision model available)',
            ok: ok.length, failed: runs.length - ok.length,
            avgDesign: Object.fromEntries(DESIGN_DIMS.map(d => [d, avg(r => r.design?.[d])])),
            avgStats: {
                balanceRatio: avg(r => r.stats?.balanceRatio),
                tables: avg(r => r.stats?.tables),
                bulletLines: avg(r => r.stats?.bulletLines),
                avgParagraphChars: avg(r => r.stats?.avgParagraphChars),
                numbersWithUnits: avg(r => r.stats?.numbersWithUnits),
            },
            runs,
        };
        writeFileSync(join(OUT_DIR, OUT_FILE), JSON.stringify(summary, null, 2));
        console.log('DESIGN BASELINE:', JSON.stringify({ ok: summary.ok, avgDesign: summary.avgDesign, avgStats: summary.avgStats }));

        expect(ok.length).toBeGreaterThan(0);
    }, 900_000);
});
