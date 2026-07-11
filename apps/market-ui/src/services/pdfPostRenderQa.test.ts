// Post-render QA auditor tests — regression test 6 acceptance at the
// rendered-output layer (extraction itself is a thin pdfjs wrapper,
// verified in-browser; the audit logic is what can regress).

import { describe, it, expect } from 'vitest';
import { auditRenderedText } from './pdfPostRenderQa';

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
