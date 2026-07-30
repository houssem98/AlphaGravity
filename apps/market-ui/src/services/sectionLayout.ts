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
    value: string;      // VERBATIM, e.g. "$130.5B", "70.6%", "~2.5x" — never rewritten
    label: string;      // the report's own words around it, markdown syntax stripped, ≤60 chars
    citation: string;   // verbatim tag, e.g. "[Analyst Synthesis]" — '' if uncited
}

const NUMBER_WITH_UNIT =
    /(?:[+~-]\s?)?\$?\d[\d,]*(?:\.\d+)?\s?(?:[–—-]\s?\$?\d[\d,]*(?:\.\d+)?\s?)?(?:%|bps|bp\b|billion|million|trillion|[BMKT]\b|x\b)/g;

const CITATION_TAG = /\[[^\]\n]{1,120}\]/g;

const PERIOD_TOKEN = /\b(?:Q[1-4]\s?(?:FY)?\s?\d{2,4}|FY\s?\d{2,4}|H[12]\s?\d{4}|[12]\d{3})\b/;

// Words that describe nothing on their own. A label made only of these
// ("representing roughly", "nearly") tells a reader what the number is not.
const FILLER = new Set([
    'the', 'and', 'of', 'to', 'in', 'a', 'an', 'for', 'with', 'that', 'this', 'which',
    'from', 'at', 'by', 'is', 'was', 'are', 'were', 'be', 'been', 'it', 'its', 'as',
    'we', 'our', 'they', 'their', 'has', 'have', 'had', 'will', 'would', 'could',
    'should', 'may', 'might', 'than', 'then', 'but', 'or', 'on', 'up', 'down', 'more',
    'less', 'about', 'roughly', 'nearly', 'approximately', 'estimated', 'estimate',
    'reported', 'representing', 'while', 'when', 'where', 'all', 'some', 'most',
    'both', 'over', 'under', 'above', 'below', 'around', 'just', 'only', 'also',
]);

// Words that open a subordinate clause. A label starting with one is a
// fragment sliced out of the middle of a sentence ("which we assign a",
// "where ASPs are up") — it reads as broken next to the number.
const SUBORDINATOR = new Set([
    'which', 'where', 'while', 'that', 'though', 'although', 'since', 'given',
    'whereas', 'because', 'if', 'when', 'after', 'before', 'unless', 'and', 'but',
]);

function hasContentWord(text: string): boolean {
    const words = text.split(/\s+/).filter(Boolean);
    // A single word names a metric only by accident ("increased").
    if (words.length < 2) return false;
    if (SUBORDINATOR.has(words[0].replace(/[^A-Za-z]/g, '').toLowerCase())) return false;
    return words.some(w => {
        const clean = w.replace(/[^A-Za-z]/g, '');
        return clean.length >= 4 && !FILLER.has(clean.toLowerCase());
    });
}

// A period only ends a clause when followed by space or end-of-string;
// splitting on every '.' cuts "22.84x" in half and yields labels like
// "84x and market capitalization".
function clauseWords(text: string, take: 'last' | 'first'): string {
    const parts = text.split(/[,;:—()]|\.(?=\s|$)/).filter(w => w.trim());
    const clause = (take === 'last' ? parts.pop() : parts.shift()) ?? '';
    const words = clause.replace(/[*`_]/g, '').trim().split(/\s+/).filter(Boolean);
    return (take === 'last' ? words.slice(-8) : words.slice(0, 7)).join(' ').slice(0, 60).trim();
}

// The metric a number describes sits either before it ("Gross margin was 73%")
// or after it ("22% of total revenue"). Prefer the leading clause, fall back
// to the trailing one, and return '' when neither actually names anything —
// a card with a meaningless label is worse than no card.
function labelFor(sentence: string, at: number, matchLength: number): string {
    const before = clauseWords(sentence.slice(0, at), 'last');
    if (hasContentWord(before)) return before;
    const after = clauseWords(sentence.slice(at + matchLength), 'first');
    return hasContentWord(after) ? after : '';
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
            out.push({ value, label: labelFor(sentence, m.index, m[0].length), citation });
        }
    }
    return out;
}

// Stat cards for the `stat-row` layout. Cited only, one card per distinct
// label so a row cannot become four restatements of the same metric.
export function pickStatCards(body: string, max = 4): StatCandidate[] {
    const seen = new Set<string>();
    const out: StatCandidate[] = [];
    for (const s of extractStats(body)) {
        if (!s.citation || !s.label) continue;
        const key = s.label.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(s);
        if (out.length >= max) break;
    }
    return out;
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// A bold line is a VERDICT only if it actually asserts something. Bold
// subheads ("AMD-Specific Risks", "Near-Term Catalysts:") and headings
// restated in bold are labels, and promoting them to a callout says nothing.
export function isVerdictLine(text: string, heading = ''): boolean {
    const t = text.trim();
    if (t.endsWith(':')) return false;
    if (heading && normalize(t) === normalize(heading)) return false;
    return t.split(/\s+/).length >= 5 || /\d/.test(t);
}

// Lifts the verdict line out of a `quote-led` section so the renderer can
// promote it to a callout without duplicating it in the prose below.
export function extractVerdict(body: string, heading = ''): { verdict: string; rest: string } | null {
    const paras = body.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    const i = paras.findIndex(
        (p, idx) =>
            /^\*\*[^*]+\*\*$/.test(p) &&
            !isTableLine(paras[idx + 1] ?? '') &&
            isVerdictLine(p.replace(/^\*\*|\*\*$/g, ''), heading),
    );
    if (i < 0) return null;
    return {
        verdict: paras[i].replace(/^\*\*|\*\*$/g, '').trim(),
        rest: paras.filter((_, idx) => idx !== i).join('\n\n'),
    };
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

// ─── Render-ready view model (G1b) ──────────────────────────────────────────
// One pass over the report produces everything the renderer needs, so the
// view layer never re-classifies and never sees anything but verbatim slices.

export interface SectionView {
    heading: string;
    layout: SectionLayout;
    statCards: StatCandidate[];
    verdict: string | null;
    markdown: string;   // body to render; the verdict line is removed once promoted
}

// `overrides` come from the design loop and are already precondition-checked
// by the validator; anything unknown here is ignored rather than trusted.
// A stat row promoted into every eligible section makes every section open
// the same way, which is the opposite of layout variety. Promote only the
// few densest sections and let the rest stay prose.
const MAX_STAT_ROWS = 2;

export function buildSectionViews(
    markdown: string,
    overrides: Array<{ heading: string; layout: SectionLayout }> = [],
): { preamble: string; sections: SectionView[] } {
    const first = markdown.search(/^##\s+/m);
    const byHeading = new Map(overrides.map(o => [o.heading.toLowerCase(), o.layout]));

    const sections = splitSections(markdown).map(({ heading, body }) => {
        const override = byHeading.get(heading.toLowerCase());
        const layout =
            override && layoutPrecondition(override, computeSignals(heading, body)) === null
                ? override
                : classifySection(heading, body).layout;
        const lifted = layout === 'quote-led' ? extractVerdict(body, heading) : null;
        return {
            heading,
            layout,
            statCards: layout === 'stat-row' ? pickStatCards(body) : [],
            verdict: lifted?.verdict ?? null,
            markdown: lifted?.rest ?? body,
        };
    });

    const promoted = new Set(
        sections
            .filter(s => s.statCards.length > 0)
            .sort((a, b) => b.statCards.length - a.statCards.length)
            .slice(0, MAX_STAT_ROWS)
            .map(s => s.heading),
    );
    for (const s of sections) if (!promoted.has(s.heading)) s.statCards = [];

    return {
        preamble: first > 0 ? markdown.slice(0, first).trim() : first === 0 ? '' : markdown.trim(),
        sections,
    };
}

// Markdown rendering of the SAME view model the web renderer draws — stat
// cards become a stat block, a verdict becomes a callout. Used to score the
// layout pass offline: the design judge reads markdown, so the layout pass
// has to be expressed in markdown to be measurable at all.
//
// Faithful to the screen, including its redundancy: promoted figures stay in
// the prose below exactly as they do in the rendered document.
export function renderLayoutMarkdown(
    markdown: string,
    overrides: Array<{ heading: string; layout: SectionLayout }> = [],
): string {
    const { preamble, sections } = buildSectionViews(markdown, overrides);
    const parts = preamble ? [preamble] : [];
    for (const s of sections) {
        parts.push(`## ${s.heading}`);
        // A card row, not a table. Encoding stat cards as a repeated
        // three-column table made every section structurally identical —
        // measured as a 2.8-point layout_variety regression in G1d.
        if (s.statCards.length > 0) {
            parts.push(s.statCards
                .map(c => `**${c.value}** ${c.label} ${c.citation}`)
                .join(' · '));
        }
        if (s.verdict) parts.push(`> **${s.verdict}**`);
        parts.push(s.markdown);
    }
    return parts.join('\n\n') + '\n';
}

// Layout diversity — the deterministic counterpart to the judge's
// `layout_variety` dim. 0 = every section identical, 1 = every section
// a different shape.
export function layoutVariety(shapes: SectionShape[]): number {
    if (shapes.length === 0) return 0;
    return +(new Set(shapes.map(s => s.layout)).size / Math.min(shapes.length, SECTION_LAYOUTS.length)).toFixed(2);
}
