// W0b eval harness — 5 real pipeline runs, judge-scored. THE baseline.
// Requires market-server local with DEV_AUTH_BYPASS=1 (port 3002).
// Run:  RUN_DR_EVAL=1 VITE_DEV_AUTH_BYPASS=true VITE_API_URL=http://localhost:3002 \
//         npx vitest run eval/drEval.test.ts
// Sequential on purpose: performDeepResearch uses module-global budget/signal
// refs — concurrent runs would stomp each other.
// Real money: ~5 × $0.08 pipeline + ~$0.02 judge ≈ $0.45 (deepseek).

import { describe, it, beforeAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    EVAL_QUERIES, RUBRIC_VERSION, buildJudgePrompt, buildCitationSpotPrompt,
    parseJudgeJson, type JudgeScores,
} from './rubric';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'out');
const API = process.env.VITE_API_URL || 'http://localhost:3002';
const MODEL = 'deepseek-chat'; // only live provider (probed 2026-07-10)

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

async function judgeCall(prompt: string): Promise<string> {
    const res = await fetch(`${API}/api/llm/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'deepseek', model: MODEL, prompt, max_tokens: 2000 }),
    });
    if (!res.ok) throw new Error(`judge call failed: HTTP ${res.status}`);
    return (await res.json()).text ?? '';
}

describe.skipIf(process.env.RUN_DR_EVAL !== '1')('W0b eval baseline', () => {
    beforeAll(() => {
        shimLocalStorage();
        localStorage.setItem('gravity_dev_session_v1', JSON.stringify({
            access_token: 'dev-token-eval', refresh_token: 'dev-refresh',
            user: { id: 'dev-eval', email: 'eval@localhost' },
            expires_at: Math.floor(Date.now() / 1000) + 12 * 3600,
        }));
        mkdirSync(OUT_DIR, { recursive: true });
    });

    it('runs 5 queries, scores each, writes baseline JSON', async () => {
        const { performDeepResearch } = await import('../src/services/deepResearchService');
        const { extractCitedSentences } = await import('../src/services/deepResearchService');

        const results: any[] = [];
        for (const { id, q } of EVAL_QUERIES) {
            const t0 = Date.now();
            let report: any = null, error: string | null = null;
            try {
                report = await performDeepResearch(q, () => {}, MODEL);
            } catch (e: any) { error = e?.message ?? String(e); }
            const wallMs = Date.now() - t0;

            let judge: JudgeScores | null = null;
            let citationSpot: { verdicts: string[] } | null = null;
            if (report) {
                writeFileSync(join(OUT_DIR, `baseline-${id}.md`), report.markdown);
                try {
                    judge = parseJudgeJson<JudgeScores>(await judgeCall(buildJudgePrompt(q, report.markdown)));
                } catch (e: any) { console.warn(`judge failed for ${id}:`, e?.message); }
                try {
                    // Sample up to 10 cited sentences; resolve [n] ids → citation titles.
                    const cited = extractCitedSentences(report.markdown).slice(0, 10);
                    if (cited.length > 0) {
                        const byId = new Map(report.citations.map((c: any) => [String(c.id), c]));
                        const samples = cited.map((c: any) => ({
                            sentence: c.sentence,
                            sources: c.citationIds
                                .map((cid: string) => byId.get(cid.replace(/\D/g, '')))
                                .filter(Boolean)
                                .map((c: any) => ({ title: c.title, url: c.url })),
                        }));
                        citationSpot = parseJudgeJson(await judgeCall(buildCitationSpotPrompt(samples)));
                    }
                } catch (e: any) { console.warn(`citation spot failed for ${id}:`, e?.message); }
            }

            const m = report?.metadata;
            results.push({
                id, query: q, ok: !!report, error, wallMs,
                deterministic: report ? {
                    sources: m.sourcesAnalyzed,
                    words: report.markdown.split(/\s+/).length,
                    llmCalls: m.budget?.calls, estUsd: m.budget?.estimatedUsd,
                    rounds: m.methodology.rounds,
                    confidence: m.confidence,
                    citationDensity: m.citationDensity?.density ?? null,
                    numericGrounded: m.verification ? `${m.verification.groundedClaims}/${m.verification.totalClaims}` : null,
                    entailmentRate: m.entailment?.entailmentRate ?? null,
                    fanoutUsed: m.sectionFanout?.used ?? null,
                } : null,
                judge, citationSpot,
            });
            console.log(`EVAL ${id}: ok=${!!report} wall=${Math.round(wallMs / 1000)}s judge=${judge ? JSON.stringify({ c: judge.comprehensiveness, i: judge.insight, f: judge.instruction_following, r: judge.readability }) : 'n/a'}`);
        }

        const okRuns = results.filter(r => r.ok);
        const avg = (f: (r: any) => number | null) => {
            const v = okRuns.map(f).filter((x): x is number => typeof x === 'number');
            return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : null;
        };
        const summary = {
            ranAt: new Date().toISOString(), rubric: RUBRIC_VERSION, model: MODEL,
            judgeBiasNote: 'judge = same model family as writer; scores comparable across our runs only',
            citationSpotNote: 'v1 title-plausibility only; entailmentRate is the token-level source-text check',
            ok: okRuns.length, failed: results.length - okRuns.length,
            avgWallS: avg(r => Math.round(r.wallMs / 1000)),
            avgJudge: {
                comprehensiveness: avg(r => r.judge?.comprehensiveness ?? null),
                insight: avg(r => r.judge?.insight ?? null),
                instruction_following: avg(r => r.judge?.instruction_following ?? null),
                readability: avg(r => r.judge?.readability ?? null),
            },
            avgCitationDensity: avg(r => r.deterministic?.citationDensity ?? null),
            avgEntailment: avg(r => r.deterministic?.entailmentRate ?? null),
            totalEstUsd: +okRuns.reduce((a, r) => a + (r.deterministic?.estUsd ?? 0), 0).toFixed(3),
            runs: results,
        };
        writeFileSync(join(OUT_DIR, 'baseline.json'), JSON.stringify(summary, null, 2));
        console.log('BASELINE:', JSON.stringify({ ok: summary.ok, avgWallS: summary.avgWallS, judge: summary.avgJudge, entail: summary.avgEntailment, usd: summary.totalEstUsd }));
    }, 3_600_000);
});
