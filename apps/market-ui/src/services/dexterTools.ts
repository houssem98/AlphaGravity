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
export interface AgentReply {
    text: string;
    actions: ClientAction[];
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
        description: 'Draw technical analysis indicators on the chart.',
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
// (`https://<deployment-host>` on Vercel, the dev server locally).
export interface ToolDeps {
    getJson: (url: string) => Promise<any>;
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

// A tool that throws returns its real error to the model rather than silence —
// the model must be able to say "the feed was down", not invent the number.
export async function executeTool(
    name: string,
    args: Record<string, unknown>,
    ctx: AssetContext,
    deps: ToolDeps,
): Promise<ToolOutcome> {
    try {
        switch (name) {
            case 'getChartData':
                return { data: await chartData(Number(args.days) || 30, ctx, deps) };
            case 'getFundamentalData':
                return { data: await fundamentalData(ctx, deps) };
            case 'getFinancialStatements':
                return { data: await financialStatements(ctx, deps) };
            case 'drawTechnicalAnalysis':
                return {
                    data: `Drawing dispatched to the chart: ${args.type}.`,
                    action: { type: String(args.type ?? ''), args },
                };
            default:
                return { data: { error: `Unknown tool: ${name}` } };
        }
    } catch (e) {
        return { data: { error: `${name} failed: ${(e as Error).message}` } };
    }
}
