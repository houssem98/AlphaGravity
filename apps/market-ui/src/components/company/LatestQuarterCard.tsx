import { figureAttrs, formatFinancialValue, NULL_MARK } from '../../lib/figures';
import { selectComparablePeriods } from '../../lib/periods';
import type { PeriodBasis } from '../../lib/periods';
// Latest-period card — headline P&L from exact XBRL rows, newest period vs
// prior, with deltas. Pure: derives everything from the metrics array the
// company page already fetches (/v1/company/{ticker}/financials).

interface Metric { metric: string; value: string | number; unit?: string; period?: string; }

// Headline lines, in display order. `match` hits the verbose XBRL metric_name
// by substring (e.g. "Revenue (Total Revenue, Net Sales)").
// V3-1 · `Gross Profit` used to match `/^Gross Profit|Gross margin/i`, so a
// filer reporting a MARGIN got it printed under the word PROFIT, and then run
// through a money formatter: `Gross margin 45 %` rendered as `Gross Profit $45`.
// A profit and a margin are different facts with different units; they get
// different rows, and each row's unit comes from the fact, not from this table.
const HEADLINE: { label: string; match: RegExp }[] = [
    { label: 'Revenue', match: /^Revenue|Total net sales|Net Sales/i },
    { label: 'Gross Profit', match: /^Gross Profit/i },
    { label: 'Gross Margin', match: /^Gross margin/i },
    { label: 'Operating Income', match: /^Operating Income/i },
    { label: 'Net Income', match: /^Net Income/i },
    { label: 'Diluted EPS', match: /EPS\).*Diluted|Diluted.*EPS/i },
];

function num(v: string | number): number | null {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return isNaN(n) ? null : n;
}

/** A figure already denominated in percent. Its change is in POINTS, not percent. */
const isPct = (unit: string | null) => unit?.trim() === '%';

export interface QuarterRow {
    label: string;
    cur: string;
    prev: string;
    delta: number | null;
    /** What `delta` is measured in: `pp` for a percentage-point move on a figure
     *  that is itself a percentage, `%` for a relative change on anything else. */
    deltaUnit: 'pp' | '%';
    /** The unit the SERVER sent for this fact. `null` when it sent none — which
     *  is a state the card renders, not one it fills in. */
    unit: string | null;
}

// Pure: pick the two most recent comparable periods and build the headline rows.
export function computeQuarterRows(metrics: Metric[]): { latest: string; prior?: string; basis: PeriodBasis; rows: QuarterRow[] } | null {
    // V2-5 · this sorted the period STRINGS and took the top two, so a mixed set
    // compared "Q4 2025" against "FY2025" — Q sorts above F — and printed a
    // delta between a quarter and a year. The two periods now come back on one
    // basis, or the second comes back undefined and no delta is drawn.
    const selection = selectComparablePeriods(metrics.map(m => m.period).filter(Boolean) as string[]);
    if (!selection) return null;
    const { latest, prior, basis } = selection;

    const rowFor = (match: RegExp, period: string): Metric | undefined =>
        metrics.find(m => m.period === period && match.test(m.metric));

    const rows = HEADLINE.map(h => {
        const curRow = rowFor(h.match, latest);
        const cur = curRow ? num(curRow.value) : null;
        if (curRow === undefined || cur === null) return null;
        const prevRow = prior ? rowFor(h.match, prior) : undefined;
        const prev = prevRow ? num(prevRow.value) : null;

        // V3-1 · the unit is the fact's own. `unit: isEps ? 'USD/share' : 'USD'`
        // asserted a currency from the row's POSITION in HEADLINE, which is how a
        // percentage came to be stamped USD and drawn with a dollar sign.
        const unit = curRow.unit?.trim() || null;
        const sameBasis = prevRow !== undefined && (prevRow.unit?.trim() || null) === unit;

        // A percentage's change is a move in POINTS. 45% against 40% is +5pp, and
        // calling it +12.5% is a different, and much larger-sounding, statement.
        const pct = isPct(unit);
        const delta = prev !== null && sameBasis
            ? (pct ? cur - prev : (prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : null))
            : null;

        return {
            label: h.label,
            cur: formatFinancialValue(cur, unit ?? undefined, curRow.metric),
            prev: prev === null || !sameBasis
                ? NULL_MARK
                : formatFinancialValue(prev, unit ?? undefined, prevRow!.metric),
            delta,
            deltaUnit: pct ? 'pp' as const : '%' as const,
            unit,
        };
    }).filter(Boolean) as QuarterRow[];

    return rows.length ? { latest, prior, basis, rows } : null;
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
                                    {...figureAttrs(latest, r.unit ?? undefined, fiscalYearEnd)}>{r.cur}</td>
                                <td className="py-2 text-right font-mono text-[color:var(--text-2)] pl-3"
                                    {...figureAttrs(prior, r.unit ?? undefined, fiscalYearEnd)}>{r.prev}</td>
                                {/* V3-1 · the delta states its own unit. A margin moving
                                    45% → 40% is -5pp; printing -11.1% there describes a
                                    different and much larger-sounding event. */}
                                <td className={`py-2 text-right font-mono pl-3 ${r.delta === null ? 'text-[#4A5568]' : r.delta >= 0 ? 'text-green-400' : 'text-red-400'}`}
                                    {...figureAttrs(prior ? `${latest} vs ${prior}` : undefined, r.delta === null ? undefined : r.deltaUnit, fiscalYearEnd)}>
                                    {r.delta === null ? NULL_MARK : `${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(1)}${r.deltaUnit}`}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
