// Eval rubric — versioned. Changing ANY prompt or query = bump RUBRIC_VERSION,
// old baselines stop being comparable.

export const RUBRIC_VERSION = 'race-lite-v1';

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
