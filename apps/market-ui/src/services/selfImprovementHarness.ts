// Self-improving deep research harness.
// Runs performDeepResearch in a loop, judge-scores each iteration, re-runs with feedback until passing or max iterations.
// Used by: npm run eval:loop, LOOP_SELF_IMPROVE.sh

import { buildJudgePrompt, buildCitationSpotPrompt, parseJudgeJson, type JudgeScores } from '../../eval/rubric';
import type { ResearchModelId } from './deepResearchService';

const API = process.env.VITE_API_URL || 'http://localhost:3002';

export interface IterationResult {
    iteration: number;
    ok: boolean;
    wallMs: number;
    report?: { markdown: string; citations: any[] };
    judge?: JudgeScores;
    citationSpot?: { verdicts: string[] };
    feedback?: string;
}

export interface LoopResult {
    query: string;
    model: ResearchModelId;
    iterations: IterationResult[];
    winner?: IterationResult; // highest avg judge score
    summary: {
        passedOnIter?: number;
        bestAvgScore?: number;
        reason: string;
        totalWallMs: number;
        totalCost: number;
    };
}

// ─── Pre-render quality gate (REPORT_QA_SPEC Section 3 integration) ─────────
// Runs AFTER performDeepResearch, BEFORE the report reaches the user/PDF.
// Judge-scores the produced report as iteration 1; below the bar → re-run
// with feedback up to maxIter, ship the winner. Never passed → confidence
// drops to Low (spec loop-termination rule). Off unless VITE_DR_QUALITY_LOOP
// is true — each extra iteration costs a full pipeline run (~$0.10).

export interface QualityLoopOptions {
    enabled?: boolean;    // default: import.meta.env.VITE_DR_QUALITY_LOOP === 'true'
    maxIter?: number;     // default: VITE_DR_QUALITY_LOOP_MAX_ITER or 2
    minScore?: number;    // default: VITE_DR_QUALITY_LOOP_MIN_SCORE or 7
}

export async function maybeRunQualityLoop<T extends { markdown: string; citations: any[]; metadata: any }>(
    report: T,
    query: string,
    model: ResearchModelId,
    options: QualityLoopOptions = {},
): Promise<T> {
    const env = (import.meta as any)?.env ?? {};
    const enabled = options.enabled ?? env.VITE_DR_QUALITY_LOOP === 'true';
    if (!enabled) return report;

    const maxIter = options.maxIter ?? (parseInt(env.VITE_DR_QUALITY_LOOP_MAX_ITER, 10) || 2);
    const minScoreThreshold = options.minScore ?? (parseFloat(env.VITE_DR_QUALITY_LOOP_MIN_SCORE) || 7);

    const loop = await runSelfImprovementHarness(query, model, {
        maxIter,
        minScore: minScoreThreshold,
        initialReport: report,
    });

    const winner = (loop.winner?.report as T | undefined) ?? report;
    winner.metadata = {
        ...winner.metadata,
        qualityLoop: {
            ran: true,
            iterations: loop.iterations.length,
            passedOnIter: loop.summary.passedOnIter,
            bestAvgScore: loop.summary.bestAvgScore,
        },
        // Spec Section 3: exhausted without a pass → ship at Low confidence.
        confidence: loop.summary.passedOnIter ? winner.metadata.confidence : 'Low',
    };
    return winner;
}

// Shared DeepSeek chat call (market-server proxy) — also used by pdfDesigner.
export async function llmChat(prompt: string): Promise<string> {
    return judgeCall(prompt);
}

async function judgeCall(prompt: string): Promise<string> {
    const res = await fetch(`${API}/api/llm/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'deepseek', model: 'deepseek-chat', prompt, max_tokens: 2000 }),
    });
    if (!res.ok) throw new Error(`judge call failed: HTTP ${res.status}`);
    return (await res.json()).text ?? '';
}

function avgScore(judge: JudgeScores | undefined): number {
    if (!judge) return 0;
    const vals = [judge.comprehensiveness, judge.insight, judge.instruction_following, judge.readability];
    return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function minScore(judge: JudgeScores | undefined): number {
    if (!judge) return 0;
    const vals = [judge.comprehensiveness, judge.insight, judge.instruction_following, judge.readability];
    return Math.min(...vals);
}

function buildFeedbackMessage(prev: IterationResult[]): string {
    const feedbacks: string[] = [];
    for (let i = 0; i < prev.length; i++) {
        const iter = prev[i];
        if (iter.judge) {
            const min = minScore(iter.judge);
            const rationale = iter.judge.rationale || {};
            feedbacks.push(
                `Iteration ${i + 1} (avg=${avgScore(iter.judge).toFixed(2)}, min=${min.toFixed(1)}):`,
                `  - ${rationale.comprehensiveness || ''}`,
                `  - ${rationale.insight || ''}`,
                `  - ${rationale.instruction_following || ''}`,
                `  - ${rationale.readability || ''}`,
            );
        }
        if (iter.citationSpot?.verdicts) {
            const dubious = iter.citationSpot.verdicts.filter(v => v === 'dubious').length;
            if (dubious > 0) {
                feedbacks.push(`  ⚠ ${dubious} dubious citations detected — prioritize peer-reviewed and institutional sources.`);
            }
        }
    }
    return feedbacks.join('\n');
}

export async function runSelfImprovementHarness(
    query: string,
    model: ResearchModelId,
    options: { maxIter?: number; minScore?: number; initialReport?: { markdown: string; citations: any[] } } = {},
): Promise<LoopResult> {
    const { maxIter = 3, minScore: minScoreThreshold = 7.0, initialReport } = options;
    const iterations: IterationResult[] = [];
    let passedOnIter: number | undefined;

    for (let iter = 1; iter <= maxIter; iter++) {
        const t0 = Date.now();
        const iterQuery = iter === 1 ? query : `${query}\n\n--- FEEDBACK FROM PRIOR ITERATIONS ---\n${buildFeedbackMessage(iterations)}`;

        let report: any = null, error: string | null = null;
        if (iter === 1 && initialReport) {
            // Pre-render integration: the pipeline already produced this
            // report — judge it as iteration 1 instead of regenerating.
            report = initialReport;
        } else {
            try {
                // Import late to avoid circular deps.
                const { performDeepResearch } = await import('./deepResearchService');
                report = await performDeepResearch(iterQuery, () => {}, model);
            } catch (e: any) {
                error = e?.message ?? String(e);
            }
        }

        const wallMs = Date.now() - t0;

        let judge: JudgeScores | null = null, citationSpot: { verdicts: string[] } | null = null;
        if (report) {
            try {
                judge = parseJudgeJson<JudgeScores>(await judgeCall(buildJudgePrompt(query, report.markdown)));
            } catch (e: any) {
                console.warn(`judge failed iter ${iter}:`, e?.message);
            }
            try {
                const cited = (await import('./deepResearchService')).extractCitedSentences(report.markdown).slice(0, 10);
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
            } catch (e: any) {
                console.warn(`citation spot failed iter ${iter}:`, e?.message);
            }
        }

        const iterResult: IterationResult = { iteration: iter, ok: !!report, wallMs, report, judge, citationSpot };
        iterations.push(iterResult);

        const min = minScore(judge);
        const avg = avgScore(judge);
        console.log(`LOOP iter ${iter}/${maxIter}: ok=${!!report} wall=${Math.round(wallMs / 1000)}s judge=[c:${judge?.comprehensiveness || 'n/a'} i:${judge?.insight || 'n/a'} f:${judge?.instruction_following || 'n/a'} r:${judge?.readability || 'n/a'}] avg=${avg.toFixed(2)} min=${min.toFixed(1)}`);

        // Check pass condition.
        if (judge && min >= minScoreThreshold) {
            console.log(`✅ PASSED on iteration ${iter} (min=${min.toFixed(1)} >= ${minScoreThreshold})`);
            passedOnIter = iter;
            break;
        }
    }

    // Pick winner (highest avg score).
    let winner: IterationResult | undefined;
    let bestAvgScore = 0;
    for (const it of iterations) {
        const avg = avgScore(it.judge);
        if (avg > bestAvgScore) {
            bestAvgScore = avg;
            winner = it;
        }
    }

    const totalWallMs = iterations.reduce((a, it) => a + it.wallMs, 0);
    const costPerRun = 0.08; // ~$0.08 per performDeepResearch + ~$0.02 judge
    const totalCost = iterations.filter(it => it.ok).length * (costPerRun + 0.02);

    const result: LoopResult = {
        query,
        model,
        iterations,
        winner,
        summary: {
            passedOnIter,
            bestAvgScore: bestAvgScore > 0 ? bestAvgScore : undefined,
            reason: passedOnIter ? `Passed on iteration ${passedOnIter}` : `Exhausted max ${maxIter} iterations; best score ${bestAvgScore.toFixed(2)}`,
            totalWallMs,
            totalCost: +totalCost.toFixed(3),
        },
    };

    return result;
}
