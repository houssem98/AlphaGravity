// Dexter Graph — the analyst layer.
// docs/AI_TRADING_AGENT_ROADMAP.md DX-8, regression row 13.
//
// Four analysts, each with its own evidence source, running in parallel. This
// is the TradingAgents shape (market / news / social / fundamentals feeding a
// debate) with one difference that matters here: each analyst gathers its
// evidence DETERMINISTICALLY first and spends exactly one LLM call turning it
// into a bounded report. No tool-calling loop per analyst — that would be four
// nested loops and an unbounded bill.
//
// Endpoints live-probed 2026-08-01 before being wired (doctrine rule 1):
//   /api/news?q=Bitcoin                → 10,399 bytes, Google News items
//   /api/social/influencers/BTC        → 15,053 bytes, posts with sentiment
//   /api/crypto klines + /api/history  → proven in DX-2
//   /api/quote + /api/fundamentals     → proven in DX-2
// Note the news route takes `q`, NOT `symbol`; `?symbol=` answers
// `{"error":"q required"}` with HTTP 400.

import { executeTool, normalizeBars, type AssetContext, type DexterCitation, type ToolDeps } from './dexterTools.js';
import { taLevels } from './taLevels.js';
import type { ChatMessage } from './dexterLlm.js';
import { newTrace, type CellStep } from './gridTrace.js';

export type AnalystId = 'market' | 'news' | 'social' | 'fundamentals';

export const ANALYST_ORDER: readonly AnalystId[] = ['market', 'news', 'social', 'fundamentals'];

export const ANALYST_TITLE: Record<AnalystId, string> = {
    market: 'Market',
    news: 'News',
    social: 'Social',
    fundamentals: 'Fundamentals',
};

// Each analyst owns a fixed block of citation ids by position, so parallel
// completion order can never shuffle the numbering: market 1-10, news 11-20,
// social 21-30, fundamentals 31-40.
export const CITE_BLOCK = 10;

export function citeBase(id: AnalystId): number {
    return ANALYST_ORDER.indexOf(id) * CITE_BLOCK + 1;
}

export interface AnalystReport {
    id: AnalystId;
    title: string;
    text: string;
    ok: boolean;
    error?: string;
    citations: DexterCitation[];
    /** DI-11: follow-up pulls actually spent, and the cap they were spent against. */
    iterations?: number;
    budget?: number;
    /** DI-11: true when a follow-up was asked for with no budget left. Never silent. */
    truncated?: boolean;
    truncationReason?: string;
    steps: CellStep[];
    ms: number;
}

export interface AnalystDeps {
    tools: ToolDeps;
    callLLM: (messages: ChatMessage[]) => Promise<{ text: string }>;
    now?: () => number;
    /** DI-11: extra evidence pulls an analyst may request. Defaults to ANALYST_ITERATION_BUDGET. */
    iterations?: number;
}

// DI-11 (row 15). The header above says "no tool-calling loop per analyst —
// that would be four nested loops and an unbounded bill", and that reasoning
// still holds: what is added here is a BOUNDED loop, not an open one. An analyst
// that finds a thread may pull it exactly `iterations` times, by naming one
// whitelisted tool call, and the cost is therefore capped at
// (1 + iterations) calls per analyst rather than however many the model fancies.
// A request made with no budget left is refused and RECORDED — the one thing
// that must never happen is a silent truncation.
export const ANALYST_ITERATION_BUDGET = 1;
export const FOLLOW_UP_PREFIX = 'FOLLOW-UP:';

/** Only deterministic evidence tools, and only ones already proven in DX-2. */
export const FOLLOW_UP_TOOLS = ['getChartData', 'getQuote', 'getFundamentalData'] as const;
export type FollowUpTool = typeof FOLLOW_UP_TOOLS[number];

export interface FollowUpRequest {
    tool: FollowUpTool;
    args: Record<string, unknown>;
}

/** Parses `FOLLOW-UP: getChartData days=365`. Anything else is not a request. */
export function parseFollowUp(text: string): FollowUpRequest | null {
    const m = text.match(/FOLLOW-UP:\s*(\w+)([^\n]*)/i);
    if (!m) return null;
    const tool = FOLLOW_UP_TOOLS.find(t => t.toLowerCase() === m[1].toLowerCase());
    if (!tool) return null;
    const args: Record<string, unknown> = {};
    for (const pair of m[2].matchAll(/(\w+)\s*=\s*("[^"]*"|\S+)/g)) {
        const raw = pair[2].replace(/^"|"$/g, '');
        args[pair[1]] = Number.isFinite(Number(raw)) && raw.trim() !== '' ? Number(raw) : raw;
    }
    return { tool, args };
}

// Keeps one analyst's report from crowding out the other three in the
// synthesis prompt.
export const REPORT_MAX_CHARS = 1800;

function clip(text: string, max = REPORT_MAX_CHARS): string {
    return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

// ── Evidence gathering: deterministic, one shape per analyst ────────────────

interface Evidence {
    citations: DexterCitation[];
    prompt: string;          // the evidence, rendered for the model
}

async function marketEvidence(ctx: AssetContext, deps: ToolDeps): Promise<Evidence> {
    const base = citeBase('market');
    const out = await executeTool('getChartData', { days: 120 }, ctx, deps);
    const bars = normalizeBars(out.data);
    if (bars.length === 0) throw new Error('no price bars available for this symbol');

    const ta = taLevels(bars);
    const last = bars[bars.length - 1];
    const lines = [
        `Bars: ${ta.bars} daily, latest ${last.date} close ${ta.lastClose}`,
        `ATR(14): ${ta.atr ?? 'n/a'}   Structural trend: ${ta.trend}`,
        `Support: ${ta.support.map(l => `${l.price} (${l.touches} touch${l.touches === 1 ? '' : 'es'})`).join(', ') || 'none'}`,
        `Resistance: ${ta.resistance.map(l => `${l.price} (${l.touches} touch${l.touches === 1 ? '' : 'es'})`).join(', ') || 'none'}`,
        `Fair-value gaps: ${ta.fairValueGaps.length}   Order blocks: ${ta.orderBlocks.length}`,
        ta.fib ? `Fib leg: ${ta.fib.low} → ${ta.fib.high} (${ta.fib.direction})` : 'Fib leg: none',
    ];
    return {
        citations: [{
            id: base,
            title: `${ctx.symbol} price structure (deterministic TA over ${ta.bars} bars)`,
            source: 'taLevels',
            text: `close ${ta.lastClose}, ATR ${ta.atr ?? 'n/a'}, trend ${ta.trend}`,
        }],
        prompt: `[${base}] Computed price structure — every number here came from the bars, not from a model:\n${lines.join('\n')}`,
    };
}

async function newsEvidence(ctx: AssetContext, deps: ToolDeps): Promise<Evidence> {
    const base = citeBase('news');
    // The route takes a search term, not a ticker.
    const q = encodeURIComponent(ctx.name || ctx.symbol);
    const json = await deps.getJson(`/api/news?q=${q}`);
    const items = (json?.items ?? []).slice(0, 8);
    if (items.length === 0) throw new Error(`no news items returned for "${ctx.name || ctx.symbol}"`);

    const citations: DexterCitation[] = items.map((it: any, i: number) => ({
        id: base + i,
        title: String(it.title ?? 'untitled'),
        source: String(it.source ?? 'news'),
        text: `${it.source ?? ''} — ${it.time ?? ''}`.trim(),
    }));
    const rendered = items.map((it: any, i: number) =>
        `[${base + i}] ${it.title} — ${it.source ?? 'unknown'}, ${it.time ?? 'undated'}`).join('\n');
    return { citations, prompt: `Recent headlines:\n${rendered}` };
}

async function socialEvidence(ctx: AssetContext, deps: ToolDeps): Promise<Evidence> {
    const base = citeBase('social');
    const json = await deps.getJson(`/api/social/influencers/${encodeURIComponent(ctx.symbol)}`);
    const posts = (json?.posts ?? []).slice(0, 8);
    if (posts.length === 0) throw new Error(`no social posts returned for ${ctx.symbol}`);

    const citations: DexterCitation[] = posts.map((p: any, i: number) => ({
        id: base + i,
        title: `@${p.handle ?? 'unknown'} (${p.followers ?? 0} followers)`,
        source: 'social',
        text: `${p.sentiment ?? 'unknown'} — ${p.views ?? 0} views, ${p.postedAt ?? ''}`.trim(),
    }));
    const rendered = posts.map((p: any, i: number) =>
        `[${base + i}] @${p.handle} (${p.followers} followers, ${p.tier ?? '?'}): "${String(p.tweet ?? '').slice(0, 160).replace(/\s+/g, ' ')}" — sentiment ${p.sentiment} (${p.sentimentModel ?? '?'}), ${p.views ?? 0} views`
    ).join('\n');
    return { citations, prompt: `Recent influencer posts:\n${rendered}` };
}

async function fundamentalsEvidence(ctx: AssetContext, deps: ToolDeps): Promise<Evidence> {
    const base = citeBase('fundamentals');
    const out = await executeTool('getFundamentalData', {}, ctx, deps);
    const data = out.data as any;
    if (data?.error) throw new Error(String(data.error));

    const citations: DexterCitation[] = [{
        id: base,
        title: `${ctx.symbol} fundamentals`,
        source: 'getFundamentalData',
        text: `${Object.keys(data ?? {}).length} fields`,
    }];
    return {
        citations,
        prompt: `[${base}] Fundamental data:\n${clip(JSON.stringify(data), 2500)}`,
    };
}

const GATHER: Record<AnalystId, (ctx: AssetContext, deps: ToolDeps) => Promise<Evidence>> = {
    market: marketEvidence,
    news: newsEvidence,
    social: socialEvidence,
    fundamentals: fundamentalsEvidence,
};

const BRIEF: Record<AnalystId, string> = {
    market: 'You are the market analyst. Describe trend, structure and the levels that matter next. The levels below were computed from the bars — quote them exactly, never round them.',
    news: 'You are the news analyst. Summarise what the coverage actually says and what it implies for the next few sessions. Distinguish reporting from speculation.',
    social: 'You are the social analyst. Summarise the retail mood, and say plainly when it looks like hype rather than information — follower counts and view counts are reach, not evidence.',
    fundamentals: 'You are the fundamentals analyst. Summarise valuation and financial health from the data given. Say which fields are missing rather than estimating them.',
};

export function analystPrompt(id: AnalystId, ctx: AssetContext, evidence: string): ChatMessage[] {
    return [
        {
            role: 'system',
            content:
                `${BRIEF[id]}\n\nAsset: ${ctx.symbol}${ctx.name ? ` (${ctx.name})` : ''}` +
                `${ctx.isTN ? ', listed on the Bourse de Tunis, quoted in TND' : ''}.\n` +
                `Write at most 150 words. Cite every figure with its [N] marker. State only what the ` +
                `evidence below supports — if it does not cover something, say so instead of filling ` +
                `the gap.`,
        },
        { role: 'user', content: evidence },
    ];
}

// Crypto has no income statement; asking for one produces an apology, not a
// report. Skipping it is honest, and cheaper than an LLM call that says "n/a".
export function analystsFor(ctx: AssetContext): AnalystId[] {
    return ANALYST_ORDER.filter(id => !(id === 'fundamentals' && ctx.isCrypto));
}

async function runOne(id: AnalystId, ctx: AssetContext, deps: AnalystDeps): Promise<AnalystReport> {
    const now = deps.now ?? Date.now;
    const t0 = now();
    const trace = newTrace(now);
    const base = { id, title: ANALYST_TITLE[id], ms: 0 };

    const budget = Math.max(0, deps.iterations ?? ANALYST_ITERATION_BUDGET);

    try {
        const evidence = await trace.step(`${ANALYST_TITLE[id]}: gathering`, id, () => GATHER[id](ctx, deps.tools));
        let prompt = evidence.prompt;
        const citations = [...evidence.citations];
        let reply = await trace.step(`${ANALYST_TITLE[id]}: writing`, 'llm',
            () => deps.callLLM(analystPrompt(id, ctx, prompt)));

        let iterations = 0;
        let truncated = false;
        let truncationReason: string | undefined;

        // Bounded: at most `budget` extra pulls, and the refusal is recorded.
        for (;;) {
            const ask = parseFollowUp(reply.text);
            if (!ask) break;
            if (iterations >= budget) {
                truncated = true;
                truncationReason =
                    `${ANALYST_TITLE[id]} asked for ${ask.tool} after spending its ${budget} follow-up ` +
                    `pull(s); the request was refused and the report is written on the evidence it already had`;
                break;
            }
            iterations++;
            const followed = await trace.step(
                `${ANALYST_TITLE[id]}: follow-up ${iterations}/${budget} (${ask.tool})`, id,
                () => executeTool(ask.tool, ask.args, ctx, deps.tools),
            );
            const cite = citeBase(id) + citations.length;
            citations.push({
                id: cite,
                title: `${ctx.symbol} follow-up: ${ask.tool}(${JSON.stringify(ask.args)})`,
                source: ask.tool,
                text: JSON.stringify(followed.data).slice(0, 300),
            });
            prompt = `${prompt}\n\n[${cite}] Follow-up you requested — ${ask.tool}(${JSON.stringify(ask.args)}):\n` +
                `${JSON.stringify(followed.data).slice(0, 1200)}`;
            reply = await trace.step(`${ANALYST_TITLE[id]}: rewriting after follow-up ${iterations}`, 'llm',
                () => deps.callLLM(analystPrompt(id, ctx, prompt)));
        }

        return {
            ...base,
            ok: true,
            text: clip(truncated ? `${reply.text}\n\n(${truncationReason})` : reply.text),
            citations,
            iterations,
            budget,
            truncated,
            truncationReason,
            steps: trace.done(),
            ms: now() - t0,
        };
    } catch (e) {
        // Row 13: a dead analyst reports that it is dead. It does not take the
        // other three with it, and it does not get to invent a section.
        const error = (e as Error).message;
        return {
            ...base,
            ok: false,
            error,
            text: `No ${ANALYST_TITLE[id].toLowerCase()} read available: ${error}`,
            citations: [],
            steps: trace.done(),
            ms: now() - t0,
        };
    }
}

// All analysts in parallel. Settled, never raced: the slowest one sets the wall
// time and a rejected one is already converted to an honest report by runOne.
export async function runAnalysts(
    ctx: AssetContext,
    deps: AnalystDeps,
    ids: AnalystId[] = analystsFor(ctx),
): Promise<AnalystReport[]> {
    return Promise.all(ids.map(id => runOne(id, ctx, deps)));
}

// The four reports, rendered for whatever consumes them next — the debate in
// DX-9, or the answer directly until then.
export function renderReports(reports: AnalystReport[]): string {
    return reports
        .map(r => `### ${r.title} analyst${r.ok ? '' : ' (unavailable)'}\n${r.text}`)
        .join('\n\n');
}

export function allCitations(reports: AnalystReport[]): DexterCitation[] {
    return reports.flatMap(r => r.citations).sort((a, b) => a.id - b.id);
}
