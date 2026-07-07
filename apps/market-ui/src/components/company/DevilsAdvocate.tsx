// Devil's Advocate — an on-demand pressure-test of the bull thesis. One RAG
// call for grounded facts, then one adversarial LLM pass that rebuts the thesis,
// reviews risks, and lands a PM verdict. A committee-lite: the sequential
// bull→bear→risk→PM debate distilled to the challenge half (the brief's Thesis
// section already carries the bull case).

import { useState, Children, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Scale } from 'lucide-react';
import { queryGravityRAG } from '../../services/gravitySearchService';

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
    + `Cite inline like [1]. Be concise and specific; never hedge into "it depends".\n\n`
    + `VERIFIED DATA:\n${facts}`;

export default function DevilsAdvocate({ ticker }: { ticker: string }) {
    const [answer, setAnswer] = useState<string | null>(null);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const run = async () => {
        setRunning(true); setError(null); setAnswer(null);
        try {
            const rag = await queryGravityRAG(
                `${ticker} investment thesis growth drivers risks bear case valuation`,
                { companies: [ticker] },
            ).catch(() => null);
            const facts = rag?.available && rag.answer ? rag.answer : '';
            if (!facts) { setError('No filing data available to challenge for this ticker.'); return; }

            const res = await fetch(LLM_PROXY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: 'deepseek', model: 'deepseek-chat', prompt: PROMPT(ticker, facts), max_tokens: 1600 }),
            });
            if (!res.ok) throw new Error(`LLM proxy ${res.status}`);
            const data = await res.json();
            setAnswer(data.text || '');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed');
        } finally {
            setRunning(false);
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
                </div>
            )}
        </div>
    );
}
