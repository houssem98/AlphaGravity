/**
 * AlphaGravity — Shared TypeScript Types
 *
 * Types shared between market-ui and market-server.
 * (gravity-ui does not consume this package — it carries its own src/lib/types.ts.)
 * Import with: import { SearchResult, ResearchReport } from 'shared-types'
 */

// ── Search ──────────────────────────────────────

export interface SearchResult {
    id: string;
    title: string;
    snippet: string;
    url: string;
    score: number;
    source: 'gravity' | 'market' | 'web';
    metadata?: Record<string, unknown>;
    timestamp?: string;
}

export interface SearchRequest {
    query: string;
    limit?: number;
    offset?: number;
    filters?: SearchFilters;
}

export interface SearchFilters {
    dateRange?: { start: string; end: string };
    sources?: string[];
    sectors?: string[];
    documentTypes?: string[];
}

export interface SearchResponse {
    results: SearchResult[];
    total: number;
    query: string;
    latencyMs: number;
}

// ── Research Reports ────────────────────────────

export interface ResearchReport {
    id: string;
    title: string;
    summary: string;
    content: string;
    citations: Citation[];
    createdAt: string;
    updatedAt: string;
    status: 'pending' | 'generating' | 'complete' | 'error';
}

export interface Citation {
    id: string;
    text: string;
    source: string;
    url: string;
    relevanceScore: number;
}

// ── Market Data ─────────────────────────────────

export interface MarketData {
    symbol: string;
    companyName: string;
    price: number;
    change: number;
    changePercent: number;
    volume: number;
    marketCap?: number;
    timestamp: string;
}

export interface MarketSentiment {
    symbol: string;
    sentiment: 'bullish' | 'bearish' | 'neutral';
    confidence: number;
    sources: number;
    summary: string;
}

// ── Health / API ────────────────────────────────

export interface HealthResponse {
    status: 'ok' | 'degraded' | 'error';
    timestamp: string;
    services?: Record<string, 'ok' | 'unavailable'>;
}

export interface ApiError {
    code: string;
    message: string;
    details?: unknown;
}

// ── Billing tiers ───────────────────────────────
// Mirror of services/gravity-api/app/billing/tiers.py — the server is the source
// of truth and this exists so the UI cannot invent a fifth tier name. Three
// vocabularies that had to agree did not (docs/PLANS_WORLD_CLASS_ROADMAP.md §1b);
// two is the floor, and R2 is what keeps it from becoming three again.

/** The tiers the pricing table may render, in ladder order. */
export const SOLD_TIERS = ['free', 'analyst', 'professional', 'institutional'] as const;
export type SoldTier = (typeof SOLD_TIERS)[number];

/** `unlimited` is internal — dev bypass and service API keys. Never sold. */
export type TierId = SoldTier | 'unlimited';

/** Every id this service has issued, mapped forward. Keys are the legacy names. */
export const LEGACY_TIER_ALIASES: Record<string, SoldTier> = {
    pro: 'professional',
    individual: 'analyst',
    team: 'institutional',
    enterprise: 'institutional',
};

export interface TierLimits {
    id: TierId;
    name: string;
    sold: boolean;
    perMinute: number;
    /** null = unlimited */
    perDay: number | null;
    /** null = unlimited */
    perMonth: number | null;
}
