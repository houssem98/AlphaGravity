// Self-Improving Design Loop — an LLM reads the report like a human design
// director and makes autonomous, BOUNDED design decisions for the PDF:
// designer proposes a DesignSpec → deterministic validator enforces safety
// (whitelisted palette, verbatim-only pull quotes, length clamps) → critic
// scores it → feedback → revise, until the critic is satisfied or budget
// runs out. The renderer honors the spec; free-form CSS or invented content
// is structurally impossible. Any LLM failure → default design, export
// never blocks.

import { parseJudgeJson } from './evalRubric';
import { llmChat } from './selfImprovementHarness';
import type { ExhibitSpec } from './reportQaGates';
import {
    SECTION_LAYOUTS, isSectionLayout, splitSections, classifySection, computeSignals,
    layoutPrecondition,
} from './sectionLayout';
import type { SectionLayout } from './sectionLayout';

// ─── The bounded design surface ─────────────────────────────────────────────

export type ReportTone = 'bullish' | 'bearish' | 'neutral' | 'mixed';
export type Density = 'compact' | 'comfortable';

export interface PullQuote {
    section: string;   // section title (fuzzy-matched at render)
    text: string;      // MUST be a verbatim substring of the report markdown
}

export interface TableDesign {
    headerAccent: boolean;       // header row tinted with the design accent (vs house navy)
    zebra: boolean;              // alternating row shading
    highlightColumns: string[];  // ≤2 header names whose cells render emphasized
}

export type ExhibitStyle = 'monochrome' | 'categorical';

// G1c — the designer's per-section lever. It may only pick another value
// from the layout enum, and only for a section whose structure can carry it;
// it can never describe a layout of its own.
export interface SectionLayoutChoice {
    heading: string;
    layout: SectionLayout;
}

export interface DesignSpec {
    sections: SectionLayoutChoice[]; // overrides; sections absent keep the classifier's pick
    tone: ReportTone;
    accent: string;              // hex from ALLOWED_ACCENTS only
    density: Density;
    coverKicker: string;         // cover badge text, ≤32 chars
    abstract: string;            // exec-summary card text, 2–3 sentences ≤500 chars
    pullQuotes: PullQuote[];     // ≤2, verbatim-enforced
    exhibitTitles: string[];     // override per exhibit, each ≤60 chars
    tableDesign: TableDesign;
    exhibitStyle: ExhibitStyle;  // monochrome = all bars in the design accent
    exhibitPick: number[];       // which exhibits ship, in what order (≤3, valid indices)
}

export const ALLOWED_ACCENTS = [
    '#3D7FF6', '#7C3AED', '#059669', '#DC2626', '#D97706', '#0891B2', '#4F46E5', '#BE185D',
];

const TONE_ACCENT: Record<ReportTone, string> = {
    bullish: '#059669', bearish: '#DC2626', neutral: '#3D7FF6', mixed: '#7C3AED',
};

export function defaultDesignSpec(tone: ReportTone = 'neutral'): DesignSpec {
    return {
        sections: [],
        tone,
        accent: TONE_ACCENT[tone],
        density: 'comfortable',
        coverKicker: 'Deep Research Report',
        abstract: '',
        pullQuotes: [],
        exhibitTitles: [],
        tableDesign: { headerAccent: false, zebra: true, highlightColumns: [] },
        exhibitStyle: 'categorical',
        exhibitPick: [],
    };
}

// Deterministic table column sizing (spec P0-7: "column widths by content
// class — ticker/direction narrow, thesis wide"). Pure layout math, no LLM:
// a column's flex grows with the longest cell it has to fit.
export function computeColumnFlex(cells: string[][]): number[] {
    if (cells.length === 0) return [];
    const cols = cells[0].length;
    const flex: number[] = [];
    for (let c = 0; c < cols; c++) {
        const maxLen = Math.max(...cells.map(row => (row[c] ?? '').length));
        flex.push(maxLen <= 8 ? 0.6 : maxLen >= 60 ? 2 : 1);
    }
    return flex;
}

// ─── Deterministic validator — the safety rail ──────────────────────────────
// Every field is clamped to the bounded surface; violations are reported so
// the next designer iteration can fix them instead of silently drifting.

function sanitizeLine(s: unknown, maxLen: number): string {
    if (typeof s !== 'string') return '';
    return s.replace(/[\n\r#*`[\]|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

export function validateDesignSpec(
    raw: unknown,
    markdown: string,
    exhibitCount: number,
): { spec: DesignSpec; violations: string[] } {
    const violations: string[] = [];
    const r = (raw ?? {}) as Record<string, unknown>;

    const tone: ReportTone = (['bullish', 'bearish', 'neutral', 'mixed'] as const)
        .includes(r.tone as ReportTone) ? r.tone as ReportTone : 'neutral';
    if (tone !== r.tone) violations.push(`tone "${String(r.tone)}" invalid — defaulted to neutral`);

    let accent = typeof r.accent === 'string' ? r.accent.toUpperCase() : '';
    if (!ALLOWED_ACCENTS.includes(accent)) {
        if (r.accent) violations.push(`accent "${String(r.accent)}" not in the allowed palette`);
        accent = TONE_ACCENT[tone];
    }

    const density: Density = r.density === 'compact' ? 'compact' : 'comfortable';

    const coverKicker = sanitizeLine(r.coverKicker, 32) || 'Deep Research Report';

    let abstract = sanitizeLine(r.abstract, 500);
    const sentences = abstract ? (abstract.match(/[.!?](\s|$)/g) ?? []).length : 0;
    if (abstract && (sentences < 2 || sentences > 3)) {
        violations.push(`abstract has ${sentences} sentence(s) — must be 2–3 complete sentences`);
        abstract = '';
    }

    // Pull quotes: verbatim-only. The design layer may EMPHASIZE content,
    // never write it — same zero-hallucination rule as the citation gates.
    const pullQuotes: PullQuote[] = [];
    if (Array.isArray(r.pullQuotes)) {
        for (const q of (r.pullQuotes as Array<Record<string, unknown>>).slice(0, 2)) {
            const text = typeof q?.text === 'string' ? q.text.trim() : '';
            const section = sanitizeLine(q?.section, 60);
            if (text.length < 40 || text.length > 240) {
                violations.push(`pull quote length ${text.length} outside 40–240 chars`);
                continue;
            }
            if (!markdown.includes(text)) {
                violations.push(`pull quote is not a verbatim substring of the report: "${text.slice(0, 60)}…"`);
                continue;
            }
            pullQuotes.push({ section, text });
        }
    }

    const exhibitTitles = Array.isArray(r.exhibitTitles)
        ? (r.exhibitTitles as unknown[]).slice(0, exhibitCount).map(t => sanitizeLine(t, 60))
        : [];

    // Table design — booleans coerced, highlight columns sanitized + capped.
    const td = (r.tableDesign ?? {}) as Record<string, unknown>;
    const tableDesign: TableDesign = {
        headerAccent: td.headerAccent === true,
        zebra: td.zebra !== false,
        highlightColumns: Array.isArray(td.highlightColumns)
            ? (td.highlightColumns as unknown[]).slice(0, 2).map(h => sanitizeLine(h, 30)).filter(Boolean)
            : [],
    };

    const exhibitStyle: ExhibitStyle = r.exhibitStyle === 'monochrome' ? 'monochrome' : 'categorical';

    let exhibitPick: number[] = [];
    if (Array.isArray(r.exhibitPick)) {
        exhibitPick = Array.from(new Set(
            (r.exhibitPick as unknown[])
                .map(n => (typeof n === 'number' && Number.isInteger(n) ? n : -1))
                .filter(n => n >= 0 && n < exhibitCount),
        )).slice(0, 3);
        if (exhibitPick.length !== (r.exhibitPick as unknown[]).length) {
            violations.push('exhibitPick contained invalid/duplicate indices — cleaned');
        }
    }

    // Per-section layout overrides (G1c). Three gates, in order: the section
    // must exist, the layout must be in the enum, and the section's structure
    // must actually support it — a designer cannot turn a section with no
    // dates into a timeline, or one with no cited figures into a stat row.
    const sections: SectionLayoutChoice[] = [];
    if (Array.isArray(r.sections)) {
        const real = splitSections(markdown);
        for (const raw of (r.sections as Array<Record<string, unknown>>).slice(0, 20)) {
            const heading = sanitizeLine(raw?.heading, 80);
            const match = real.find(s => s.heading.toLowerCase() === heading.toLowerCase());
            if (!match) {
                violations.push(`section "${heading}" is not a heading in this report`);
                continue;
            }
            if (!isSectionLayout(raw?.layout)) {
                violations.push(`layout "${String(raw?.layout)}" for "${heading}" is not a known layout`);
                continue;
            }
            const failed = layoutPrecondition(raw.layout, computeSignals(match.heading, match.body));
            if (failed) {
                violations.push(`"${heading}" cannot be ${raw.layout}: ${failed}`);
                continue;
            }
            sections.push({ heading: match.heading, layout: raw.layout });
        }
    }

    return {
        spec: {
            sections, tone, accent, density, coverKicker, abstract, pullQuotes, exhibitTitles,
            tableDesign, exhibitStyle, exhibitPick,
        },
        violations,
    };
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

// What each section was classified as, and which other layouts its structure
// could legally carry. Showing the legal set up front means the designer
// spends its judgment choosing, not guessing at what will be rejected.
export function sectionLayoutDigest(markdown: string): string {
    return splitSections(markdown).slice(0, 14).map(({ heading, body }) => {
        const signals = computeSignals(heading, body);
        const allowed = SECTION_LAYOUTS.filter(l => layoutPrecondition(l, signals) === null);
        return `- "${heading}" → ${classifySection(heading, body).layout} (allowed: ${allowed.join(', ')})`;
    }).join('\n');
}

function reportDigest(markdown: string, exhibits: ExhibitSpec[]): string {
    const sections = [...markdown.matchAll(/^## (.+)$/gm)].map(m => m[1]).slice(0, 14);
    return [
        `SECTIONS: ${sections.join(' | ')}`,
        exhibits.length ? `EXHIBITS: ${exhibits.map(e => `${e.title} (${e.bars.length} bars)`).join(' | ')}` : 'EXHIBITS: none',
        '',
        'REPORT (truncated):',
        markdown.slice(0, 14000),
    ].join('\n');
}

export function buildDesignerPrompt(
    title: string,
    markdown: string,
    exhibits: ExhibitSpec[],
    feedback?: string,
): string {
    return `You are the design director of an institutional research desk (Goldman Sachs Research / Bloomberg Intelligence quality bar). Read the report below like a human expert and make design decisions for its PDF.

Your ONLY levers (anything else is ignored):
- tone: "bullish" | "bearish" | "neutral" | "mixed" — from the report's actual thesis
- accent: ONE hex from ${JSON.stringify(ALLOWED_ACCENTS)} — match the tone (green=bullish, red=bearish, blue=neutral, purple=mixed)
- density: "compact" (data-heavy reports, many tables) | "comfortable" (narrative reports)
- coverKicker: cover badge label, ≤32 chars (e.g. "Earnings Deep Dive", "Thematic Research")
- abstract: 2–3 COMPLETE sentences (≤500 chars) distilling the report for the executive-summary card — grounded ONLY in what the report says
- pullQuotes: up to 2 — each MUST be an EXACT verbatim sentence copied character-for-character from the report (they get visual emphasis; you may not rewrite them), 40–240 chars, with the section title it belongs to
- exhibitTitles: sharper title per exhibit (≤60 chars each), same order as listed
- tableDesign: {"headerAccent": bool (tint table headers with the accent — good when tables carry the thesis), "zebra": bool (row striping — good for wide tables), "highlightColumns": up to 2 column header names whose cells deserve emphasis (e.g. "Target", "Upside")}
- exhibitStyle: "monochrome" (all bars in the accent — one story) | "categorical" (one color per entity — comparison story)
- exhibitPick: array of exhibit indices (0-based, from the EXHIBITS list) to include, in display order, ≤3 — drop exhibits that don't advance the thesis; empty array = keep all
- sections: per-section layout OVERRIDES, only where you disagree with the automatic classification below. Each entry is {"heading": exact heading text, "layout": one of the ALLOWED layouts listed for that section}. Omit a section to accept its current layout. A layout not listed as allowed for that section WILL be rejected — the section's structure cannot carry it.

SECTION LAYOUTS (current classification → layouts this section's structure can support):
${sectionLayoutDigest(markdown)}

REPORT TITLE: ${title}

${reportDigest(markdown, exhibits)}
${feedback ? `\n--- REVISION FEEDBACK (fix these) ---\n${feedback}\n` : ''}
Return ONLY valid JSON:
{"tone": "...", "accent": "#......", "density": "...", "coverKicker": "...", "abstract": "...", "pullQuotes": [{"section": "...", "text": "..."}], "exhibitTitles": ["..."], "tableDesign": {"headerAccent": false, "zebra": true, "highlightColumns": ["..."]}, "exhibitStyle": "categorical", "exhibitPick": [0], "sections": [{"heading": "...", "layout": "..."}]}`;
}

export interface DesignCritique {
    hierarchy: number;      // 1–10: does the spec sharpen information hierarchy?
    tone_fit: number;       // 1–10: accent/kicker/abstract match the thesis?
    scannability: number;   // 1–10: pull quotes + density help a skimming PM?
    restraint: number;      // 1–10: no over-decoration, quotes genuinely load-bearing?
    fixes: string[];
}

export function buildDesignCriticPrompt(spec: DesignSpec, title: string, sectionTitles: string[]): string {
    return `You are a demanding design reviewer for institutional research PDFs. Score this design spec for the report "${title}" (sections: ${sectionTitles.join(', ')}). Score strictly — 9-10 means flawless professional judgment.

SPEC:
${JSON.stringify(spec, null, 2)}

Score 1-10 each: hierarchy (do the choices sharpen what matters most? do the per-section layouts in "sections" match what each section actually contains?), tone_fit (accent/kicker/abstract match the report's actual stance?), scannability (would a skimming PM get the story faster?), restraint (nothing decorative, pull quotes genuinely load-bearing, layout overrides used only where they earn their keep?).

Return ONLY valid JSON:
{"hierarchy": n, "tone_fit": n, "scannability": n, "restraint": n, "fixes": ["specific fix", "..."]}`;
}

// ─── The loop ────────────────────────────────────────────────────────────────

export interface DesignLoopResult {
    spec: DesignSpec;
    iterations: number;
    finalScore: number | null;   // min critic score of the accepted spec
    violationsFixed: number;
    fellBack: boolean;           // LLM failure → default design
}

export async function runDesignLoop(
    title: string,
    markdown: string,
    exhibits: ExhibitSpec[],
    options: { maxIter?: number; minScore?: number; chat?: (p: string) => Promise<string> } = {},
): Promise<DesignLoopResult> {
    const { maxIter = 2, minScore = 8, chat = llmChat } = options;
    const sectionTitles = [...markdown.matchAll(/^## (.+)$/gm)].map(m => m[1]).slice(0, 14);

    let best: { spec: DesignSpec; score: number } | null = null;
    let feedback: string | undefined;
    let violationsFixed = 0;

    try {
        for (let iter = 1; iter <= maxIter; iter++) {
            const raw = parseJudgeJson<Record<string, unknown>>(
                await chat(buildDesignerPrompt(title, markdown, exhibits, feedback)));
            const { spec, violations } = validateDesignSpec(raw, markdown, exhibits.length);
            violationsFixed += violations.length;

            const critique = parseJudgeJson<DesignCritique>(
                await chat(buildDesignCriticPrompt(spec, title, sectionTitles)));
            const score = critique
                ? Math.min(critique.hierarchy, critique.tone_fit, critique.scannability, critique.restraint)
                : 0;

            if (!best || score > best.score) best = { spec, score };
            if (score >= minScore && violations.length === 0) {
                return { spec, iterations: iter, finalScore: score, violationsFixed, fellBack: false };
            }
            feedback = [
                ...violations.map(v => `VALIDATOR: ${v}`),
                ...(critique?.fixes ?? []).map(f => `CRITIC: ${f}`),
            ].join('\n') || 'Scores too low — make sharper, more report-specific choices.';
        }
    } catch (e: any) {
        console.warn('[pdfDesigner] loop failed, using default design:', e?.message);
        if (!best) return { spec: defaultDesignSpec(), iterations: 0, finalScore: null, violationsFixed, fellBack: true };
    }

    return {
        spec: best?.spec ?? defaultDesignSpec(),
        iterations: maxIter,
        finalScore: best?.score ?? null,
        violationsFixed,
        fellBack: !best,
    };
}
