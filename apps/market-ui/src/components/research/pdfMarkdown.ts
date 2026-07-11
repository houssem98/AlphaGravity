// Pure markdown → block/segment parsing for the PDF renderer (P0-6/P0-7).
// No @react-pdf imports — unit-testable without a PDF runtime. PdfDocument.tsx
// maps these structures to typed components.

export interface ParsedBlock {
    type: 'h2' | 'h3' | 'h4' | 'p' | 'li' | 'blockquote' | 'hr' | 'table';
    content: string;
    cells?: string[][];
}

export function parseMarkdown(md: string): ParsedBlock[] {
    const lines = md.split('\n');
    const blocks: ParsedBlock[] = [];
    let tableRows: string[][] = [];
    let inTable = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) {
            if (inTable && tableRows.length > 0) {
                blocks.push({ type: 'table', content: '', cells: tableRows });
                tableRows = []; inTable = false;
            }
            continue;
        }
        if (line.startsWith('|') && line.endsWith('|')) {
            const cells = line.split('|').filter(Boolean).map(c => c.trim());
            if (cells.every(c => /^[-:]+$/.test(c))) { inTable = true; continue; }
            tableRows.push(cells); inTable = true; continue;
        } else if (inTable && tableRows.length > 0) {
            blocks.push({ type: 'table', content: '', cells: tableRows });
            tableRows = []; inTable = false;
        }
        if (line.startsWith('#### ')) blocks.push({ type: 'h4', content: line.slice(5) });
        else if (line.startsWith('### ')) blocks.push({ type: 'h3', content: line.slice(4) });
        else if (line.startsWith('## ')) blocks.push({ type: 'h2', content: line.slice(3) });
        else if (line.startsWith('> ')) blocks.push({ type: 'blockquote', content: line.slice(2) });
        else if (line === '---') blocks.push({ type: 'hr', content: '' });
        else if (line.startsWith('- ')) blocks.push({ type: 'li', content: line.slice(2) });
        else if (/^\d+\.\s/.test(line)) blocks.push({ type: 'li', content: line.replace(/^\d+\.\s/, '') });
        else blocks.push({ type: 'p', content: line });
    }
    if (tableRows.length > 0) blocks.push({ type: 'table', content: '', cells: tableRows });
    return blocks;
}

// Inline markdown → typed segments. Citation markers [n] are PRESERVED as
// their own segment kind (spec P0-6: bracketed [n] citations render
// everywhere — stripping them left "44.5% ." orphans in the shipped report).
export interface InlineSegment {
    text: string;
    kind: 'plain' | 'bold' | 'code' | 'link' | 'citation';
    href?: string;
}

const INLINE_RE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|(\[\d+\])/g;

export function parseInlineSegments(text: string): InlineSegment[] {
    const parts: InlineSegment[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    INLINE_RE.lastIndex = 0;
    while ((m = INLINE_RE.exec(text)) !== null) {
        if (m.index > last) parts.push({ text: text.slice(last, m.index), kind: 'plain' });
        if (m[1] !== undefined) parts.push({ text: m[1], kind: 'bold' });
        else if (m[2] !== undefined) parts.push({ text: m[2], kind: 'code' });
        else if (m[3] !== undefined && m[4] !== undefined) parts.push({ text: m[3], kind: 'link', href: m[4] });
        else if (m[5] !== undefined) parts.push({ text: m[5], kind: 'citation' });
        last = m.index + m[0].length;
    }
    if (last < text.length) parts.push({ text: text.slice(last), kind: 'plain' });
    if (parts.length === 0) parts.push({ text, kind: 'plain' });
    return parts;
}

export interface Section { title: string; blocks: ParsedBlock[] }

export function parseSections(markdown: string): Section[] {
    const sections: Section[] = [];
    const parts = markdown.split(/^(?=## )/m);
    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const m = trimmed.match(/^## (.+)$/m);
        if (!m) continue;
        const title = m[1].replace(/\*\*/g, '').replace(/\[(\d+)\]/g, '').trim();
        const bodyMd = trimmed.substring(trimmed.indexOf('\n') + 1).trim();
        sections.push({ title, blocks: parseMarkdown(bodyMd) });
    }
    return sections;
}

// Cover title / query cleanup (no citations, no md marks).
export function stripMd(s: string): string {
    return s.replace(/\*\*\*/g, '').replace(/\*\*/g, '').replace(/\*/g, '')
        .replace(/`([^`]+)`/g, '$1').replace(/\[(\d+)\]/g, '').trim();
}

// P0-7: escape check — no literal markdown syntax may survive into the text
// layer. Run over the TEXT segments the renderer will actually draw.
export function findMarkdownLiterals(blocks: ParsedBlock[]): string[] {
    const bad: string[] = [];
    const check = (t: string) => {
        for (const seg of parseInlineSegments(t)) {
            if (/\*\*|__|^##\s|\s##\s/.test(seg.text)) bad.push(seg.text);
        }
    };
    for (const b of blocks) {
        if (b.type === 'table') b.cells?.forEach(row => row.forEach(check));
        else check(b.content);
    }
    return bad;
}

