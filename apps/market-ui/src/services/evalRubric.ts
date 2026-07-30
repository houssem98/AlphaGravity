// Eval rubric — versioned. Changing ANY prompt or query = bump RUBRIC_VERSION,
// old baselines stop being comparable.

export const RUBRIC_VERSION = 'race-lite-v1';

// G0a: design rubric is versioned SEPARATELY so adding design dims never
// invalidates the content baseline (eval/out/v2-prew1/baseline.json).
export const DESIGN_RUBRIC_VERSION = 'gamma-design-v1';

// 5 pinned queries: 2 company, 1 comparative, 1 macro, 1 thematic.
export const EVAL_QUERIES = [
    { id: 'company-nvda', q: 'Nvidia data center revenue growth and key risks FY2026' },
    { id: 'company-aapl', q: 'Apple services segment margin trajectory and regulatory risks 2026' },
    { id: 'comparative-amd-intc', q: 'AMD vs Intel data center CPU market share shift 2024-2026' },
    { id: 'macro-fed-nim', q: 'Federal Reserve rate path 2026 and implications for bank net interest margins' },
    { id: 'thematic-ai-capex', q: 'AI infrastructure capex cycle sustainability — hyperscaler spending 2025-2027' },
] as const;

export interface JudgeScores {
    comprehensiveness: number;   // 1-10
    insight: number;             // 1-10
    instruction_following: number; // 1-10
    readability: number;         // 1-10
    rationale: Record<string, string>;
}

// Judge = deepseek-chat (only live provider as of 2026-07-10). KNOWN
// LIMITATION: the judge shares a model family with the pipeline writer —
// self-preference bias possible; scores are comparable across OUR runs
// (same judge), not against external systems.
export function buildJudgePrompt(query: string, reportMarkdown: string): string {
    return `You are a demanding institutional research director grading an analyst report. Score strictly — a 9-10 means genuinely exceptional, publishable-at-a-bulge-bracket quality. Typical competent work is 5-7.

RESEARCH REQUEST: "${query}"

REPORT (markdown):
<report>
${reportMarkdown.substring(0, 28000)}
</report>

Score 1-10 on each dimension:
- comprehensiveness: does it cover the major angles a professional would expect (financials, competition, risks, catalysts, quantified where possible)?
- insight: non-obvious analysis beyond summarizing sources — mispricings, second-order effects, contrarian checks?
- instruction_following: does it answer THE REQUEST asked (entities, timeframe, focus), not a generic report?
- readability: structure, tables where they help, no filler, scannable?

Return ONLY valid JSON:
{"comprehensiveness": n, "insight": n, "instruction_following": n, "readability": n, "rationale": {"comprehensiveness": "one line", "insight": "one line", "instruction_following": "one line", "readability": "one line"}}`;
}

// ─── Design rubric (G0a) ────────────────────────────────────────────────────
// HONEST SCOPE: this judges DOCUMENT STRUCTURE read from markdown — heading
// logic, section balance, scannability affordances, chartable/extractable
// numbers, and whether sections vary enough in content shape to justify
// Gamma-style per-section layouts. It does NOT judge rendered pixels: no
// vision model is available (no live vision key as of 2026-07-10). Treat it
// as "is this document DESIGNABLE and well-structured", not "does it look
// good".

export interface DesignScores {
    visual_hierarchy: number;   // 1-10
    scannability: number;       // 1-10
    exhibit_readiness: number;  // 1-10
    layout_variety: number;     // 1-10
    rationale: Record<string, string>;
}

export const DESIGN_DIMS = [
    'visual_hierarchy', 'scannability', 'exhibit_readiness', 'layout_variety',
] as const;

export function buildDesignJudgePrompt(query: string, reportMarkdown: string): string {
    return `You are a demanding design director at a publication that turns analyst reports into beautifully structured documents (think Gamma, Pitch, Stripe's annual letter). You are judging the SOURCE STRUCTURE of a report — how well it is organized to BE designed. You are reading markdown, not pixels: judge structure and content shape, never colors or typography.

Score strictly. 9-10 = exceptional, ready to lay out with zero restructuring. Typical competent work is 5-7. A wall of undifferentiated prose is a 2-3 no matter how well written.

RESEARCH REQUEST: "${query}"

REPORT (markdown):
<report>
${reportMarkdown.substring(0, 28000)}
</report>

Score 1-10 on each dimension:
- visual_hierarchy: is the heading structure logical and consistently leveled? Are sections balanced in length, or is one section 5x the others? Does the document open with a clear top-level answer before drilling down?
- scannability: can a reader extract the argument in 60 seconds? Tables/lists/bold used where they genuinely help (not decoratively), paragraphs short enough to scan, no filler sentences padding sections.
- exhibit_readiness: are there numeric series, comparisons, and headline metrics stated concretely enough to lift into charts and stat cards verbatim? Penalize numbers buried mid-paragraph with no units/labels, or vague quantities ("strong growth") where a figure belongs.
- layout_variety: do the sections differ in CONTENT SHAPE (some comparative, some metric-dense, some narrative, some risk-enumerating) such that distinct page layouts would be justified? Penalize a document where every section is structurally identical prose.

Return ONLY valid JSON:
{"visual_hierarchy": n, "scannability": n, "exhibit_readiness": n, "layout_variety": n, "rationale": {"visual_hierarchy": "one line", "scannability": "one line", "exhibit_readiness": "one line", "layout_variety": "one line"}}`;
}

// Deterministic structural stats — zero LLM, computed alongside judge scores
// so a judge that drifts can be sanity-checked against hard counts.
export interface StructureStats {
    sections: number;
    maxSectionChars: number;
    medianSectionChars: number;
    balanceRatio: number;      // maxSection / medianSection (1 = perfectly even)
    tables: number;
    bulletLines: number;
    boldSpans: number;
    avgParagraphChars: number;
    numbersWithUnits: number;  // e.g. "$94.9B", "12%", "1.4x"
}

// True median: on even-length input the midpoint of the two middle values.
// Taking the upper element instead makes balanceRatio 1.0 for every
// two-section document — i.e. blind to the exact lopsidedness it measures.
function medianOf(sorted: number[]): number {
    if (sorted.length === 0) return 0;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeStructureStats(markdown: string): StructureStats {
    const bodies = markdown.split(/^##\s+/m).slice(1);
    const lens = bodies.map(b => b.length).sort((a, b) => a - b);
    const median = medianOf(lens);
    const max = lens.length ? lens[lens.length - 1] : 0;
    const paras = markdown
        .split(/\n{2,}/)
        .map(p => p.trim())
        .filter(p => p.length > 0 && !p.startsWith('#') && !p.startsWith('|') && !/^\s*[-*]\s/.test(p));
    return {
        sections: bodies.length,
        maxSectionChars: max,
        medianSectionChars: median,
        balanceRatio: median > 0 ? +(max / median).toFixed(2) : 0,
        tables: (markdown.match(/^\|.*\|\s*$/gm) || []).length,
        bulletLines: (markdown.match(/^\s*[-*]\s+/gm) || []).length,
        boldSpans: (markdown.match(/\*\*[^*\n]+\*\*/g) || []).length,
        avgParagraphChars: paras.length
            ? Math.round(paras.reduce((a, p) => a + p.length, 0) / paras.length)
            : 0,
        numbersWithUnits: (markdown.match(/(\$\s?\d[\d,.]*\s?[BMK]?\b|\d[\d,.]*\s?%|\d[\d.]*x\b)/g) || []).length,
    };
}

// Citation spot-check v1 — title-level plausibility only. The pipeline's own
// entailment metric (report.metadata.entailment) is the token-level check with
// full source text; THIS check samples whether the cited source is even the
// right KIND of document for the claim. v1 ceiling: cannot verify numbers
// against source body (source text isn't persisted in the report).
export function buildCitationSpotPrompt(
    samples: Array<{ sentence: string; sources: Array<{ title: string; url: string }> }>,
): string {
    const block = samples.map((s, i) =>
        `${i + 1}. CLAIM: ${s.sentence}\n   CITED: ${s.sources.map(x => `"${x.title}" (${x.url})`).join(' | ') || '(unresolved citation id)'}`,
    ).join('\n');
    return `You are auditing citation attribution in a research report. For each claim, judge whether the cited source(s) plausibly SUPPORT it based on source title/domain — "plausible" (source type matches the claim), "dubious" (source unlikely to contain this), or "unresolved" (no source given).

${block}

Return ONLY valid JSON: {"verdicts": ["plausible"|"dubious"|"unresolved", ...]} — one per claim, in order.`;
}

export function parseJudgeJson<T>(raw: string): T | null {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]) as T; } catch { return null; }
}
