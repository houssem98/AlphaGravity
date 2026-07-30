// QA-18 — Self-Improving Design Loop tests. Mocked chat; proves the bounded
// surface, verbatim-quote enforcement, feedback revision, and fail-safe.

import { describe, it, expect } from 'vitest';
import {
    validateDesignSpec, runDesignLoop, defaultDesignSpec, ALLOWED_ACCENTS,
    computeColumnFlex, sectionLayoutDigest,
} from './pdfDesigner';

const MARKDOWN = [
    '# BlackRock: AI Platform Advantage',
    '',
    '## Executive Summary',
    'BlackRock extends its lead as Aladdin adoption compounds across institutional clients [1].',
    '',
    '## Investment Thesis',
    'Aladdin technology services revenue grew 14% year-over-year, outpacing every organic segment [2].',
].join('\n');

const VERBATIM = 'Aladdin technology services revenue grew 14% year-over-year, outpacing every organic segment [2].';

const GOOD_SPEC = {
    tone: 'bullish', accent: '#059669', density: 'comfortable',
    coverKicker: 'Platform Deep Dive',
    abstract: 'BlackRock extends its platform lead. Aladdin revenue is compounding ahead of organic segments.',
    pullQuotes: [{ section: 'Investment Thesis', text: VERBATIM }],
    exhibitTitles: ['Revenue growth vs peers'],
};

// G1c — per-section layout overrides. The report needs sections whose
// structure genuinely differs, so the preconditions have something to bite on.
const LAYOUT_MD = [
    '# Report',
    '',
    '## Financial Performance',
    'Revenue reached $130.5B in FY2025 [1]. Gross margin was 73.0% in Q4 [2]. Inventory turnover sat at ~2.5x [3].',
    '',
    '## Narrative Outlook',
    'We expect the cycle to persist, though conviction is lower than last year.',
].join('\n');

describe('G1c — per-section layout overrides', () => {
    it('accepts an override the section structure can carry', () => {
        const { spec, violations } = validateDesignSpec(
            { ...GOOD_SPEC, pullQuotes: [], sections: [{ heading: 'Financial Performance', layout: 'prose' }] },
            LAYOUT_MD, 1);
        expect(violations).toHaveLength(0);
        expect(spec.sections).toEqual([{ heading: 'Financial Performance', layout: 'prose' }]);
    });

    it('rejects a layout the section cannot support', () => {
        // No cited figures in the narrative section → stat-row is impossible.
        const { spec, violations } = validateDesignSpec(
            { ...GOOD_SPEC, pullQuotes: [], sections: [{ heading: 'Narrative Outlook', layout: 'stat-row' }] },
            LAYOUT_MD, 1);
        expect(spec.sections).toHaveLength(0);
        expect(violations.join(' ')).toMatch(/cannot be stat-row/);
    });

    it('rejects a layout that is not in the enum — no invented layouts', () => {
        const { spec, violations } = validateDesignSpec(
            { ...GOOD_SPEC, pullQuotes: [], sections: [{ heading: 'Financial Performance', layout: 'hero-collage' }] },
            LAYOUT_MD, 1);
        expect(spec.sections).toHaveLength(0);
        expect(violations.join(' ')).toMatch(/not a known layout/);
    });

    it('rejects an override for a section that does not exist', () => {
        const { spec, violations } = validateDesignSpec(
            { ...GOOD_SPEC, pullQuotes: [], sections: [{ heading: 'Invented Section', layout: 'prose' }] },
            LAYOUT_MD, 1);
        expect(spec.sections).toHaveLength(0);
        expect(violations.join(' ')).toMatch(/not a heading in this report/);
    });

    it('defaults to no overrides when the designer omits the field', () => {
        expect(validateDesignSpec({ ...GOOD_SPEC, pullQuotes: [] }, LAYOUT_MD, 1).spec.sections).toEqual([]);
    });

    it('tells the designer which layouts each section can legally take', () => {
        const digest = sectionLayoutDigest(LAYOUT_MD);
        expect(digest).toMatch(/"Financial Performance" → stat-row/);
        expect(digest).toMatch(/"Narrative Outlook" → prose/);
        // The narrative section must not be offered stat-row.
        expect(digest.split('\n').find(l => l.includes('Narrative Outlook'))).not.toMatch(/stat-row/);
    });
});

describe('validator — the bounded design surface', () => {
    it('accepts a valid spec unchanged', () => {
        const { spec, violations } = validateDesignSpec(GOOD_SPEC, MARKDOWN, 1);
        expect(violations).toHaveLength(0);
        expect(spec.accent).toBe('#059669');
        expect(spec.pullQuotes).toHaveLength(1);
    });

    it('rejects non-verbatim pull quotes (design may emphasize, never write)', () => {
        const { spec, violations } = validateDesignSpec({
            ...GOOD_SPEC,
            pullQuotes: [{ section: 'Thesis', text: 'Aladdin revenue grew a spectacular 40% this quarter, crushing all rivals everywhere.' }],
        }, MARKDOWN, 1);
        expect(spec.pullQuotes).toHaveLength(0);
        expect(violations.some(v => v.includes('verbatim'))).toBe(true);
    });

    it('clamps off-palette accents and unknown tones', () => {
        const { spec, violations } = validateDesignSpec({ ...GOOD_SPEC, tone: 'euphoric', accent: '#FF00FF' }, MARKDOWN, 1);
        expect(spec.tone).toBe('neutral');
        expect(ALLOWED_ACCENTS).toContain(spec.accent);
        expect(violations.length).toBeGreaterThanOrEqual(2);
    });

    it('drops abstracts that are not 2–3 sentences; sanitizes injection chars', () => {
        const oneSentence = validateDesignSpec({ ...GOOD_SPEC, abstract: 'Only one sentence here.' }, MARKDOWN, 1);
        expect(oneSentence.spec.abstract).toBe('');
        const dirty = validateDesignSpec({ ...GOOD_SPEC, coverKicker: '## Hack [12] | *bold*' }, MARKDOWN, 1);
        expect(dirty.spec.coverKicker).not.toMatch(/[#[\]|*]/);
    });

    it('caps pull quotes at 2 and exhibit titles at exhibit count', () => {
        const { spec } = validateDesignSpec({
            ...GOOD_SPEC,
            pullQuotes: [
                { section: 'A', text: VERBATIM },
                { section: 'B', text: VERBATIM },
                { section: 'C', text: VERBATIM },
            ],
            exhibitTitles: ['a', 'b', 'c'],
        }, MARKDOWN, 1);
        expect(spec.pullQuotes.length).toBeLessThanOrEqual(2);
        expect(spec.exhibitTitles).toHaveLength(1);
    });
});

describe('table + graphic design knobs', () => {
    it('tableDesign coerced safely; highlight columns sanitized and capped at 2', () => {
        const { spec } = validateDesignSpec({
            ...GOOD_SPEC,
            tableDesign: { headerAccent: true, zebra: false, highlightColumns: ['Target', '[Upside]', 'Entry'] },
        }, MARKDOWN, 1);
        expect(spec.tableDesign.headerAccent).toBe(true);
        expect(spec.tableDesign.zebra).toBe(false);
        expect(spec.tableDesign.highlightColumns).toEqual(['Target', 'Upside']);
    });

    it('missing tableDesign → safe defaults (zebra on, no accent header)', () => {
        const { spec } = validateDesignSpec(GOOD_SPEC, MARKDOWN, 1);
        expect(spec.tableDesign).toEqual({ headerAccent: false, zebra: true, highlightColumns: [] });
        expect(spec.exhibitStyle).toBe('categorical');
        expect(spec.exhibitPick).toEqual([]);
    });

    it('exhibitStyle enum-clamped; exhibitPick de-duped, bounds-checked, capped at 3', () => {
        const { spec, violations } = validateDesignSpec({
            ...GOOD_SPEC,
            exhibitStyle: 'rainbow',
            exhibitPick: [2, 2, 0, 9, -1, 1, 3],
        }, MARKDOWN, 3);
        expect(spec.exhibitStyle).toBe('categorical');
        expect(spec.exhibitPick).toEqual([2, 0, 1]);
        expect(violations.some(v => v.includes('exhibitPick'))).toBe(true);
    });

    it('computeColumnFlex: narrow tickers, wide thesis columns (P0-7 content classes)', () => {
        const flex = computeColumnFlex([
            ['Ticker', 'Direction', 'Thesis'],
            ['BLK', 'Long', 'Aladdin platform compounding drives multi-year fee-revenue growth well beyond consensus estimates'],
        ]);
        expect(flex[0]).toBe(0.6);   // ≤8 chars
        expect(flex[1]).toBe(1);     // medium ("Direction" header = 9 chars)
        expect(flex[2]).toBe(2);     // ≥60 chars
        expect(computeColumnFlex([])).toEqual([]);
    });
});

describe('the loop — propose → validate → critique → revise', () => {
    const critique = (n: number, fixes: string[] = []) =>
        JSON.stringify({ hierarchy: n, tone_fit: n, scannability: n, restraint: n, fixes });

    it('passes first round on a good spec + satisfied critic', async () => {
        const calls: string[] = [];
        const chat = async (p: string) => {
            calls.push(p);
            return calls.length === 1 ? JSON.stringify(GOOD_SPEC) : critique(9);
        };
        const r = await runDesignLoop('T', MARKDOWN, [], { chat });
        expect(r.iterations).toBe(1);
        expect(r.finalScore).toBe(9);
        expect(r.fellBack).toBe(false);
        expect(r.spec.coverKicker).toBe('Platform Deep Dive');
    });

    it('feeds validator violations + critic fixes into the revision prompt', async () => {
        const prompts: string[] = [];
        let call = 0;
        const chat = async (p: string) => {
            prompts.push(p); call += 1;
            if (call === 1) return JSON.stringify({ ...GOOD_SPEC, accent: '#123456' });  // invalid accent
            if (call === 2) return critique(6, ['kicker too generic']);
            if (call === 3) return JSON.stringify(GOOD_SPEC);                            // revised
            return critique(9);
        };
        const r = await runDesignLoop('T', MARKDOWN, [], { chat });
        expect(r.iterations).toBe(2);
        expect(prompts[2]).toContain('REVISION FEEDBACK');
        expect(prompts[2]).toContain('VALIDATOR:');
        expect(prompts[2]).toContain('CRITIC: kicker too generic');
        expect(r.finalScore).toBe(9);
    });

    it('LLM dead → default design, never throws (export must not block)', async () => {
        const r = await runDesignLoop('T', MARKDOWN, [], { chat: async () => { throw new Error('432'); } });
        expect(r.fellBack).toBe(true);
        expect(r.spec).toEqual(defaultDesignSpec());
    });

    it('budget exhausted below bar → best spec by critic score ships', async () => {
        let call = 0;
        const chat = async () => {
            call += 1;
            if (call === 1) return JSON.stringify(GOOD_SPEC);
            if (call === 2) return critique(5);
            if (call === 3) return JSON.stringify({ ...GOOD_SPEC, coverKicker: 'Second Try' });
            return critique(6);
        };
        const r = await runDesignLoop('T', MARKDOWN, [], { chat, maxIter: 2 });
        expect(r.spec.coverKicker).toBe('Second Try');   // score 6 beats 5
        expect(r.finalScore).toBe(6);
        expect(r.fellBack).toBe(false);
    });
});
