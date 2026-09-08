// Sentiment tab — extracted verbatim from CompanyPage.tsx (CF-9).

import { NULL_MARK } from '../../lib/figures';
import { headline as sentimentHeadline, type SentimentView } from '../../lib/sentimentSkill';
import type { SentimentDelta, SentimentResult } from './types';

export default function SentimentTab({
    symbol, sentiment, sentimentView, sentimentRefusal, sentimentDelta,
}: {
    symbol: string;
    sentiment: SentimentResult | null;
    sentimentView: SentimentView | null;
    sentimentRefusal: { status: number; detail: string; documentId: string; filing: string } | null;
    sentimentDelta: SentimentDelta | null;
}) {
    return (
        <div className="space-y-5">
            {/* The skill's own account of the reading: what was
                measured, over which filings, and what it does
                not cover. Rendered whenever the skill answered,
                score or no score — an abstention has a basis
                too, and hiding it is what made the old tab look
                like a broken endpoint. */}
            {sentimentView && (
                <div data-sentiment-basis className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-3">
                    <p data-sentiment-headline className="text-sm text-white">
                        {sentimentHeadline(sentimentView, symbol)}
                    </p>
                    {sentimentView.candidates.length > 0 && (
                        <p className="text-xs text-[#A7B0C8]">
                            Candidates:{' '}
                            {sentimentView.candidates.map(c => `${c.ticker} (${c.name})`).join(' · ')}
                        </p>
                    )}
                    {sentimentView.window.filings.length > 0 && (
                        <p className="text-xs text-[#A7B0C8]">
                            Window: <span className="text-white">{sentimentView.window.start || NULL_MARK}</span>
                            {' → '}<span className="text-white">{sentimentView.window.end || NULL_MARK}</span>
                            {' · '}{sentimentView.window.filings.join(', ')}
                        </p>
                    )}
                    {Object.keys(sentimentView.sourceMix).length > 0 && (
                        <p className="text-xs text-[#A7B0C8]">
                            Sources:{' '}
                            {Object.entries(sentimentView.sourceMix)
                                .map(([k, n]) => `${k} (${n})`).join(' · ')}
                        </p>
                    )}
                    {(sentimentView.positive.length > 0 || sentimentView.negative.length > 0) && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div data-sentiment-positive className="space-y-1">
                                <p className="text-xs uppercase tracking-wider text-green-400">Positive evidence</p>
                                {sentimentView.positive.length === 0
                                    ? <p className="text-xs text-[#4A5568]">None above the evidence threshold.</p>
                                    : sentimentView.positive.map((e, i) => (
                                        <p key={i} className="text-xs text-[#A7B0C8]">“{e.text}”</p>
                                    ))}
                            </div>
                            <div data-sentiment-negative className="space-y-1">
                                <p className="text-xs uppercase tracking-wider text-red-400">Negative evidence</p>
                                {sentimentView.negative.length === 0
                                    ? <p className="text-xs text-[#4A5568]">None above the evidence threshold.</p>
                                    : sentimentView.negative.map((e, i) => (
                                        <p key={i} className="text-xs text-[#A7B0C8]">“{e.text}”</p>
                                    ))}
                            </div>
                        </div>
                    )}
                    {sentimentView.limitations.length > 0 && (
                        <ul data-sentiment-limitations className="list-disc pl-4 space-y-1">
                            {sentimentView.limitations.map((l, i) => (
                                <li key={i} className="text-xs text-[#4A5568]">{l}</li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {!sentiment ? (
                // CT2-5 · row R6. "No sentiment data indexed yet"
                // was a guess about WHY. State what was asked and
                // what the server said, verbatim — and show no
                // number, because none was returned.
                sentimentView ? null : (
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
                )
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
                        {/* Only when the source actually returned a
                            confidence. The skill does not compute one,
                            and rendering `0%` for "absent" is the same
                            fabrication as rendering 0 for a missing
                            metric. */}
                        {sentiment.confidence > 0 && (
                            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                                <p className="text-xs text-[#4A5568] uppercase tracking-wider mb-1">Confidence</p>
                                <p className="text-3xl font-bold text-white">{(sentiment.confidence * 100).toFixed(0)}%</p>
                                <p className="text-xs text-[#4A5568] mt-1">{sentiment.document_count} documents analyzed</p>
                            </div>
                        )}
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

                </>
            )}
        </div>
    );
}
