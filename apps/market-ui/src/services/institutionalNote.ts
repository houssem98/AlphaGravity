// Institutional Note — DI-13, docs/DEXTER_INSTITUTIONAL_ROADMAP.md rows 17-18.
//
// G12: the output was a levels block, a plan block and prose. A PM scans for six
// things and none of them were there. This is that skeleton, emitted as a
// `dexter-note` fenced block on the DD-8 contract, so the client paints it the
// same way it paints levels and plans.
//
// The rule that makes it honest rather than decorative: a field the evidence
// cannot support renders as an EXPLICIT GAP — "no price target: no valuation
// anchor was computed" — never as an omitted line and never as a plausible
// number. An invented price target is worse than a missing one, because a
// missing one is obviously missing.
//
// Row 18 is the subtle one. An invalidation trigger is not the stop. The stop is
// where the position is closed; the invalidation is where the THESIS is wrong,
// and it must be stated as a condition someone could check. A trigger that is
// only a price, or that merely restates the stop, is rejected.

export type Rating = 'BUY' | 'ACCUMULATE' | 'HOLD' | 'REDUCE' | 'SELL';

export const RATINGS: readonly Rating[] = ['BUY', 'ACCUMULATE', 'HOLD', 'REDUCE', 'SELL'];
export const NOTE_LANG = 'dexter-note';

export interface PriceTarget {
    price: number;
    /** e.g. "3 months", "by 2026-12-31". A target with no horizon is not a target. */
    horizon: string;
}

export interface Catalyst {
    /** What happens. */
    event: string;
    /** When it is expected — a date or a bounded window. Never "soon". */
    expected: string;
}

export interface InvalidationTrigger {
    /** The observable condition, e.g. "two consecutive daily closes below 61,400". */
    condition: string;
    /** Why it kills the thesis, not merely the position. */
    kills: string;
}

export interface NoteInput {
    symbol: string;
    rating?: Rating | null;
    target?: PriceTarget | null;
    thesis?: string | null;
    /** What the market is missing. The part that makes it research rather than a summary. */
    variantPerception?: string | null;
    catalysts?: Catalyst[];
    invalidations?: InvalidationTrigger[];
    /** The stop from the trade plan, so row 18 can check the triggers are not just it. */
    stop?: number | null;
    unit?: string;
    /** DI-10's line, or its honest null. */
    calibration?: string | null;
}

export interface NoteField {
    key: string;
    label: string;
    value: string | null;
    /** Set when the field could not be filled. Rendered in place of the value. */
    gap: string | null;
}

export interface InstitutionalNote {
    symbol: string;
    fields: NoteField[];
    /** Fields that came back as gaps — never silently dropped. */
    gaps: string[];
    complete: boolean;
    calibration: string | null;
}

const GAP: Record<string, string> = {
    rating: 'no rating: the evidence did not support one',
    target: 'no price target: no valuation anchor with a horizon was computed',
    thesis: 'no thesis: nothing here rises above a description of what happened',
    variantPerception: 'no variant perception: nothing identified that the market is missing',
    catalysts: 'no dated catalysts: no scheduled event was found, and an undated catalyst is a hope',
    invalidations: 'no falsifiable invalidation trigger: a view with no invalidation condition is not a view',
};

/** A price alone is not a condition, and restating the stop is not an invalidation. */
export function isFalsifiable(t: InvalidationTrigger, stop: number | null | undefined): boolean {
    const c = t.condition?.trim() ?? '';
    if (c.length < 8) return false;
    // Bare number, with or without separators/currency.
    if (/^[^a-z]*$/i.test(c)) return false;
    if (stop !== null && stop !== undefined) {
        const stripped = c.replace(/[,\s]/g, '');
        const stopStr = String(stop);
        const onlyTheStop = stripped.includes(stopStr) && !/close|break|hold|fail|above|below|through|session|day|week|print/i.test(c);
        if (onlyTheStop) return false;
    }
    return /\b(close|closes|breaks?|holds?|fails?|above|below|through|prints?|reclaims?|loses?|session|day|week|month|by \d)/i.test(c);
}

export function buildNote(input: NoteInput): InstitutionalNote {
    const unit = input.unit ?? '';
    const fields: NoteField[] = [];
    const gaps: string[] = [];

    const push = (key: string, label: string, value: string | null) => {
        const gap = value === null ? GAP[key] : null;
        if (gap) gaps.push(gap);
        fields.push({ key, label, value, gap });
    };

    push('rating', 'Rating',
        input.rating && RATINGS.includes(input.rating) ? input.rating : null);

    push('target', 'Price target',
        input.target && Number.isFinite(input.target.price) && input.target.horizon?.trim()
            ? `${input.target.price}${unit} over ${input.target.horizon.trim()}`
            : null);

    push('thesis', 'Thesis', input.thesis?.trim() || null);

    push('variantPerception', 'Variant perception', input.variantPerception?.trim() || null);

    const dated = (input.catalysts ?? []).filter(c => c.event?.trim() && c.expected?.trim());
    push('catalysts', 'Catalysts',
        dated.length > 0 ? dated.map(c => `${c.event} — expected ${c.expected}`).join('; ') : null);

    const falsifiable = (input.invalidations ?? []).filter(t => isFalsifiable(t, input.stop));
    push('invalidations', 'Invalidation triggers',
        falsifiable.length > 0 ? falsifiable.map(t => `${t.condition} → ${t.kills}`).join('; ') : null);

    return {
        symbol: input.symbol,
        fields,
        gaps,
        complete: gaps.length === 0,
        calibration: input.calibration ?? null,
    };
}

export function renderNoteBlock(note: InstitutionalNote): string {
    return '```' + NOTE_LANG + '\n' + JSON.stringify(note) + '\n```';
}

export function isNoteBlock(v: unknown): v is InstitutionalNote {
    const n = v as Partial<InstitutionalNote> | null;
    return !!n && typeof n === 'object' && typeof n.symbol === 'string' && Array.isArray(n.fields);
}

/** Plain-text fallback for anything that cannot paint the block. */
export function renderNoteText(note: InstitutionalNote): string {
    const lines = note.fields.map(f => `${f.label}: ${f.value ?? `— ${f.gap}`}`);
    if (note.calibration) lines.push(note.calibration);
    return lines.join('\n');
}
