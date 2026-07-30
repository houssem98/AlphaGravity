// G1a — the Gamma core move: per-section layout selection.
//
// A section's layout is a function of its CONTENT SHAPE, computed
// deterministically from markdown. No LLM, no invented content. G1c lets a
// designer LLM OVERRIDE a classification, but only with another enum value
// whose structural preconditions hold — `layoutPrecondition` is that gate, so
// a hallucinated "make this a timeline" on a section with no dates is
// rejected mechanically rather than trusted.
//
// Rule that keeps this honest: a heading NEVER assigns a layout on its own.
// "Outlook: Catalysts & Monitoring Dashboard" only becomes a timeline if the
// section actually contains a chronological sequence.

export const SECTION_LAYOUTS = [
    'prose', 'stat-row', 'comparison', 'timeline', 'table-heavy', 'quote-led', 'risk-list',
] as const;

export type SectionLayout = typeof SECTION_LAYOUTS[number];

export function isSectionLayout(v: unknown): v is SectionLayout {
    return typeof v === 'string' && (SECTION_LAYOUTS as readonly string[]).includes(v);
}

export interface ReportSection {
    heading: string;
    body: string;
}

export function splitSections(markdown: string): ReportSection[] {
    const marks = [...markdown.matchAll(/^##\s+(.+)$/gm)];
    return marks.map((m, i) => ({
        heading: m[1].trim(),
        body: markdown
            .slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : markdown.length)
            .trim(),
    }));
}

// ─── Stat extraction (extractor-only) ───────────────────────────────────────
// Every field is a verbatim slice of the report. A stat card can therefore
// only ever display a number the report already made — inventing one is
// structurally impossible, same rule as the pull-quote validator.

export interface StatCandidate {
    value: string;      // verbatim, e.g. "$130.5B", "70.6%", "~2.5x"
    label: string;      // verbatim context preceding the number, ≤60 chars
    citation: string;   // verbatim tag, e.g. "[Analyst Synthesis]" — '' if uncited
}

const NUMBER_WITH_UNIT =
    /(?:[+~-]\s?)?\$?\d[\d,]*(?:\.\d+)?\s?(?:[–—-]\s?\$?\d[\d,]*(?:\.\d+)?\s?)?(?:%|bps|bp\b|billion|million|trillion|[BMKT]\b|x\b)/g;

const CITATION_TAG = /\[[^\]\n]{1,120}\]/g;

const PERIOD_TOKEN = /\b(?:Q[1-4]\s?(?:FY)?\s?\d{2,4}|FY\s?\d{2,4}|H[12]\s?\d{4}|[12]\d{3})\b/;

function labelFor(sentence: string, at: number): string {
    const before = sentence.slice(0, at);
    const clause = before.split(/[,;:—(]/).pop() ?? before;
    const words = clause.trim().split(/\s+/).filter(Boolean).slice(-8).join(' ');
    return words.slice(-60).trim();
}

function isTableLine(line: string): boolean {
    return /^\s*\|/.test(line);
}

export function extractStats(body: string): StatCandidate[] {
    // Prose only. Numbers inside tables belong to the table-heavy layout,
    // and their surrounding cells make poor stat-card labels.
    const prose = body
        .split('\n')
        .filter(l => !isTableLine(l) && !l.startsWith('#'))
        .join('\n');

    const out: StatCandidate[] = [];
    const seen = new Set<string>();

    for (const sentence of prose.split(/(?<=[.!?])\s+/)) {
        const citation = sentence.match(CITATION_TAG)?.[0] ?? '';
        NUMBER_WITH_UNIT.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = NUMBER_WITH_UNIT.exec(sentence))) {
            const value = m[0].trim();
            const key = `${value}|${citation}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ value, label: labelFor(sentence, m.index), citation });
        }
    }
    return out;
}

// ─── Structural signals ─────────────────────────────────────────────────────

export interface SectionSignals {
    chars: number;
    tableRows: number;      // body rows, excluding header + separator
    tableCols: number;      // widest table's column count
    tableShare: number;     // fraction of section chars living inside tables
    bullets: number;
    boldLines: number;      // paragraphs that are entirely bold — verdict callouts
    citedStats: number;
    periodTokens: number;   // distinct chronological markers leading bullets/rows
    contrastHits: number;   // "vs" / "versus" occurrences
    riskTable: boolean;     // table header reads like a risk matrix
}

const RISK_HEADER_TERMS = ['risk', 'probability', 'impact', 'mitigant', 'severity', 'likelihood'];

export function computeSignals(heading: string, body: string): SectionSignals {
    const lines = body.split('\n');
    const tableLines = lines.filter(isTableLine);
    const separators = tableLines.filter(l => /^\s*\|[\s|:-]+\|\s*$/.test(l));
    const headers = tableLines.filter(l => !/^\s*\|[\s|:-]+\|\s*$/.test(l));

    const cellsOf = (l: string) => l.split('|').slice(1, -1).map(c => c.trim());
    const tableCols = tableLines.reduce((max, l) => Math.max(max, cellsOf(l).length), 0);

    const bulletLines = lines.filter(l => /^\s*[-*]\s+/.test(l));

    // Chronology counts only where a period token LEADS a bullet or a table's
    // first column — a date mentioned mid-prose is not a timeline.
    const leadCells = [
        ...bulletLines.map(l => l.replace(/^\s*[-*]\s+/, '')),
        ...headers.map(l => cellsOf(l)[0] ?? ''),
    ];
    const periods = new Set(
        leadCells
            .map(c => c.replace(/\*\*/g, '').trim().match(PERIOD_TOKEN)?.[0])
            .filter((x): x is string => Boolean(x)),
    );

    const firstHeader = headers[0] ? cellsOf(headers[0]).join(' ').toLowerCase() : '';
    const riskTable = RISK_HEADER_TERMS.filter(t => firstHeader.includes(t)).length >= 2;

    const paragraphs = body.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);

    // A bold line followed by a table is a CAPTION ("**Financial
    // Scorecard**"), not a verdict. Counting captions as verdicts turned
    // table sections into callouts in the archived corpus.
    const verdictLines = paragraphs.filter(
        (p, i) => /^\*\*[^*]+\*\*$/.test(p) && !isTableLine(paragraphs[i + 1] ?? ''),
    ).length;

    return {
        chars: body.length,
        tableRows: Math.max(0, headers.length - (separators.length > 0 ? 1 : 0)),
        tableCols,
        tableShare: body.length ? tableLines.join('\n').length / body.length : 0,
        bullets: bulletLines.length,
        boldLines: verdictLines,
        citedStats: extractStats(body).filter(s => s.citation).length,
        periodTokens: periods.size,
        contrastHits: (`${heading} ${body}`.match(/\bvs\.?\b|\bversus\b/gi) ?? []).length,
        riskTable,
    };
}

// ─── Preconditions — the gate G1c's validator reuses ────────────────────────
// Returns null when the layout is structurally supportable, else the reason
// it is not. A layout is never assigned (or accepted from an LLM override)
// unless its precondition passes.

export function layoutPrecondition(layout: SectionLayout, s: SectionSignals): string | null {
    switch (layout) {
        case 'stat-row':
            return s.citedStats >= 3 ? null : `stat-row needs ≥3 cited numbers, found ${s.citedStats}`;
        case 'table-heavy':
            return s.tableRows >= 3 ? null : `table-heavy needs ≥3 table rows, found ${s.tableRows}`;
        case 'comparison':
            // Structure only. Prose that merely SAYS "vs" gives a
            // side-by-side renderer nothing to put in the second column —
            // and using the contrast count here too would make the trigger
            // its own gate, which checks nothing.
            return s.tableCols >= 3
                ? null
                : `comparison needs a ≥3-column table, widest is ${s.tableCols}`;
        case 'timeline':
            return s.periodTokens >= 3
                ? null
                : `timeline needs ≥3 leading period markers, found ${s.periodTokens}`;
        case 'risk-list':
            return s.bullets >= 3 || s.tableRows >= 3
                ? null
                : 'risk-list needs ≥3 bullets or ≥3 table rows';
        case 'quote-led':
            // A verdict callout stands alone amid prose. A bullet-dominated
            // section is a list that happens to have a bold label.
            if (s.boldLines < 1) return 'quote-led needs a standalone bold verdict line';
            return s.bullets < 3 ? null : `quote-led is a callout, not a ${s.bullets}-item list`;
        case 'prose':
            return null;
    }
}

// ─── Classifier ─────────────────────────────────────────────────────────────

const RISK_HEADING = /\brisks?\b|\bthreats?\b|downside|limitation|unknown|caveat/i;
const COMPARISON_HEADING =
    /\bvs\.?\b|versus|side-by-side|comparison|winners?\s*(?:&|and)\s*losers|strengths?\s*(?:&|and)\s*weaknesses|relative\s+strengths|pair-trade/i;

export interface SectionShape {
    heading: string;
    layout: SectionLayout;
    signals: SectionSignals;
    reason: string;
}

export function classifySection(heading: string, body: string): SectionShape {
    const s = computeSignals(heading, body);
    const shape = (layout: SectionLayout, reason: string): SectionShape =>
        ({ heading, layout, signals: s, reason });

    // Priority order, most specific shape first. Every branch also requires
    // its precondition — the trigger says "this looks like X", the
    // precondition says "the structure can actually carry X".
    const triggers: Array<[SectionLayout, boolean, string]> = [
        ['risk-list', RISK_HEADING.test(heading) || s.riskTable,
            s.riskTable ? 'risk-matrix table header' : 'risk heading with enumerated items'],
        ['comparison', COMPARISON_HEADING.test(heading) || s.contrastHits >= 2,
            'explicit contrast between named alternatives'],
        ['timeline', s.periodTokens >= 3, `${s.periodTokens} chronological markers lead its items`],
        // Row count is the substantive condition; the share floor only keeps a
        // token 4-row table in a long essay from claiming the section. Set at
        // 0.15 because the corpus has two identical "Financial Performance"
        // scorecards at 0.19 and 0.28 — a 0.25 floor split them arbitrarily.
        ['table-heavy', s.tableRows >= 4 && s.tableShare >= 0.15,
            `${s.tableRows} table rows carry ${Math.round(s.tableShare * 100)}% of the section`],
        ['quote-led', s.boldLines >= 1, 'standalone bold verdict line'],
        ['stat-row', s.citedStats >= 3, `${s.citedStats} cited figures extractable as stat cards`],
    ];

    for (const [layout, triggered, reason] of triggers) {
        if (triggered && layoutPrecondition(layout, s) === null) return shape(layout, reason);
    }
    return shape('prose', 'narrative prose with no dominant structural shape');
}

export function classifyReport(markdown: string): SectionShape[] {
    return splitSections(markdown).map(sec => classifySection(sec.heading, sec.body));
}

// Layout diversity — the deterministic counterpart to the judge's
// `layout_variety` dim. 0 = every section identical, 1 = every section
// a different shape.
export function layoutVariety(shapes: SectionShape[]): number {
    if (shapes.length === 0) return 0;
    return +(new Set(shapes.map(s => s.layout)).size / Math.min(shapes.length, SECTION_LAYOUTS.length)).toFixed(2);
}
