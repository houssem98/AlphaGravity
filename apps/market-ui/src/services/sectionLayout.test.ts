// G1a — block library + deterministic section-shape classifier.
// Fixtures mirror the shapes actually present in the archived v2 corpus
// (eval/out/baseline-*.md): risk matrices, entity comparison tables, verdict
// callouts, and long uncited executive prose.

import { describe, it, expect } from 'vitest';
import {
    splitSections, extractStats, computeSignals, classifySection, classifyReport,
    layoutPrecondition, layoutVariety, isSectionLayout, SECTION_LAYOUTS,
} from './sectionLayout';

const RISK_TABLE = `Risk is concentrated in two places.

| Risk Factor | Probability (12mo) | Impact | Mitigant |
|-------------|--------------------|--------|----------|
| Inventory digestion | 30–40% | Revenue -15% | Capex guidance elevated |
| Margin compression | 40–50% | $1.3B per 100bps | Blackwell ASP offset |
| ASIC displacement | 35–45% | Revenue -$8B | CUDA lock-in |`;

const COMPARISON = `AMD vs Intel on data center CPUs.

| Metric | AMD | Intel |
|--------|-----|-------|
| Revenue | $5.5B | $500M |
| Share | 27% | 68% |`;

const VERDICT = `We rate the name Neutral after weighing both sides.

**Conviction Rating: Neutral (Sector Weight)**

Relative to the sector we see better risk-adjusted opportunities elsewhere.`;

const STAT_PROSE = `Data center revenue reached $130.5B in FY2025 [Analyst Synthesis]. Gross margin was 73.0% in Q4 and guided to 70.6% [Consolidated Data Points]. Inventory turnover sat at ~2.5x [Analyst Synthesis].`;

const UNCITED_PROSE = `Data center revenue reached $130.5B in FY2025, up 142% year over year. We view the Street consensus range of $140B–$150B as too conservative given the Blackwell ramp.`;

const TIMELINE = `Milestones ahead:

- Q1 FY2026 — first full Blackwell quarter
- Q3 FY2026 — enterprise inference inflection
- FY2027 — mix shifts toward inference`;

describe('splitSections', () => {
    it('splits on h2 and keeps bodies intact', () => {
        const secs = splitSections('# Title\n\n## One\nalpha\n\n## Two\nbeta');
        expect(secs.map(s => s.heading)).toEqual(['One', 'Two']);
        expect(secs[1].body).toBe('beta');
    });

    it('does not treat h3 as a section boundary', () => {
        const secs = splitSections('## One\nalpha\n\n### Sub\nnested');
        expect(secs).toHaveLength(1);
        expect(secs[0].body).toContain('### Sub');
    });
});

describe('extractStats — extractor-only, verbatim', () => {
    it('pulls value, label and citation as literal report slices', () => {
        const stats = extractStats(STAT_PROSE);
        const values = stats.map(s => s.value);
        expect(values).toContain('$130.5B');
        expect(values).toContain('73.0%');
        expect(values).toContain('~2.5x');
        for (const s of stats) {
            expect(STAT_PROSE).toContain(s.value);
            if (s.citation) expect(STAT_PROSE).toContain(s.citation);
            if (s.label) expect(STAT_PROSE).toContain(s.label);
        }
    });

    it('leaves numbers uncited when the sentence has no citation tag', () => {
        expect(extractStats(UNCITED_PROSE).every(s => s.citation === '')).toBe(true);
    });

    it('ignores numbers living inside tables', () => {
        expect(extractStats(COMPARISON).map(s => s.value)).not.toContain('$5.5B');
    });

    it('does not invent a number that is not in the text', () => {
        expect(extractStats('Growth was strong and margins held up.')).toHaveLength(0);
    });
});

describe('computeSignals', () => {
    it('counts table rows without the header or separator', () => {
        expect(computeSignals('Risk Matrix', RISK_TABLE).tableRows).toBe(3);
    });

    it('detects a risk-matrix table by its header terms', () => {
        expect(computeSignals('Findings', RISK_TABLE).riskTable).toBe(true);
        expect(computeSignals('Findings', COMPARISON).riskTable).toBe(false);
    });

    it('counts period markers only when they LEAD an item', () => {
        expect(computeSignals('Outlook', TIMELINE).periodTokens).toBe(3);
        // Same years, buried mid-prose — not a timeline.
        expect(computeSignals('Outlook',
            'We expect FY2026 to follow 2025 and precede FY2027 in the same cycle.').periodTokens).toBe(0);
    });

    it('counts only fully-bold paragraphs as verdict lines', () => {
        expect(computeSignals('Conclusion', VERDICT).boldLines).toBe(1);
        expect(computeSignals('Body', 'A **bold span** inside a sentence.').boldLines).toBe(0);
    });

    it('treats a bold line above a table as a caption, not a verdict', () => {
        const captioned = `Intro prose.\n\n**Financial Scorecard**\n\n${COMPARISON.split('\n\n')[1]}`;
        expect(computeSignals('Financial Performance', captioned).boldLines).toBe(0);
    });
});

describe('classifySection', () => {
    it('classifies a risk matrix as risk-list', () => {
        expect(classifySection('Risk Matrix', RISK_TABLE).layout).toBe('risk-list');
    });

    it('classifies an entity table under a comparison heading as comparison', () => {
        expect(classifySection('Side-by-Side Financial Comparison', COMPARISON).layout).toBe('comparison');
    });

    it('classifies a verdict callout as quote-led', () => {
        expect(classifySection('Conclusion & Conviction Rating', VERDICT).layout).toBe('quote-led');
    });

    it('classifies dense cited figures as stat-row', () => {
        expect(classifySection('Financial Performance', STAT_PROSE).layout).toBe('stat-row');
    });

    it('classifies a dated sequence as timeline', () => {
        expect(classifySection('Outlook', TIMELINE).layout).toBe('timeline');
    });

    it('falls back to prose for undifferentiated narrative', () => {
        expect(classifySection('Executive Summary', UNCITED_PROSE).layout).toBe('prose');
    });

    it('never lets a heading alone assign a layout the structure cannot carry', () => {
        // Risk heading, but nothing enumerated → must not claim risk-list.
        const s = classifySection('Key Risks & Monitoring Points', UNCITED_PROSE);
        expect(s.layout).not.toBe('risk-list');
        // Timeline heading, dates only mid-prose → must not claim timeline.
        expect(classifySection('Outlook: Catalysts', UNCITED_PROSE).layout).not.toBe('timeline');
    });

    it('always returns a whitelisted layout', () => {
        for (const body of [RISK_TABLE, COMPARISON, VERDICT, STAT_PROSE, UNCITED_PROSE, TIMELINE, '']) {
            expect(isSectionLayout(classifySection('X', body).layout)).toBe(true);
        }
    });
});

describe('layoutPrecondition — the gate for G1c LLM overrides', () => {
    it('rejects stat-row on a section with fewer than 3 cited numbers', () => {
        const s = computeSignals('Executive Summary', UNCITED_PROSE);
        expect(layoutPrecondition('stat-row', s)).toMatch(/needs ≥3 cited numbers/);
    });

    it('rejects timeline on a section with no leading period markers', () => {
        const s = computeSignals('Outlook', UNCITED_PROSE);
        expect(layoutPrecondition('timeline', s)).toMatch(/period markers/);
    });

    it('accepts prose for anything', () => {
        expect(layoutPrecondition('prose', computeSignals('X', ''))).toBeNull();
    });

    it('accepts the layout the classifier itself chose, for every layout', () => {
        for (const body of [RISK_TABLE, COMPARISON, VERDICT, STAT_PROSE, TIMELINE, UNCITED_PROSE]) {
            const shape = classifySection('Section', body);
            expect(layoutPrecondition(shape.layout, shape.signals)).toBeNull();
        }
    });
});

describe('classifyReport + layoutVariety', () => {
    const REPORT = [
        '# Report', '',
        '## Executive Summary', UNCITED_PROSE, '',
        '## Financial Performance', STAT_PROSE, '',
        '## Risk Matrix', RISK_TABLE, '',
        '## Conclusion & Conviction Rating', VERDICT,
    ].join('\n\n');

    it('assigns one shape per section', () => {
        expect(classifyReport(REPORT).map(s => s.layout))
            .toEqual(['prose', 'stat-row', 'risk-list', 'quote-led']);
    });

    it('scores an all-prose document below a mixed one', () => {
        const flat = '## A\n\nalpha prose.\n\n## B\n\nbeta prose.';
        expect(layoutVariety(classifyReport(flat)))
            .toBeLessThan(layoutVariety(classifyReport(REPORT)));
    });

    it('returns 0 for an empty document', () => {
        expect(layoutVariety([])).toBe(0);
    });

    it('exposes exactly 7 whitelisted layouts', () => {
        expect(SECTION_LAYOUTS).toHaveLength(7);
    });
});
