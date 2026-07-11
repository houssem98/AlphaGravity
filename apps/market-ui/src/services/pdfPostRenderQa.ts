// Post-render PDF QA (REPORT_QA_SPEC P0-6 fix 4) — audit the text layer of
// the ACTUALLY RENDERED PDF, not the markdown that fed it. Catches what only
// the renderer can break: stripped citations leaving "44.5% ." orphans,
// unresolved bracket ids, markdown literals reaching the page, leaked
// internal tags. Deterministic; the future pixel-level vision critic plugs
// in behind the same result shape once a vision-capable key is live
// (DeepSeek has no vision — blocked as of 2026-07-11).

export interface PostRenderQaResult {
    ok: boolean;
    pages: number;
    orphanPunctuation: string[];   // "44.5% ." — space before punctuation
    unresolvedIds: string[];       // [n] beyond citation count, [RAG-n] survivors
    markdownLiterals: string[];    // raw **, ##, __ in the text layer
    internalTags: string[];        // [TIER …] / debug tokens
}

// Pure auditor over extracted page text — unit-testable without a PDF.
export function auditRenderedText(pageTexts: string[], citationCount: number): PostRenderQaResult {
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

    return {
        ok: orphanPunctuation.length === 0 && unresolvedIds.length === 0
            && markdownLiterals.length === 0 && internalTags.length === 0,
        pages: pageTexts.length,
        orphanPunctuation, unresolvedIds, markdownLiterals, internalTags,
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

export async function postRenderQa(blob: Blob, citationCount: number): Promise<PostRenderQaResult> {
    return auditRenderedText(await extractPdfPageTexts(blob), citationCount);
}
