// DX-8 regression tests — docs/AI_TRADING_AGENT_ROADMAP.md Section 6 row 13.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    runAnalysts, analystsFor, analystPrompt, renderReports, allCitations,
    citeBase, ANALYST_ORDER, CITE_BLOCK, REPORT_MAX_CHARS,
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
