// Structural-QA auditor tests — the pure logic over the opendataloader JSON
// tree. Closes REPORT_QA_SPEC regression test 7 (mid-cell page split) at the
// geometry level, no Java needed.

import { describe, it, expect } from 'vitest';
import { auditStructure, type OdlNode } from './pdfStructuralQa';

// A clean 2-row table entirely on page 6, then a heading.
const CLEAN: OdlNode = {
    type: 'document',
    kids: [
        { type: 'heading', level: '1', content: 'Financial Performance' },
        {
            type: 'table',
            rows: [
                { type: 'table row', 'row number': 1, cells: [
                    { type: 'table cell', 'page number': 6, 'bounding box': [50, 700, 200, 720], kids: [{ type: 'paragraph', content: 'Revenue' }] },
                    { type: 'table cell', 'page number': 6, 'bounding box': [200, 700, 350, 720], kids: [{ type: 'paragraph', content: '$130.5B' }] },
                ] },
                { type: 'table row', 'row number': 2, cells: [
                    { type: 'table cell', 'page number': 6, 'bounding box': [50, 680, 200, 700], kids: [{ type: 'paragraph', content: 'Margin' }] },
                    { type: 'table cell', 'page number': 6, 'bounding box': [200, 680, 350, 700], kids: [{ type: 'paragraph', content: '73.0%' }] },
                ] },
            ],
        },
        { type: 'heading', level: '2', content: 'Segment Detail' },
    ],
};

describe('regression test 7 — no table row spans a page break (geometry)', () => {
    it('clean single-page table passes', () => {
        const r = auditStructure(CLEAN);
        expect(r.ok).toBe(true);
        expect(r.tables).toBe(1);
        expect(r.splitRows).toHaveLength(0);
    });

    it('a row whose cells land on two pages is flagged as split', () => {
        const split: OdlNode = { type: 'table', rows: [
            { type: 'table row', 'row number': 3, cells: [
                { type: 'table cell', 'page number': 6, 'bounding box': [50, 60, 200, 80], kids: [{ type: 'paragraph', content: 'State Street' }] },
                { type: 'table cell', 'page number': 7, 'bounding box': [200, 760, 350, 780], kids: [{ type: 'paragraph', content: 'Underperform' }] },
            ] },
        ] };
        const r = auditStructure(split);
        expect(r.ok).toBe(false);
        expect(r.splitRows).toHaveLength(1);
        expect(r.splitRows[0].rowNumber).toBe(3);
        expect(r.splitRows[0].pages).toEqual([6, 7]);
    });
});

describe('heading hierarchy — no skipped levels', () => {
    it('h1 → h2 passes', () => {
        expect(auditStructure(CLEAN).headingSkips).toHaveLength(0);
        expect(auditStructure(CLEAN).headings).toBe(2);
    });

    it('h1 → h3 (missing h2) is flagged', () => {
        const skip: OdlNode = { type: 'document', kids: [
            { type: 'heading', level: '1', content: 'Overview' },
            { type: 'heading', level: '3', content: 'Sub-sub detail' },
        ] };
        const r = auditStructure(skip);
        expect(r.headingSkips).toHaveLength(1);
        expect(r.headingSkips[0]).toMatchObject({ from: 1, to: 3 });
        expect(r.ok).toBe(false);
    });

    it('going back up levels (h3 → h1) is fine', () => {
        const ok: OdlNode = { type: 'document', kids: [
            { type: 'heading', level: '1', content: 'A' },
            { type: 'heading', level: '2', content: 'B' },
            { type: 'heading', level: '3', content: 'C' },
            { type: 'heading', level: '1', content: 'D' },
        ] };
        expect(auditStructure(ok).headingSkips).toHaveLength(0);
    });
});

describe('robustness', () => {
    it('accepts an array root', () => {
        const r = auditStructure([
            { type: 'heading', level: '1', content: 'A' },
            { type: 'paragraph', content: 'body' },
        ]);
        expect(r.ok).toBe(true);
        expect(r.headings).toBe(1);
    });

    it('empty tree is clean', () => {
        expect(auditStructure({}).ok).toBe(true);
        expect(auditStructure([]).tables).toBe(0);
    });
});
