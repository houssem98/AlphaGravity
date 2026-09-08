// Small presentational pieces shared by the company tabs.
// Extracted verbatim from CompanyPage.tsx (CF-9).

import { useNavigate } from 'react-router-dom';
import { Zap } from 'lucide-react';
import { NULL_MARK, unitLabel } from '../../lib/figures';
import type { GravityDocument } from './types';

export const COLORS = ['#00F0FF', '#5B8DF6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

export function fmt(n: string | number, style: 'currency' | 'percent' | 'number' = 'number'): string {
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

export function StatCard({ label, value, period, unit, sub }: {
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

export function FilingRow({ doc, ticker, isNew }: { doc: GravityDocument; ticker: string; isNew?: boolean }) {
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
