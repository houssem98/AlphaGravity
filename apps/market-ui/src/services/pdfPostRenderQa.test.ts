// Post-render QA auditor tests — regression test 6 acceptance at the
// rendered-output layer (extraction itself is a thin pdfjs wrapper,
// verified in-browser; the audit logic is what can regress).

import { describe, it, expect } from 'vitest';
import { auditRenderedText, findSplitTableRows } from './pdfPostRenderQa';

describe('auditRenderedText — the rendered text layer', () => {
    it('clean pages pass', () => {
        const r = auditRenderedText([
            'Margins reached 44.5% [3]. Aladdin revenue grew 14% [12], ahead of consensus.',
            'Page 2 of 12 — References follow.',
        ], 40);
        expect(r.ok).toBe(true);
        expect(r.pages).toBe(2);
    });

    it('regression test 6 — orphaned punctuation in the OUTPUT fails', () => {
        const r = auditRenderedText(['Margins reached 44.5% . Expense ratio 0.06% , lowest.'], 40);
        expect(r.ok).toBe(false);
        expect(r.orphanPunctuation).toHaveLength(2);
    });

    it('unresolved bracket ids fail — [RAG-5] survivor and out-of-range [55]', () => {
        const r = auditRenderedText(['Thesis rests on [RAG-5]. Another claim [55].'], 40);
        expect(r.unresolvedIds).toEqual(['[RAG-5]', '[55]']);
    });

    it('markdown literals in the text layer fail', () => {
        const r = auditRenderedText(['## Executive Summary rendered raw', 'Revenue was **$35B** literal.'], 40);
        expect(r.ok).toBe(false);
        expect(r.markdownLiterals.length).toBe(2);
    });

    it('leaked internal tags fail', () => {
        const r = auditRenderedText(['Flows improved [TIER 2b] materially.'], 40);
        expect(r.internalTags).toEqual(['[TIER 2b]']);
    });

    it('in-range citations, decimals, and page footers are not false positives', () => {
        const r = auditRenderedText([
            'EPS of $2.22 beat by $0.52 [7]. Growth of 14.5% held. Page 3 of 31',
            'Exhibit 1: Revenue comparison ($B) BLK 5.2$B · Q1-2026 [3]',
        ], 40);
        expect(r.ok).toBe(true);
    });
});

describe('findSplitTableRows — regression test 7 at the text layer', () => {
    const md = [
        '| Segment | Revenue | Growth |',
        '| --- | --- | --- |',
        '| Data Center | $26.0B | 78% YoY |',
        '| Gaming | $3.3B | 15% YoY |',
    ].join('\n');

    it('rows whose cells share a page pass', () => {
        const pages = [
            'Segment Revenue Growth Data Center $26.0B 78% YoY Gaming $3.3B 15% YoY',
        ];
        expect(findSplitTableRows(pages, md)).toHaveLength(0);
    });

    it('a row whose cells land on two pages is flagged with both pages', () => {
        const pages = [
            'Segment Revenue Growth Data Center $26.0B 78% YoY Gaming',
            '$3.3B 15% YoY — continued',
        ];
        const split = findSplitTableRows(pages, md);
        expect(split).toHaveLength(1);
        expect(split[0].preview).toContain('Gaming');
        expect(split[0].pages).toEqual([1, 2]);
    });

    it('react-pdf wrap-hyphen injection does not false-positive', () => {
        // Live-observed: "~65% (est., custom ASIC)" extracts as "~65% (- est., custom ASIC)"
        const wrapMd = [
            '| Metric | NVDA | AMD |',
            '| --- | --- | --- |',
            '| DC Gross Margin | ~65% (est., custom ASIC) | ~2.0% (at current price) |',
        ].join('\n');
        const pages = ['Metric NVDA AMD DC Gross Margin ~65% (- est., custom ASIC) ~2.0% (- at current price)'];
        expect(findSplitTableRows(pages, wrapMd)).toHaveLength(0);
    });

    it('letterSpacing glyph splits and citation markers do not false-positive', () => {
        const spaced = 'S e g m e n t Revenue Growth D a t a C e n t e r $26.0B 78% YoY Gaming $3.3B 15% YoY';
        const mdCited = md.replace('$26.0B', '$26.0B [3]');
        expect(findSplitTableRows([spaced], mdCited)).toHaveLength(0);
    });

    it('renderer-truncated long cells still anchor on their prefix', () => {
        const longMd = [
            '| Driver | Detail |',
            '| --- | --- |',
            '| Hyperscaler capex | Sustained multi-year AI infrastructure buildout across all major cloud providers |',
        ].join('\n');
        const pages = ['Driver Detail Hyperscaler capex Sustained multi-year AI infra…'];
        expect(findSplitTableRows(pages, longMd)).toHaveLength(0);
    });

    it('auditRenderedText folds split rows into ok', () => {
        const pages = ['Segment Revenue Growth Data Center $26.0B 78% YoY Gaming', '$3.3B 15% YoY'];
        const r = auditRenderedText(pages, 40, md);
        expect(r.ok).toBe(false);
        expect(r.splitTableRows).toHaveLength(1);
    });
});
