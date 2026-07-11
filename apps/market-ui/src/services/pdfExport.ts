// PDF Export Service — uses @react-pdf/renderer for real vector PDFs
import React from 'react';
import { pdf } from '@react-pdf/renderer';
import type { ResearchReport } from './deepResearchService';
import PdfDocument from '../components/research/PdfDocument';
import { runDesignLoop, type DesignSpec } from './pdfDesigner';
import { buildExhibits } from './reportQaGates';

// Self-Improving Design Loop: an LLM design director reads the report and
// makes bounded design decisions (tone/accent/density/kicker/abstract/pull
// quotes/exhibit titles) before rendering. Validator-enforced, fail-safe —
// any LLM failure falls back to the house default design. Disable with
// VITE_PDF_DESIGN_LOOP=false.
async function designForReport(report: ResearchReport): Promise<DesignSpec | undefined> {
  const env = (import.meta as any)?.env ?? {};
  if (env.VITE_PDF_DESIGN_LOOP === 'false') return undefined;
  try {
    const exhibits = buildExhibits(report.metadata.numericClaims ?? []);
    const result = await runDesignLoop(report.title, report.markdown, exhibits);
    console.log(`[pdfDesigner] iterations=${result.iterations} score=${result.finalScore} fixed=${result.violationsFixed} fallback=${result.fellBack}`);
    return result.fellBack ? undefined : result.spec;
  } catch {
    return undefined;   // design is an enhancement — export must never block
  }
}

/**
 * Generate a PDF blob from the report using @react-pdf/renderer.
 * Returns a Blob that can be used for download or preview.
 */
export async function generatePdfBlob(report: ResearchReport): Promise<Blob> {
  const design = await designForReport(report);
  const doc = React.createElement(PdfDocument, { report, design });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blob = await pdf(doc as any).toBlob();
  return blob;
}

/**
 * Export the report as a downloadable PDF file.
 */
export async function exportReportToPDF(report: ResearchReport): Promise<void> {
  const blob = await generatePdfBlob(report);

  const filename = report.title
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 60);

  // Trigger download
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}_AlphaSense_AI.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
