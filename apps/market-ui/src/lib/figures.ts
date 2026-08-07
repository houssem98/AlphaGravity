// CT-5 · a figure ships with its period and its unit, or it ships as a null
// (docs/COMMAND_TERMINAL_ROADMAP.md §3 rule 3, §6 rows 7 and 7c).
//
// Row 7 forbids the third state: a number carrying neither. Where the payload
// omits a part, the marker is rendered for THAT part — never a guess.

export const NULL_MARK = '—';

/**
 * A period, with its fiscal-year-end when one is known.
 *
 * The year is deliberately NOT derived. "FY2026" plus a fiscal-year-end month of
 * "January" only means January 2026 under a labelling convention this payload
 * never states, and doctrine 5 exists because guessing it is wrong even on the
 * issuers where it happens to be right. The month comes from Alpha Vantage's
 * `FiscalYearEnd`; absent that, the period says so.
 */
export function periodLabel(period: string | undefined, fiscalYearEnd?: string): string {
    const p = period?.trim();
    if (!p) return NULL_MARK;
    if (!/^FY\s?\d{4}$/i.test(p)) return p;
    return `${p} · FYE ${fiscalYearEnd?.trim() || NULL_MARK}`;
}

/** The unit a figure is denominated in, or the marker. Never inferred from the
 *  magnitude or the formatting of the number. */
export function unitLabel(unit?: string): string {
    return unit?.trim() ? unit.trim() : NULL_MARK;
}

/** The attributes every rendered figure carries. The gate reads these, and they
 *  hold exactly the tokens the cell shows. */
export function figureAttrs(period: string | undefined, unit: string | undefined, fiscalYearEnd?: string) {
    return {
        'data-figure': true,
        'data-period': periodLabel(period, fiscalYearEnd),
        'data-unit': unitLabel(unit),
    } as const;
}
