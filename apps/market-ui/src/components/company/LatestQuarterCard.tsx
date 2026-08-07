import { figureAttrs } from '../../lib/figures';
// Latest-period card — headline P&L from exact XBRL rows, newest period vs
// prior, with deltas. Pure: derives everything from the metrics array the
// company page already fetches (/v1/company/{ticker}/financials).

interface Metric { metric: string; value: string | number; unit?: string; period?: string; }

// Headline lines, in display order. `match` hits the verbose XBRL metric_name
// by substring (e.g. "Revenue (Total Revenue, Net Sales)").
const HEADLINE: { label: string; match: RegExp; pct?: boolean }[] = [
    { label: 'Revenue', match: /^Revenue|Total net sales|Net Sales/i },
    { label: 'Gross Profit', match: /^Gross Profit|Gross margin/i },
    { label: 'Operating Income', match: /^Operating Income/i },
    { label: 'Net Income', match: /^Net Income/i },
    { label: 'Diluted EPS', match: /EPS\).*Diluted|Diluted.*EPS/i },
];

function num(v: string | number): number | null {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return isNaN(n) ? null : n;
}

function money(n: number): string {
    if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
    if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    return `$${n.toLocaleString()}`;
}

export interface QuarterRow { label: string; cur: string; prev: string; delta: number | null; unit: string; }

// Pure: pick the two most recent periods and build the headline rows with deltas.
export function computeQuarterRows(metrics: Metric[]): { latest: string; prior?: string; rows: QuarterRow[] } | null {
    // Two most recent periods (string desc works for FYyyyy / ISO dates).
    const periods = [...new Set(metrics.map(m => m.period).filter(Boolean) as string[])]
        .sort().reverse();
    if (periods.length === 0) return null;
    const [latest, prior] = periods;

    const valueFor = (match: RegExp, period: string): number | null => {
        const row = metrics.find(m => m.period === period && match.test(m.metric));
        return row ? num(row.value) : null;
    };

    const rows = HEADLINE.map(h => {
        const cur = valueFor(h.match, latest);
        const prev = prior ? valueFor(h.match, prior) : null;
        if (cur === null) return null;
        const isEps = /EPS/i.test(h.label);
        const delta = prev !== null && prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : null;
        return {
            label: h.label,
            cur: isEps ? `$${cur.toFixed(2)}` : money(cur),
            prev: prev === null ? '—' : isEps ? `$${prev.toFixed(2)}` : money(prev),
            delta,
            // CT-5 · both columns are money unless the row is per-share.
            unit: isEps ? 'USD/share' : 'USD',
        };
    }).filter(Boolean) as QuarterRow[];

    return rows.length ? { latest, prior, rows } : null;
}

export default function LatestQuarterCard({ metrics, fiscalYearEnd }: { metrics: Metric[]; fiscalYearEnd?: string }) {
    const computed = computeQuarterRows(metrics);
    if (!computed) return null;
    const { latest, prior, rows } = computed;

    return (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
            <div className="flex items-baseline justify-between mb-4">
                <p className="text-xs text-[#00F0FF] uppercase tracking-wider font-semibold">Latest Reported Period</p>
                <p className="text-[10px] text-[#4A5568]">{latest}{prior ? ` vs ${prior}` : ''} · exact XBRL</p>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-[10px] uppercase tracking-wider text-[#4A5568] border-b border-white/[0.06]">
                            <th className="text-left font-medium py-2">Metric</th>
                            <th className="text-right font-medium py-2 pl-3">{latest}</th>
                            <th className="text-right font-medium py-2 pl-3">{prior ?? 'Prior'}</th>
                            <th className="text-right font-medium py-2 pl-3">Δ</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                        {rows.map(r => (
                            <tr key={r.label}>
                                <td className="py-2 text-[#A7B0C8]">{r.label}</td>
                                {/* MP-8 · U3. Measured on prod at 360x780: "$130.50B" ended
                                    exactly where "+65.5%" began — a 0px gap — and the prior
                                    column's #4A5568 came to 2.55:1 against this card, well
                                    under the 4.5:1 R11 asks for. `pl-3` is the gutter; the
                                    colour moves to the --text-2 token rather than another
                                    hand-picked grey. Type size is unchanged. */}
                                {/* CT-5 · row 7. Every figure here states the period it
                                    belongs to and the unit it is denominated in. */}
                                <td className="py-2 text-right font-mono text-white pl-3"
                                    {...figureAttrs(latest, r.unit, fiscalYearEnd)}>{r.cur}</td>
                                <td className="py-2 text-right font-mono text-[color:var(--text-2)] pl-3"
                                    {...figureAttrs(prior, r.unit, fiscalYearEnd)}>{r.prev}</td>
                                <td className={`py-2 text-right font-mono pl-3 ${r.delta === null ? 'text-[#4A5568]' : r.delta >= 0 ? 'text-green-400' : 'text-red-400'}`}
                                    {...figureAttrs(prior ? `${latest} vs ${prior}` : undefined, r.delta === null ? undefined : '%', fiscalYearEnd)}>
                                    {r.delta === null ? '—' : `${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(1)}%`}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
