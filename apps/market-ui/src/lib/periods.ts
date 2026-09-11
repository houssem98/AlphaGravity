// V2-5 · a period is compared to another period on the same basis, or to nothing.
//
// `LatestQuarterCard` sorted period STRINGS and took the top two. On a mixed set
// that is a lexical accident: "Q4 2025" sorts above "FY2025" because Q sorts
// above F, so the card printed a quarter against a fiscal year and a delta
// between them. A quarter is not 4% smaller than a year; the number meant
// nothing.
//
// Nothing here formats or renders. It answers two questions: what basis is this
// period stated on, and which two periods may be compared.

export type PeriodBasis = 'annual' | 'quarterly' | 'ttm' | 'date' | 'unknown';

export interface ParsedPeriod {
    raw: string;
    basis: PeriodBasis;
    /** Year the period falls in. 0 when the label does not state one. */
    year: number;
    /** Orders periods WITHIN one basis. Meaningless across bases, deliberately. */
    key: number;
}

export function parsePeriod(raw: string): ParsedPeriod {
    const p = (raw ?? '').trim();
    let m: RegExpExecArray | null;

    if ((m = /^TTM(?:\s+(?:FY)?(\d{4}))?$/i.exec(p))) {
        const year = m[1] ? Number(m[1]) : 0;
        return { raw: p, basis: 'ttm', year, key: year };
    }
    if ((m = /^Q([1-4])\s*(?:FY)?\s*(\d{4})$/i.exec(p))) {
        const year = Number(m[2]);
        return { raw: p, basis: 'quarterly', year, key: year * 4 + Number(m[1]) };
    }
    if ((m = /^(?:FY)?(\d{4})[-\s]*Q([1-4])$/i.exec(p))) {
        const year = Number(m[1]);
        return { raw: p, basis: 'quarterly', year, key: year * 4 + Number(m[2]) };
    }
    if ((m = /^FY\s?(\d{4})$/i.exec(p)) || (m = /^(\d{4})$/.exec(p))) {
        const year = Number(m[1]);
        return { raw: p, basis: 'annual', year, key: year };
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(p)) {
        return { raw: p, basis: 'date', year: Number(p.slice(0, 4)), key: Date.parse(p) };
    }
    return { raw: p, basis: 'unknown', year: 0, key: 0 };
}

// Which basis the card speaks when a company reports on several. The newest year
// wins; a tie goes to the finer grain, because "latest reported period" means the
// most recently closed one and a quarter closes inside its fiscal year.
const PRECEDENCE: PeriodBasis[] = ['quarterly', 'ttm', 'annual', 'date', 'unknown'];

export interface PeriodSelection {
    basis: PeriodBasis;
    latest: string;
    prior?: string;
}

/**
 * The newest period, and the one before it ON THE SAME BASIS.
 *
 * `prior` is left undefined when the chosen basis holds only one period. The
 * caller renders no delta rather than reaching into another basis for something
 * to subtract.
 */
export function selectComparablePeriods(periods: readonly string[]): PeriodSelection | null {
    const parsed = [...new Set(periods.filter(Boolean))].map(parsePeriod);
    if (parsed.length === 0) return null;

    const groups = new Map<PeriodBasis, ParsedPeriod[]>();
    for (const p of parsed) {
        const g = groups.get(p.basis);
        if (g) g.push(p); else groups.set(p.basis, [p]);
    }

    let chosen: ParsedPeriod[] | null = null;
    let chosenRank: [number, number] = [-Infinity, Infinity];
    for (const [basis, members] of groups) {
        const rank: [number, number] = [
            Math.max(...members.map(m => m.year)),
            PRECEDENCE.indexOf(basis),
        ];
        if (rank[0] > chosenRank[0] || (rank[0] === chosenRank[0] && rank[1] < chosenRank[1])) {
            chosen = members;
            chosenRank = rank;
        }
    }
    if (!chosen) return null;

    // An unknown label states no order, so the original string order is all
    // there is; every other basis sorts on the key its label yields.
    const sorted = chosen[0].basis === 'unknown'
        ? [...chosen].sort((a, b) => b.raw.localeCompare(a.raw))
        : [...chosen].sort((a, b) => b.key - a.key);

    return { basis: sorted[0].basis, latest: sorted[0].raw, prior: sorted[1]?.raw };
}
