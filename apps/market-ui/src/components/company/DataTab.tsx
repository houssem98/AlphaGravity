// Structured-metrics tab — extracted verbatim from CompanyPage.tsx (CF-9).

import { NULL_MARK, periodLabel, unitLabel, figureAttrs, sourceLabel } from '../../lib/figures';
import { fmt } from './presentation';
import type { GravityDocument, GravityMetric, MarketOverview } from './types';

export default function DataTab({ metrics, documents, overview, onSelectSource }: {
    metrics: GravityMetric[];
    documents: GravityDocument[];
    overview: MarketOverview | null;
    onSelectSource: (doc: GravityDocument | null) => void;
}) {
    return (
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
                                                onClick={() => onSelectSource(documents.find(d => d.id === m.document_id) ?? null)}>
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
    );
}
