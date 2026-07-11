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
    type EntityAliases,
} from './reportQaGates';

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
