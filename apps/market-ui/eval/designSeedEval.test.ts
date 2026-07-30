// G3b — does seeding the designer with past exemplars help?
//
// Two passes over the same 5 archived reports:
//   COLD   — the design loop as it ships today, no exemplars.
//   SEEDED — the same loop, seeded with the top exemplars from the bank the
//            COLD pass produced.
//
// LEAKAGE GUARD: a report is never seeded with its own exemplar. Seeding a
// report with the winning spec it already produced would measure nothing but
// copying. `topExemplars` is filtered by title before each seeded run.
//
// Run: RUN_SEED_EVAL=1 npx vitest run eval/designSeedEval.test.ts
// Cost: up to 4 LLM calls per report per pass (designer + critic, ≤2 iters).

import { describe, it, beforeAll, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVAL_QUERIES } from '../src/services/evalRubric';
import { runDesignLoop } from '../src/services/pdfDesigner';
import { extractExhibits } from '../src/services/exhibitExtract';
import { addExemplar, topExemplars, type DesignExemplar } from '../src/services/designExemplars';

const EVAL_ROOT = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(EVAL_ROOT, 'out');
const SRC_DIR = join(EVAL_ROOT, 'out/v2-prew1');
const API = process.env.VITE_API_URL || 'http://localhost:3002';
const MODEL = 'deepseek-v4-flash';

async function chat(prompt: string): Promise<string> {
    const res = await fetch(`${API}/api/llm/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'deepseek', model: MODEL, prompt, max_tokens: 3000 }),
    });
    if (!res.ok) throw new Error(`chat failed: HTTP ${res.status}`);
    return (await res.json()).text ?? '';
}

interface Row {
    id: string;
    iterations: number;
    score: number | null;
    violations: number;
    fellBack: boolean;
    seeds: number;
}

const mean = (xs: number[]) =>
    xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : null;

describe.skipIf(process.env.RUN_SEED_EVAL !== '1')('G3b exemplar seeding', () => {
    beforeAll(() => { mkdirSync(OUT_DIR, { recursive: true }); });

    it('compares a cold design loop against a seeded one', async () => {
        const reports = EVAL_QUERIES
            .map(({ id }) => ({ id, path: join(SRC_DIR, `baseline-${id}.md`) }))
            .filter(r => existsSync(r.path))
            .map(r => ({ id: r.id, markdown: readFileSync(r.path, 'utf8') }));

        expect(reports.length).toBeGreaterThan(0);

        // ── Pass 1: cold ──────────────────────────────────────────────────
        const cold: Row[] = [];
        let bank: DesignExemplar[] = [];
        for (const { id, markdown } of reports) {
            const r = await runDesignLoop(id, markdown, extractExhibits(markdown), { chat });
            cold.push({
                id, iterations: r.iterations, score: r.finalScore,
                violations: r.violationsFixed, fellBack: r.fellBack, seeds: 0,
            });
            if (!r.fellBack && typeof r.finalScore === 'number') {
                bank = addExemplar(bank, {
                    ranAt: new Date().toISOString(), title: id,
                    tone: r.spec.tone, theme: r.spec.theme,
                    score: r.finalScore, iterations: r.iterations, spec: r.spec,
                });
            }
            console.log(`COLD   ${id}: iters=${r.iterations} score=${r.finalScore} fixed=${r.violationsFixed}`);
        }

        // ── Pass 2: seeded, never with the report's own exemplar ──────────
        const seeded: Row[] = [];
        for (const { id, markdown } of reports) {
            const seeds = topExemplars(bank.filter(e => e.title !== id), {}, 3);
            const r = await runDesignLoop(id, markdown, extractExhibits(markdown), { chat, exemplars: seeds });
            seeded.push({
                id, iterations: r.iterations, score: r.finalScore,
                violations: r.violationsFixed, fellBack: r.fellBack, seeds: seeds.length,
            });
            console.log(`SEEDED ${id}: iters=${r.iterations} score=${r.finalScore} fixed=${r.violationsFixed} seeds=${seeds.length}`);
        }

        const summarise = (rows: Row[]) => ({
            n: rows.length,
            avgIterations: mean(rows.map(r => r.iterations)),
            avgScore: mean(rows.filter(r => typeof r.score === 'number').map(r => r.score as number)),
            avgViolations: mean(rows.map(r => r.violations)),
            fellBack: rows.filter(r => r.fellBack).length,
        });

        const summary = {
            ranAt: new Date().toISOString(),
            model: MODEL,
            note: 'Seeded runs exclude the report own exemplar (no self-seeding).',
            cold: summarise(cold),
            seeded: summarise(seeded),
            rows: { cold, seeded },
        };
        writeFileSync(join(OUT_DIR, 'design-seed-eval.json'), JSON.stringify(summary, null, 2));
        console.log('G3B RESULT:', JSON.stringify({ cold: summary.cold, seeded: summary.seeded }));

        expect(seeded.length).toBe(cold.length);
    }, 1_800_000);
});
