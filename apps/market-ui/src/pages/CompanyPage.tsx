// Company Profile Page — AlphaSense-style company intelligence hub
// Combines Alpha Vantage market data + Gravity's indexed filings + structured financials

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ArrowLeft, TrendingUp, TrendingDown, FileText, Zap,
    ExternalLink, BarChart3, Building2, RefreshCw, Activity, Grid3x3,
} from 'lucide-react';
import { peersFor } from '../lib/peers';
import { newCount } from '../lib/newFilings';
import { NULL_MARK } from '../lib/figures';
import EdgarLink from '../components/EdgarLink';
import OverviewTab from '../components/company/OverviewTab';
import FilingsTab from '../components/company/FilingsTab';
import SentimentTab from '../components/company/SentimentTab';
import DataTab from '../components/company/DataTab';
import TickerEntry from '../components/company/TickerEntry';
import { fmt, StatCard } from '../components/company/presentation';
import { useCompanyData } from '../components/company/useCompanyData';
import { chartGroupFor } from '../components/company/chartGroup';
import type { GravityDocument, CompanyTab } from '../components/company/types';

export type { CompanyTab };




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

    const {
        overview, quote, documents, metrics, longitudinal, trendMetric, trendReason, trendUnit, loading,
        failedSurfaces, watermark,
        sentiment, sentimentView, sentimentRefusal, sentimentDelta,
    } = useCompanyData(symbol);
    const [activeTab, setActiveTab] = useState<CompanyTab>(tab ?? 'overview');
    // CT2-4 · row R5. The filing a figure's id RESOLVED to. It is set from the
    // documents list by id and never constructed from the metric, so the drawer
    // can only ever name a filing this page actually received.
    const [sourceDoc, setSourceDoc] = useState<GravityDocument | null>(null);


    // No ticker in the URL (the "Companies" nav link points to bare /companies).
    // TickerEntry verifies what was typed before opening a page for it — CF-24.
    if (!symbol) return <TickerEntry onOpen={openTicker} />;

    const price = quote?.price ?? null;
    const changePct = quote?.changePct ?? null;
    const isUp = changePct !== null ? changePct >= 0 : null;

    const chartGroup = chartGroupFor(metrics);


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
                            ...(sentiment || sentimentRefusal || sentimentView
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
                        <OverviewTab symbol={symbol} metrics={metrics} overview={overview}
                            longitudinal={longitudinal} documents={documents} chartGroup={chartGroup}
                            trendMetric={trendMetric} trendReason={trendReason} trendUnit={trendUnit} />
                    )}

                    {/* Filings tab */}
                    {activeTab === 'filings' && (
                        <FilingsTab documents={documents} symbol={symbol} watermark={watermark} />
                    )}

                    {/* Sentiment tab */}
                    {activeTab === 'sentiment' && (
                        <SentimentTab symbol={symbol} sentiment={sentiment}
                            sentimentView={sentimentView} sentimentRefusal={sentimentRefusal}
                            sentimentDelta={sentimentDelta} />
                    )}

                    {/* Metrics tab */}
                    {activeTab === 'data' && (
                        <DataTab metrics={metrics} documents={documents}
                            overview={overview} onSelectSource={setSourceDoc} />
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
