// V3-9 · one chart, one unit, one period.
//
// CompanyPage built the secondary bar chart by taking the first eight numeric
// metrics irrespective of unit and keying them on `m.period`. Revenue in dollars,
// EPS per share and a margin in percent were drawn as one series against one Y
// axis — and since those eight rows are typically all from the SAME period, under
// eight identical X labels. A shared axis is a claim that the bars are
// comparable; that claim was false.
//
// Pure, and its own module so a fixture can reach it.

import type { GravityMetric } from './types';

export interface ChartGroup {
    /** The unit every bar in `data` is denominated in. `null` when the server
     *  sent none — which is stated, not filled in. */
    unit: string | null;
    period: string;
    /** How many numeric facts are NOT on this chart — whether because they are on
     *  another unit or period, or because they fell past the eight-bar cap. Shown,
     *  so the chart never reads as the whole set. */
    omitted: number;
    data: { name: string; value: number; label: string }[];
}

/**
 * The largest set of metrics that share one unit AND one period, capped at eight
 * bars. Returns null when there is nothing numeric to draw.
 */
export function chartGroupFor(metrics: GravityMetric[]): ChartGroup | null {
    const numeric = metrics.filter(m => typeof m.value === 'number' && m.period);
    const groups = new Map<string, GravityMetric[]>();
    for (const m of numeric) {
        // JSON, not a delimiter: both a unit ("USD/shares") and a period
        // ("Q4 2025") can contain a space or a slash.
        const key = JSON.stringify([m.unit?.trim() ?? '', m.period]);
        const bucket = groups.get(key);
        if (bucket) bucket.push(m); else groups.set(key, [m]);
    }
    const best = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (!best) return null;

    const [key, rows] = best;
    const [unit, period] = JSON.parse(key) as [string, string];
    const data = rows.slice(0, 8).map(m => ({
            // The XBRL metric_name is verbose — "Revenue (Total Revenue, Net
            // Sales)". The axis gets the head of it; the tooltip keeps all of it.
        name: m.metric.replace(/\s*\(.*$/, '').trim() || m.metric,
        value: m.value as number,
        label: m.metric,
    }));

    // Counted against what is DRAWN, not against the group: eight bars out of
    // twenty on one unit leaves twelve facts off the chart, and saying "0 omitted"
    // there would be the chart claiming to be the whole set.
    return { unit: unit || null, period, omitted: numeric.length - data.length, data };
}
