// Firecrawl client — thin wrapper over market-server /api/firecrawl/*.
// Returns LLM-ready markdown so callers can pipe straight into Claude/Gemini.

import { getAccessToken } from './supabase';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3002';

export interface FirecrawlMetadata {
    title?: string;
    description?: string;
    language?: string;
    sourceURL?: string;
    statusCode?: number;
    ogImage?: string;
    favicon?: string;
    [key: string]: any;
}

export interface FirecrawlScrapeResult {
    markdown: string;
    html?: string;
    metadata: FirecrawlMetadata;
    links: string[];
    cached: boolean;
    raw?: any;
}

export interface FirecrawlScrapeOptions {
    formats?: Array<'markdown' | 'html' | 'links' | 'screenshot'>;
    onlyMainContent?: boolean;
}

async function authHeaders(): Promise<Record<string, string>> {
    const token = await getAccessToken();
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
}

export async function scrapeUrl(
    url: string,
    opts: FirecrawlScrapeOptions = {},
): Promise<FirecrawlScrapeResult> {
    const res = await fetch(`${API_BASE}/api/firecrawl/scrape`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({
            url,
            formats: opts.formats ?? ['markdown', 'links'],
            onlyMainContent: opts.onlyMainContent ?? true,
        }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `Firecrawl scrape failed (${res.status})`);
    }
    return res.json();
}

export interface FirecrawlCrawlJob {
    id?: string;
    success?: boolean;
    url?: string;
    [key: string]: any;
}

export interface FirecrawlCrawlOptions {
    limit?: number;
    maxDepth?: number;
    includePaths?: string[];
    excludePaths?: string[];
}

export async function startCrawl(url: string, opts: FirecrawlCrawlOptions = {}): Promise<FirecrawlCrawlJob> {
    const res = await fetch(`${API_BASE}/api/firecrawl/crawl`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ url, ...opts }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `Firecrawl crawl failed (${res.status})`);
    }
    return res.json();
}

export async function getCrawlStatus(jobId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/api/firecrawl/crawl/${encodeURIComponent(jobId)}`, {
        headers: await authHeaders(),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `Firecrawl status failed (${res.status})`);
    }
    return res.json();
}

// Build a self-describing block ready to inject into an LLM prompt.
// Mirrors the contextual-tagging pattern used by tavilyService.
export function toLlmContext(result: FirecrawlScrapeResult, maxChars = 12000): string {
    const meta = result.metadata || {};
    const header = [
        meta.title ? `# ${meta.title}` : null,
        meta.sourceURL ? `Source: ${meta.sourceURL}` : null,
        meta.description ? `Description: ${meta.description}` : null,
    ].filter(Boolean).join('\n');
    const md = (result.markdown || '').slice(0, maxChars);
    return [header, '', md].filter(Boolean).join('\n').trim();
}

// Ship the scraped markdown to /api/llm/chat with a question. Returns the
// answer text. Defaults to Claude Sonnet — fast + cheap with 200k context.
export interface AnswerOptions {
    provider?: 'anthropic' | 'gemini' | 'deepseek' | 'groq';
    model?: string;
    maxTokens?: number;
}

export async function answerWithContext(
    result: FirecrawlScrapeResult,
    question: string,
    opts: AnswerOptions = {},
): Promise<{ text: string; latencyMs: number; model: string }> {
    const provider = opts.provider ?? 'anthropic';
    const model = opts.model ?? (provider === 'anthropic' ? 'claude-sonnet-4-6' : provider === 'gemini' ? 'gemini-2.5-flash' : 'deepseek-v4-flash');
    const ctx = toLlmContext(result, 16000);
    const ask = question.trim() || 'Summarise this page in 5 bullets, then list 3 questions a financial analyst would still want answered.';
    const prompt = `You are an institutional research assistant. Use the web page below as your only source. Quote facts inline and cite the source URL in parentheses.\n\n${ctx}\n\n---\n\nQuestion: ${ask}`;

    const res = await fetch(`${API_BASE}/api/llm/chat`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ provider, model, prompt, max_tokens: opts.maxTokens ?? 2048 }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `LLM chat failed (${res.status})`);
    }
    const data = await res.json();
    return { text: data.text || '', latencyMs: data.latencyMs ?? 0, model: data.model ?? model };
}
