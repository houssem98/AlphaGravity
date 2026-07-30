// G1a — block library + deterministic section-shape classifier.
// Fixtures mirror the shapes actually present in the archived v2 corpus
// (eval/out/baseline-*.md): risk matrices, entity comparison tables, verdict
// callouts, and long uncited executive prose.

import { describe, it, expect } from 'vitest';
import {
    splitSections, extractStats, computeSignals, classifySection, classifyReport,
    layoutPrecondition, layoutVariety, isSectionLayout, SECTION_LAYOUTS,
    pickStatCards, extractVerdict, buildSectionViews, isVerdictLine,
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
        // value + citation are strictly verbatim; the label is the report's
        // own words with markdown syntax stripped.
        const plain = STAT_PROSE.replace(/[*`_]/g, '');
        for (const s of stats) {
            expect(STAT_PROSE).toContain(s.value);
            if (s.citation) expect(STAT_PROSE).toContain(s.citation);
            if (s.label) expect(plain).toContain(s.label);
        }
    });

    it('does not cut a label out of the middle of a decimal', () => {
        const stats = extractStats('Microsoft trades at a P/E of 22.84x and a market cap of $2.855 trillion [Ref].');
        const cap = stats.find(s => s.value.includes('2.855'))!;
        expect(cap.label).not.toMatch(/^84x/);
    });

    it('strips markdown syntax out of labels', () => {
        const stats = extractStats('Revenue grew to **$8–12 billion** across the segment [Ref].');
        expect(stats.every(s => !s.label.includes('*'))).toBe(true);
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

describe('pickStatCards', () => {
    it('returns only cited stats, one per distinct label', () => {
        const cards = pickStatCards(STAT_PROSE);
        expect(cards.length).toBeGreaterThan(0);
        expect(cards.every(c => c.citation !== '')).toBe(true);
        const labels = cards.map(c => c.label.toLowerCase());
        expect(new Set(labels).size).toBe(labels.length);
    });

    it('returns nothing for uncited prose — a stat card must be attributable', () => {
        expect(pickStatCards(UNCITED_PROSE)).toHaveLength(0);
    });

    it('respects the max', () => {
        expect(pickStatCards(STAT_PROSE, 2).length).toBeLessThanOrEqual(2);
    });
});

describe('extractVerdict', () => {
    it('lifts the bold line and removes it from the remaining prose', () => {
        const v = extractVerdict(VERDICT)!;
        expect(v.verdict).toBe('Conviction Rating: Neutral (Sector Weight)');
        expect(v.rest).not.toContain('**Conviction Rating');
        expect(v.rest).toContain('Relative to the sector');
    });

    it('returns null when there is no verdict line', () => {
        expect(extractVerdict(UNCITED_PROSE)).toBeNull();
    });

    it('does not lift a table caption', () => {
        expect(extractVerdict(`Intro.\n\n**Scorecard**\n\n| A | B |\n|---|---|\n| 1 | 2 |`)).toBeNull();
    });

    it('does not lift a bold subhead as a verdict', () => {
        // Real misfires from the archived corpus.
        expect(isVerdictLine('AMD-Specific Risks')).toBe(false);
        expect(isVerdictLine('Near-Term Catalysts (Next 12 Months):')).toBe(false);
        expect(isVerdictLine('Side-by-Side Financial Comparison', 'Side-by-Side Financial Comparison'))
            .toBe(false);
        expect(isVerdictLine('Conviction Rating: Neutral (Sector Weight)')).toBe(true);
    });

    it('returns null when the only bold line is a subhead', () => {
        expect(extractVerdict('Intro prose here.\n\n**AMD-Specific Risks**\n\nMore prose.')).toBeNull();
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

describe('buildSectionViews — the render view model', () => {
    const REPORT = [
        '# Nvidia', 'Prepared for the desk.', '',
        '## Financial Performance', STAT_PROSE, '',
        '## Conclusion & Conviction Rating', VERDICT,
    ].join('\n\n');

    it('keeps the pre-heading preamble', () => {
        expect(buildSectionViews(REPORT).preamble).toContain('# Nvidia');
    });

    it('attaches stat cards only to stat-row sections', () => {
        const { sections } = buildSectionViews(REPORT);
        expect(sections[0].layout).toBe('stat-row');
        expect(sections[0].statCards.length).toBeGreaterThan(0);
        expect(sections[1].statCards).toHaveLength(0);
    });

    it('promotes the verdict once — lifted out of the body it renders', () => {
        const conclusion = buildSectionViews(REPORT).sections[1];
        expect(conclusion.verdict).toBe('Conviction Rating: Neutral (Sector Weight)');
        expect(conclusion.markdown).not.toContain('**Conviction Rating');
    });

    it('renders every stat card verbatim from the source markdown', () => {
        for (const s of buildSectionViews(REPORT).sections) {
            for (const c of s.statCards) expect(REPORT).toContain(c.value);
        }
    });

    it('handles a document with no headings at all', () => {
        const v = buildSectionViews('Just a paragraph.');
        expect(v.sections).toHaveLength(0);
        expect(v.preamble).toBe('Just a paragraph.');
    });
});
