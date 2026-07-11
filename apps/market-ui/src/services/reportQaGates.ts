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
