// QA-1 (P0-3) regression tests 3, 4, 5 from REPORT_QA_SPEC.md Section 4 —
// all derived from real failures in the shipped 2026-07-10 report.

import { describe, it, expect } from 'vitest';
import {
    extractNumericClaims,
    checkEntityAttribution,
    detectDuplicateAttributions,
    buildSourceEntityIndex,
    runEntityGate,
    detectMetric,
    detectPeriod,
    detectValue,
    evaluatePublicationGates,
    capConfidence,
    buildConfidenceBanner,
    type EntityAliases,
    type PublicationGateInput,
} from './reportQaGates';
import { buildLimitationsSection } from './deepResearchService';

const ALIASES: EntityAliases = {
    GS:   ['GS', 'Goldman Sachs', 'Goldman'],
    MS:   ['MS', 'Morgan Stanley'],
    STT:  ['STT', 'State Street'],
    PAYX: ['PAYX', 'Paychex'],
    BLK:  ['BLK', 'BlackRock'],
};

describe('regression test 3 — entity swap {GS, eps, Q4-2024, 2.22} cited to MS source', () => {
    const md = 'Goldman Sachs reported Q4 2024 EPS of $2.22, beating consensus by $0.52 [RAG-2].';
    const sourceIndex = new Map([['RAG-2', 'MS']]);

    it('entity gate rejects the mis-attributed citation', () => {
        const mismatches = checkEntityAttribution(md, ALIASES, sourceIndex);
        expect(mismatches).toHaveLength(1);
        expect(mismatches[0].claimEntity).toBe('GS');
        expect(mismatches[0].sourceEntity).toBe('MS');
        expect(mismatches[0].citationId).toBe('RAG-2');
    });

    it('claim tuple is extracted with correct fields', () => {
        const claims = extractNumericClaims(md, ALIASES);
        expect(claims).toHaveLength(1);
        expect(claims[0]).toMatchObject({ entity: 'GS', metric: 'eps', period: 'Q4-2024', value: 2.22, unit: 'usd' });
    });
});

describe('regression test 4 — (eps_beat, Q4-2024, 0.52) attributed to both MS and GS', () => {
    // Two sentences, same metric+period+value, different entities — the real
    // report attributed MS's beat to GS in the trade table.
    const md = [
        'Morgan Stanley beat consensus EPS by $0.52 in Q4 2024 [3].',
        'Goldman Sachs beat consensus EPS by $0.52 in Q4 2024 [7].',
    ].join(' ');

    it('duplicate-attribution detector flags both entities', () => {
        const claims = extractNumericClaims(md, ALIASES);
        expect(claims).toHaveLength(2);
        const dupes = detectDuplicateAttributions(claims);
        expect(dupes).toHaveLength(1);
        expect(dupes[0].entities.sort()).toEqual(['GS', 'MS']);
        expect(dupes[0].sentences).toHaveLength(2);
    });
});

describe('regression test 5 — STT claim cited to PAYX Item 9C passage', () => {
    // Non-numeric claim: the executive-departure thesis rested on PAYX 10-K
    // boilerplate. Entity check must work without a numeric value.
    const md = 'State Street faces continued executive departures and leadership instability [RAG-5].';
    const sourceIndex = new Map([['RAG-5', 'PAYX']]);

    it('entity gate rejects the citation', () => {
        const mismatches = checkEntityAttribution(md, ALIASES, sourceIndex);
        expect(mismatches).toHaveLength(1);
        expect(mismatches[0].claimEntity).toBe('STT');
        expect(mismatches[0].sourceEntity).toBe('PAYX');
    });

    it('runEntityGate counts it in misAttributedCount', () => {
        const gate = runEntityGate(md, ALIASES, sourceIndex);
        expect(gate.misAttributedCount).toBe(1);
        expect(gate.misattributed).toHaveLength(1);
    });
});

describe('no false positives', () => {
    it('correctly-attributed claim passes', () => {
        const md = 'Morgan Stanley reported Q4 2024 EPS of $2.22 [RAG-2].';
        const gate = runEntityGate(md, ALIASES, new Map([['RAG-2', 'MS']]));
        expect(gate.misAttributedCount).toBe(0);
    });

    it('multi-entity sentence is skipped (conservative)', () => {
        const md = 'Goldman Sachs and Morgan Stanley both beat Q4 2024 consensus [4].';
        const gate = runEntityGate(md, ALIASES, new Map([['4', 'MS']]));
        expect(gate.misAttributedCount).toBe(0);
    });

    it('unknown source entity is skipped', () => {
        const md = 'Goldman Sachs reported Q4 2024 EPS of $11.95 [2].';
        const gate = runEntityGate(md, ALIASES, new Map([['2', '']]));
        expect(gate.misAttributedCount).toBe(0);
    });

    it('same value for same entity twice is not a duplicate', () => {
        const md = 'BlackRock revenue grew 14% in Q1 2026 [1]. BlackRock revenue rose 14% in Q1 2026 [2].';
        const claims = extractNumericClaims(md, ALIASES);
        expect(detectDuplicateAttributions(claims)).toHaveLength(0);
    });
});

// ─── QA-2 (P0-4) publication gates ──────────────────────────────────────────

const CLEAN_GATES: PublicationGateInput = {
    misattributed: 0, duplicates: 0, unsupportedClaims: 0,
    citationDensity: 0.95, totalFactSentences: 100, staleSourceRatio: 0.1,
    revisorRan: true, revisorFlags: 3, revisorAccepted: 2,
};

describe('regression test 10 — ungrounded body number, unbadged → gate fails', () => {
    it('blocks and caps confidence at Low', () => {
        const r = evaluatePublicationGates({ ...CLEAN_GATES, unsupportedClaims: 26 });
        expect(r.passed).toBe(false);
        expect(r.maxConfidence).toBe('Low');
        expect(r.violations.some(v => v.gate === 'ungrounded_numbers' && v.severity === 'block')).toBe(true);
    });
});

describe('regression test 15 — Limitations list capped below flagged count → "+N more"', () => {
    it('renders explicit "…and N more" when unsupported claims exceed the cap', () => {
        const unsupportedClaims = Array.from({ length: 26 }, (_, i) => `$${i + 1}.5B invented figure ${i + 1}`);
        const { section, count } = buildLimitationsSection({
            markdown: 'body',
            blueprint: { researchAngles: [], subtopics: [] },
            verification: {
                totalClaims: 30, groundedClaims: 4, multiSourceClaims: 1,
                singleSourceClaims: [], unsupportedClaims,
            },
            confidence: 'Low',
        });
        expect(count).toBe(26);
        expect(section).toContain('Unsupported numeric claims (26)');
        expect(section).toContain('…and 20 more');
    });
});

describe('regression test 17 (gate half) — violated gates can never ship Medium/High', () => {
    it('capConfidence lowers, never raises', () => {
        expect(capConfidence('High', 'Low')).toBe('Low');
        expect(capConfidence('Medium', 'Low')).toBe('Low');
        expect(capConfidence('Low', 'High')).toBe('Low');
        expect(capConfidence('High', 'High')).toBe('High');
    });

    it('mis-attributed citations block Medium/High', () => {
        const r = evaluatePublicationGates({ ...CLEAN_GATES, misattributed: 8 });
        expect(r.passed).toBe(false);
        expect(r.maxConfidence).toBe('Low');
    });

    it('confidence banner renders verdict + reason at top', () => {
        const r = evaluatePublicationGates({ ...CLEAN_GATES, misattributed: 8 });
        const banner = buildConfidenceBanner('Low', r.violations);
        expect(banner).toMatch(/^> \*\*Confidence: Low\*\*/);
        expect(banner).toContain('8 mis-attributed');
    });
});

describe('remaining P0-4 gate rules', () => {
    it('clean telemetry passes at High', () => {
        const r = evaluatePublicationGates(CLEAN_GATES);
        expect(r.passed).toBe(true);
        expect(r.maxConfidence).toBe('High');
        expect(r.violations).toHaveLength(0);
    });

    it('citation density < 90% warns and caps Medium', () => {
        const r = evaluatePublicationGates({ ...CLEAN_GATES, citationDensity: 0.72 });
        expect(r.passed).toBe(true);   // warn, not block
        expect(r.maxConfidence).toBe('Medium');
    });

    it('stale-source ratio > 40% caps Low', () => {
        const r = evaluatePublicationGates({ ...CLEAN_GATES, staleSourceRatio: 1.0 });
        expect(r.maxConfidence).toBe('Low');
    });

    it('revisor flags>0 accepted==0 is a component-failure block', () => {
        const r = evaluatePublicationGates({ ...CLEAN_GATES, revisorFlags: 15, revisorAccepted: 0 });
        expect(r.passed).toBe(false);
        expect(r.violations.some(v => v.gate === 'revisor_component_failure')).toBe(true);
    });

    it('revisor rule skipped when revisor never ran', () => {
        const r = evaluatePublicationGates({ ...CLEAN_GATES, revisorRan: false, revisorFlags: 15, revisorAccepted: 0 });
        expect(r.passed).toBe(true);
    });
});

// ─── QA-3 (P0-6) citation ID space ──────────────────────────────────────────

import { remapRagCitations, stripInternalTags, scanCitationIntegrity } from './reportQaGates';

describe('regression test 6 — orphaned punctuation fails the scan', () => {
    it('detects "44.5% ." and "0.06% ," gaps left by stripped citations', () => {
        const r = scanCitationIntegrity('Margins reached 44.5% . Expense ratio of 0.06% , the lowest.', 10);
        expect(r.ok).toBe(false);
        expect(r.orphanPunctuation.length).toBe(2);
    });

    it('clean prose passes', () => {
        const r = scanCitationIntegrity('Margins reached 44.5% [3]. Expense ratio of 0.06% [4], the lowest.', 10);
        expect(r.ok).toBe(true);
    });

    it('table rows and blockquotes are exempt', () => {
        const r = scanCitationIntegrity('| cell | 44.5% . |\n> quoted 1.2% ,', 10);
        expect(r.orphanPunctuation).toHaveLength(0);
    });
});

describe('regression test 13 — bracket ids must resolve to a References entry', () => {
    it('surviving [RAG-5] fails', () => {
        const r = scanCitationIntegrity('Thesis rests on governance concerns [RAG-5].', 60);
        expect(r.ok).toBe(false);
        expect(r.unresolvedIds).toContain('[RAG-5]');
    });

    it('[n] beyond citation count fails', () => {
        const r = scanCitationIntegrity('A claim [55].', 40);
        expect(r.unresolvedIds).toContain('[55]');
    });

    it('in-range [n] resolves; markdown links exempt', () => {
        const r = scanCitationIntegrity('A claim [12]. See [the filing](https://sec.gov/x).', 40);
        expect(r.unresolvedIds).toHaveLength(0);
    });
});

describe('P0-6 remap + internal-tag strip', () => {
    it('remapRagCitations merges RAG ids into the 1–N space', () => {
        // 50 web + 3 SEC → RAG-1 becomes [54]
        expect(remapRagCitations('Aladdin revenue grew [RAG-1] and [RAG-6].', 53))
            .toBe('Aladdin revenue grew [54] and [59].');
    });

    it('stripInternalTags removes [TIER 2b] without leaving an orphan', () => {
        const out = stripInternalTags('Flows improved materially [TIER 2b] .');
        expect(out).toBe('Flows improved materially.');
        expect(scanCitationIntegrity(out, 10).ok).toBe(true);
    });

    it('leaves numeric citations and normal prose untouched', () => {
        const md = 'Revenue grew 14% [7]. Standard [brackets] stay.';
        expect(stripInternalTags(md)).toBe(md);
    });
});

// ─── QA-6 (P0-2) temporal sanity ────────────────────────────────────────────

import { lintTemporal, recencyWeightQueries, extractDateFromUrl } from './reportQaGates';

describe('regression test 2 — "our FY2025 EPS estimate" in a 2026-07-10 report', () => {
    const reportDate = new Date('2026-07-10');

    it('temporal linter fails the draft', () => {
        const v = lintTemporal('Our price target is built on our FY2025 EPS estimate of $12.40.', reportDate);
        expect(v.some(x => x.kind === 'elapsed_period_estimate' && x.period === 'FY2025')).toBe(true);
    });

    it('future-period outlook passes', () => {
        const v = lintTemporal('Our FY2027 EPS estimate of $14 implies upside.', reportDate);
        expect(v).toHaveLength(0);
    });

    it('elapsed quarter estimate flagged, reported result not', () => {
        expect(lintTemporal('We forecast Q4 2024 revenue of $2B.', reportDate)
            .some(x => x.kind === 'elapsed_period_estimate')).toBe(true);
        expect(lintTemporal('Q4 2024 revenue came in at $2B, as reported.', reportDate)).toHaveLength(0);
    });

    it('gate blocks on unprovenanced price dates, warns on elapsed estimates', () => {
        const blocked = evaluatePublicationGates({ ...CLEAN_GATES, unprovenancedPriceDates: 1 });
        expect(blocked.passed).toBe(false);
        expect(blocked.maxConfidence).toBe('Low');
        const warned = evaluatePublicationGates({ ...CLEAN_GATES, elapsedPeriodEstimates: 2 });
        expect(warned.passed).toBe(true);
        expect(warned.maxConfidence).toBe('Medium');
    });
});

describe('regression test 14 — price row without live-quote provenance', () => {
    it('"Prices as of market close June 1, 2026" is flagged as fabricated provenance', () => {
        const v = lintTemporal('Prices as of market close June 1, 2026. Entry at $980.', new Date('2026-07-10'));
        expect(v.some(x => x.kind === 'unprovenanced_price_date')).toBe(true);
    });

    it('tool-sourced [live] price date passes', () => {
        const v = lintTemporal('Prices as of 2026-07-10 [live] from quote API.', new Date('2026-07-10'));
        expect(v.filter(x => x.kind === 'unprovenanced_price_date')).toHaveLength(0);
    });
});

describe('P0-2 retrieval recency helpers', () => {
    it('recencyWeightQueries appends current year only when absent', () => {
        expect(recencyWeightQueries(['nvidia data center revenue', 'amd roadmap 2025'], 2026))
            .toEqual(['nvidia data center revenue 2026', 'amd roadmap 2025']);
    });

    it('extractDateFromUrl recovers /YYYY/MM/DD/, rejects junk', () => {
        expect(extractDateFromUrl('https://x.com/2026/07/03/story')).toBe('2026-07-03');
        expect(extractDateFromUrl('https://x.com/2026-05-01-report')).toBe('2026-05-01');
        expect(extractDateFromUrl('https://x.com/2026/13/99/')).toBeNull();
        expect(extractDateFromUrl('https://x.com/plain-page')).toBeNull();
    });
});

// ─── QA-7 (P0-5) compliance lint ────────────────────────────────────────────

import { lintCompliance, addTradeTableFraming, TRADE_TABLE_FRAMING } from './reportQaGates';

describe('regression test 8 — fabricated third-party attribution fails the build', () => {
    it('the exact string from the shipped report is caught', () => {
        const v = lintCompliance('Entry $980, target $1,150.\n\nSource: Goldman Sachs Research estimates');
        expect(v).toHaveLength(1);
        expect(v[0].excerpt).toContain('Goldman Sachs Research estimates');
    });

    it('"per <bank> research" variant is caught', () => {
        expect(lintCompliance('valuation per Morgan research suggests upside').length).toBe(1);
    });

    it('our standardized source line passes', () => {
        expect(lintCompliance('Source: Market Intelligence AI estimates; company filings; cited sources.')).toHaveLength(0);
    });

    it('gate blocks on third-party attributions', () => {
        const r = evaluatePublicationGates({ ...CLEAN_GATES, thirdPartyAttributions: 1 });
        expect(r.passed).toBe(false);
        expect(r.maxConfidence).toBe('Low');
    });
});

describe('P0-5 trade-table framing', () => {
    const table = '| Expression | Entry | Target | Stop-Loss |\n|---|---|---|---|\n| Long BLK | $980 | $1150 | $890 |';

    it('framing line inserted above a trade table', () => {
        const out = addTradeTableFraming(`## Trade Expressions\n\n${table}`);
        const lines = out.split('\n');
        const idx = lines.findIndex(l => l.startsWith('|') && l.includes('Expression'));
        expect(lines[idx - 2]).toBe(TRADE_TABLE_FRAMING);
    });

    it('non-trade tables untouched; no double-framing', () => {
        const plain = '| Metric | Value |\n|---|---|\n| Revenue | $5B |';
        expect(addTradeTableFraming(plain)).toBe(plain);
        const once = addTradeTableFraming(addTradeTableFraming(`${TRADE_TABLE_FRAMING}\n\n${table}`));
        expect(once.split('\n').filter(l => l.includes(TRADE_TABLE_FRAMING))).toHaveLength(1);
    });
});

// ─── QA-9 (P1-2) source tiering ─────────────────────────────────────────────

import { buildSourceTierIndex, findT3OnlyClaims } from './reportQaGates';
import { tierOf } from './tavilyService';

describe('regression test 12 — numeric claim supported only by instagram/reddit', () => {
    it('tier gate rejects the claim', () => {
        const md = 'BlackRock AI market opportunity is worth $10 billion by 2027 [1][2].';
        const claims = extractNumericClaims(md, ALIASES);
        const tierIndex = buildSourceTierIndex([
            { url: 'https://www.instagram.com/reel/xyz' },
            { url: 'https://www.reddit.com/r/stocks/abc' },
        ]);
        const t3Only = findT3OnlyClaims(claims, tierIndex);
        expect(t3Only).toHaveLength(1);
        const r = evaluatePublicationGates({ ...CLEAN_GATES, t3OnlyNumericClaims: t3Only.length });
        expect(r.passed).toBe(false);
        expect(r.maxConfidence).toBe('Low');
    });

    it('same claim with one T1/T2 source passes', () => {
        const md = 'BlackRock AI market opportunity is worth $10 billion by 2027 [1][2].';
        const claims = extractNumericClaims(md, ALIASES);
        const tierIndex = buildSourceTierIndex([
            { url: 'https://www.reuters.com/markets/blackrock-ai' },
            { url: 'https://www.reddit.com/r/stocks/abc' },
        ]);
        expect(findT3OnlyClaims(claims, tierIndex)).toHaveLength(0);
    });

    it('tierOf maps hosts correctly', () => {
        expect(tierOf('https://www.sec.gov/Archives/edgar/data/x.htm')).toBe('T1');
        expect(tierOf('https://www.bloomberg.com/news/x')).toBe('T2');
        expect(tierOf('https://www.cnbc.com/2026/x')).toBe('T2');
        expect(tierOf('https://www.instagram.com/reel/x')).toBe('T3');
        expect(tierOf('https://seekingalpha.com/article/x')).toBe('T3');
        expect(tierOf('https://random-seo-farm.biz/market-report')).toBe('T3');
    });
});

// ─── QA-8 (P1-1) retrieval scope guard ──────────────────────────────────────

import { checkRagCoverage, buildCoverageDisclosure } from './reportQaGates';

describe('regression test 11 — RAG corpus has zero docs for a coverage entity', () => {
    it('gap without SEC coverage → disclosure inserted', () => {
        const gaps = checkRagCoverage(
            ['BLK', 'STT'],
            [{ ticker: 'PAYX' }, { ticker: 'BAC' }],   // zero coverage overlap (the real bug)
            [],                                          // no SEC filings either
            ALIASES,
        );
        expect(gaps).toHaveLength(2);
        const disclosure = buildCoverageDisclosure(gaps);
        expect(disclosure).toContain('No internal documents available for BLK, STT');
    });

    it('gap covered by SEC filings → no disclosure (EDGAR branch)', () => {
        const gaps = checkRagCoverage(['STT'], [], [{ company: 'State Street Corporation' }], ALIASES);
        expect(gaps[0].hasSec).toBe(true);
        expect(buildCoverageDisclosure(gaps)).toBe('');
    });

    it('entity present in RAG → no gap', () => {
        expect(checkRagCoverage(['BLK'], [{ ticker: 'BLK' }], [], ALIASES)).toHaveLength(0);
    });
});

// ─── QA-10 (P1-3) revisor debug harness ─────────────────────────────────────

import { reviseReport, applyRevisionEdits } from './deepResearchService';

describe('P1-3 revisor — known-bad draft harness', () => {
    // Draft with an unhedged forecast (flagged by fact-inference verifier) and
    // an uncited factual sentence — the revisor MUST produce accepted edits.
    const badDraft = [
        '# Report',
        '',
        'BlackRock revenue will definitely reach $25 billion next year.',
        'The firm manages significant institutional assets across regions [1].',
    ].join('\n');

    it('edits apply and revision is accepted on a known-bad draft', async () => {
        const { stats } = await reviseReport({
            markdown: badDraft,
            verification: { totalClaims: 2, groundedClaims: 1, multiSourceClaims: 0, singleSourceClaims: [], unsupportedClaims: [] },
            citationDensity: { totalFactSentences: 2, citedSentences: 1, density: 0.5, uncitedSamples: ['BlackRock revenue will definitely reach $25 billion next year.'] },
            factInference: { totalForwardLooking: 1, hedgedCount: 0, hedgingRate: 0, unhedgedSamples: ['BlackRock revenue will definitely reach $25 billion next year.'] },
        }, {
            callLLM: async () => JSON.stringify([{
                find: 'BlackRock revenue will definitely reach $25 billion next year.',
                replace: 'Consensus suggests BlackRock revenue could reach $25 billion next year [1].',
                reason: 'hedge_forecast',
            }]),
            tracker: null,
        });
        expect(stats.used).toBe(true);
        expect(stats.editsApplied).toBeGreaterThanOrEqual(1);
        expect(stats.accepted).toBe(true);
    });

    it('every rejected edit carries a reason', () => {
        const { applied, rejections } = applyRevisionEdits(badDraft, [
            { find: 'text that is definitely not present in the draft', replace: 'replacement of similar length here', reason: 'other' },
            { find: 'BlackRock revenue will definitely reach $25 billion next year.', replace: 'x', reason: 'other' },
            { find: 'The firm manages significant institutional assets', replace: 'The firm manages significant institutional assets [99]', reason: 'add_citation' },
        ]);
        expect(applied).toBe(0);
        expect(rejections.map(r => r.reason)).toEqual(['not_found', 'length_ratio', 'invented_citation']);
    });
});

// ─── QA-11 (P1-4) scope adherence ───────────────────────────────────────────

import { checkScopeAdherence, buildScopeDisclosure } from './reportQaGates';

describe('P1-4 scope adherence', () => {
    it('thin coverage entity flagged (the STT two-paragraphs bug)', () => {
        const md = 'BlackRock '.repeat(10) + 'Vanguard '.repeat(9) + 'State Street coverage.';
        const r = checkScopeAdherence(md, ['BLK', 'V', 'STT'],
            { BLK: ['BlackRock'], V: ['Vanguard'], STT: ['State Street'] });
        expect(r.underCovered).toEqual(['STT']);
    });

    it('out-of-universe trade row flagged; Adjacent-expressions section exempt', () => {
        const table = '| Expression | Entry | Target |\n|---|---|---|\n| Long MSFT | $400 | $500 |';
        const flagged = checkScopeAdherence(`## Trade Expressions\n${table}`, ['BLK'], { BLK: ['BlackRock'] });
        expect(flagged.outOfUniverseTradeRows).toHaveLength(1);
        const exempt = checkScopeAdherence(`## Adjacent expressions\n${table}`, ['BLK'], { BLK: ['BlackRock'] });
        expect(exempt.outOfUniverseTradeRows).toHaveLength(0);
    });

    it('in-universe trade rows pass; disclosure renders both signals', () => {
        const table = '| Expression | Entry |\n|---|---|\n| Long BLK | $980 |';
        const ok = checkScopeAdherence(`## Trade Expressions\n${table}`, ['BLK'], { BLK: ['BlackRock'] });
        expect(ok.outOfUniverseTradeRows).toHaveLength(0);
        expect(buildScopeDisclosure({ shares: {}, underCovered: ['STT'], outOfUniverseTradeRows: ['| Long MSFT |'] }))
            .toContain('STT');
        expect(buildScopeDisclosure({ shares: {}, underCovered: [], outOfUniverseTradeRows: [] })).toBe('');
    });
});

// ─── QA-12 (P1-5) estimate discipline ───────────────────────────────────────

import { lintEstimates } from './reportQaGates';

describe('P1-5 estimate discipline', () => {
    it('"we estimate" without method flagged (the $400-600M ACV bug)', () => {
        const v = lintEstimates('We estimate a $400-600M Aladdin ACV uplift over three years.');
        expect(v).toHaveLength(1);
    });

    it('estimate with shown work passes', () => {
        expect(lintEstimates('We estimate $500M uplift, based on 2,000 clients × $250K average contract value.')).toHaveLength(0);
        expect(lintEstimates('We estimate 300bps (illustrative) cost impact.')).toHaveLength(0);
    });

    it('gate warns and caps Medium', () => {
        const r = evaluatePublicationGates({ ...CLEAN_GATES, unmethodEstimates: 4 });
        expect(r.passed).toBe(true);
        expect(r.maxConfidence).toBe('Medium');
    });
});

// ─── QA-16 (P2-1) auto-exhibits ─────────────────────────────────────────────

import { buildExhibits, type ExhibitClaim } from './reportQaGates';

describe('P2-1 auto-exhibits from the NumericClaim store', () => {
    const claim = (entity: string, metric: string, value: number, unit = 'usd_b'): ExhibitClaim =>
        ({ entity, metric, period: 'Q1-2026', value, unit, sourceIds: ['3'] });

    it('a (metric, unit) held by ≥2 entities becomes a cited exhibit', () => {
        const specs = buildExhibits([
            claim('BLK', 'revenue', 5.2), claim('STT', 'revenue', 3.1), claim('BLK', 'eps', 9.8, 'usd'),
        ]);
        expect(specs).toHaveLength(1);
        expect(specs[0].title).toContain('Revenue');
        expect(specs[0].bars.map(b => b.label)).toEqual(['BLK', 'STT']);   // sorted desc by value
        expect(specs[0].bars[0].sourceIds).toEqual(['3']);
    });

    it('single-entity metrics and "other"/non-positive claims are skipped; caps at 3', () => {
        expect(buildExhibits([claim('BLK', 'eps', 2.2, 'usd')])).toHaveLength(0);
        expect(buildExhibits([claim('BLK', 'other', 5), claim('STT', 'other', 3)])).toHaveLength(0);
        const many: ExhibitClaim[] = ['revenue', 'eps', 'aum', 'margin', 'fcf'].flatMap(m =>
            [claim('BLK', m, 5), claim('STT', m, 3)]);
        expect(buildExhibits(many)).toHaveLength(3);
    });
});

// ─── QA-13 (P1-6) telemetry consistency ─────────────────────────────────────

import { deriveReportStats, isSecEdgarUrl } from './reportQaGates';

describe('P1-6 telemetry consistency', () => {
    const citations = [
        { source: 'Web', url: 'https://www.reuters.com/x' },
        { source: 'Web', url: 'https://www.sec.gov/Archives/edgar/data/0001.htm' },   // the "0 SEC filings" classifier bug
        { source: 'SEC EDGAR', url: 'https://www.sec.gov/Archives/edgar/data/0002.htm' },
        { source: 'Gravity RAG', url: '' },
    ];

    it('sec.gov URLs count as SEC even when labeled Web', () => {
        const stats = deriveReportStats(citations, 172);
        expect(stats.sec).toBe(2);
        expect(stats.web).toBe(1);
        expect(stats.rag).toBe(1);
    });

    it('one struct: cited count == references length; breakdown sums', () => {
        const stats = deriveReportStats(citations, 172);
        expect(stats.sourcesCited).toBe(citations.length);
        expect(stats.web + stats.sec + stats.rag).toBe(stats.sourcesCited);
        expect(stats.sourcesAnalyzed).toBe(172);
    });

    it('isSecEdgarUrl matches Archives and bare edgar paths', () => {
        expect(isSecEdgarUrl('https://www.sec.gov/Archives/edgar/data/x')).toBe(true);
        expect(isSecEdgarUrl('https://efts.sec.gov/edgar/search')).toBe(true);
        expect(isSecEdgarUrl('https://www.reuters.com/sec-story')).toBe(false);
    });
});

// ─── QA-5 (P0-1) title hygiene ──────────────────────────────────────────────

import { normalizeDisplaySubtitle } from './reportQaGates';

describe('regression test 1 — raw query never renders on the cover', () => {
    it('"ai in asset managment" → "AI in Asset Management"', () => {
        expect(normalizeDisplaySubtitle('ai in asset managment')).toBe('AI in Asset Management');
    });

    it('title-cases with small-word exceptions', () => {
        expect(normalizeDisplaySubtitle('the future of etf flows and esg investing'))
            .toBe('The Future of ETF Flows and ESG Investing');
    });

    it('collapses whitespace', () => {
        expect(normalizeDisplaySubtitle('  nvidia   q4  eps ')).toBe('Nvidia Q4 EPS');
    });
});

describe('helpers', () => {
    it('detectMetric hits the ontology', () => {
        expect(detectMetric('EPS of $2.22')).toBe('eps');
        expect(detectMetric('assets under management reached $10T')).toBe('aum');
        expect(detectMetric('fund capacity capped at $10B')).toBe('capacity');
    });

    it('detectPeriod parses Q/FY/year forms', () => {
        expect(detectPeriod('Q4 2024 EPS')).toBe('Q4-2024');
        expect(detectPeriod('our FY2026 outlook')).toBe('FY2026');
        expect(detectPeriod('during 2025 the firm')).toBe('2025');
        expect(detectPeriod('no period here')).toBe('');
    });

    it('detectValue parses $, %, bps, x', () => {
        expect(detectValue('revenue of $35.6 billion')).toEqual({ value: 35.6, unit: 'usd_b' });
        expect(detectValue('margin of 44.5%')).toEqual({ value: 44.5, unit: 'pct' });
        expect(detectValue('a 150 bps drag')).toEqual({ value: 150, unit: 'bps' });
        expect(detectValue('trades at 14.5x earnings')).toEqual({ value: 14.5, unit: 'x' });
        expect(detectValue('no numbers')).toBeNull();
    });

    it('buildSourceEntityIndex maps web titles and RAG tickers', () => {
        const idx = buildSourceEntityIndex(
            [{ title: 'Morgan Stanley Q4 earnings beat' }, { title: 'Markets wrap: stocks mixed' }],
            [{ ticker: 'PAYX' }],
            ALIASES,
        );
        expect(idx.get('1')).toBe('MS');
        expect(idx.get('2')).toBe('');      // no single entity in title
        expect(idx.get('RAG-1')).toBe('PAYX');
    });
});
