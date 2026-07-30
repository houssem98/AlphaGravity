// G1b — the render side of the Gamma block library. Each block is fed ONLY
// verbatim slices the classifier extracted from the report, so a block can
// never display a number or a claim the report did not make.

import { Quote } from 'lucide-react';
import type { StatCandidate } from '../../services/sectionLayout';

const ACCENT = '#3D7FF6';

// Reports carry either numbered citations ("[3]") or named ones
// ("[Analyst Synthesis]"). A bare "3" on a card means nothing to a reader.
function citationLabel(citation: string): string {
    const inner = citation.replace(/^\[|\]$/g, '').trim();
    return /^\d+$/.test(inner) ? `Source ${inner}` : inner;
}

// Cited figures promoted out of the prose into scannable cards. The citation
// rides along on the card — a stat with no attribution never gets here
// (pickStatCards drops it), so provenance survives the promotion.
export function StatRow({ stats, accent = ACCENT }: { stats: StatCandidate[]; accent?: string }) {
    if (stats.length === 0) return null;
    return (
        <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            {stats.map((s, i) => (
                <div key={i} className="rounded-xl px-4 py-3.5"
                    style={{ border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
                    <div className="text-[21px] font-bold tabular-nums leading-none" style={{ color: accent }}>
                        {s.value}
                    </div>
                    <div className="text-[11.5px] leading-[1.45] mt-2" style={{ color: '#8894AD' }}>
                        {s.label}
                    </div>
                    <div className="text-[9.5px] uppercase tracking-wider mt-2 truncate" style={{ color: '#4A5570' }}>
                        {citationLabel(s.citation)}
                    </div>
                </div>
            ))}
        </div>
    );
}

// The section's verdict line, promoted to a callout. Verbatim — extractVerdict
// only moves the sentence, it does not rewrite it.
export function VerdictCallout({ text, accent = ACCENT }: { text: string; accent?: string }) {
    return (
        <div className="mb-6 rounded-xl px-5 py-4 flex items-start gap-3"
            style={{ border: `1px solid ${accent}38`, background: `${accent}0F` }}>
            <Quote className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accent }} />
            <div className="text-[15px] font-semibold leading-[1.6]" style={{ color: '#DDE6F5' }}>
                {text}
            </div>
        </div>
    );
}

// Wide comparison tables get their own scroll context instead of squeezing
// every column into the prose measure.
export function ComparisonFrame({ children }: { children: React.ReactNode }) {
    return <div className="overflow-x-auto -mx-1 px-1">{children}</div>;
}
