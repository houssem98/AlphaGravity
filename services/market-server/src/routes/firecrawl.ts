// Firecrawl proxy — server-side key, returns LLM-ready markdown.
import { Router, Request, Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { meter } from './gravity.js';

const router = Router();

// V4-2 · this whole file spent FIRECRAWL_API_KEY with no inbound auth at all.
//
// V3-8 asked "can an anonymous caller make this server spend?" of
// /api/llm/health and answered it there. The same question was never asked one
// router over. `/scrape`, `/search` and `/crawl` each read the server's key, and
// index.ts installs no global auth, so anyone who could reach market-server
// could spend the Firecrawl allowance — `/crawl` being the most expensive
// operation the vendor sells, pointed at any URL the caller named.
//
// tavily.ts, research.ts, market.ts, claude.ts and hermes.ts all already do
// exactly this. These routes were simply outside the pattern.
router.use(authMiddleware);

/** Per-viewer, like /api/llm/chat. Anonymous never reaches here. */
function meterViewer(req: AuthRequest, res: Response): boolean {
    const full = meter(`firecrawl:${req.user?.id ?? 'unknown'}`);
    if (full) {
        res.status(429).json({
            error: `Firecrawl rate limit reached for this ${full.window}.`,
            retryAfter: full.retryAfter,
        });
        return false;
    }
    return true;
}

const FIRECRAWL_BASE = process.env.FIRECRAWL_BASE_URL || 'https://api.firecrawl.dev';
const TTL_MS = 5 * 60 * 1000;

interface CacheEntry { data: any; timestamp: number; }
const scrapeCache = new Map<string, CacheEntry>();

function getCached(key: string): any | null {
    const hit = scrapeCache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.timestamp > TTL_MS) {
        scrapeCache.delete(key);
        return null;
    }
    return hit.data;
}

function setCached(key: string, data: any) {
    scrapeCache.set(key, { data, timestamp: Date.now() });
    if (scrapeCache.size > 200) {
        const oldest = scrapeCache.keys().next().value;
        if (oldest) scrapeCache.delete(oldest);
    }
}

// POST /api/firecrawl/scrape { url, formats?, onlyMainContent? }
// Returns { markdown, html?, metadata, links?, raw }
router.post('/scrape', async (req: AuthRequest, res: Response) => {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'FIRECRAWL_API_KEY not configured' });
    if (!meterViewer(req, res)) return;

    const { url, formats, onlyMainContent } = req.body ?? {};
    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'url is required' });
    }
    try {
        new URL(url);
    } catch {
        return res.status(400).json({ error: 'invalid url' });
    }

    const cacheKey = `scrape:${url}:${JSON.stringify(formats || ['markdown'])}:${onlyMainContent ?? true}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json({ ...cached, cached: true });

    try {
        const body = {
            url,
            formats: Array.isArray(formats) && formats.length > 0 ? formats : ['markdown', 'links'],
            onlyMainContent: onlyMainContent ?? true,
        };
        const upstream = await fetch(`${FIRECRAWL_BASE}/v1/scrape`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
        });
        if (!upstream.ok) {
            const text = await upstream.text();
            return res.status(upstream.status).json({ error: `Firecrawl ${upstream.status}`, detail: text.slice(0, 500) });
        }
        const json = await upstream.json();
        const data = json?.data ?? {};
        const result = {
            markdown: data.markdown ?? '',
            html: data.html,
            metadata: data.metadata ?? {},
            links: data.links ?? [],
            raw: data,
        };
        setCached(cacheKey, result);
        res.json({ ...result, cached: false });
    } catch (err: any) {
        console.error('Firecrawl scrape error:', err);
        res.status(500).json({ error: err?.message || 'Firecrawl scrape failed' });
    }
});

// POST /api/firecrawl/search { query, limit? } → { results: [{title,url,content,score}] }
// Web-search fallback for the deep-research pipeline: Tavily is quota-capped
// (432), so this is the node-harness-reachable twin of the Vercel tn
// dispatcher's websearch. Same response shape.
router.post('/search', async (req: AuthRequest, res: Response) => {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'FIRECRAWL_API_KEY not configured' });
    if (!meterViewer(req, res)) return;

    const { query, limit } = req.body ?? {};
    if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: 'query is required' });
    }
    const n = Math.min(10, Math.max(1, Number(limit) || 6));

    const cacheKey = `search:${query}:${n}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    try {
        const upstream = await fetch(`${FIRECRAWL_BASE}/v1/search`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ query, limit: n }),
        });
        if (!upstream.ok) {
            const text = await upstream.text();
            return res.status(upstream.status).json({ error: `Firecrawl ${upstream.status}`, detail: text.slice(0, 300) });
        }
        const json = await upstream.json();
        const results = (json?.data || [])
            .map((d: any) => ({
                title: d.title || d.url,
                url: d.url,
                content: d.description || d.markdown || '',
                score: 0.6,
            }))
            .filter((r: any) => r.url);
        const payload = { results };
        setCached(cacheKey, payload);
        res.json(payload);
    } catch (err: any) {
        console.error('Firecrawl search error:', err);
        res.status(500).json({ error: err?.message || 'Firecrawl search failed' });
    }
});

// POST /api/firecrawl/crawl { url, limit?, maxDepth? }
// Returns the Firecrawl crawl job id; poll status separately.
router.post('/crawl', async (req: AuthRequest, res: Response) => {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'FIRECRAWL_API_KEY not configured' });
    if (!meterViewer(req, res)) return;

    const { url, limit, maxDepth, includePaths, excludePaths } = req.body ?? {};
    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'url is required' });
    }
    try {
        const upstream = await fetch(`${FIRECRAWL_BASE}/v1/crawl`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                url,
                limit: typeof limit === 'number' ? Math.min(limit, 200) : 25,
                maxDepth: typeof maxDepth === 'number' ? Math.min(Math.max(maxDepth, 1), 5) : 2,
                includePaths,
                excludePaths,
                scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
            }),
        });
        if (!upstream.ok) {
            const text = await upstream.text();
            return res.status(upstream.status).json({ error: `Firecrawl ${upstream.status}`, detail: text.slice(0, 500) });
        }
        res.json(await upstream.json());
    } catch (err: any) {
        console.error('Firecrawl crawl error:', err);
        res.status(500).json({ error: err?.message || 'Firecrawl crawl failed' });
    }
});

// GET /api/firecrawl/crawl/:id — poll a crawl job.
router.get('/crawl/:id', async (req: AuthRequest, res: Response) => {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'FIRECRAWL_API_KEY not configured' });
    // A status poll is a READ of a job the viewer already paid for. Metering it
    // would 429 them out of watching their own crawl, so this route is authed
    // but not metered.
    const id = String(req.params.id || '');
    if (!id) return res.status(400).json({ error: 'id required' });
    try {
        const upstream = await fetch(`${FIRECRAWL_BASE}/v1/crawl/${encodeURIComponent(id)}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!upstream.ok) {
            const text = await upstream.text();
            return res.status(upstream.status).json({ error: `Firecrawl ${upstream.status}`, detail: text.slice(0, 500) });
        }
        res.json(await upstream.json());
    } catch (err: any) {
        res.status(500).json({ error: err?.message || 'Firecrawl crawl-status failed' });
    }
});

export { router as firecrawlRouter };
