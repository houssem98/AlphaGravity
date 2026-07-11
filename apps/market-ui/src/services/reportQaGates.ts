// Report QA Gates — REPORT_QA_SPEC.md P0-3 entity-attribution gate.
// Every check here is pure and deterministic (zero LLM cost), mirroring the
// existing verifier style in deepResearchService.ts. The NumericClaim tuple
// store built here is the shared foundation for the publication gates (P0-4),
// exhibits (P2-1), and live-price checks (P2-3).

import { extractCitedSentences } from './deepResearchService';

// ─── NumericClaim tuple (spec P0-3 fix 1) ───────────────────────────────────

export interface NumericClaim {
    entity: string;        // canonical ticker, e.g. "MS"
    metric: string;        // from the ontology below, or "other"
    period: string;        // "Q4-2024", "FY2025", "2024", or ""
    value: number;
    unit: string;          // usd_t | usd_b | usd_m | usd_k | pct | bps | x | usd
    sourceIds: string[];   // citation ids carried by the sentence ("3", "RAG-2")
    sentence: string;      // truncated sentence the claim came from
}

export interface EntityMismatch {
    sentence: string;
    claimEntity: string;   // entity the prose attributes the fact to
    citationId: string;
    sourceEntity: string;  // entity the cited source is actually about
}

export interface DuplicateAttribution {
    key: string;           // metric|period|value+unit
    entities: string[];    // ≥2 distinct entities claiming the same tuple
    sentences: string[];
}

export interface EntityGateResult {
    claims: NumericClaim[];
    misattributed: EntityMismatch[];
    duplicates: DuplicateAttribution[];
    misAttributedCount: number;    // misattributed.length + duplicates.length
}

// Ticker → aliases (ticker itself + company names). Bare tickers ≤5 chars are
// matched case-sensitively (GS ≠ "gs"); names match case-insensitively.
export type EntityAliases = Record<string, string[]>;

// ─── Entity mention detection ───────────────────────────────────────────────

function aliasMatches(sentence: string, alias: string): boolean {
    const isBareTicker = alias.length <= 5 && alias === alias.toUpperCase();
    const re = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
        isBareTicker ? '' : 'i');
    return re.test(sentence);
}

export function findEntities(sentence: string, aliases: EntityAliases): string[] {
    const found: string[] = [];
    for (const [ticker, names] of Object.entries(aliases)) {
        if (names.some(n => n && aliasMatches(sentence, n))) found.push(ticker);
    }
    return found;
}

// ─── Metric ontology (spec P0-3 fix 4 — controlled vocabulary) ──────────────
// Ordered: first match wins. Specific metrics before generic ones.

const METRIC_ONTOLOGY: Array<[string, RegExp]> = [
    ['eps',          /\beps\b|earnings per share/i],
    ['aum',          /\baum\b|assets under management/i],
    ['nii',          /net interest income|\bnii\b/i],
    ['fcf',          /free cash flow|\bfcf\b/i],
    ['capacity',     /\bcapacity\b/i],
    ['price_target', /price target/i],
    ['market_share', /market share/i],
    ['capex',        /\bcapex\b|capital expenditure/i],
    ['margin',       /\bmargins?\b/i],
    ['revenue',      /\brevenues?\b|\bsales\b/i],
    ['growth',       /\bgrowth\b|\bgrew\b/i],
];

export function detectMetric(sentence: string): string {
    for (const [metric, re] of METRIC_ONTOLOGY) if (re.test(sentence)) return metric;
    return 'other';
}

// ─── Period detection ───────────────────────────────────────────────────────

export function detectPeriod(sentence: string): string {
    const q = sentence.match(/\bQ([1-4])[\s-]?(?:FY)?[\s']?(\d{4})\b/i);
    if (q) return `Q${q[1]}-${q[2]}`;
    const fy = sentence.match(/\bFY[\s-]?(\d{4})\b/i);
    if (fy) return `FY${fy[1]}`;
    const y = sentence.match(/\b(20\d{2})\b/);
    if (y) return y[1];
    return '';
}

// ─── Value + unit extraction ────────────────────────────────────────────────
// ponytail: first strong numeric in the sentence is the claim value — per-
// metric value binding needs dependency parsing; upgrade if false pairs show.

const SCALE_UNIT: Record<string, string> = {
    t: 'usd_t', trillion: 'usd_t',
    b: 'usd_b', bn: 'usd_b', billion: 'usd_b',
    m: 'usd_m', million: 'usd_m',
    k: 'usd_k', thousand: 'usd_k',
};

export function detectValue(sentence: string): { value: number; unit: string } | null {
    // $-amount with optional scale suffix
    const usd = sentence.match(/\$\s?([\d,]+(?:\.\d+)?)\s?(trillion|billion|million|thousand|bn|[TBMK])?\b/);
    if (usd) {
        const value = parseFloat(usd[1].replace(/,/g, ''));
        const unit = usd[2] ? SCALE_UNIT[usd[2].toLowerCase()] : 'usd';
        return { value, unit };
    }
    const pct = sentence.match(/([\d,]+(?:\.\d+)?)\s?(%|percent)/);
    if (pct) return { value: parseFloat(pct[1].replace(/,/g, '')), unit: 'pct' };
    const bps = sentence.match(/([\d,]+(?:\.\d+)?)\s?(?:bps|basis\s?points)/i);
    if (bps) return { value: parseFloat(bps[1].replace(/,/g, '')), unit: 'bps' };
    const mult = sentence.match(/([\d,]+(?:\.\d+)?)\s?x\b/);
    if (mult) return { value: parseFloat(mult[1].replace(/,/g, '')), unit: 'x' };
    return null;
}

// ─── Claim extraction ───────────────────────────────────────────────────────
// Only sentences that (a) carry ≥1 citation, (b) mention exactly ONE known
// entity (ambiguous multi-entity sentences are skipped — conservative, no
// false positives), and (c) contain a strong numeric become claims.

export function extractNumericClaims(markdown: string, aliases: EntityAliases): NumericClaim[] {
    const out: NumericClaim[] = [];
    for (const { sentence, citationIds } of extractCitedSentences(markdown)) {
        const entities = findEntities(sentence, aliases);
        if (entities.length !== 1) continue;
        const num = detectValue(sentence);
        if (!num) continue;
        out.push({
            entity: entities[0],
            metric: detectMetric(sentence),
            period: detectPeriod(sentence),
            value: num.value,
            unit: num.unit,
            sourceIds: citationIds,
            sentence,
        });
    }
    return out;
}

// ─── Entity check (spec P0-3 fix 2) ─────────────────────────────────────────
// Runs over ALL cited sentences (numeric or not — regression test 5 is a
// non-numeric executive-departure claim). A sentence attributing a fact to
// entity X while citing a source tagged with entity Y is a mis-attribution.

export function checkEntityAttribution(
    markdown: string,
    aliases: EntityAliases,
    sourceEntityById: Map<string, string>,   // '' or missing = unknown → skip
): EntityMismatch[] {
    const out: EntityMismatch[] = [];
    for (const { sentence, citationIds } of extractCitedSentences(markdown)) {
        const entities = findEntities(sentence, aliases);
        if (entities.length !== 1) continue;
        for (const id of citationIds) {
            const src = sourceEntityById.get(id);
            if (src && src !== entities[0]) {
                out.push({ sentence, claimEntity: entities[0], citationId: id, sourceEntity: src });
            }
        }
    }
    return out;
}

// ─── Duplicate-attribution detector (spec P0-3 fix 3) ───────────────────────
// Same (metric, period, value+unit) tuple attributed to two different
// entities in one report — catches the GS/MS "$0.52 beat" swap.

export function detectDuplicateAttributions(claims: NumericClaim[]): DuplicateAttribution[] {
    const byKey = new Map<string, NumericClaim[]>();
    for (const c of claims) {
        const key = `${c.metric}|${c.period}|${c.value}${c.unit}`;
        byKey.set(key, [...(byKey.get(key) ?? []), c]);
    }
    const out: DuplicateAttribution[] = [];
    for (const [key, group] of byKey) {
        const entities = Array.from(new Set(group.map(c => c.entity)));
        if (entities.length > 1) {
            out.push({ key, entities, sentences: group.map(c => c.sentence) });
        }
    }
    return out;
}

// ─── Source-entity index builder ────────────────────────────────────────────
// Web ids are "1".."N" in prose; RAG passages are "RAG-1".."RAG-N" (RAG
// sources carry a `ticker` tag). A web source maps to an entity only when
// its title mentions exactly one known entity — else unknown ('').

export function buildSourceEntityIndex(
    webSources: Array<{ title: string }>,
    ragSources: Array<{ ticker: string }>,
    aliases: EntityAliases,
): Map<string, string> {
    const index = new Map<string, string>();
    webSources.slice(0, 50).forEach((s, i) => {
        const found = findEntities(s.title, aliases);
        index.set(String(i + 1), found.length === 1 ? found[0] : '');
    });
    ragSources.slice(0, 20).forEach((s, i) => {
        index.set(`RAG-${i + 1}`, s.ticker || '');
    });
    return index;
}

// ─── Publication gates (spec P0-4) ──────────────────────────────────────────
// The pipeline already MEASURES quality; these gates ENFORCE it. A draft
// violating any blocker can never ship as Medium/High confidence.

export type GateConfidence = 'High' | 'Medium' | 'Low';

export interface PublicationGateInput {
    misattributed: number;        // entityGate.misattributed.length
    duplicates: number;           // entityGate.duplicates.length
    unsupportedClaims: number;    // verification.unsupportedClaims.length (unbadged body numbers)
    citationDensity: number;      // 0..1
    totalFactSentences: number;   // 0 = nothing to judge, density gate skipped
    staleSourceRatio: number;     // (stale+archival+undated)/total, 0..1; 0 when no web sources
    revisorRan: boolean;
    revisorFlags: number;         // issues flagged before revision
    revisorAccepted: number;      // edits actually applied
    // P0-2 temporal linter (optional — 0 when linter not run)
    elapsedPeriodEstimates?: number;   // "our FY2025 estimate" in a 2026 report
    unprovenancedPriceDates?: number;  // "Prices as of <date>" without tool provenance
    // P0-5 compliance lint (optional)
    thirdPartyAttributions?: number;   // "Source: <bank> Research estimates"
    // P1-2 tier gate (optional)
    t3OnlyNumericClaims?: number;      // numeric claims supported only by T3 sources
    // P1-5 estimate discipline (optional)
    unmethodEstimates?: number;        // "we estimate" without method note or illustrative tag
}

export interface GateViolation {
    gate: string;
    detail: string;
    severity: 'block' | 'warn';
}

export interface PublicationGateResult {
    passed: boolean;              // no blockers
    violations: GateViolation[];
    maxConfidence: GateConfidence; // cap for the derived confidence banner
}

const CONF_ORDER: Record<GateConfidence, number> = { High: 2, Medium: 1, Low: 0 };

export function capConfidence(derived: GateConfidence, cap: GateConfidence): GateConfidence {
    return CONF_ORDER[cap] < CONF_ORDER[derived] ? cap : derived;
}

export function evaluatePublicationGates(i: PublicationGateInput): PublicationGateResult {
    const violations: GateViolation[] = [];
    let cap: GateConfidence = 'High';
    const lower = (c: GateConfidence) => { cap = capConfidence(cap, c); };

    if (i.misattributed + i.duplicates > 0) {
        violations.push({
            gate: 'mis_attributed_citations',
            detail: `${i.misattributed} mis-attributed citation(s), ${i.duplicates} duplicate attribution(s) — must be 0`,
            severity: 'block',
        });
        lower('Low');
    }
    if (i.unsupportedClaims > 0) {
        violations.push({
            gate: 'ungrounded_numbers',
            detail: `${i.unsupportedClaims} ungrounded number(s) in body without an unverified badge`,
            severity: 'block',
        });
        lower('Low');
    }
    if (i.totalFactSentences > 0 && i.citationDensity < 0.90) {
        violations.push({
            gate: 'citation_density',
            detail: `citation density ${Math.round(i.citationDensity * 100)}% < 90%`,
            severity: 'warn',
        });
        lower('Medium');
    }
    if (i.staleSourceRatio > 0.40) {
        violations.push({
            gate: 'stale_sources',
            detail: `${Math.round(i.staleSourceRatio * 100)}% of web sources stale/archival/undated (> 40%)`,
            severity: 'warn',
        });
        lower('Low');
    }
    if ((i.t3OnlyNumericClaims ?? 0) > 0) {
        violations.push({
            gate: 't3_numeric_support',
            detail: `${i.t3OnlyNumericClaims} numeric claim(s) supported only by social/SEO/aggregator sources`,
            severity: 'block',
        });
        lower('Low');
    }
    if ((i.thirdPartyAttributions ?? 0) > 0) {
        violations.push({
            gate: 'third_party_attribution',
            detail: `${i.thirdPartyAttributions} fabricated third-party research attribution(s)`,
            severity: 'block',
        });
        lower('Low');
    }
    if ((i.unprovenancedPriceDates ?? 0) > 0) {
        violations.push({
            gate: 'fabricated_price_provenance',
            detail: `${i.unprovenancedPriceDates} price/date string(s) without tool provenance`,
            severity: 'block',
        });
        lower('Low');
    }
    if ((i.unmethodEstimates ?? 0) > 0) {
        violations.push({
            gate: 'estimates_without_method',
            detail: `${i.unmethodEstimates} "we estimate" claim(s) without a method note or illustrative tag`,
            severity: 'warn',
        });
        lower('Medium');
    }
    if ((i.elapsedPeriodEstimates ?? 0) > 0) {
        violations.push({
            gate: 'elapsed_period_estimates',
            detail: `${i.elapsedPeriodEstimates} estimate/outlook reference(s) to already-elapsed fiscal periods`,
            severity: 'warn',
        });
        lower('Medium');
    }
    if (i.revisorRan && i.revisorFlags > 0 && i.revisorAccepted === 0) {
        violations.push({
            gate: 'revisor_component_failure',
            detail: `Revisor flagged ${i.revisorFlags} issue(s) but applied 0 edits — component failure`,
            severity: 'block',
        });
        lower('Low');
    }

    return {
        passed: !violations.some(v => v.severity === 'block'),
        violations,
        maxConfidence: cap,
    };
}

// Rendered at the very top of the final markdown so the confidence verdict
// sits on the cover AND above the Executive Summary — not page 27.
export function buildConfidenceBanner(
    confidence: GateConfidence,
    violations: GateViolation[],
): string {
    const reason = violations.length === 0
        ? 'all publication gates passed'
        : violations.slice(0, 3).map(v => v.detail).join('; ')
            + (violations.length > 3 ? `; and ${violations.length - 3} more` : '');
    return `> **Confidence: ${confidence}** — ${reason}\n\n`;
}

// ─── Citation ID space (spec P0-6) ──────────────────────────────────────────
// One canonical 1–N numbering. RAG passages are numbered AFTER web + SEC in
// the report's citations array, so [RAG-n] in prose remaps to [offset + n].

export function remapRagCitations(markdown: string, ragOffset: number): string {
    return markdown.replace(/\[RAG-(\d+)\]/g, (_, n) => `[${ragOffset + parseInt(n, 10)}]`);
}

// Internal pipeline tags must never reach the renderer ([TIER 2b] leaked into
// a body paragraph in the audited report). Strip, then heal any space left
// hanging before punctuation so the strip itself can't create orphans.
const INTERNAL_TAG_RE = / *\[(?:TIER|DEBUG|INTERNAL|DRAFT|TODO)\b[^\]]*\]/gi;

export function stripInternalTags(markdown: string): string {
    return markdown
        .replace(INTERNAL_TAG_RE, '')
        .replace(/([^\s|])[ \t]+([.,;])(?=\s|$)/gm, '$1$2');
}

export interface CitationIntegrityResult {
    orphanPunctuation: string[];   // "44.5% ." — a stripped citation left a gap
    unresolvedIds: string[];       // bracket ids with no References entry
    ok: boolean;
}

// Post-assembly QA (spec P0-6 fix 4): fail when prose has space-before-
// punctuation orphans or bracket ids that don't resolve to a citation.
// Table rows (|) are skipped — pipes legitimately pad cells.
export function scanCitationIntegrity(markdown: string, citationCount: number): CitationIntegrityResult {
    const orphanPunctuation: string[] = [];
    const unresolvedIds: string[] = [];
    for (const line of markdown.split('\n')) {
        if (line.includes('|') || line.trimStart().startsWith('>')) continue;
        for (const m of line.matchAll(/\S+ +[.,;](?=\s|$)/g)) orphanPunctuation.push(m[0]);
        for (const m of line.matchAll(/\[([A-Za-z]+-\d+|\d+)\](?!\()/g)) {
            const id = m[1];
            if (/^\d+$/.test(id)) {
                const n = parseInt(id, 10);
                if (n < 1 || n > citationCount) unresolvedIds.push(`[${id}]`);
            } else {
                unresolvedIds.push(`[${id}]`);   // [RAG-5] etc. must not survive remap
            }
        }
    }
    return { orphanPunctuation, unresolvedIds, ok: orphanPunctuation.length === 0 && unresolvedIds.length === 0 };
}

// ─── Temporal sanity (spec P0-2) ────────────────────────────────────────────
// A July-2026 report cannot "estimate" FY2025 (the year ended), and cannot
// print "Prices as of <date>" when no live quote tool sourced that date.

export interface TemporalViolation {
    kind: 'elapsed_period_estimate' | 'unprovenanced_price_date';
    excerpt: string;
    period?: string;
}

const ESTIMATE_LANGUAGE = /\b(estimate[sd]?|outlook|forecast(?:s|ed)?|project(?:s|ed|ion|ions)?)\b/i;
// "Prices as of…", "as of market close…" — a tool-sourced date carries the
// [live] provenance marker; anything else is fabricated provenance.
const PRICE_DATE_RE = /\b(?:prices?|entry|close)\s+as\s+of\s+[^.\n]{3,60}/gi;

function periodEnd(period: string): Date | null {
    const q = period.match(/^Q([1-4])-(\d{4})$/);
    if (q) return new Date(Date.UTC(parseInt(q[2], 10), parseInt(q[1], 10) * 3, 0));
    const fy = period.match(/^FY(\d{4})$/);
    if (fy) return new Date(Date.UTC(parseInt(fy[1], 10), 11, 31));
    if (/^\d{4}$/.test(period)) return new Date(Date.UTC(parseInt(period, 10), 11, 31));
    return null;
}

export function lintTemporal(markdown: string, reportDate: Date): TemporalViolation[] {
    const out: TemporalViolation[] = [];
    const sentences = markdown
        .replace(/^#+\s.*$/gm, '')
        .split(/(?<=[.!?])\s+(?=[A-Z(])|\n{2,}/)
        .map(s => s.replace(/\s+/g, ' ').trim())
        .filter(s => s.length >= 15);

    for (const s of sentences) {
        if (ESTIMATE_LANGUAGE.test(s)) {
            const period = detectPeriod(s);
            const end = period ? periodEnd(period) : null;
            if (end && end < reportDate) {
                out.push({
                    kind: 'elapsed_period_estimate',
                    excerpt: s.length > 140 ? s.slice(0, 137) + '…' : s,
                    period,
                });
            }
        }
        for (const m of s.matchAll(PRICE_DATE_RE)) {
            if (!/\[live\]/i.test(m[0])) {
                out.push({
                    kind: 'unprovenanced_price_date',
                    excerpt: m[0].slice(0, 140),
                });
            }
        }
    }
    return out;
}

// Recency-weight retrieval: queries without an explicit year get the current
// year appended so search engines skew fresh (the audited run pulled 166/166
// stale-or-undated sources).
export function recencyWeightQueries(queries: string[], year: number = new Date().getFullYear()): string[] {
    return queries.map(q => (/\b20\d{2}\b/.test(q) ? q : `${q} ${year}`));
}

// Date-extractor fallback: many pages carry their date in the URL path
// (/2026/07/03/, /2026-07-03-, ?date=2026-07). Meta-date extraction happens
// upstream (Tavily publishedDate); this recovers a slice of the "undated".
export function extractDateFromUrl(url: string): string | null {
    const m = url.match(/\/(20\d{2})[\/-](\d{1,2})(?:[\/-](\d{1,2}))?(?:[\/\-?#]|$)/);
    if (!m) return null;
    const [, y, mo, d] = m;
    const month = parseInt(mo, 10);
    if (month < 1 || month > 12) return null;
    const day = d ? Math.min(Math.max(parseInt(d, 10), 1), 28) : 1;
    return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ─── Source-tier gate (spec P1-2) ───────────────────────────────────────────
// A numeric claim whose every cited source is T3 (social/SEO/aggregator) is
// rejected — an Instagram reel can't ground a market-size figure. RAG
// passages are indexed SEC filings → T1.

import { tierOf, type SourceTier } from './tavilyService';

export function buildSourceTierIndex(
    webSources: Array<{ url: string }>,
): Map<string, SourceTier> {
    const index = new Map<string, SourceTier>();
    webSources.slice(0, 50).forEach((s, i) => index.set(String(i + 1), tierOf(s.url)));
    return index;
}

export function findT3OnlyClaims(
    claims: NumericClaim[],
    tierById: Map<string, SourceTier>,
): NumericClaim[] {
    return claims.filter(c =>
        c.sourceIds.length > 0
        && c.sourceIds.every(id => tierById.get(id) === 'T3'));
}

// ─── Retrieval scope guard (spec P1-1) ──────────────────────────────────────
// Coverage universe × corpus check: the audited report covered BLK/V/STT but
// every RAG passage was MRSH/BAC/PAYX/ARES — and the writer force-fit them
// instead of admitting the gap. A coverage entity with zero RAG docs must be
// backed by SEC filings or get an explicit disclosure line.

export interface CoverageGap {
    ticker: string;
    hasSec: boolean;   // SEC filings for this entity exist in the run's corpus
}

export function checkRagCoverage(
    coverageTickers: string[],
    ragSources: Array<{ ticker: string }>,
    secDocs: Array<{ company: string }>,
    aliases: EntityAliases,
): CoverageGap[] {
    const ragTickers = new Set(ragSources.map(s => s.ticker).filter(Boolean));
    return coverageTickers
        .filter(t => !ragTickers.has(t))
        .map(t => ({
            ticker: t,
            hasSec: secDocs.some(d => findEntities(d.company, { [t]: aliases[t] ?? [t] }).length > 0),
        }));
}

export function buildCoverageDisclosure(gaps: CoverageGap[]): string {
    const missing = gaps.filter(g => !g.hasSec);
    if (missing.length === 0) return '';
    return `\n\n> **Coverage disclosure:** No internal documents available for ${missing.map(g => g.ticker).join(', ')}; analysis relies on web sources.\n`;
}

// ─── Auto-exhibits (spec P2-1) ──────────────────────────────────────────────
// Institutional notes are exhibit-led; the audited report was 31 pages with
// zero charts. Build comparison-bar specs from the NumericClaim store: any
// (metric, unit) held by ≥2 entities becomes an exhibit, every bar cites its
// claim's sources.

export interface ExhibitBar {
    label: string;         // entity ticker
    value: number;
    period: string;
    sourceIds: string[];
}

export interface ExhibitSpec {
    title: string;         // e.g. "Revenue — cross-entity comparison"
    unit: string;
    bars: ExhibitBar[];
}

const METRIC_LABELS: Record<string, string> = {
    eps: 'EPS', revenue: 'Revenue', aum: 'AUM', margin: 'Margin', fcf: 'Free Cash Flow',
    capacity: 'Capacity', nii: 'Net Interest Income', capex: 'Capex',
    price_target: 'Price Target', market_share: 'Market Share', growth: 'Growth',
};

const UNIT_LABELS: Record<string, string> = {
    usd_t: '$T', usd_b: '$B', usd_m: '$M', usd_k: '$K', usd: '$', pct: '%', bps: 'bps', x: '×',
};

export type ExhibitClaim = Pick<NumericClaim, 'entity' | 'metric' | 'period' | 'value' | 'unit' | 'sourceIds'>;

export function buildExhibits(claims: ExhibitClaim[], max = 3): ExhibitSpec[] {
    const groups = new Map<string, NumericClaim[]>();
    for (const c of claims) {
        if (c.metric === 'other' || c.value <= 0) continue;
        const key = `${c.metric}|${c.unit}`;
        groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    const specs: ExhibitSpec[] = [];
    for (const [key, group] of groups) {
        // One bar per entity — keep the first claim seen for each.
        const byEntity = new Map<string, NumericClaim>();
        for (const c of group) if (!byEntity.has(c.entity)) byEntity.set(c.entity, c);
        if (byEntity.size < 2) continue;
        const [metric, unit] = key.split('|');
        specs.push({
            title: `${METRIC_LABELS[metric] ?? metric} — cross-entity comparison`,
            unit: UNIT_LABELS[unit] ?? unit,
            bars: [...byEntity.values()]
                .sort((a, b) => b.value - a.value)
                .map(c => ({ label: c.entity, value: c.value, period: c.period, sourceIds: c.sourceIds })),
        });
    }
    return specs
        .sort((a, b) => b.bars.length - a.bars.length)
        .slice(0, max);
}

// ─── Telemetry consistency (spec P1-6) ──────────────────────────────────────
// One struct feeds cover, methodology, and references — the audited report
// claimed "172 sources" on the cover, "0 SEC filings" in methodology, and had
// sec.gov 10-Ks all through the references. sec.gov URLs count as SEC
// regardless of how the source was labeled upstream.

export function isSecEdgarUrl(url: string): boolean {
    return /sec\.gov\/(?:Archives\/)?edgar/i.test(url);
}

export interface ReportStats {
    sourcesAnalyzed: number;   // everything the pipeline ingested
    sourcesCited: number;      // references entries — sources contributing facts
    web: number;
    sec: number;
    rag: number;
}

export function deriveReportStats(
    citations: Array<{ source: string; url: string }>,
    sourcesAnalyzed: number,
): ReportStats {
    let web = 0, sec = 0, rag = 0;
    for (const c of citations) {
        if (c.source === 'SEC EDGAR' || isSecEdgarUrl(c.url)) sec += 1;
        else if (c.source === 'Gravity RAG') rag += 1;
        else web += 1;
    }
    return { sourcesAnalyzed, sourcesCited: citations.length, web, sec, rag };
}

// ─── Estimate discipline (spec P1-5) ────────────────────────────────────────
// "$400–600M Aladdin ACV uplift" with zero shown work is invented precision.
// Every "we estimate" needs a one-line method (inputs + arithmetic) or an
// explicit `illustrative` tag.

export interface EstimateViolation { excerpt: string }

const ESTIMATE_CLAIM_RE = /\b(?:we|our)\s+estimate/i;
const METHOD_MARKERS = /illustrative|method:|based on|derived from|assuming|calculated (?:as|from)|implies|per our model/i;

export function lintEstimates(markdown: string): EstimateViolation[] {
    const out: EstimateViolation[] = [];
    const sentences = markdown
        .replace(/^#+\s.*$/gm, '')
        .split(/(?<=[.!?])\s+(?=[A-Z(])|\n{2,}/)
        .map(s => s.replace(/\s+/g, ' ').trim());
    for (const s of sentences) {
        if (ESTIMATE_CLAIM_RE.test(s) && !METHOD_MARKERS.test(s)) {
            out.push({ excerpt: s.length > 140 ? s.slice(0, 137) + '…' : s });
        }
    }
    return out;
}

// ─── Scope adherence (spec P1-4) ────────────────────────────────────────────
// The audited report promised three firms, gave State Street two thin
// paragraphs, and put MSFT/NVDA/GOOGL in half the trade expressions. Check:
// (a) each coverage entity gets a minimum share of entity mentions, and
// (b) trade-table rows stay in the coverage universe unless they sit under
// an "Adjacent expressions" heading.

export interface ScopeAdherenceResult {
    shares: Record<string, number>;       // ticker → share of coverage-entity mentions
    underCovered: string[];               // coverage entities below minShare
    outOfUniverseTradeRows: string[];     // unlabeled out-of-universe trade rows
}

// Tokens that look like tickers but aren't.
const NOT_TICKERS = new Set(['LONG', 'SHORT', 'BUY', 'SELL', 'HOLD', 'USD', 'EUR', 'ETF',
    'EPS', 'AUM', 'FCF', 'CEO', 'CFO', 'YOY', 'QOQ', 'FY', 'IPO', 'AI', 'ML', 'GAAP', 'CAGR']);

export function checkScopeAdherence(
    markdown: string,
    coverageTickers: string[],
    aliases: EntityAliases,
    minShare = 0.15,
): ScopeAdherenceResult {
    // (a) mention shares
    const counts: Record<string, number> = {};
    let total = 0;
    for (const t of coverageTickers) {
        const names = aliases[t] ?? [t];
        let n = 0;
        for (const name of names) {
            const isBareTicker = name.length <= 5 && name === name.toUpperCase();
            const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, isBareTicker ? 'g' : 'gi');
            n += (markdown.match(re) ?? []).length;
        }
        counts[t] = n;
        total += n;
    }
    const shares: Record<string, number> = {};
    for (const t of coverageTickers) shares[t] = total > 0 ? counts[t] / total : 0;
    const underCovered = coverageTickers.length >= 2 && total > 0
        ? coverageTickers.filter(t => shares[t] < minShare)
        : [];

    // (b) trade rows outside the universe
    const outOfUniverseTradeRows: string[] = [];
    const coverage = new Set(coverageTickers);
    let currentHeading = '';
    let inTradeTable = false;
    for (const line of markdown.split('\n')) {
        const h = line.match(/^#{2,4}\s+(.*)$/);
        if (h) { currentHeading = h[1]; inTradeTable = false; continue; }
        if (line.trim().startsWith('|')) {
            if (TRADE_HEADER_RE.test(line)) { inTradeTable = true; continue; }
            if (/^\s*\|[\s|:-]+\|\s*$/.test(line)) continue;
            if (inTradeTable && !/adjacent/i.test(currentHeading)) {
                const tickers = (line.match(/\b[A-Z]{2,5}\b/g) ?? [])
                    .filter(t => !NOT_TICKERS.has(t));
                if (tickers.length > 0 && tickers.every(t => !coverage.has(t))) {
                    outOfUniverseTradeRows.push(line.trim().slice(0, 100));
                }
            }
        } else {
            inTradeTable = false;
        }
    }
    return { shares, underCovered, outOfUniverseTradeRows };
}

export function buildScopeDisclosure(r: ScopeAdherenceResult): string {
    const parts: string[] = [];
    if (r.underCovered.length > 0) {
        parts.push(`coverage entities with thin treatment: ${r.underCovered.join(', ')}`);
    }
    if (r.outOfUniverseTradeRows.length > 0) {
        parts.push(`${r.outOfUniverseTradeRows.length} trade expression(s) outside the coverage universe (label under "Adjacent expressions")`);
    }
    if (parts.length === 0) return '';
    return `\n\n> **Scope note:** ${parts.join('; ')}.\n`;
}

// ─── Compliance lint (spec P0-5) ────────────────────────────────────────────
// "Source: Goldman Sachs Research estimates" on AI-generated price targets is
// a fabricated third-party attribution — a regulatory hazard, not a typo.

export interface ComplianceViolation {
    kind: 'third_party_attribution';
    excerpt: string;
}

const THIRD_PARTY_ATTRIBUTION_RE =
    /\b[A-Z][A-Za-z&.]*(?:\s+[A-Z][A-Za-z&.]*){0,3}\s+Research\s+estimates\b|\bper\s+[A-Z][A-Za-z]+\s+research\b/g;

export function lintCompliance(markdown: string): ComplianceViolation[] {
    const out: ComplianceViolation[] = [];
    for (const m of markdown.matchAll(THIRD_PARTY_ATTRIBUTION_RE)) {
        if (m[0].startsWith('Market Intelligence')) continue;   // our own standardized line
        out.push({ kind: 'third_party_attribution', excerpt: m[0] });
    }
    return out;
}

// Standard framing line inserted above any trade-expression table (spec P0-5:
// price targets/stop-losses must never sit unframed next to the disclaimer).
export const TRADE_TABLE_FRAMING =
    '*Illustrative expressions, not investment advice; see disclaimer.*';

const TRADE_HEADER_RE = /\|.*(expression|entry|target|stop.?loss|direction).*\|/i;

export function addTradeTableFraming(markdown: string): string {
    const lines = markdown.split('\n');
    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isTableHeader = line.trim().startsWith('|')
            && TRADE_HEADER_RE.test(line)
            && /^\s*\|[\s|:-]+\|\s*$/.test(lines[i + 1] ?? '');
        const alreadyFramed = out.length > 0
            && out.slice(-3).some(l => l.includes(TRADE_TABLE_FRAMING));
        if (isTableHeader && !alreadyFramed) {
            out.push(TRADE_TABLE_FRAMING, '');
        }
        out.push(line);
    }
    return out.join('\n');
}

// ─── Display subtitle normalization (spec P0-1) ─────────────────────────────
// The raw user query must NEVER render on the cover ("ai in asset managment"
// shipped verbatim as a subtitle). Deterministic: common-typo fixes →
// title-case with small-word/acronym handling. Raw query stays in metadata.

const TYPO_FIXES: Record<string, string> = {
    managment: 'management', mangement: 'management', anaylsis: 'analysis',
    analyis: 'analysis', finanical: 'financial', financal: 'financial',
    stratagy: 'strategy', strategey: 'strategy', comapny: 'company',
    performace: 'performance', investement: 'investment', bussiness: 'business',
};

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'with']);

const ACRONYMS = new Set(['ai', 'ml', 'esg', 'etf', 'ipo', 'm&a', 'fy', 'q1', 'q2', 'q3', 'q4',
    'eps', 'aum', 'fcf', 'roi', 'roic', 'capex', 'gdp', 'sec', 'us', 'uk', 'eu']);

export function normalizeDisplaySubtitle(rawQuery: string): string {
    const words = rawQuery.trim().replace(/\s+/g, ' ').split(' ');
    return words.map((w, i) => {
        const lower = w.toLowerCase();
        const fixed = TYPO_FIXES[lower] ?? lower;
        if (ACRONYMS.has(fixed)) return fixed.toUpperCase();
        // Attached fiscal tokens: fy2026 → FY2026, q4fy25 → Q4FY25
        if (/^(?:fy\d{2,4}|q[1-4](?:fy)?\d{0,4})$/.test(fixed)) return fixed.toUpperCase();
        if (i > 0 && i < words.length - 1 && SMALL_WORDS.has(fixed)) return fixed;
        return fixed.charAt(0).toUpperCase() + fixed.slice(1);
    }).join(' ');
}

// ─── Sentence-safe clamp (spec P0-7 fix 3) ──────────────────────────────────
// The exec-summary card must never render a mid-sentence char-slice ("…the
// primary determinant of"). Cut at the last sentence boundary under the cap.

export function clampToSentence(text: string, maxChars: number): string {
    const t = text.trim();
    if (t.length <= maxChars) return t;
    const slice = t.slice(0, maxChars);
    const lastEnd = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '),
        slice.endsWith('.') ? slice.length - 1 : -1);
    return lastEnd > 0 ? slice.slice(0, lastEnd + 1).trim() : slice.trim() + '…';
}

// ─── Gate runner ─────────────────────────────────────────────────────────────

export function runEntityGate(
    markdown: string,
    aliases: EntityAliases,
    sourceEntityById: Map<string, string>,
): EntityGateResult {
    const claims = extractNumericClaims(markdown, aliases);
    const misattributed = checkEntityAttribution(markdown, aliases, sourceEntityById);
    const duplicates = detectDuplicateAttributions(claims);
    return {
        claims,
        misattributed,
        duplicates,
        misAttributedCount: misattributed.length + duplicates.length,
    };
}
