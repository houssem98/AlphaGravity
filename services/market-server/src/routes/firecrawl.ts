// Firecrawl proxy — server-side key, returns LLM-ready markdown.
import { Router, Request, Response } from 'express';

const router = Router();

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
router.post('/scrape', async (req: Request, res: Response) => {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'FIRECRAWL_API_KEY not configured' });

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

// POST /api/firecrawl/crawl { url, limit?, maxDepth? }
// Returns the Firecrawl crawl job id; poll status separately.
router.post('/crawl', async (req: Request, res: Response) => {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'FIRECRAWL_API_KEY not configured' });

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
                maxDepth: typeof maxDepth === 'number' ? maxDepth : 2,
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
router.get('/crawl/:id', async (req: Request, res: Response) => {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'FIRECRAWL_API_KEY not configured' });
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
