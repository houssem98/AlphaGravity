// Post-render PDF QA (REPORT_QA_SPEC P0-6 fix 4) — audit the text layer of
// the ACTUALLY RENDERED PDF, not the markdown that fed it. Catches what only
// the renderer can break: stripped citations leaving "44.5% ." orphans,
// unresolved bracket ids, markdown literals reaching the page, leaked
// internal tags. Deterministic; the future pixel-level vision critic plugs
// in behind the same result shape once a vision-capable key is live
// (DeepSeek has no vision — blocked as of 2026-07-11).

import { parseMarkdown } from '../components/research/pdfMarkdown';

export interface PostRenderQaResult {
    ok: boolean;
    pages: number;
    orphanPunctuation: string[];   // "44.5% ." — space before punctuation
    unresolvedIds: string[];       // [n] beyond citation count, [RAG-n] survivors
    markdownLiterals: string[];    // raw **, ##, __ in the text layer
    internalTags: string[];        // [TIER …] / debug tokens
    splitTableRows: SplitTableRow[]; // table row whose cells span two pages
}

export interface SplitTableRow {
    preview: string;    // "Q1 FY2026 | $26.0B | 78%…"
    pages: number[];    // 1-indexed pages where the row's cells were found
}

// pdfjs letterSpacing splits glyphs unpredictably — compare whitespace-free.
// Hyphens stripped too: react-pdf's line-wrapper injects "-" at wrap points
// inside narrow cells ("~65% (est.," extracts as "~65% (- est.,", verified
// live 2026-07-12), and this is a co-location check, not a fidelity check.
const normalizeForMatch = (s: string) =>
    s.replace(/\[\d+\]/g, '').replace(/[*_`|]/g, '')
        .replace(/[-‐‑–—]/g, '').replace(/\s+/g, '').toLowerCase();

// Regression test 7 at the text layer: a markdown table row is split across a
// page break iff NO single rendered page contains all of its cells. react-pdf
// emits tables as untagged positioned Views (no structure tree — verified
// 2026-07-12: the pdfkit fork has the struct() API but @react-pdf/render never
// calls it), so geometry tools can't see rows; textual co-location can.
export function findSplitTableRows(pageTexts: string[], markdown: string): SplitTableRow[] {
    const pagesNorm = pageTexts.map(normalizeForMatch);
    const out: SplitTableRow[] = [];
    for (const block of parseMarkdown(markdown)) {
        if (block.type !== 'table' || !block.cells) continue;
        for (const row of block.cells) {
            // Anchor on each cell's first 12 normalized chars — the renderer
            // may truncate long cells to one line, so tails are unreliable.
            const anchors = row.map(normalizeForMatch)
                .filter(c => c.length >= 4)
                .map(c => c.slice(0, 12));
            if (anchors.length < 2) continue;   // one anchor can't prove co-location
            if (!pagesNorm.some(p => anchors.every(a => p.includes(a)))) {
                const pages = pagesNorm.flatMap((p, i) =>
                    anchors.some(a => p.includes(a)) ? [i + 1] : []);
                out.push({ preview: row.join(' | ').slice(0, 80), pages });
            }
        }
    }
    return out;
}

// Pure auditor over extracted page text — unit-testable without a PDF.
// Pass the source markdown to also run the split-table-row check.
export function auditRenderedText(pageTexts: string[], citationCount: number, markdown?: string): PostRenderQaResult {
    const orphanPunctuation: string[] = [];
    const unresolvedIds: string[] = [];
    const markdownLiterals: string[] = [];
    const internalTags: string[] = [];

    for (const text of pageTexts) {
        for (const m of text.matchAll(/\S+ +[.,;](?=\s|$)/g)) orphanPunctuation.push(m[0]);
        for (const m of text.matchAll(/\[([A-Za-z]+-\d+|\d+)\](?!\()/g)) {
            const id = m[1];
            if (/^\d+$/.test(id)) {
                const n = parseInt(id, 10);
                if (n < 1 || n > citationCount) unresolvedIds.push(`[${id}]`);
            } else {
                unresolvedIds.push(`[${id}]`);
            }
        }
        for (const m of text.matchAll(/\*\*[^*\n]+\*\*|__[^_\n]+__|(?:^|\s)#{2,4}\s+\S+/g)) {
            markdownLiterals.push(m[0].trim().slice(0, 60));
        }
        for (const m of text.matchAll(/\[(?:TIER|DEBUG|INTERNAL|DRAFT|TODO)\b[^\]]*\]/gi)) {
            internalTags.push(m[0]);
        }
    }

    const splitTableRows = markdown ? findSplitTableRows(pageTexts, markdown) : [];

    return {
        ok: orphanPunctuation.length === 0 && unresolvedIds.length === 0
            && markdownLiterals.length === 0 && internalTags.length === 0
            && splitTableRows.length === 0,
        pages: pageTexts.length,
        orphanPunctuation, unresolvedIds, markdownLiterals, internalTags, splitTableRows,
    };
}

// Extract per-page text from a rendered PDF blob via pdfjs. Dynamic import —
// pdfjs only loads when an export actually happens.
export async function extractPdfPageTexts(blob: Blob): Promise<string[]> {
    const pdfjs = await import('pdfjs-dist');
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        // Vite serves the worker as an asset URL; exports are rare, lazy is fine.
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    }
    const data = new Uint8Array(await blob.arrayBuffer());
    const loadingTask = pdfjs.getDocument({ data, disableFontFace: true });
    const doc = await loadingTask.promise;
    const pages: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        pages.push(content.items.map((it: any) => it.str ?? '').join(' '));
    }
    await loadingTask.destroy();
    return pages;
}

export async function postRenderQa(blob: Blob, citationCount: number, markdown?: string): Promise<PostRenderQaResult> {
    return auditRenderedText(await extractPdfPageTexts(blob), citationCount, markdown);
}
