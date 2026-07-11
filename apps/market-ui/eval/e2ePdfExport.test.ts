// LIVE end-to-end PDF export: real baseline report → LIVE DeepSeek design
// loop → react-pdf render → post-render text-layer QA → PDF on disk.
// Needs market-server on :3002 with a live DEEPSEEK_API_KEY.
// Run:  RUN_PDF_E2E=1 npx vitest run eval/e2ePdfExport.test.ts

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import React from 'react';

const HERE = dirname(fileURLToPath(import.meta.url));

describe.skipIf(process.env.RUN_PDF_E2E !== '1')('live designed PDF export', () => {
    it('design loop → render → post-render QA → file', async () => {
        const markdown = readFileSync(join(HERE, 'out', 'baseline-company-nvda.md'), 'utf8');

        // Citations from the report's own Web Sources footer (pre-QA-15 format).
        const citations = [...markdown.matchAll(/^\[(\d+)\] (.+?) — (https?:\/\/\S+)$/gm)]
            .map(m => ({ id: parseInt(m[1], 10), title: m[2], url: m[3], source: 'Web' }));
        console.log(`citations parsed from footer: ${citations.length}`);

        // NumericClaim store from the real markdown — feeds the exhibits.
        const { extractNumericClaims, buildExhibits } = await import('../src/services/reportQaGates');
        const aliases = {
            NVDA: ['NVDA', 'Nvidia', 'NVIDIA'], AMD: ['AMD'], INTC: ['INTC', 'Intel'],
            MSFT: ['MSFT', 'Microsoft'], GOOGL: ['GOOGL', 'Google', 'Alphabet'],
            AMZN: ['AMZN', 'Amazon'], META: ['META', 'Meta'], TSM: ['TSM', 'TSMC'],
        };
        const numericClaims = extractNumericClaims(markdown, aliases).slice(0, 40);
        const exhibits = buildExhibits(numericClaims);
        console.log(`numericClaims: ${numericClaims.length}, exhibits: ${exhibits.length}`);

        const report = {
            query: 'Nvidia data center revenue growth and key risks FY2026',
            title: 'NVIDIA: Data Center Growth & Key Risks — FY2026',
            summary: markdown.split('\n\n')[1] ?? '',
            markdown,
            citations,
            metadata: {
                sourcesAnalyzed: citations.length,
                generatedAt: new Date().toISOString(),
                estimatedReadTime: Math.ceil(markdown.split(/\s+/).length / 200),
                confidence: 'Medium' as const,
                numericClaims,
            },
        };

        // ── LIVE design loop (DeepSeek via market-server :3002) ─────────────
        const { runDesignLoop } = await import('../src/services/pdfDesigner');
        const t0 = Date.now();
        const design = await runDesignLoop(report.title, markdown, exhibits);
        console.log(`design loop: ${Math.round((Date.now() - t0) / 1000)}s, iterations=${design.iterations}, score=${design.finalScore}, violationsFixed=${design.violationsFixed}, fellBack=${design.fellBack}`);
        console.log('DESIGN SPEC:', JSON.stringify(design.spec, null, 2));
        expect(design.fellBack).toBe(false);

        // ── Render ───────────────────────────────────────────────────────────
        const { renderToBuffer } = await import('@react-pdf/renderer');
        const PdfDocument = (await import('../src/components/research/PdfDocument')).default;
        const buffer = await renderToBuffer(
            React.createElement(PdfDocument, { report: report as any, design: design.spec }) as any,
        );
        const outPath = join(HERE, 'out', 'designed-nvda.pdf');
        writeFileSync(outPath, buffer);
        console.log(`PDF written: ${outPath} (${Math.round(buffer.length / 1024)} KB)`);

        // ── Post-render text-layer QA (node: legacy pdfjs, explicit worker) ──
        const require = createRequire(import.meta.url);
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc =
            pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
        const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer), disableFontFace: true });
        const doc = await loadingTask.promise;
        const pages: string[] = [];
        for (let p = 1; p <= doc.numPages; p++) {
            const content = await (await doc.getPage(p)).getTextContent();
            pages.push(content.items.map((it: any) => it.str ?? '').join(' '));
        }
        await loadingTask.destroy();

        const { auditRenderedText } = await import('../src/services/pdfPostRenderQa');
        const qa = auditRenderedText(pages, report.citations.length);
        console.log('POST-RENDER QA:', JSON.stringify({
            ok: qa.ok, pages: qa.pages,
            orphans: qa.orphanPunctuation.slice(0, 5),
            unresolved: qa.unresolvedIds.slice(0, 8),
            literals: qa.markdownLiterals.slice(0, 5),
            internalTags: qa.internalTags,
        }, null, 2));

        expect(qa.pages).toBeGreaterThan(3);

        // ── Structural QA (opendataloader-pdf → geometry) — regression test 7 ──
        // Runs only when Java 11+ is present; skips clean otherwise.
        const { structuralQa, isJavaAvailable } = await import('../src/services/pdfStructuralQa');
        if (await isJavaAvailable()) {
            const struct = await structuralQa(outPath);
            console.log('STRUCTURAL QA:', JSON.stringify(struct, null, 2));
            expect(struct).not.toBeNull();
            expect(struct!.splitRows).toHaveLength(0);   // no table row spans a page break
        } else {
            console.log('STRUCTURAL QA: skipped — Java 11+ not installed (opendataloader-pdf needs a JRE)');
        }
    }, 600_000);
});
