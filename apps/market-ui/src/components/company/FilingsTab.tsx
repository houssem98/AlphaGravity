// Filings tab — extracted verbatim from CompanyPage.tsx (CF-9).

import { isNewFiling } from '../../lib/newFilings';
import { FilingRow } from './presentation';
import type { GravityDocument } from './types';

export default function FilingsTab({ documents, symbol, watermark }: {
    documents: GravityDocument[];
    symbol: string;
    watermark: string | null;
}) {
    return (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            {documents.length === 0
                ? <p className="text-sm text-[#4A5568] text-center py-8">No indexed filings found. Seed the Gravity index first.</p>
                : documents.map(doc => (
                    <FilingRow key={doc.id} doc={doc} ticker={symbol}
                        isNew={isNewFiling(doc.filing_date, watermark)} />
                ))
            }
        </div>
    );
}
