// Company Profile Page — AlphaSense-style company intelligence hub
// Combines Alpha Vantage market data + Gravity's indexed filings + structured financials

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ArrowLeft, TrendingUp, TrendingDown, FileText,
    Zap, ExternalLink, BarChart3, Building2, RefreshCw, Activity, Grid3x3,
} from 'lucide-react';
import { peersFor } from '../lib/peers';
import { lastSeen, markSeen, isNewFiling, newCount } from '../lib/newFilings';
import {
    BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Cell,
} from 'recharts';
import { apiGetOverview } from '../services/api';
import { getAccessToken } from '../services/supabase';
import CompanyBrief from '../components/company/CompanyBrief';
import LatestQuarterCard from '../components/company/LatestQuarterCard';
import TranscriptSummary from '../components/company/TranscriptSummary';
import DevilsAdvocate from '../components/company/DevilsAdvocate';
import EdgarLink from '../components/EdgarLink';

// ─── Types ────────────────────────────────────────────────────────────────────

import { NULL_MARK, periodLabel, unitLabel, figureAttrs, sourceLabel } from '../lib/figures';

interface MarketOverview {
    Symbol: string;
    Name: string;
    Sector: string;
    Industry: string;
    Description: string;
    MarketCapitalization: string;
    PERatio: string;
    EPS: string;
    DividendYield: string;
    '52WeekHigh': string;
    '52WeekLow': string;
    AnalystTargetPrice: string;
    ReturnOnEquityTTM: string;
    ProfitMargin: string;
    RevenueGrowthYOY: string;
    OperatingMarginTTM: string;
    GrossProfitTTM: string;
    RevenueTTM: string;
    EBITDA: string;
    // CT-5 · Alpha Vantage OVERVIEW carries these two. They are the only real
    // source of a fiscal-year-end in this payload; absent them, a period-end is
    // rendered as an honest unknown rather than guessed.
    FiscalYearEnd?: string;   // e.g. "January"
    LatestQuarter?: string;   // e.g. "2025-10-31"
}

interface Quote {
    price: number;
    changePct: number;
    volume: number;
    marketCap: number;
}

interface GravityDocument {
    id: string;
    ticker: string;
    filing_type: string;
    filing_date: string | null;
    title: string;
    chunk_count: number;
    status: string;
}

interface GravityMetric {
    metric: string;
    value: string | number;
    unit?: string;
    period?: string;
    ticker?: string;
    // CT2-3 · optional on purpose. CT2-2 measured 0 of 60 rows carrying it, and
    // the marker exists because the id can be missing — narrowing this to string
    // would delete the state the page has to render honestly.
    document_id?: string;
}

interface SentimentResult {
    ticker: string;
    overall_score: number;       // -1 to +1
    label: string;               // 'bullish' | 'neutral' | 'bearish'
    confidence: number;
    document_count: number;
    period?: string;
    breakdown?: { category: string; score: number; count: number }[];
}

interface SentimentDelta {
    ticker: string;
    current_score: number;
    previous_score: number;
    delta: number;
    direction: 'improving' | 'deteriorating' | 'stable';
    significant_shifts: { topic: string; change: number; direction: string }[];
}

interface LongitudinalPoint {
    period: string;
    revenue?: number;
    net_income?: number;
    operating_income?: number;
    eps?: number;
    gross_margin?: number;
    [key: string]: string | number | undefined;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const GRAVITY_BASE = import.meta.env.VITE_GRAVITY_API_URL ?? 'http://localhost:8000';

function fmt(n: string | number, style: 'currency' | 'percent' | 'number' = 'number'): string {
    const num = typeof n === 'string' ? parseFloat(n) : n;
    if (isNaN(num)) return '—';
    if (style === 'currency') {
        if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
        if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
        if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
        return `$${num.toLocaleString()}`;
    }
    if (style === 'percent') return `${(num * 100).toFixed(2)}%`;
    return num.toLocaleString();
}


// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, period, unit, sub }: {
    label: string; value: string; period?: string; unit?: string; sub?: string;
}) {
    const p = period && period.trim() ? period.trim() : NULL_MARK;
    const u = unitLabel(unit);
    return (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <p className="text-xs text-[#4A5568] uppercase tracking-wider mb-1">{label}</p>
            {/* CT2-3 · quote and overview figures come from market data, which
                carries no filing id at all. The marker is the honest answer, not
                a placeholder for one CT2-4 will fill in. */}
            <p className="text-xl font-semibold text-white"
                data-figure data-period={p} data-unit={u} data-source={NULL_MARK}>{value}</p>
            <p className="text-xs text-[#A7B0C8] mt-0.5">{p} · {u}</p>
            {sub && <p className="text-xs text-[#A7B0C8] mt-0.5">{sub}</p>}
        </div>
    );
}

function FilingRow({ doc, ticker, isNew }: { doc: GravityDocument; ticker: string; isNew?: boolean }) {
    const navigate = useNavigate();
    const typeColor: Record<string, string> = {
        '10-K': '#00F0FF', '10-Q': '#5B8DF6', '8-K': '#F59E0B',
    };
    const color = typeColor[doc.filing_type] ?? '#A7B0C8';
    return (
        <div className="flex items-center gap-3 py-2.5 border-b border-white/[0.04] last:border-0 group">
            <span
                className="text-[10px] font-mono px-1.5 py-0.5 rounded flex-shrink-0"
                style={{ color, background: color + '18' }}
            >
                {doc.filing_type}
            </span>
            <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">
                    {doc.title}
                    {isNew && <span className="ml-2 text-[9px] font-bold uppercase tracking-wider text-[#10B981] bg-[#10B981]/15 px-1.5 py-0.5 rounded align-middle">New</span>}
                </p>
                {doc.filing_date && <p className="text-[10px] text-[#4A5568]">{doc.filing_date}</p>}
            </div>
            <button
                onClick={() => navigate(`/search?q=${encodeURIComponent(`${ticker} ${doc.filing_type} ${doc.filing_date ?? ''}`)}`)}
                className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[10px] text-[#00F0FF] hover:underline flex-shrink-0"
            >
                <Zap className="w-3 h-3" /> Search
            </button>
        </div>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

// CT-3 · the tabs are addressable. `tab` is the DEFAULT, not a controlled value:
// every existing mount passes nothing and keeps landing on Overview.
export type CompanyTab = 'overview' | 'filings' | 'data' | 'sentiment';

export default function CompanyPage({ embedded = false, tab, ticker: fixedTicker }: {
    embedded?: boolean;
    tab?: CompanyTab;
    // CT-4 · the ticker a command resolved. Seeds the embedded mount, which
    // otherwise opens on its own ticker-entry form.
    ticker?: string;
}) {
    const { ticker } = useParams<{ ticker: string }>();
    const navigate = useNavigate();
    // Embedded in the /search mode toggle → ticker lives in local state instead
    // of the route, so switching companies never leaves the search page.
    const [localTicker, setLocalTicker] = useState(fixedTicker ?? '');
    const symbol = (ticker ?? localTicker).toUpperCase();
    const openTicker = (t: string) => embedded
        ? setLocalTicker(t.toUpperCase())
        : navigate(`/companies/${encodeURIComponent(t.toUpperCase())}`);

    const [overview, setOverview] = useState<MarketOverview | null>(null);
    const [quote, setQuote] = useState<Quote | null>(null);
    const [documents, setDocuments] = useState<GravityDocument[]>([]);
    const [metrics, setMetrics] = useState<GravityMetric[]>([]);
    const [sentiment, setSentiment] = useState<SentimentResult | null>(null);
    // CT2-5 · why there is no score, in the server's own words. Present exactly
    // when `sentiment` is null and the request actually ran.
    const [sentimentRefusal, setSentimentRefusal] = useState<
        { status: number; detail: string; documentId: string; filing: string } | null>(null);
    const [sentimentDelta, setSentimentDelta] = useState<SentimentDelta | null>(null);
    const [longitudinal, setLongitudinal] = useState<LongitudinalPoint[]>([]);
    const [loading, setLoading] = useState(true);
    // CT-7 · row 9. A surface that failed is NAMED. A credential fault and a data
    // gap look identical when both render an empty card, and only one of them is
    // the user's problem.
    const [failedSurfaces, setFailedSurfaces] = useState<string[]>([]);
    const [activeTab, setActiveTab] = useState<CompanyTab>(tab ?? 'overview');
    // CT2-4 · row R5. The filing a figure's id RESOLVED to. It is set from the
    // documents list by id and never constructed from the metric, so the drawer
    // can only ever name a filing this page actually received.
    const [sourceDoc, setSourceDoc] = useState<GravityDocument | null>(null);
    // Watermark captured at page open (newest filing_date the user saw last
    // time); filings newer than this get a NEW badge. Captured before markSeen.
    const [watermark, setWatermark] = useState<string | null>(null);

    useEffect(() => {
        if (!symbol) return;
        setLoading(true);
        setFailedSurfaces([]);
        setWatermark(lastSeen(symbol));

        const authed = (tok: string | null): HeadersInit =>
            tok ? { Authorization: `Bearer ${tok}` } : {};

        getAccessToken().catch(() => null).then(tok => Promise.allSettled([
            // Alpha Vantage overview (opportunistic — 25 req/day free tier;
            // page renders '—' when absent)
            apiGetOverview(symbol),
            // Quote via the Yahoo→sina fallback stack (always up, no key)
            fetch(`/api/quote?symbols=${encodeURIComponent(symbol)}`)
                .then(r => r.ok ? r.json() : null),
            // Gravity indexed documents (Supabase-REST-backed; /v1/documents is
            // dead on prod — asyncpg get_db stub)
            fetch(`${GRAVITY_BASE}/v1/company/${symbol}/filings?limit=15`, {
                headers: authed(tok),
            }).then(r => r.ok ? r.json() : null),
            // Exact XBRL financial facts (NL→SQL structured search is broken in
            // prod and inexact anyway — xbrl:* rows are the one exact population)
            fetch(`${GRAVITY_BASE}/v1/company/${symbol}/financials?limit=80`, {
                headers: authed(tok),
            }).then(r => r.ok ? r.json() : null),
            // CT2-5 · the sentiment score is NOT fetched here. It needs a
            // document_id, which only arrives with the filings payload in this
            // same batch, so it runs in its own effect below.
            // Gravity sentiment delta (vs previous period)
            fetch(`${GRAVITY_BASE}/v1/analytics/sentiment/${symbol}/delta`, {
                headers: { 'X-API-Key': 'deep-research-internal' },
            }).then(r => r.ok ? r.json() : null).catch(() => null),
            // Gravity longitudinal trend
            fetch(`${GRAVITY_BASE}/v1/analytics/longitudinal/${symbol}`, {
                headers: { 'X-API-Key': 'deep-research-internal' },
            }).then(r => r.ok ? r.json() : null).catch(() => null),
        ]).then(([ov, qt, docs, met, sentDelta, longit]) => {
            const arr = (v: unknown): any[] => Array.isArray(v) ? v : [];

            // A rejected fetch, or a body carrying an `error`, is a FAILURE and is
            // stated. A well-formed body with no data is an EMPTY and renders the
            // null marker — the two are not the same event and must not look it.
            const failures: string[] = [];
            const failed = (r: PromiseSettledResult<any>) =>
                r.status === 'rejected' || (r.value && typeof r.value === 'object' && 'error' in r.value);
            if (failed(ov)) failures.push('Company overview (Alpha Vantage)');
            if (failed(docs)) failures.push('Filings index');
            if (failed(met)) failures.push('XBRL financials');
            if (failures.length) setFailedSurfaces(failures);

            if (ov.status === 'fulfilled' && ov.value?.Symbol) setOverview(ov.value);
            if (qt.status === 'fulfilled') {
                const q = qt.value?.quoteResponse?.result?.[0];
                setQuote(q?.regularMarketPrice ? {
                    price: q.regularMarketPrice,
                    changePct: q.regularMarketChangePercent ?? 0,
                    volume: q.regularMarketVolume ?? 0,
                    marketCap: q.marketCap ?? 0,
                } : null);
            }
            if (docs.status === 'fulfilled') {
                const list = arr(docs.value?.documents ?? docs.value) as GravityDocument[];
                setDocuments(list);
                // Record the newest filing_date so next visit can flag anything newer.
                const newest = list.map(d => d.filing_date).filter(Boolean).sort().reverse()[0] ?? null;
                markSeen(symbol, newest);
            }
            if (met.status === 'fulfilled') setMetrics(arr(met.value?.rows ?? met.value?.structured_data));
            if (sentDelta.status === 'fulfilled' && sentDelta.value?.delta !== undefined) setSentimentDelta(sentDelta.value);
            if (longit.status === 'fulfilled' && longit.value) {
                setLongitudinal(arr(longit.value?.data_points ?? longit.value?.periods));
            }
            setLoading(false);
        }));
    }, [symbol]);

    // CT2-5 · row R6. Probed live 2026-08-09: the endpoint requires BOTH
    // document_id AND period (the ledger's P2 named only the first), and it is a
    // CACHE READ — `_load_cache(document_id)` — so with a real filing id and both
    // params it answers 404 "Sentiment not found ... POST to compute it". Calling
    // it with no params at all, as this page used to, produced a 422 that was our
    // malformed request rather than the real gap.
    //
    // So: ask correctly, then state whatever comes back. Never synthesise a score.
    useEffect(() => {
        if (!symbol || !documents.length) return;
        const doc = documents[0];   // filings arrive newest-first
        let alive = true;
        setSentimentRefusal(null);
        (async () => {
            const qs = new URLSearchParams({ document_id: doc.id, period: doc.filing_date ?? '' });
            try {
                const res = await fetch(`${GRAVITY_BASE}/v1/analytics/sentiment/${symbol}?${qs}`, {
                    headers: { 'X-API-Key': 'deep-research-internal' },
                });
                const body = await res.json().catch(() => null);
                if (!alive) return;
                if (res.ok && body?.overall_score !== undefined) { setSentiment(body); return; }
                setSentimentRefusal({
                    status: res.status,
                    // The server's own words. Paraphrasing an error is how a
                    // credential fault starts looking like a data gap.
                    detail: typeof body?.detail === 'string' ? body.detail : JSON.stringify(body?.detail ?? body),
                    documentId: doc.id,
                    filing: `${doc.filing_type || NULL_MARK} · ${doc.filing_date || NULL_MARK}`,
                });
            } catch (e) {
                if (alive) setSentimentRefusal({
                    status: 0, detail: String(e), documentId: doc.id,
                    filing: `${doc.filing_type || NULL_MARK} · ${doc.filing_date || NULL_MARK}`,
                });
            }
        })();
        return () => { alive = false; };
    }, [symbol, documents]);

    // No ticker in the URL (the "Companies" nav link points to bare /companies).
    // Render a ticker picker instead of a blank page (which looked like a freeze).
    if (!symbol) {
        return (
            <div className="min-h-[calc(100vh-64px)] flex items-center justify-center p-6">
                <div className="w-full max-w-md text-center">
                    <div className="w-12 h-12 rounded-xl bg-[#5B8DF6]/10 flex items-center justify-center mx-auto mb-4">
                        <Building2 className="w-6 h-6 text-[#5B8DF6]" />
                    </div>
                    <h1 className="text-xl font-semibold text-[#F4F6FF] mb-1">Company Intelligence</h1>
                    <p className="text-sm text-[#A7B0C8] mb-5">
                        Enter a ticker to view filings, financials, and sentiment.
                    </p>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            const v = new FormData(e.currentTarget)
                                .get('ticker')?.toString().trim().toUpperCase();
                            if (v) openTicker(v);
                        }}
                        className="flex gap-2"
                    >
                        <input
                            name="ticker"
                            autoFocus
                            placeholder="e.g. AAPL, NVDA, TSLA"
                            className="flex-1 px-4 py-2.5 rounded-lg bg-[#0B0E14] border border-[#1F2937] text-[#F4F6FF] placeholder-[#4A5568] focus:outline-none focus:border-[#5B8DF6]"
                        />
                        <button
                            type="submit"
                            className="px-4 py-2.5 rounded-lg bg-[#5B8DF6] text-white font-medium text-sm hover:bg-[#5B8DF6]/90 transition-colors"
                        >
                            View
                        </button>
                    </form>
                    <div className="flex flex-wrap gap-2 justify-center mt-4">
                        {['AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN'].map((t) => (
                            <button
                                key={t}
                                onClick={() => openTicker(t)}
                                className="px-3 py-1 rounded-md text-xs bg-[#1F2937] text-[#A7B0C8] hover:text-[#F4F6FF] transition-colors"
                            >
                                {t}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    const price = quote?.price ?? null;
    const changePct = quote?.changePct ?? null;
    const isUp = changePct !== null ? changePct >= 0 : null;

    const chartData = metrics
        .filter(m => typeof m.value === 'number' && m.period)
        .slice(0, 8)
        .map(m => ({ name: m.period!, value: m.value as number, label: m.metric }));

    const COLORS = ['#00F0FF', '#5B8DF6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6'];

    return (
        <div className="min-h-[calc(100dvh-64px)] p-4 sm:p-6 max-w-5xl mx-auto">
            {/* Back */}
            <button
                onClick={() => embedded ? setLocalTicker('') : navigate(-1)}
                className="flex items-center gap-1.5 text-sm text-[#A7B0C8] hover:text-white mb-6 transition-colors"
            >
                <ArrowLeft className="w-4 h-4" /> Back
            </button>

            {loading ? (
                /* CT-7 · row 8. A skeleton says "a value is coming here"; a spinner
                   says only "something is happening", and an empty card after it
                   says nothing at all. `aria-busy` is what makes the difference
                   readable to a screen reader and to the gate. */
                <div aria-busy="true" aria-live="polite" className="space-y-4" data-testid="company-skeleton">
                    <span className="sr-only">Loading {symbol}…</span>
                    <div className="h-10 w-64 rounded-xl bg-white/[0.06] animate-pulse" />
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <div key={i} className="h-20 rounded-xl border border-white/[0.06] bg-white/[0.03] animate-pulse" />
                        ))}
                    </div>
                    <div className="h-40 rounded-xl border border-white/[0.06] bg-white/[0.03] animate-pulse" />
                </div>
            ) : (
                <div aria-busy="false">
                    {/* CT-7 · row 9. Named, not a shrug. */}
                    {failedSurfaces.length > 0 && (
                        <div role="alert" className="mb-6 rounded-xl border border-[#F59E0B]/40 bg-[#F59E0B]/10 p-4">
                            <p className="text-sm text-[#F59E0B] font-medium">
                                Could not load: {failedSurfaces.join(', ')}
                            </p>
                            <p className="text-xs text-[#A7B0C8] mt-1">
                                The figures those surfaces supply are unavailable, not zero. Nothing below is a placeholder.
                            </p>
                        </div>
                    )}

                    {/* Header */}
                    <div className="flex items-start justify-between gap-4 mb-6">
                        <div>
                            <div className="flex items-center gap-3 mb-1">
                                <div className="w-10 h-10 rounded-xl bg-[#5B8DF6]/10 flex items-center justify-center">
                                    <Building2 className="w-5 h-5 text-[#5B8DF6]" />
                                </div>
                                <div>
                                    <h1 className="text-2xl font-bold text-white">
                                        {overview?.Name ?? symbol}
                                    </h1>
                                    <p className="text-sm text-[#A7B0C8]">
                                        {symbol} · {overview?.Sector ?? '—'} · {overview?.Industry ?? '—'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Price */}
                        {price !== null && (
                            <div className="text-right flex-shrink-0">
                                <p className="text-3xl font-bold text-white">${price.toFixed(2)}</p>
                                {changePct !== null && (
                                    <div className={`flex items-center justify-end gap-1 text-sm ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                                        {isUp ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                                        {isUp ? '+' : ''}{changePct.toFixed(2)}%
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Quick actions */}
                    {/* Three buttons in a non-wrapping row measured 441px inside a
                        342px column at 390px — clipped, with no scroller. */}
                    <div className="flex flex-wrap gap-2 mb-6">
                        <button
                            onClick={() => navigate(`/search?q=${encodeURIComponent(`${overview?.Name ?? symbol} latest earnings analysis`)}`)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#00F0FF]/10 border border-[#00F0FF]/30 text-[#00F0FF] text-xs hover:bg-[#00F0FF]/20 transition-colors"
                        >
                            <Zap className="w-3.5 h-3.5" /> Quick Search
                        </button>
                        <button
                            onClick={() => {
                                const name = overview?.Name ?? symbol;
                                const primer = `Initiation report on ${name} (${symbol}): business model and segments, financial performance and trajectory, valuation, competitive positioning and moat, key risks, and near-term catalysts. Cite filings and cite figures.`;
                                navigate(`/search?mode=research&q=${encodeURIComponent(primer)}`);
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#5B8DF6]/10 border border-[#5B8DF6]/30 text-[#5B8DF6] text-xs hover:bg-[#5B8DF6]/20 transition-colors"
                        >
                            <FileText className="w-3.5 h-3.5" /> Full Primer
                        </button>
                        {/* Resolves to the latest 10-K document itself (same resolver as
                            Quick Answer); falls back to EDGAR search while/if unresolved. */}
                        <EdgarLink
                            ticker={symbol}
                            filingType="10-K"
                            allowLatest
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.08] text-[#A7B0C8] text-xs hover:border-white/20 hover:text-white transition-colors"
                        />
                    </div>

                    {/* Peer strip — sector peers + 1-click compare in Research Grid */}
                    {(() => {
                        const peers = peersFor(symbol);
                        if (peers.length === 0) return null;
                        return (
                            <div className="flex items-center gap-2 flex-wrap mb-6">
                                <span className="text-[10px] text-[#4A5568] uppercase tracking-wider">Peers</span>
                                {peers.map(p => (
                                    <button
                                        key={p}
                                        onClick={() => openTicker(p)}
                                        className="px-2 py-0.5 rounded text-xs font-mono bg-white/[0.04] text-[#A7B0C8] hover:text-white hover:bg-white/[0.08] transition-colors"
                                    >
                                        {p}
                                    </button>
                                ))}
                                <button
                                    onClick={() => navigate(`/search?mode=grid&tickers=${encodeURIComponent([symbol, ...peers].join(','))}`)}
                                    className="ml-1 flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-[#00F0FF]/10 border border-[#00F0FF]/30 text-[#00F0FF] text-xs hover:bg-[#00F0FF]/20 transition-colors"
                                >
                                    <Grid3x3 className="w-3 h-3" /> Compare in grid
                                </button>
                            </div>
                        );
                    })()}

                    {/* Key stats grid */}
                    {overview && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                            <StatCard label="Market Cap" value={fmt(overview.MarketCapitalization, 'currency')}
                                      period={overview.LatestQuarter} unit="USD" />
                            <StatCard label="P/E Ratio" value={fmt(overview.PERatio)}
                                      period="TTM" unit="ratio" />
                            <StatCard label="EPS (TTM)" value={isNaN(parseFloat(overview.EPS)) ? '—' : `$${overview.EPS}`}
                                      period="TTM" unit="USD/share" />
                            <StatCard label="Analyst Target" value={isNaN(parseFloat(overview.AnalystTargetPrice)) ? '—' : `$${overview.AnalystTargetPrice}`}
                                      unit="USD/share" />
                            <StatCard label="52W High" value={overview['52WeekHigh'] ? `$${overview['52WeekHigh']}` : '—'}
                                      period="52W" unit="USD/share" />
                            <StatCard label="52W Low" value={overview['52WeekLow'] ? `$${overview['52WeekLow']}` : '—'}
                                      period="52W" unit="USD/share" />
                            <StatCard label="Operating Margin" value={overview.OperatingMarginTTM ? `${(parseFloat(overview.OperatingMarginTTM) * 100).toFixed(1)}%` : '—'}
                                      period="TTM" unit="%" />
                            <StatCard label="Revenue (TTM)" value={fmt(overview.RevenueTTM, 'currency')}
                                      period="TTM" unit="USD" />
                        </div>
                    )}

                    {/* Tabs */}
                    <div role="tablist" aria-label="Company sections" className="flex gap-1 border-b border-white/[0.06] mb-5">
                        {([
                            { key: 'overview', label: 'Overview', icon: BarChart3 },
                            { key: 'filings', label: `Filings (${documents.length})${newCount(documents.map(d => d.filing_date), watermark) > 0 ? ` · ${newCount(documents.map(d => d.filing_date), watermark)} new` : ''}`, icon: FileText },
                            { key: 'data', label: `Metrics (${metrics.length})`, icon: RefreshCw },
                            // CT2-5 · row R6. The tab used to mount only on a
                            // returned score, which meant `/sentiment <t>` routed
                            // to a tab that had never existed for any ticker (§5
                            // P2). It now mounts on a score OR on a stated
                            // refusal — the one thing it must never do is mount
                            // and show a number nothing returned.
                            ...(sentiment || sentimentRefusal
                                ? [{ key: 'sentiment', label: 'Sentiment', icon: Activity } as const] : []),
                        ] as const).map(({ key, label, icon: Icon }) => (
                            <button
                                key={key}
                                role="tab"
                                aria-selected={activeTab === key}
                                onClick={() => setActiveTab(key)}
                                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${activeTab === key
                                    ? 'border-[#00F0FF] text-[#00F0FF]'
                                    : 'border-transparent text-[#A7B0C8] hover:text-white'
                                    }`}
                            >
                                <Icon className="w-3.5 h-3.5" /> {label}
                            </button>
                        ))}
                    </div>

                    {/* Overview tab */}
                    {activeTab === 'overview' && (
                        <div className="space-y-5">
                            <LatestQuarterCard metrics={metrics} fiscalYearEnd={overview?.FiscalYearEnd} />
                            {(() => {
                                const t = documents.find(d => d.filing_type === 'earnings_transcript');
                                return t ? <TranscriptSummary ticker={symbol} date={t.filing_date} /> : null;
                            })()}
                            <CompanyBrief ticker={symbol} />
                            <DevilsAdvocate ticker={symbol} />
                            {overview?.Description && (
                                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
                                    <p className="text-xs text-[#4A5568] uppercase tracking-wider mb-2">About</p>
                                    <p className="text-sm text-[#A7B0C8] leading-relaxed">{overview.Description}</p>
                                </div>
                            )}

                            {chartData.length > 0 && (
                                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
                                    <p className="text-xs text-[#4A5568] uppercase tracking-wider mb-4">Financial Metrics (from Gravity Index)</p>
                                    <ResponsiveContainer width="100%" height={200}>
                                        <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 8, left: 8 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                                            <XAxis dataKey="name" tick={{ fill: '#4A5568', fontSize: 10 }} axisLine={false} tickLine={false} />
                                            <YAxis tick={{ fill: '#4A5568', fontSize: 10 }} axisLine={false} tickLine={false} width={60} />
                                            <Tooltip
                                                contentStyle={{ backgroundColor: '#0D1117', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', fontSize: '12px', color: '#E8EBF0' }}
                                                formatter={(v: number, _n, p) => [v.toLocaleString(), p.payload.label]}
                                            />
                                            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                                                {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Filings tab */}
                    {activeTab === 'filings' && (
                        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                            {documents.length === 0
                                ? <p className="text-sm text-[#4A5568] text-center py-8">No indexed filings found. Seed the Gravity index first.</p>
                                : documents.map(doc => <FilingRow key={doc.id} doc={doc} ticker={symbol} isNew={isNewFiling(doc.filing_date, watermark)} />)
                            }
                        </div>
                    )}

                    {/* Sentiment tab */}
                    {activeTab === 'sentiment' && (
                        <div className="space-y-5">
                            {!sentiment ? (
                                // CT2-5 · row R6. "No sentiment data indexed yet"
                                // was a guess about WHY. State what was asked and
                                // what the server said, verbatim — and show no
                                // number, because none was returned.
                                <div data-sentiment-refusal className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-2">
                                    <p className="text-sm text-white">No sentiment score for {symbol}.</p>
                                    {sentimentRefusal ? (
                                        <>
                                            <p className="text-xs text-[#A7B0C8]">
                                                Asked <code className="text-[#4A5568]">GET /v1/analytics/sentiment/{symbol}</code>{' '}
                                                for the filing <span className="text-white">{sentimentRefusal.filing}</span>.
                                            </p>
                                            <p className="text-xs text-[#A7B0C8]">
                                                The server answered <span data-sentiment-status className="font-mono text-[#F59E0B]">{sentimentRefusal.status}</span>:{' '}
                                                <span data-sentiment-detail className="text-[#A7B0C8]">{sentimentRefusal.detail}</span>
                                            </p>
                                            <p className="font-mono text-[10px] break-all text-[#4A5568]">document_id={sentimentRefusal.documentId}</p>
                                        </>
                                    ) : (
                                        <p className="text-xs text-[#A7B0C8]">No filing to score against yet — the filings index returned nothing for {symbol}.</p>
                                    )}
                                </div>
                            ) : (
                                <>
                                    {/* Score card */}
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                                            <p className="text-xs text-[#4A5568] uppercase tracking-wider mb-1">Sentiment Score</p>
                                            <p className={`text-3xl font-bold ${sentiment.overall_score > 0.1 ? 'text-green-400' : sentiment.overall_score < -0.1 ? 'text-red-400' : 'text-yellow-400'}`}>
                                                {sentiment.overall_score > 0 ? '+' : ''}{(sentiment.overall_score * 100).toFixed(0)}
                                            </p>
                                            <p className="text-xs text-[#A7B0C8] mt-1 capitalize">{sentiment.label}</p>
                                        </div>
                                        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                                            <p className="text-xs text-[#4A5568] uppercase tracking-wider mb-1">Confidence</p>
                                            <p className="text-3xl font-bold text-white">{(sentiment.confidence * 100).toFixed(0)}%</p>
                                            <p className="text-xs text-[#4A5568] mt-1">{sentiment.document_count} documents analyzed</p>
                                        </div>
                                        {sentimentDelta && (
                                            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                                                <p className="text-xs text-[#4A5568] uppercase tracking-wider mb-1">vs Prior Period</p>
                                                <p className={`text-3xl font-bold ${sentimentDelta.delta > 0 ? 'text-green-400' : sentimentDelta.delta < 0 ? 'text-red-400' : 'text-yellow-400'}`}>
                                                    {sentimentDelta.delta > 0 ? '+' : ''}{(sentimentDelta.delta * 100).toFixed(0)}
                                                </p>
                                                <p className="text-xs text-[#A7B0C8] mt-1 capitalize">{sentimentDelta.direction}</p>
                                            </div>
                                        )}
                                    </div>

                                    {/* Category breakdown */}
                                    {sentiment.breakdown && sentiment.breakdown.length > 0 && (
                                        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
                                            <p className="text-xs text-[#4A5568] uppercase tracking-wider mb-4">Sentiment by Category</p>
                                            <div className="space-y-3">
                                                {sentiment.breakdown.map(b => (
                                                    <div key={b.category} className="flex items-center gap-3">
                                                        <span className="text-xs text-[#A7B0C8] w-32 flex-shrink-0 capitalize">{b.category}</span>
                                                        <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                                                            <div
                                                                className={`h-full rounded-full transition-all ${b.score > 0.1 ? 'bg-green-400' : b.score < -0.1 ? 'bg-red-400' : 'bg-yellow-400'}`}
                                                                style={{ width: `${Math.abs(b.score) * 100}%`, marginLeft: b.score < 0 ? 'auto' : '0' }}
                                                            />
                                                        </div>
                                                        <span className={`text-xs font-mono w-10 text-right ${b.score > 0.1 ? 'text-green-400' : b.score < -0.1 ? 'text-red-400' : 'text-yellow-400'}`}>
                                                            {b.score > 0 ? '+' : ''}{(b.score * 100).toFixed(0)}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Significant shifts */}
                                    {sentimentDelta?.significant_shifts && sentimentDelta.significant_shifts.length > 0 && (
                                        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
                                            <p className="text-xs text-[#4A5568] uppercase tracking-wider mb-3">Notable Shifts vs Prior Period</p>
                                            <div className="space-y-2">
                                                {sentimentDelta.significant_shifts.map((s, i) => (
                                                    <div key={i} className="flex items-center gap-3">
                                                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${s.direction === 'positive' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                                                            {s.direction === 'positive' ? '▲' : '▼'}
                                                        </span>
                                                        <span className="text-sm text-[#A7B0C8]">{s.topic}</span>
                                                        <span className={`ml-auto text-xs font-mono ${s.direction === 'positive' ? 'text-green-400' : 'text-red-400'}`}>
                                                            {s.change > 0 ? '+' : ''}{(s.change * 100).toFixed(0)} pts
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Longitudinal chart */}
                                    {longitudinal.length > 0 && (
                                        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
                                            <p className="text-xs text-[#4A5568] uppercase tracking-wider mb-4">Revenue Trend</p>
                                            <ResponsiveContainer width="100%" height={200}>
                                                <LineChart data={longitudinal} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                                                    <XAxis dataKey="period" tick={{ fill: '#4A5568', fontSize: 10 }} axisLine={false} tickLine={false} />
                                                    <YAxis tick={{ fill: '#4A5568', fontSize: 10 }} axisLine={false} tickLine={false} width={60} />
                                                    <Tooltip contentStyle={{ backgroundColor: '#0D1117', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', fontSize: '12px', color: '#E8EBF0' }} />
                                                    {['revenue', 'net_income', 'operating_income'].filter(k => longitudinal.some(p => p[k] !== undefined)).map((key, i) => (
                                                        <Line key={key} type="monotone" dataKey={key} stroke={['#00F0FF', '#5B8DF6', '#10B981'][i]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} name={key.replace(/_/g, ' ')} />
                                                    ))}
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {/* Metrics tab */}
                    {activeTab === 'data' && (
                        <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
                            {metrics.length === 0
                                ? <p className="text-sm text-[#4A5568] text-center py-8">No structured metrics found in Gravity index.</p>
                                : (
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                                                {['Metric', 'Value', 'Period', 'Source'].map(h => (
                                                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-[#4A5568]">{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/[0.04]">
                                            {metrics.map((m, i) => {
                                                const src = sourceLabel(m.document_id, documents);
                                                return (
                                                <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                                                    <td className="px-4 py-2.5 text-[#A7B0C8]">{m.metric}</td>
                                                    <td className="px-4 py-2.5 font-mono text-white"
                                                        {...figureAttrs(m.period, m.unit, overview?.FiscalYearEnd, src)}>
                                                        {typeof m.value === 'number' && m.unit === 'USD'
                                                            ? fmt(m.value, 'currency')
                                                            : typeof m.value === 'number' ? m.value.toLocaleString() : m.value}
                                                        <span className="ml-1 text-xs text-[#4A5568]">{unitLabel(m.unit)}</span>
                                                    </td>
                                                    <td className="px-4 py-2.5 text-[#4A5568]">{periodLabel(m.period, overview?.FiscalYearEnd)}</td>
                                                    <td className="px-4 py-2.5" data-source-cell={src}>
                                                        {src === NULL_MARK
                                                            ? <span className="text-[#4A5568]"
                                                                title="No filing id on this row — the figure is XBRL companyfacts, which names no single filing. Nothing here is guessed from the period.">
                                                                {NULL_MARK}
                                                            </span>
                                                            : <button type="button" data-source-affordance
                                                                className="text-xs text-[#00F0FF] hover:underline"
                                                                onClick={() => setSourceDoc(documents.find(d => d.id === m.document_id) ?? null)}>
                                                                {src}
                                                            </button>}
                                                    </td>
                                                </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                )
                            }
                        </div>
                    )}
                </div>
            )}

            {/* CT2-4 · row R5. Every word here comes off the resolved
                GravityDocument — the filing this page received and matched by id.
                Nothing is derived from the metric's period (§3 rule 1), and
                EdgarLink is given the filing's own date with allowLatest left
                false, so an unresolvable date links to search rather than to the
                wrong document. */}
            {sourceDoc && (
                <div className="fixed inset-0 z-50 flex justify-end bg-black/60"
                    onClick={() => setSourceDoc(null)}>
                    <aside role="dialog" aria-label="Source filing" data-source-drawer
                        className="h-full w-full max-w-sm overflow-y-auto border-l border-white/[0.08] bg-[#0B0F1A] p-5"
                        onClick={e => e.stopPropagation()}>
                        <div className="flex items-start justify-between gap-3">
                            <p className="text-xs uppercase tracking-wider text-[#4A5568]">Source filing</p>
                            <button type="button" onClick={() => setSourceDoc(null)}
                                className="text-xs text-[#A7B0C8] hover:text-white">Close</button>
                        </div>
                        <p className="mt-3 text-lg font-semibold text-white" data-drawer-filing-type>
                            {sourceDoc.filing_type || NULL_MARK}
                        </p>
                        <p className="text-sm text-[#A7B0C8]" data-drawer-filing-date>
                            {sourceDoc.filing_date || NULL_MARK}
                        </p>
                        <p className="mt-2 text-sm text-[#A7B0C8]">{sourceDoc.title || NULL_MARK}</p>
                        <p className="mt-4 font-mono text-[10px] break-all text-[#4A5568]" data-drawer-document-id>
                            {sourceDoc.id}
                        </p>
                        <div className="mt-4">
                            <EdgarLink ticker={sourceDoc.ticker} filingType={sourceDoc.filing_type}
                                filingDate={sourceDoc.filing_date ?? undefined} />
                        </div>
                    </aside>
                </div>
            )}
        </div>
    );
}
