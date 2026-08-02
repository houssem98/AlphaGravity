// DX-8 regression tests — docs/AI_TRADING_AGENT_ROADMAP.md Section 6 row 13.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    runAnalysts, analystsFor, analystPrompt, renderReports, allCitations,
    citeBase, ANALYST_ORDER, CITE_BLOCK, REPORT_MAX_CHARS,
    parseFollowUp, ANALYST_ITERATION_BUDGET,
    type AnalystDeps, type AnalystId,
} from './dexterGraph';
import type { AssetContext } from './dexterTools';

const CRYPTO: AssetContext = { symbol: 'BTC', isTN: false, isCrypto: true, name: 'Bitcoin' };
const EQUITY: AssetContext = { symbol: 'AAPL', isTN: false, isCrypto: false, name: 'Apple' };

const BARS = Array.from({ length: 40 }, (_, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    open: 100 + i, high: 108 + i, low: 94 + i, close: 103 + i, volume: 1000,
}));

// Answers the four evidence routes. Any route named in `dead` throws instead.
function deps(dead: string[] = [], seen: string[] = []): AnalystDeps {
    return {
        now: (() => { let t = 0; return () => (t += 10); })(),
        tools: {
            getJson: async (url: string) => {
                seen.push(url);
                if (dead.some(d => url.includes(d))) throw new Error(`${url} → HTTP 503`);
                if (url.includes('/api/news')) {
                    return { items: [{ title: 'Bitcoin Falls To 3-Week Low', url: 'https://x', source: 'Forbes', time: 'Fri, 31 Jul 2026' }] };
                }
                if (url.includes('/api/social')) {
                    return { posts: [{ handle: 'altcoindaily', followers: 1700000, tier: 'mega', tweet: 'DARKEST Moment in Bitcoin', sentiment: 'bullish', sentimentModel: 'keyword', views: 28405, postedAt: '2026-07-31' }] };
                }
                if (url.includes('binance') || url.includes('/api/history')) return BARS.map(b => [0, b.open, b.high, b.low, b.close, b.volume]);
                if (url.includes('/api/quote')) return { quoteResponse: { result: [{ regularMarketPrice: 231.4 }] } };
                if (url.includes('/api/fundamentals')) return { quoteSummary: { result: [{ trailingPE: 34.2 }] } };
                throw new Error(`unexpected route ${url}`);
            },
        },
        callLLM: async () => ({ text: 'A bounded report citing [1].' }),
    };
}

// Crypto bars come back as Binance kline arrays; map the fixture accordingly.
function cryptoDeps(dead: string[] = [], seen: string[] = []): AnalystDeps {
    const base = deps(dead, seen);
    return {
        ...base,
        tools: {
            getJson: async (url: string) => {
                if (url.includes('binance')) {
                    seen.push(url);
                    if (dead.some(d => url.includes(d))) throw new Error(`${url} → HTTP 503`);
                    return BARS.map(b => [Date.parse(b.date), b.open, b.high, b.low, b.close, b.volume]);
                }
                return base.tools.getJson(url);
            },
        },
    };
}

describe('row 13 — analysts run in parallel', () => {
    it('runs every analyst the asset supports', async () => {
        const reports = await runAnalysts(CRYPTO, cryptoDeps());
        expect(reports.map(r => r.id)).toEqual(['market', 'news', 'social']);
        expect(reports.every(r => r.ok)).toBe(true);
    });

    it('skips fundamentals for crypto instead of writing an apology', () => {
        expect(analystsFor(CRYPTO)).toEqual(['market', 'news', 'social']);
        expect(analystsFor(EQUITY)).toEqual([...ANALYST_ORDER]);
    });

    it('does not serialise the analysts', async () => {
        const seen: string[] = [];
        await runAnalysts(CRYPTO, cryptoDeps([], seen));
        // All three gathers are dispatched before any of them is awaited to
        // completion, so every route appears in the first tick.
        expect(seen.length).toBeGreaterThanOrEqual(3);
    });
});

describe('row 13 — one analyst failing degrades honestly', () => {
    it('keeps the other analysts when news is down', async () => {
        const reports = await runAnalysts(CRYPTO, cryptoDeps(['/api/news']));
        const news = reports.find(r => r.id === 'news')!;
        expect(news.ok).toBe(false);
        expect(news.error).toContain('HTTP 503');
        expect(news.text).toContain('No news read available');
        expect(reports.filter(r => r.ok).map(r => r.id)).toEqual(['market', 'social']);
    });

    it('never throws, even when every source is dead', async () => {
        const reports = await runAnalysts(CRYPTO, cryptoDeps(['/api', 'binance']));
        expect(reports).toHaveLength(3);
        expect(reports.every(r => !r.ok)).toBe(true);
        expect(reports.every(r => r.citations.length === 0)).toBe(true);
    });

    it('marks an unavailable analyst in the rendered reports', async () => {
        const reports = await runAnalysts(CRYPTO, cryptoDeps(['/api/social']));
        const rendered = renderReports(reports);
        expect(rendered).toContain('### Social analyst (unavailable)');
        expect(rendered).toContain('### Market analyst\n');
    });

    it('records the failure in the analyst\'s own trace', async () => {
        const reports = await runAnalysts(CRYPTO, cryptoDeps(['/api/news']));
        const news = reports.find(r => r.id === 'news')!;
        expect(news.steps[0]).toMatchObject({ tool: 'news', status: 'failed' });
        expect(news.steps[0].error).toContain('HTTP 503');
    });

    it('reports an empty feed as unavailable rather than an empty section', async () => {
        const empty: AnalystDeps = {
            ...cryptoDeps(),
            tools: { getJson: async () => ({ items: [], posts: [] }) },
        };
        const [news] = await runAnalysts(CRYPTO, empty, ['news']);
        expect(news.ok).toBe(false);
        expect(news.error).toContain('no news items returned');
    });
});

describe('row 13 — citation ids cannot collide', () => {
    it('gives each analyst a fixed block by position', () => {
        expect(citeBase('market')).toBe(1);
        expect(citeBase('news')).toBe(1 + CITE_BLOCK);
        expect(citeBase('social')).toBe(1 + CITE_BLOCK * 2);
        expect(citeBase('fundamentals')).toBe(1 + CITE_BLOCK * 3);
    });

    it('produces disjoint, sorted ids however the analysts finish', async () => {
        const reports = await runAnalysts(CRYPTO, cryptoDeps());
        const ids = allCitations(reports).map(c => c.id);
        expect(ids).toEqual([...ids].sort((a, b) => a - b));
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('row 13 — the analyst brief', () => {
    it('tells the market analyst not to round the computed levels', () => {
        const [system] = analystPrompt('market', CRYPTO, 'evidence');
        expect(system.content).toContain('quote them exactly, never round them');
    });

    it('tells every analyst to declare gaps rather than fill them', () => {
        for (const id of ANALYST_ORDER) {
            const [system] = analystPrompt(id as AnalystId, EQUITY, 'e');
            expect(system.content).toContain('say so instead of filling');
            expect(system.content).toContain('Cite every figure');
        }
    });

    it('tells the model the listing currency for a Tunisian asset', () => {
        const [system] = analystPrompt('market', { symbol: 'SAH', isTN: true, isCrypto: false }, 'e');
        expect(system.content).toContain('quoted in TND');
    });

    it('bounds each report so one analyst cannot crowd out the rest', async () => {
        const long: AnalystDeps = { ...cryptoDeps(), callLLM: async () => ({ text: 'x'.repeat(9000) }) };
        const [r] = await runAnalysts(CRYPTO, long, ['news']);
        expect(r.text.length).toBeLessThanOrEqual(REPORT_MAX_CHARS);
        expect(r.text.endsWith('…')).toBe(true);
    });
});

describe('row 13 — wired into the handler', () => {
    const handler = readFileSync(join(__dirname, '../../api/agent/[fn].ts'), 'utf8');

    // DX-9 widened this gate to 'decide' as well; DX-11 then made it fire on
    // the ROUTED mode, so an unpinned "analyze this chart" reaches the analysts
    // on its own.
    it('runs on the routed mode, not only on a pinned one', () => {
        expect(handler).toMatch(/\(effectiveMode === 'deep' \|\| effectiveMode === 'decide'\) && ctx/);
    });

    it('grades the deep answer like any other', () => {
        expect(handler).toMatch(/scoreAnswerTrust\(\{ answer: final\.text, citations, steps: trace\.done\(\) \}\)/);
    });

    it('keeps concurrent analyst steps out of the ordered main trace', () => {
        expect(handler).toContain('would imply a sequence that never happened');
    });

    // A prod run wrote "No social read is available [502]" — an HTTP status
    // rendered as a citation marker, which resolved to nothing and graded F.
    it('reserves square brackets for citations so a status code cannot become one', () => {
        expect(handler).toContain('Square brackets are reserved for citation markers');
        expect(handler).toContain('not an error code');
    });
});

// DI-11 — docs/DEXTER_INSTITUTIONAL_ROADMAP.md Section 6 row 15.
describe('row 15 — the analyst iteration budget is bounded and enforced', () => {
    /** Asks for a follow-up on the first `asks` replies, then writes plainly. */
    function pullingDeps(asks: number, budget?: number): AnalystDeps & { calls: number } {
        const base = cryptoDeps();
        let calls = 0;
        const d = {
            ...base,
            iterations: budget,
            callLLM: async () => {
                calls++;
                return { text: calls <= asks ? 'Need more history.\nFOLLOW-UP: getChartData days=365' : 'Final report citing [1].' };
            },
        };
        return Object.defineProperty(d, 'calls', { get: () => calls }) as AnalystDeps & { calls: number };
    }

    it('parses a follow-up request and its arguments', () => {
        expect(parseFollowUp('FOLLOW-UP: getChartData days=365')).toEqual({ tool: 'getChartData', args: { days: 365 } });
        expect(parseFollowUp('follow-up:  getQuote symbol="BTC"')).toEqual({ tool: 'getQuote', args: { symbol: 'BTC' } });
        expect(parseFollowUp('no request here')).toBeNull();
        expect(parseFollowUp('FOLLOW-UP: rmRf path=/')).toBeNull();   // not on the whitelist
    });

    it('spends nothing when the analyst does not ask', async () => {
        const [r] = await runAnalysts(CRYPTO, cryptoDeps(), ['market']);
        expect(r.iterations).toBe(0);
        expect(r.truncated).toBe(false);
        expect(r.budget).toBe(ANALYST_ITERATION_BUDGET);
    });

    it('lets an analyst pull the thread once, and cites what it pulled', async () => {
        const d = pullingDeps(1);
        const [r] = await runAnalysts(CRYPTO, d, ['market']);
        expect(r.iterations).toBe(1);
        expect(r.truncated).toBe(false);
        expect(d.calls).toBe(2);                       // first write + rewrite
        expect(r.citations.some(c => c.source === 'getChartData')).toBe(true);
        expect(r.citations.at(-1)!.title).toContain('follow-up: getChartData');
    });

    it('refuses the second request and RECORDS the truncation', async () => {
        const d = pullingDeps(5);                      // asks forever
        const [r] = await runAnalysts(CRYPTO, d, ['market']);
        expect(r.iterations).toBe(ANALYST_ITERATION_BUDGET);
        expect(r.truncated).toBe(true);
        expect(r.truncationReason).toContain('after spending its 1 follow-up pull(s)');
        expect(r.text).toContain('the request was refused');
        expect(d.calls).toBe(2);                       // bounded, not a loop
    });

    it('honours a caller-supplied budget, including zero', async () => {
        const generous = pullingDeps(5, 3);
        const [r3] = await runAnalysts(CRYPTO, generous, ['market']);
        expect(r3.iterations).toBe(3);
        expect(r3.truncated).toBe(true);
        expect(generous.calls).toBe(4);

        const none = pullingDeps(5, 0);
        const [r0] = await runAnalysts(CRYPTO, none, ['market']);
        expect(r0.iterations).toBe(0);
        expect(r0.truncated).toBe(true);
        expect(none.calls).toBe(1);
    });

    it('caps the whole analyst at 1 + budget model calls', async () => {
        for (const budget of [0, 1, 2, 3]) {
            const d = pullingDeps(99, budget);
            await runAnalysts(CRYPTO, d, ['market']);
            expect(d.calls).toBe(1 + budget);
        }
    });

    it('records the follow-up in the trace rather than hiding it', async () => {
        const [r] = await runAnalysts(CRYPTO, pullingDeps(1), ['market']);
        const labels = r.steps.map(s => s.label);
        expect(labels.some(l => l.includes('follow-up 1/1 (getChartData)'))).toBe(true);
        expect(labels.some(l => l.includes('rewriting after follow-up 1'))).toBe(true);
    });
});
