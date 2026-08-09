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

/** The shape `sourceLabel` needs from a filing. `id` is the only field it matches on. */
export interface FilingRef {
    id: string;
    filing_type?: string;
    filing_date?: string | null;
}

/**
 * CT2-3 · the filing a figure resolves to, BY ID LOOKUP.
 *
 * `documentId` is compared to `filing.id` by string identity and by nothing
 * else. A figure whose period happens to line up with a filing is NOT sourced by
 * it (docs/COMMAND_TERMINAL_V2_ROADMAP.md §3 rule 1) — CT2-2 measured what
 * happens when that rule is dropped: every NVDA figure carries the constant
 * `xbrl:NVDA`, which matches no filing and identifies no document.
 *
 * Returns the marker whenever the id is absent, blank, or unresolvable. There is
 * deliberately no third state.
 */
export function sourceLabel(documentId: string | undefined, filings: readonly FilingRef[] = []): string {
    const id = documentId?.trim();
    if (!id) return NULL_MARK;
    const hit = filings.find(f => f.id === id);
    if (!hit) return NULL_MARK;
    return `${hit.filing_type?.trim() || NULL_MARK} · ${hit.filing_date?.trim() || NULL_MARK}`;
}

/** The attributes every rendered figure carries. The gate reads these, and they
 *  hold exactly the tokens the cell shows. */
export function figureAttrs(
    period: string | undefined,
    unit: string | undefined,
    fiscalYearEnd?: string,
    source?: string,
) {
    return {
        'data-figure': true,
        'data-period': periodLabel(period, fiscalYearEnd),
        'data-unit': unitLabel(unit),
        'data-source': source?.trim() || NULL_MARK,
    } as const;
}
