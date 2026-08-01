// Dexter tools — the agent's tool belt, executed server-side.
// docs/AI_TRADING_AGENT_ROADMAP.md DX-2, regression rows 4 and 6.
//
// DX-1 fixed WHO calls the model; this fixes WHERE the tools run. The four tool
// bodies used to live inside Assistant.tsx and fetch from the browser, so every
// tool result made a round trip out to the client and back before the model
// could read it. They now run next to the model in api/agent/[fn].ts, one
// same-origin hop from the endpoints that already serve them.
//
// One tool cannot move: drawTechnicalAnalysis paints on the user's chart. It is
// returned as a CLIENT ACTION instead — the server tells the model the drawing
// was dispatched and hands the instruction back in the response for the browser
// to apply. Nothing about a drawing is invented here; DX-5 will gate the levels
// against the deterministic TA engine.

// The .js extension is load-bearing: this module is reachable from
// api/agent/[fn].ts, and the Vercel Node ESM runtime will not resolve a
// extensionless relative import (it 500s with FUNCTION_INVOCATION_FAILED).
// Same reason gridTrust.ts imports './gridResearch.js'.
import {
    taLevels, candidateLevels, levelTolerance, nearestCandidate,
    type Bar, type TaLevels,
} from './taLevels.js';

export interface AssetContext {
    symbol: string;
    isTN: boolean;
    isCrypto: boolean;
    name?: string;
    price?: number | null;
}

export interface ClientAction {
    type: string;                          // support_resistance | order_block | fibonacci | pattern
    args: Record<string, unknown>;
}

// What POST /api/agent/chat returns. The server owns this contract because the
// server now owns the loop.
// DX-6: one citation per successful tool snapshot. The model is told the id
// while it reads the result, so it can cite [N] as it writes rather than having
// a source list stapled on afterwards.
export interface DexterCitation {
    id: number;
    title: string;      // "BTC price history (binance)"
    source: string;     // tool name
    text: string;       // the snapshot the figure must have come from
}

export interface AgentReply {
    text: string;
    actions: ClientAction[];
    steps: import('./gridTrace').CellStep[];   // DX-3: what actually ran
    citations: DexterCitation[];               // DX-6: what the figures rest on
    fabricatedCites: number[];                 // [N] markers with no such source
    uncitedFigures: string[];                  // numbers with no source nearby
    provider: string;
    model: string;
    ms: number;
}

export interface ToolOutcome {
    data: unknown;                         // what the model reads back
    action?: ClientAction;                 // what the browser must apply
}

// JSON Schema, the shape every OpenAI-compatible provider expects. Kept here
// rather than in the component so the server owns both the contract and the
// execution — the model can no longer be offered a tool nothing implements.
export const TOOL_DEFS = [
    {
        name: 'drawTechnicalAnalysis',
        description:
            'Draw technical analysis indicators on the chart. Every price you pass is verified ' +
            'against levels computed from the actual bars (swing pivots, support/resistance ' +
            'clusters, order blocks, fair-value gaps, fibonacci). A price further than half an ' +
            'ATR from a real level is refused and nothing is drawn, so call getChartData first ' +
            'and choose levels the data supports rather than estimating round numbers.',
        parameters: {
            type: 'object',
            properties: {
                type: {
                    type: 'string',
                    description: 'The type of drawing: "support_resistance", "order_block", "fibonacci", or "pattern".',
                },
                levels: {
                    type: 'array',
                    items: { type: 'number' },
                    description: 'The price levels to draw. For support/resistance, provide an array of prices. For order blocks, provide [top, bottom]. For fibonacci, provide [high, low].',
                },
                points: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            time: { type: 'string', description: 'Date string (YYYY-MM-DD)' },
                            price: { type: 'number', description: 'Price level' },
                            label: { type: 'string', description: 'Label for the point (e.g., "Left Shoulder", "Head", "Top 1")' },
                        },
                    },
                    description: 'Points to draw for patterns like head and shoulders, double top, etc.',
                },
                reasoning: {
                    type: 'string',
                    description: 'Brief explanation of why these levels or patterns were chosen.',
                },
            },
            required: ['type', 'reasoning'],
        },
    },
    {
        name: 'getChartData',
        description: 'Get the recent OHLCV data for the current asset to analyze patterns and trends.',
        parameters: {
            type: 'object',
            properties: {
                days: { type: 'number', description: 'Number of recent days of data to retrieve (max 365).' },
            },
            required: ['days'],
        },
    },
    {
        name: 'getFundamentalData',
        description: 'Get fundamental data for the current asset (market cap, P/E ratio, revenue, etc.).',
        parameters: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'getFinancialStatements',
        description: 'Get detailed financial statements (income statement, balance sheet, cash flow) for the current asset.',
        parameters: { type: 'object', properties: {}, required: [] },
    },
] as const;

export const TOOL_NAMES: readonly string[] = TOOL_DEFS.map(t => t.name);

// Injected so tests never touch the network and the caller decides the origin
// (`https://<deployment-host>` on Vercel, the dev server locally). `getBars` is
// the memoised daily series the draw gate checks against — the handler shares
// one fetch across every tool call in a run.
export interface ToolDeps {
    getJson: (url: string) => Promise<any>;
    getBars?: () => Promise<Bar[]>;
}

// chartData answers in three shapes (array for equities and crypto, an object
// with dailyBars for BVMT). The gate needs one.
export function normalizeBars(data: unknown): Bar[] {
    const rows = Array.isArray(data)
        ? data
        : (data && typeof data === 'object' && Array.isArray((data as any).dailyBars))
            ? (data as any).dailyBars
            : [];
    return rows.filter((b: any) =>
        b && Number.isFinite(b.open) && Number.isFinite(b.high) &&
        Number.isFinite(b.low) && Number.isFinite(b.close));
}

export interface DrawGate {
    ok: boolean;
    args?: Record<string, unknown>;   // snapped to the engine's own prices
    reason?: string;
    snapped?: Array<{ asked: number; drawn: number }>;
}

function proposedPrices(args: Record<string, unknown>): number[] {
    const levels = Array.isArray(args.levels) ? args.levels.filter((n: unknown) => Number.isFinite(n)) as number[] : [];
    const points = Array.isArray(args.points)
        ? (args.points as any[]).map(p => p?.price).filter((n: unknown) => Number.isFinite(n)) as number[]
        : [];
    return [...levels, ...points];
}

// DX-5: the model may SELECT a level and explain it; it may not INVENT one.
// Anything further than half an ATR from a price the engine actually computed
// is refused and the chart is left alone. Anything that passes is snapped to the
// engine's exact price, so the line on the chart is the real level rather than
// the model's rounding of it.
export function gateDrawing(args: Record<string, unknown>, ta: TaLevels): DrawGate {
    const proposed = proposedPrices(args);
    if (proposed.length === 0) {
        // Nothing numeric to verify (e.g. a pure annotation) — nothing to fake.
        return { ok: true, args };
    }

    const candidates = candidateLevels(ta);
    if (candidates.length === 0) {
        return {
            ok: false,
            reason: ta.bars === 0
                ? 'No price bars available, so no level can be verified. Call getChartData first.'
                : `Only ${ta.bars} bars available — not enough structure to verify a level against.`,
        };
    }

    const tolerance = levelTolerance(ta);
    const snapped: Array<{ asked: number; drawn: number }> = [];
    const rejected: Array<{ asked: number; nearest: number }> = [];

    for (const price of proposed) {
        const nearest = nearestCandidate(price, candidates)!;
        if (Math.abs(nearest - price) <= tolerance) snapped.push({ asked: price, drawn: nearest });
        else rejected.push({ asked: price, nearest });
    }

    if (rejected.length > 0) {
        const detail = rejected
            .map(r => `${r.asked} (nearest real level ${r.nearest})`)
            .join(', ');
        return {
            ok: false,
            reason:
                `Refused: ${detail}. Levels must come from the price data, not from estimation — ` +
                `nothing was drawn. Real levels available: ${candidates.join(', ')}.`,
        };
    }

    // Rewrite the args with the engine's prices, in the order they were asked.
    const map = new Map(snapped.map(s => [s.asked, s.drawn]));
    const out: Record<string, unknown> = { ...args };
    if (Array.isArray(args.levels)) {
        out.levels = (args.levels as number[]).map(n => map.get(n) ?? n);
    }
    if (Array.isArray(args.points)) {
        out.points = (args.points as any[]).map(p =>
            Number.isFinite(p?.price) ? { ...p, price: map.get(p.price) ?? p.price } : p);
    }
    return { ok: true, args: out, snapped };
}

const BINANCE_KLINES = 'https://api.binance.com/api/v3/klines';

// Yahoo's chart endpoint takes a range, not a bar count.
export function yahooRange(days: number): string {
    if (days > 252) return '2y';
    if (days > 100) return '1y';
    return '3mo';
}

async function chartData(days: number, ctx: AssetContext, deps: ToolDeps): Promise<unknown> {
    const limit = Math.min(Math.max(1, days || 30), 365);

    if (ctx.isTN) {
        // BVMT: daily bars from our snapshot store + today's intraday candles.
        const [hist, intra] = await Promise.all([
            deps.getJson(`/api/tn/history?symbol=${ctx.symbol}`).catch(() => ({})),
            deps.getJson(`/api/tn/intraday?symbol=${ctx.symbol}&interval=15`).catch(() => ({})),
        ]);
        const daily = (hist.candles || []).map((c: any) => ({
            date: new Date(c.time * 1000).toISOString().split('T')[0],
            open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
        }));
        return {
            currency: 'TND',
            dailyBars: daily.slice(-limit),
            dailyBarsNote: `daily history accumulates from 2026-07-02 onward (${daily.length} bars so far)`,
            todayIntraday15m: intra.candles || [],
            prevClose: intra.prevClose,
            last: intra.last,
        };
    }

    if (ctx.isCrypto) {
        const raw = await deps.getJson(`${BINANCE_KLINES}?symbol=${ctx.symbol}USDT&interval=1d&limit=${limit}`);
        if (!Array.isArray(raw)) return { error: 'Binance returned no klines for this symbol.' };
        return raw.map((d: any) => ({
            date: new Date(d[0]).toISOString().split('T')[0],
            open: parseFloat(d[1]), high: parseFloat(d[2]), low: parseFloat(d[3]),
            close: parseFloat(d[4]), volume: parseFloat(d[5]),
        }));
    }

    const json = await deps.getJson(`/api/history?symbol=${ctx.symbol}&interval=1d&range=${yahooRange(limit)}`);
    const result = json?.chart?.result?.[0];
    if (!result) return { error: 'No price history available for this symbol.' };

    const { timestamp = [], indicators } = result;
    const quote = indicators?.quote?.[0] ?? {};
    const bars: unknown[] = [];
    for (let i = Math.max(0, timestamp.length - limit); i < timestamp.length; i++) {
        if (quote.close?.[i] == null) continue;
        bars.push({
            date: new Date(timestamp[i] * 1000).toISOString().split('T')[0],
            open: quote.open[i], high: quote.high[i], low: quote.low[i],
            close: quote.close[i], volume: quote.volume?.[i] || 0,
        });
    }
    return bars;
}

async function fundamentalData(ctx: AssetContext, deps: ToolDeps): Promise<unknown> {
    if (ctx.isTN) {
        try {
            const [mkts, eng] = await Promise.all([
                deps.getJson('/api/tn/markets'),
                deps.getJson(`/api/tn/engine?symbol=${ctx.symbol}`).catch(() => null),
            ]);
            const row = (mkts.rows || []).find((r: any) => r.symbol === ctx.symbol);
            return row
                ? {
                    ...row, currency: 'TND',
                    engineScore: eng?.score, engineFactors: eng?.factors,
                    note: 'P/E, EPS and dividend data not yet available for BVMT listings — live market stats + Engine score only.',
                }
                : { error: 'Symbol not found on the BVMT board.' };
        } catch {
            return { error: 'BVMT feed unreachable.' };
        }
    }

    const symbol = ctx.isCrypto ? `${ctx.symbol}-USD` : ctx.symbol;
    let data: Record<string, unknown> = {};
    const quote = await deps.getJson(`/api/quote?symbols=${symbol}`).catch(() => null);
    const quoted = quote?.quoteResponse?.result?.[0];
    if (quoted) data = { ...quoted };

    const fund = await deps.getJson(`/api/fundamentals?symbol=${symbol}`).catch(() => null);
    const summary = fund?.quoteSummary?.result?.[0];
    if (summary) data = { ...data, ...summary };

    return Object.keys(data).length > 0 ? data : { error: 'Fundamental data not available for this asset.' };
}

async function financialStatements(ctx: AssetContext, deps: ToolDeps): Promise<unknown> {
    if (ctx.isTN) {
        return { error: 'Financial statements are not available yet for BVMT listings. Point the user to the official fiche-valeur on bvmt.com.tn for filings.' };
    }
    if (ctx.isCrypto) {
        return { error: 'Financial statements are not applicable for cryptocurrencies.' };
    }
    const json = await deps.getJson(`/api/financials?symbol=${ctx.symbol}`).catch(() => null);
    const fin = json?.quoteSummary?.result?.[0];
    return fin ?? { error: 'Financial statements not available for this asset.' };
}

// DX-3: a throwing tool propagates. The trace needs the real failure to record
// `status:'failed'` with the real error (gridTrace re-throws by contract), and
// the caller turns it into an honest message for the model. Swallowing it here
// would make every step look like it succeeded.
export async function executeTool(
    name: string,
    args: Record<string, unknown>,
    ctx: AssetContext,
    deps: ToolDeps,
): Promise<ToolOutcome> {
    switch (name) {
        case 'getChartData':
            return { data: await chartData(Number(args.days) || 30, ctx, deps) };
        case 'getFundamentalData':
            return { data: await fundamentalData(ctx, deps) };
        case 'getFinancialStatements':
            return { data: await financialStatements(ctx, deps) };
        case 'drawTechnicalAnalysis': {
            // DX-5: verified against the deterministic engine before it can
            // touch the chart. A refusal is not a failure — it is the gate
            // doing its job, and the model can retry with a real level.
            const bars = deps.getBars ? await deps.getBars() : [];
            const gate = gateDrawing(args, taLevels(bars));
            if (!gate.ok) return { data: { error: gate.reason } };
            const drawn = gate.args!;
            const note = gate.snapped?.some(s => s.asked !== s.drawn)
                ? ` Snapped to the engine's own prices: ${gate.snapped.filter(s => s.asked !== s.drawn).map(s => `${s.asked}→${s.drawn}`).join(', ')}.`
                : '';
            return {
                data: `Drawing dispatched to the chart: ${args.type}.${note}`,
                action: { type: String(args.type ?? ''), args: drawn },
            };
        }
        default:
            return { data: { error: `Unknown tool: ${name}` } };
    }
}

// gridTrace's third status: the call ran fine but carried nothing useful. A feed
// that answers "no data for this symbol" is not a failure, and grading it as one
// would make a working pipeline look broken.
export function isEmptyToolData(data: unknown): boolean {
    if (data == null) return true;
    if (Array.isArray(data)) return data.length === 0;
    if (typeof data === 'object') {
        const keys = Object.keys(data as object);
        if (keys.length === 0) return true;
        if ('error' in (data as object)) return true;
        if ('dailyBars' in (data as any)) {
            const d = data as any;
            return (d.dailyBars?.length ?? 0) === 0 && (d.todayIntraday15m?.length ?? 0) === 0;
        }
    }
    return false;
}

// Short human note for the trace row — never the payload, never an adjective.
export function toolMeta(name: string, data: unknown): string {
    if (data && typeof data === 'object' && 'error' in (data as object)) {
        return String((data as any).error);
    }
    if (Array.isArray(data)) return `${data.length} bars`;
    if (name === 'getChartData' && data && typeof data === 'object') {
        const d = data as any;
        return `${d.dailyBars?.length ?? 0} daily bars, ${d.todayIntraday15m?.length ?? 0} intraday`;
    }
    if (data && typeof data === 'object') return `${Object.keys(data as object).length} fields`;
    return String(data ?? '');
}

// ── DX-6: evidence ─────────────────────────────────────────────────────────
// A figure in a trading answer is either traceable to a feed or it is a guess.
// These two helpers are what tell those apart, reusing the grid's own
// definition of "a figure" so both products agree on what counts.

// A citation covers the sentence it closes, which is how people actually write:
// "the high was $66,556.16 and the low was $58,624.71 [1]." cites both. The
// first prod probe used a fixed character window instead and flagged the high
// as uncited — a warning that fires on a correct answer is a false signal, not
// a safety net, so the scope is the sentence.
// A period between two digits is a decimal point, not the end of a sentence —
// without this, the scan stopped inside "$58,624.71" and reported the figure
// before it as uncited.
function isSentenceEnd(text: string, i: number): boolean {
    const ch = text[i];
    if (ch === '\n' || ch === '!' || ch === '?') return true;
    if (ch !== '.') return false;
    return !(/\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? ''));
}

// Only market figures count. A bare small integer is nearly always a count
// ("60 days", "3 touches") or a year, and demanding a source for those buries
// the one number that actually needed one.
export function isMarketFigure(raw: string): boolean {
    return /[$%]/.test(raw)
        || /(?:bn|billion|trillion|million|[mbk])$/i.test(raw)
        || /[.,]/.test(raw);
}

// Month names, so "July 21" and "August 1, 2026" read as dates, not as figures.
const MONTH_BEFORE = /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+$/i;

// Figures that appear in the prose with no citation anywhere in their sentence.
// These are exactly the numbers a reader cannot check.
export function uncitedFigures(text: string): string[] {
    if (!text) return [];
    const out = new Set<string>();
    // Same figure shapes as the grid's extractFigures, minus the trailing `\b`
    // that silently drops the "%" off "12%".
    const re = /\$?\d[\d,]*(?:\.\d+)?\s?(?:%|bn|billion|trillion|million|[mbk])?(?![\w%])/gi;

    for (const m of text.matchAll(re)) {
        const start = m.index ?? 0;
        const end = start + m[0].length;
        const before = text.slice(Math.max(0, start - 1), start);
        const after = text.slice(end, end + 1);

        if (before === '[') continue;                                     // a marker, not a figure
        if (before === '-' || before === '/' || before === '.') continue; // inside a date or a decimal
        if (after === '-' || after === '/') continue;                     // start of a date
        if (MONTH_BEFORE.test(text.slice(Math.max(0, start - 12), start))) continue;
        if (!isMarketFigure(m[0])) continue;

        let stop = end;
        while (stop < text.length && !isSentenceEnd(text, stop)) stop++;
        if (!/\[\d+\]/.test(text.slice(end, stop))) {
            out.add(m[0].replace(/\s+/g, '').toLowerCase());
        }
    }
    return [...out].sort();
}

// Turn a completed tool call into the evidence line the model may cite.
export function citationFor(id: number, tool: string, symbol: string, data: unknown): DexterCitation {
    return {
        id,
        title: `${symbol} ${(TOOL_LABEL[tool] ?? tool).toLowerCase()}`,
        source: tool,
        text: toolMeta(tool, data),
    };
}

// User-facing verb for each tool, so the trace reads as work rather than as an
// API log.
export const TOOL_LABEL: Record<string, string> = {
    getChartData: 'Reading price history',
    getFundamentalData: 'Reading fundamentals',
    getFinancialStatements: 'Reading financial statements',
    drawTechnicalAnalysis: 'Drawing on the chart',
};
