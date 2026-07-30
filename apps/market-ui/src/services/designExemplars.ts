// G3a — the exemplar bank: every design-loop outcome, kept.
//
// The design loop currently starts cold on every report and throws away the
// spec it just worked to produce. This records the outcomes so G3b can seed
// the designer with the best prior work for a similar report.
//
// The bank stores JUDGEMENTS, not content: a DesignSpec plus the critic score
// it earned. Pull quotes are the one content-bearing field, and they are
// report-specific, so they are stripped before storage — an exemplar must
// never be able to carry one report's sentence into another report.

import type { DesignSpec, ReportTone } from './pdfDesigner';
import type { ReportTheme } from './reportTheme';

export interface DesignExemplar {
    ranAt: string;      // ISO
    title: string;
    tone: ReportTone;
    theme: ReportTheme;
    score: number;      // critic score the spec earned, 1–10
    iterations: number; // how many loop passes it took
    spec: DesignSpec;
}

export const EXEMPLAR_CAP = 50;

/** Minimum critic score worth learning from. */
export const EXEMPLAR_MIN_SCORE = 6;

const key = (e: { title: string; tone: string }) => `${e.title.toLowerCase().trim()}|${e.tone}`;

// A spec is a design decision, but pullQuotes carry the report's own
// sentences. Seeding a later report with them would leak content across
// reports, so they never enter the bank.
function stripContent(spec: DesignSpec): DesignSpec {
    return { ...spec, pullQuotes: [], abstract: '', exhibitTitles: [] };
}

export function addExemplar(
    bank: DesignExemplar[],
    candidate: DesignExemplar,
    cap = EXEMPLAR_CAP,
): DesignExemplar[] {
    // A failed or weak loop is not an exemplar — learning from it would
    // teach the designer to repeat whatever the critic rejected.
    if (!Number.isFinite(candidate.score) || candidate.score < EXEMPLAR_MIN_SCORE) return bank;

    const entry: DesignExemplar = { ...candidate, spec: stripContent(candidate.spec) };
    const existing = bank.find(e => key(e) === key(entry));
    if (existing && existing.score >= entry.score) return bank;

    return [...bank.filter(e => key(e) !== key(entry)), entry]
        .sort((a, b) => b.score - a.score || b.ranAt.localeCompare(a.ranAt))
        .slice(0, cap);
}

// Best prior work for a report like this one: same tone first (tone drives
// accent and voice), then the best of anything else so a new tone still gets
// a seed rather than nothing.
export function topExemplars(
    bank: DesignExemplar[],
    match: { tone?: ReportTone; theme?: ReportTheme } = {},
    n = 3,
): DesignExemplar[] {
    const score = (e: DesignExemplar) =>
        (match.tone && e.tone === match.tone ? 2 : 0) + (match.theme && e.theme === match.theme ? 1 : 0);
    return [...bank]
        .sort((a, b) => score(b) - score(a) || b.score - a.score)
        .slice(0, n);
}

// ─── Storage ────────────────────────────────────────────────────────────────
// localStorage in the browser; a no-op everywhere else. Deliberately not
// Supabase: the bank is worth nothing until G3b proves seeding helps, and a
// table would be schema to maintain for an unproven idea.

const STORAGE_KEY = 'gamma.designExemplars.v1';

export function loadBank(): DesignExemplar[] {
    try {
        const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];   // a corrupt bank must never break an export
    }
}

export function saveBank(bank: DesignExemplar[]): void {
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(bank));
    } catch { /* quota or no storage — the bank is an optimisation, not state */ }
}

export function recordDesignOutcome(outcome: Omit<DesignExemplar, 'ranAt'>): DesignExemplar[] {
    const bank = addExemplar(loadBank(), { ...outcome, ranAt: new Date().toISOString() });
    saveBank(bank);
    return bank;
}
