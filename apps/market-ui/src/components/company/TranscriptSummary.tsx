// Earnings-call smart summary — one fixed-prompt RAG call over the indexed
// transcript. Only mounts when the company page found a transcript filing, so
// tickers without one show nothing (no empty promise).

import { useEffect, Children, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Mic } from 'lucide-react';
import { queryGravityRAG } from '../../services/gravitySearchService';
import { useCompanyBriefStore, briefDefault } from '../../stores/companyBriefStore';
import { useBackgroundStore } from '../../stores/backgroundStore';

// True when the RAG answer is a "no transcript content" disclaimer rather than a
// real call summary. Exported for the self-check.
export function isTranscriptDisclaimer(answer: string): boolean {
    return /no earnings call|not include any earnings call|no outlook or summary of an earnings call|do not (?:contain|include).*(?:transcript|earnings call)/i.test(answer);
}

function citeChildren(children: ReactNode): ReactNode {
    return Children.map(children, child => {
        if (typeof child !== 'string') return child;
        return child.split(/(\[\d+\])/g).map((part, i) => {
            const m = part.match(/^\[(\d+)\]$/);
            if (!m) return part;
            return <sup key={i} className="text-[#00F0FF] text-[10px] font-bold">[{m[1]}]</sup>;
        });
    });
}

export default function TranscriptSummary({ ticker, date }: { ticker: string; date?: string | null }) {
    // The RAG call runs 1.7–14.7s (measured, FI-4), so its state lives in the
    // ticker-keyed store: leaving the company page mid-read no longer discards
    // the result and returning shows the SAME read rather than starting another.
    const entry = useCompanyBriefStore((s) => s.byTicker[ticker]) ?? briefDefault;
    const { transcriptAnswer: answer, transcriptFailed: failed } = entry;
    const patch = useCompanyBriefStore((s) => s.patch);
    const startBgJob = useBackgroundStore((s) => s.startJob);
    const endBgJob = useBackgroundStore((s) => s.endJob);
    // Before the effect has run there is no entry yet — that frame is loading too.
    const loading = entry.transcriptLoading || (answer === null && !failed);

    useEffect(() => {
        const cur = useCompanyBriefStore.getState().byTicker[ticker];
        // Already reading, or already read → resume the store, never re-run.
        if (cur && (cur.transcriptLoading || cur.transcriptAnswer !== null || cur.transcriptFailed)) return;
        patch(ticker, { transcriptLoading: true, transcriptAnswer: null, transcriptFailed: false });
        const jobId = `transcript-${ticker}-${Date.now()}`;
        startBgJob({
            id: jobId, label: `${ticker} Earnings Call Summary`, kind: 'brief',
            href: `/companies/${ticker}`, startedAt: Date.now(),
        });
        (async () => {
            const res = await queryGravityRAG(`${ticker} earnings call summary`, {
                companies: [ticker],
                document_types: ['earnings_transcript'],
            }).catch(() => null);
            // ponytail: string-match guard, known ceiling. Prod's document_types
            // filter isn't enforced on the structured channel, so a thin/absent
            // transcript makes RAG fall back to 10-K figures and disclaim the
            // call. Hide rather than show a "call summary" that summarizes
            // financials. Upgrade: enforce document_types server-side in the
            // structured channel, then drop this guard.
            const ans = res?.available ? (res.answer || '') : '';
            if (ans && !isTranscriptDisclaimer(ans)) patch(ticker, { transcriptAnswer: ans });
            else patch(ticker, { transcriptFailed: true });
            endBgJob(jobId);
            patch(ticker, { transcriptLoading: false });
        })();
        // Do NOT cancel on unmount: the read lives in the store and keeps going.
    }, [ticker, patch, startBgJob, endBgJob]);

    // Nothing useful and not loading → hide entirely.
    if (failed && !loading) return null;

    return (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
            <div className="flex items-center gap-2 mb-3">
                <Mic className="w-4 h-4 text-[#00F0FF]" />
                <p className="text-xs text-[#00F0FF] uppercase tracking-wider font-semibold">Earnings Call Summary</p>
                {date && <span className="text-[10px] text-[#4A5568] ml-auto">{date}</span>}
            </div>
            {loading ? (
                <div className="flex items-center gap-2 text-xs text-[#4A5568] py-2">
                    <span className="w-3 h-3 rounded-full border-2 border-[#00F0FF] border-t-transparent animate-spin" />
                    Reading transcript…
                </div>
            ) : (
                <div className="text-sm text-[#A7B0C8] leading-relaxed space-y-2 [&_strong]:text-white [&_strong]:font-semibold">
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                            p: ({ children }) => <p>{citeChildren(children)}</p>,
                            li: ({ children }) => <li className="ml-4 list-disc">{citeChildren(children)}</li>,
                            strong: ({ children }) => <strong>{citeChildren(children)}</strong>,
                        }}
                    >
                        {answer ?? ''}
                    </ReactMarkdown>
                </div>
            )}
        </div>
    );
}
