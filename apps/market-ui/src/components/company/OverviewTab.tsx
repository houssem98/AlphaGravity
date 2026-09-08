// Overview tab — extracted verbatim from CompanyPage.tsx (CF-9).

import {
    BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Cell,
} from 'recharts';
import CompanyBrief from './CompanyBrief';
import LatestQuarterCard from './LatestQuarterCard';
import TranscriptSummary from './TranscriptSummary';
import DevilsAdvocate from './DevilsAdvocate';
import { COLORS } from './presentation';
import type { GravityDocument, GravityMetric, LongitudinalPoint, MarketOverview } from './types';

export default function OverviewTab({
    symbol, metrics, overview, longitudinal, documents, chartData,
}: {
    symbol: string;
    metrics: GravityMetric[];
    overview: MarketOverview | null;
    longitudinal: LongitudinalPoint[];
    documents: GravityDocument[];
    chartData: { name: string; value: number; label: string }[];
}) {
    const transcript = documents.find(d => d.filing_type === 'earnings_transcript');
    return (
        <div className="space-y-5">
            <LatestQuarterCard metrics={metrics} fiscalYearEnd={overview?.FiscalYearEnd} />
            {/* Revenue trend. This lived inside the `sentiment` tab behind
                `!sentiment ?`, so it only rendered once a sentiment score
                existed -- and GET /v1/analytics/sentiment/{t} answers 404
                until one is computed, which nothing does. A revenue series
                does not depend on sentiment; it belongs beside the rest of
                the company's numbers. */}
            {longitudinal.length > 0 && (
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
                    <p className="text-xs text-[#4A5568] uppercase tracking-wider mb-4">Revenue Trend</p>
                    <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={longitudinal} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                            <XAxis dataKey="period" tick={{ fill: '#4A5568', fontSize: 10 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fill: '#4A5568', fontSize: 10 }} axisLine={false} tickLine={false} width={60}
                                    tickFormatter={(v: number) => `$${(v / 1e9).toFixed(0)}B`} />
                            <Tooltip contentStyle={{ backgroundColor: '#0D1117', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', fontSize: '12px', color: '#E8EBF0' }}
                                    formatter={(v: number) => [`$${(v / 1e9).toFixed(2)}B`, 'revenue']} />
                            {['revenue', 'net_income', 'operating_income'].filter(k => longitudinal.some(p => p[k] !== undefined)).map((key, i) => (
                                <Line key={key} type="monotone" dataKey={key} stroke={['#00F0FF', '#5B8DF6', '#10B981'][i]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} name={key.replace(/_/g, ' ')} />
                            ))}
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            )}
            {transcript ? <TranscriptSummary ticker={symbol} date={transcript.filing_date} /> : null}
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
    );
}
