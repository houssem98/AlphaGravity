// QA-4 (P0-7) renderer transform tests — regression test 9 + table/exec-summary
// fixes, all derived from visually-confirmed bugs in the 2026-07-10 report.

import { describe, it, expect } from 'vitest';
import {
    parseMarkdown, parseInlineSegments, parseSections, findMarkdownLiterals, stripMd,
} from './pdfMarkdown';
import { clampToSentence } from '../../services/reportQaGates';

describe('regression test 9 — literal ## / ** must not reach the text layer', () => {
    it('## lines become typed h2 blocks, never paragraph text', () => {
        const blocks = parseMarkdown('## Executive Summary\nBody text.');
        expect(blocks[0]).toMatchObject({ type: 'h2', content: 'Executive Summary' });
        expect(findMarkdownLiterals(blocks)).toHaveLength(0);
    });

    it('** bold is parsed into a segment, no asterisks in any rendered text', () => {
        const blocks = parseMarkdown('Revenue was **$35.6B** in Q4.');
        expect(findMarkdownLiterals(blocks)).toHaveLength(0);
        const segs = parseInlineSegments(blocks[0].content);
        expect(segs.some(x => x.kind === 'bold' && x.text === '$35.6B')).toBe(true);
        expect(segs.every(x => !x.text.includes('**'))).toBe(true);
    });

    it('findMarkdownLiterals catches unparsed __ residue', () => {
        const blocks = parseMarkdown('Header text __EXPRESSION__ raw.');
        expect(findMarkdownLiterals(blocks).length).toBeGreaterThan(0);
    });
});

describe('P0-7 trade-table bug — "**- EXPRESSION**" header cells', () => {
    const md = [
        '| **- EXPRESSION** | **DIRECTION** | Thesis |',
        '|---|---|---|',
        '| Long MSFT | Buy | AI capex cycle **[3]** durable |',
    ].join('\n');

    it('markdown table parses into typed cells', () => {
        const blocks = parseMarkdown(md);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].type).toBe('table');
        expect(blocks[0].cells).toHaveLength(2);
        expect(blocks[0].cells![0]).toHaveLength(3);
    });

    it('cell content parses to segments without asterisks', () => {
        const blocks = parseMarkdown(md);
        for (const row of blocks[0].cells!) {
            for (const cell of row) {
                const segs = parseInlineSegments(cell);
                expect(segs.every(x => !x.text.includes('**'))).toBe(true);
            }
        }
    });
});

describe('P0-6 citation markers render instead of being stripped', () => {
    it('[n] becomes a citation segment (not dropped → no orphan gap)', () => {
        const segs = parseInlineSegments('Margins reached 44.5% [12].');
        expect(segs.some(x => x.kind === 'citation' && x.text === '[12]')).toBe(true);
        expect(segs.map(x => x.text).join('')).toBe('Margins reached 44.5% [12].');
    });
});

describe('P0-7 exec summary — sentence clamp, never char-slice', () => {
    it('short text unchanged', () => {
        expect(clampToSentence('One sentence.', 500)).toBe('One sentence.');
    });

    it('long text cut at last full sentence under the cap', () => {
        const text = 'First sentence here. Second sentence follows. ' + 'x'.repeat(500);
        const out = clampToSentence(text, 100);
        expect(out).toBe('First sentence here. Second sentence follows.');
        expect(out.endsWith('.')).toBe(true);
    });

    it('no sentence boundary → explicit ellipsis, never silent truncation', () => {
        const out = clampToSentence('y'.repeat(600), 100);
        expect(out.endsWith('…')).toBe(true);
    });
});

describe('section splitter + cover cleanup', () => {
    it('parseSections splits on ## and cleans titles', () => {
        const sections = parseSections('## **Thesis** [2]\nBody.\n\n## Risks\nMore.');
        expect(sections.map(x => x.title)).toEqual(['Thesis', 'Risks']);
    });

    it('stripMd cleans cover strings', () => {
        expect(stripMd('**AI in Asset Management** [3]')).toBe('AI in Asset Management');
    });
});
