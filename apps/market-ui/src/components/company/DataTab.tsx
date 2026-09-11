// Structured-metrics tab — extracted verbatim from CompanyPage.tsx (CF-9).

import { NULL_MARK, periodLabel, unitLabel, figureAttrs, sourceLabel } from '../../lib/figures';
import { canonicalSecUrl } from '../../lib/secUrl';
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
                                // V2-8 · four states, in order of how much is known.
                                //
                                // An indexed filing keeps the in-app drawer. An
                                // exact XBRL row resolves no document id — it is
                                // "xbrl:<TICKER>" on all 150,596 of them — so the
                                // server names the filing by accession instead and
                                // this links straight to it. Failing both, the
                                // server says WHY, and only a payload that says
                                // nothing at all still renders the bare marker.
                                const filingUrl = m.accession
                                    ? canonicalSecUrl({ cik: m.cik, accession: m.accession })
                                    : '';
                                const filingLabel = [m.filing_type, m.filed]
                                    .filter(Boolean).join(' · ');
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
                                    <td className="px-4 py-2.5"
                                        data-source-cell={src !== NULL_MARK ? src : filingUrl ? filingLabel : NULL_MARK}>
                                        {src !== NULL_MARK
                                            ? <button type="button" data-source-affordance
                                                className="text-xs text-[#00F0FF] hover:underline"
                                                onClick={() => onSelectSource(documents.find(d => d.id === m.document_id) ?? null)}>
                                                {src}
                                            </button>
                                            : filingUrl
                                                ? <a href={filingUrl} target="_blank" rel="noopener noreferrer"
                                                    data-source-filing={m.accession ?? ''}
                                                    className="text-xs text-[#00F0FF] hover:underline"
                                                    title={`Accession ${m.accession} · period ending ${m.period_end ?? NULL_MARK}`}>
                                                    {filingLabel || m.accession}
                                                </a>
                                                : m.source_reason
                                                    ? <span data-source-unresolved
                                                        className="text-xs text-[#4A5568]"
                                                        title={m.source_reason}>
                                                        {m.source_reason}
                                                    </span>
                                                    : <span className="text-[#4A5568]"
                                                        title="This payload carries no provenance for the row at all — not an accession, and not a reason one is missing. Nothing here is guessed from the period.">
                                                        {NULL_MARK}
                                                    </span>}
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
