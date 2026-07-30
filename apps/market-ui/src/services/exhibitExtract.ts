// G2a — numeric series out of report tables into bounded ExhibitSpecs.
//
// Extractor-only, like the stat cards: every bar value is parsed out of a
// cell the report already wrote. Nothing is converted between units and
// nothing is inferred, so a chart can only ever plot a number the report
// states. `exhibitValueViolations` is the gate that proves it.

import type { ExhibitSpec, ExhibitBar } from './reportQaGates';

export interface ParsedCell {
    value: number;
    unit: string;   // '%', 'bps', '$B', '$M', 'x', '' for a bare number
    raw: string;    // the numeric text exactly as the report wrote it
}

// Every unit alternative ends at a word boundary. Without that, the "t" of
// "200 to 300 bps" is read as the trillions suffix.
const UNIT_TOKEN = /%|bps\b|bp\b|billion\b|million\b|trillion\b|[BMKT]\b|x\b/i;

const CELL_NUMBER = new RegExp(
    `([+-]|~|approx\\.?\\s*)?\\s*(\\$)?\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*(${UNIT_TOKEN.source})?`,
    'i',
);

const UNIT_ALIAS: Record<string, string> = {
    b: '$B', billion: '$B', m: '$M', million: '$M', k: '$K', t: '$T', trillion: '$T',
    bp: 'bps', bps: 'bps', '%': '%', x: 'x',
};

// Inequalities and placeholders are not plottable values — a chart that
// renders "<100K" as 100 would be asserting something the report did not.
const NOT_A_VALUE = /\bN\/?A\b|—|^\s*-\s*$|[<>≤≥]/i;

export function parseCellNumber(cell: string): ParsedCell | null {
    const text = cell.trim();
    if (!text || NOT_A_VALUE.test(text)) return null;
    const m = CELL_NUMBER.exec(text);
    if (!m) return null;

    const [, sign, dollar, digits, suffix] = m;
    const magnitude = Number(digits.replace(/,/g, ''));
    if (!Number.isFinite(magnitude)) return null;

    // A range ("30–40%") states its unit after the second figure. Take the
    // first figure — the report's own number, no midpoint arithmetic — but
    // read the unit from wherever in the cell it appears.
    const key = (suffix ?? text.match(UNIT_TOKEN)?.[0] ?? '').toLowerCase();
    let unit = UNIT_ALIAS[key] ?? (key === '' ? '' : key);
    // "$12.2B" is dollars; a bare "3.5M" is a count of things.
    if (!dollar && (unit === '$B' || unit === '$M' || unit === '$K' || unit === '$T')) {
        unit = unit.slice(1);
    }
    if (dollar && unit === '') unit = '$';

    return {
        value: sign === '-' ? -magnitude : magnitude,
        unit,
        raw: m[0].trim(),
    };
}

export interface MarkdownTable {
    headers: string[];
    rows: string[][];
}

// Row labels and headers are frequently bolded; a chart axis should not
// render "**NVIDIA Corp**".
const plain = (s: string) => s.replace(/[*`]/g, '').replace(/\s+/g, ' ').trim();

const cellsOf = (line: string) => line.split('|').slice(1, -1).map(c => c.trim());
const isSeparator = (line: string) => /^\s*\|[\s|:-]+\|\s*$/.test(line);

export function parseMarkdownTables(markdown: string): MarkdownTable[] {
    const tables: MarkdownTable[] = [];
    let current: string[] = [];
    const flush = () => {
        // header + separator + at least one body row
        if (current.length >= 3 && isSeparator(current[1])) {
            tables.push({
                headers: cellsOf(current[0]),
                rows: current.slice(2).filter(l => !isSeparator(l)).map(cellsOf),
            });
        }
        current = [];
    };
    for (const line of markdown.split('\n')) {
        if (/^\s*\|/.test(line)) current.push(line);
        else flush();
    }
    flush();
    return tables;
}

// A series survives only if at least two cells parse AND agree on a unit.
// Mixed units ("$12.2B" beside "~$500M") are dropped rather than converted.
function seriesFrom(
    labels: string[],
    cells: string[],
    sourceIds: string[],
): { bars: ExhibitBar[]; unit: string } | null {
    const parsed = cells.map(parseCellNumber);
    const units = parsed.filter((p): p is ParsedCell => p !== null).map(p => p.unit);
    if (units.length < 2) return null;

    // Majority unit wins; cells in any other unit are excluded.
    const tally = new Map<string, number>();
    for (const u of units) tally.set(u, (tally.get(u) ?? 0) + 1);
    const unit = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];

    const bars: ExhibitBar[] = [];
    parsed.forEach((p, i) => {
        if (p && p.unit === unit && labels[i]) {
            bars.push({ label: plain(labels[i]), value: p.value, period: '', sourceIds });
        }
    });
    return bars.length >= 2 ? { bars, unit } : null;
}

const SOURCE_HEADER = /source|citation|reference/i;

export function extractExhibits(markdown: string, max = 3): ExhibitSpec[] {
    const specs: ExhibitSpec[] = [];

    for (const { headers, rows } of parseMarkdownTables(markdown)) {
        const srcCol = headers.findIndex(h => SOURCE_HEADER.test(h));
        const dataCols = headers
            .map((_, i) => i)
            .filter(i => i !== 0 && i !== srcCol);

        // Orientation A — each ROW is a series across the entity columns.
        for (const row of rows) {
            const title = row[0];
            if (!title) continue;
            const s = seriesFrom(
                dataCols.map(i => headers[i]),
                dataCols.map(i => row[i] ?? ''),
                srcCol >= 0 && row[srcCol] ? [row[srcCol]] : [],
            );
            if (s) specs.push({ title: plain(title), unit: s.unit, bars: s.bars });
        }

        // Orientation B — each COLUMN is a series across the row labels.
        for (const i of dataCols) {
            const s = seriesFrom(
                rows.map(r => r[0] ?? ''),
                rows.map(r => r[i] ?? ''),
                [],
            );
            if (s) specs.push({ title: plain(headers[i]), unit: s.unit, bars: s.bars });
        }
    }

    // Widest comparisons first; a 5-entity series says more than a 2-entity one.
    return specs.sort((a, b) => b.bars.length - a.bars.length).slice(0, max);
}

// Bar geometry, kept out of the renderer so it can be tested without a DOM.
// Series in this corpus go negative (bank NIM sensitivity runs to -16bps), so
// the baseline is wherever zero falls, not the left edge.
export interface BarBox { x: number; width: number }

export function barGeometry(values: number[], width: number): { bars: BarBox[]; zeroX: number } {
    const min = Math.min(0, ...values);
    const max = Math.max(0, ...values);
    const span = max - min || 1;
    const scale = width / span;
    const zeroX = min === 0 ? 0 : -min * scale;   // negating 0 yields -0
    return {
        zeroX,
        bars: values.map(v => ({
            x: v >= 0 ? zeroX : zeroX + v * scale,
            width: Math.abs(v) * scale,
        })),
    };
}

// The QA gate: every plotted value must be findable in the report text.
// Returns one message per violation, empty when the exhibits are clean.
export function exhibitValueViolations(markdown: string, specs: ExhibitSpec[]): string[] {
    const out: string[] = [];
    for (const spec of specs) {
        for (const bar of spec.bars) {
            const digits = String(Math.abs(bar.value));
            if (!markdown.includes(digits)) {
                out.push(`"${spec.title}" plots ${bar.label}=${bar.value}, which is not in the report text`);
            }
        }
    }
    return out;
}
