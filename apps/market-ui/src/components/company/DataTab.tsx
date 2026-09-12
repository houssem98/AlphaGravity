// Structured-metrics tab — extracted verbatim from CompanyPage.tsx (CF-9).

import { NULL_MARK, periodLabel, unitLabel, figureAttrs, sourceLabel, formatFinancialValue } from '../../lib/figures';
import { canonicalSecUrl } from '../../lib/secUrl';
import type { GravityDocument, GravityMetric, MarketOverview } from './types';

/**
 * V4-3 · what a figure in dispute looks like.
 *
 * Every reported value, none of them promoted to "the" value. Showing one of two
 * disagreeing numbers in the position where a canonical figure normally sits is
 * the claim this ledger exists to refuse — and a reader cannot tell it was a
 * choice at all unless the alternatives are on screen next to it.
 */
function DisputedValue({ values, unit, metric }: {
    values?: (number | null)[];
    unit?: string;
    metric?: string;
}) {
    const reported = (values ?? []).filter((v): v is number => typeof v === 'number');
    return (
        <span data-disputed-values={reported.length}>
            <span className="text-[10px] uppercase tracking-wider mr-1.5">In dispute</span>
            {reported.length === 0
                ? NULL_MARK
                : reported.map((v, i) => (
                    <span key={i}>
                        {i > 0 && <span className="text-[#4A5568] mx-1">vs</span>}
                        {formatFinancialValue(v, unit, metric)}
                    </span>
                ))}
            <span className="ml-1 text-xs text-[#4A5568]">{unitLabel(unit)}</span>
        </span>
    );
}

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
                                    {/* V4-3 · a disputed figure is not a figure.
                                        V3-3 marks the row `ambiguous` when two filings
                                        report different values for one (metric, period),
                                        and this cell rendered the number anyway — the
                                        only signal being prose in the Source column,
                                        which reads as "we could not find the filing"
                                        rather than "two filings disagree". The dispute
                                        now lands where the reader looks.

                                        V4-6 · and it formats through the one formatter.
                                        `m.unit === 'USD'` was exact equality against a
                                        single spelling, so "USD M" — which is what the
                                        server's own `_get_metric_unit` answers — fell
                                        out of currency formatting entirely. */}
                                    <td className={`px-4 py-2.5 font-mono ${m.ambiguous ? 'text-[#F59E0B]' : 'text-white'}`}
                                        data-ambiguous={m.ambiguous ? 'true' : undefined}
                                        title={m.ambiguous ? m.source_reason ?? undefined : undefined}
                                        {...figureAttrs(m.period, m.unit, overview?.FiscalYearEnd, src)}>
                                        {m.ambiguous
                                            ? <DisputedValue values={m.conflicting_values} unit={m.unit} metric={m.metric} />
                                            : <>
                                                {typeof m.value === 'number'
                                                    ? formatFinancialValue(m.value, m.unit ?? undefined, m.metric)
                                                    : m.value}
                                                <span className="ml-1 text-xs text-[#4A5568]">{unitLabel(m.unit)}</span>
                                            </>}
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
