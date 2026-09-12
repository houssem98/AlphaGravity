// Devil's Advocate — an on-demand pressure-test of the bull thesis. One RAG
// call for grounded facts, then one adversarial LLM pass that rebuts the thesis,
// reviews risks, and lands a PM verdict. A committee-lite: the sequential
// bull→bear→risk→PM debate distilled to the challenge half (the brief's Thesis
// section already carries the bull case).

import { Children, type ReactNode } from 'react';
import { authHeader } from '../../services/supabase';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Scale } from 'lucide-react';
import { queryGravityRAG } from '../../services/gravitySearchService';
import { useCompanyBriefStore, briefDefault } from '../../stores/companyBriefStore';
import { useBackgroundStore } from '../../stores/backgroundStore';

const LLM_PROXY_URL = `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/llm/chat`;

function citeChildren(children: ReactNode): ReactNode {
    return Children.map(children, child => {
        if (typeof child !== 'string') return child;
        return child.split(/(\[\d+\])/g).map((part, i) => {
            const m = part.match(/^\[(\d+)\]$/);
            if (!m) return part;
            return <sup key={i} className="text-[#F59E0B] text-[10px] font-bold">[{m[1]}]</sup>;
        });
    });
}

const PROMPT = (ticker: string, facts: string) =>
    `You are the DEVIL'S ADVOCATE on an investment committee, pressure-testing the bull case for ${ticker}. `
    + `Using ONLY the verified filing data below, deliver three sections with bold headers:\n`
    + `**Bear Rebuttal** — attack the 2-3 weakest points of the bull thesis with specific figures.\n`
    + `**Risk Review** — the top 3 downside risks and what would invalidate the bull case.\n`
    + `**PM Verdict** — a definitive call (Buy / Hold / Avoid) with conviction (High/Medium/Low) and one-line sizing rationale.\n`
    + `Cite inline with the bracketed numbers below — [1], [2] — and use no number that is not listed. `
    + `Be concise and specific; never hedge into "it depends".\n\n`
    + `NUMBERED FILING PASSAGES:\n${facts}`;

export default function DevilsAdvocate({ ticker }: { ticker: string }) {
    // Run state lives in the ticker-keyed store, so leaving the company page no
    // longer drops the challenge: the loop keeps writing here and the UI picks
    // the SAME run (or its finished result) back up on return.
    const entry = useCompanyBriefStore((s) => s.byTicker[ticker]) ?? briefDefault;
    const { devilAnswer: answer, devilRunning: running, devilError: error, devilSources: sources } = entry;
    const patch = useCompanyBriefStore((s) => s.patch);
    const startBgJob = useBackgroundStore((s) => s.startJob);
    const endBgJob = useBackgroundStore((s) => s.endJob);

    const run = async () => {
        patch(ticker, { devilRunning: true, devilError: null, devilAnswer: null, devilSources: [] });
        const jobId = `devil-${ticker}-${Date.now()}`;
        startBgJob({
            id: jobId, label: `${ticker} Devil's Advocate`, kind: 'brief',
            href: `/companies/${ticker}`, startedAt: Date.now(),
        });
        try {
            const rag = await queryGravityRAG(
                `${ticker} investment thesis growth drivers risks bear case valuation`,
                { companies: [ticker] },
            ).catch(() => null);

            // V3-7 · this used to be `facts = rag.answer` — the pipeline's own
            // SYNTHESISED paragraph, handed to the model under the heading
            // VERIFIED DATA with an instruction to cite it as [1]. There was no
            // [1]: nothing numbered was ever sent, so every marker the model
            // emitted indexed a list that did not exist, and the superscripts
            // rendered below pointed at nothing.
            //
            // The RAG result already carries `citations[]` — each one an exact
            // source passage with its own id, title and URL. Those are what a
            // challenge can actually be held to, so those are what it gets.
            const cites = (rag?.available ? rag.citations : []) ?? [];
            if (!cites.length) {
                // No evidence means no challenge. An answer built on a summary
                // nobody can check is not a cheaper version of this — it is a
                // different thing wearing its name.
                patch(ticker, {
                    devilError: rag?.available
                        ? 'The filing search returned no citable passages for this ticker, so there is '
                        + 'no evidence to pressure-test the thesis against.'
                        : 'No filing data available to challenge for this ticker.',
                });
                return;
            }
            const facts = cites.map(c => [
                `[${c.id}]`,
                c.source,
                c.section && `— ${c.section}`,
                c.date && `(${c.date})`,
            ].filter(Boolean).join(' ') + `\n${c.text}`).join('\n\n');
            patch(ticker, {
                devilSources: cites.map(c => ({
                    id: c.id, source: c.source, section: c.section, date: c.date, url: c.url,
                })),
            });

            const res = await fetch(LLM_PROXY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
                // deepseek-chat, not -v4-flash: the latter is a reasoning model
                // that returns content:null at this budget (see CompanyBrief).
                body: JSON.stringify({ provider: 'deepseek', model: 'deepseek-chat', prompt: PROMPT(ticker, facts), max_tokens: 1600 }),
            });
            if (!res.ok) throw new Error(`LLM proxy ${res.status}`);
            const data = await res.json();
            patch(ticker, { devilAnswer: data.text || '' });
        } catch (e) {
            patch(ticker, { devilError: e instanceof Error ? e.message : 'Failed' });
        } finally {
            endBgJob(jobId);
            patch(ticker, { devilRunning: false });
        }
    };

    return (
        <div className="rounded-xl border border-[#F59E0B]/20 bg-[#F59E0B]/[0.03] p-5">
            <div className="flex items-center gap-2 mb-1">
                <Scale className="w-4 h-4 text-[#F59E0B]" />
                <p className="text-xs text-[#F59E0B] uppercase tracking-wider font-semibold">Devil's Advocate</p>
                <button
                    onClick={run}
                    disabled={running}
                    className="ml-auto px-2.5 py-1 rounded-lg border border-[#F59E0B]/30 text-[11px] text-[#F59E0B] hover:bg-[#F59E0B]/10 disabled:opacity-40 transition-colors"
                >
                    {running ? 'Challenging…' : answer ? 'Re-challenge' : 'Challenge the thesis'}
                </button>
            </div>
            {!answer && !running && !error && (
                <p className="text-xs text-[#4A5568]">Pressure-test the bull case: bear rebuttal, risk review, and a PM verdict — grounded in filings.</p>
            )}
            {running && (
                <div className="flex items-center gap-2 text-xs text-[#4A5568] py-2">
                    <span className="w-3 h-3 rounded-full border-2 border-[#F59E0B] border-t-transparent animate-spin" />
                    Building the bear case…
                </div>
            )}
            {error && <p className="text-xs text-red-400 py-1">{error}</p>}
            {answer && (
                <div className="mt-2 text-sm text-[#A7B0C8] leading-relaxed space-y-2 [&_strong]:text-white [&_strong]:font-semibold">
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                            p: ({ children }) => <p>{citeChildren(children)}</p>,
                            li: ({ children }) => <li className="ml-4 list-disc">{citeChildren(children)}</li>,
                            strong: ({ children }) => <strong>{citeChildren(children)}</strong>,
                        }}
                    >
                        {answer}
                    </ReactMarkdown>

                    {/* V3-7 · the list the [N] markers index. The challenge is
                        prompted with these exact passages and nothing else, so
                        every superscript above resolves to a filing here. */}
                    {sources.length > 0 && (
                        <div data-devil-sources className="pt-3 mt-3 border-t border-[#F59E0B]/15">
                            <p className="text-[10px] uppercase tracking-wider text-[#4A5568] mb-1.5">
                                Evidence the challenge was given
                            </p>
                            <ol className="space-y-1">
                                {sources.map(s => (
                                    <li key={s.id} data-devil-source={s.id} className="text-[11px] text-[#4A5568] flex gap-1.5">
                                        <span className="text-[#F59E0B] font-bold shrink-0">[{s.id}]</span>
                                        {s.url
                                            ? <a href={s.url} target="_blank" rel="noreferrer" className="hover:text-[#A7B0C8] underline decoration-dotted truncate">{s.source}</a>
                                            : <span className="truncate">{s.source}</span>}
                                        {s.section && <span className="shrink-0">· {s.section}</span>}
                                        {s.date && <span className="shrink-0">· {s.date}</span>}
                                    </li>
                                ))}
                            </ol>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
