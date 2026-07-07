// Company Brief — AlphaSense-style AI tearsheet: a one-ticker Research Grid run.
// Reuses the grid engine (SEED_GRID_PROMPTS × runGrid × Gravity RAG) so every
// section is a cited, filings-grounded answer — no new infrastructure.

import { useState, useEffect, useCallback, useRef, Children, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkles, RefreshCw, Square } from 'lucide-react';
import {
    initializeGrid, runGrid, cellKey, SEED_GRID_PROMPTS,
    type GridState, type CellRunnerDeps,
} from '../../services/gridResearch';
import type { Citation, ResearchModelId } from '../../services/deepResearchService';
import { queryGravityRAG } from '../../services/gravitySearchService';
import { saveGridRun, loadTodaysRunByName } from '../../services/gridStore';

const LLM_PROXY_URL = `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/llm/chat`;

// Same proxy contract as GridView's callLLMProxy (kept local — it's 12 lines).
async function callDeepSeek(prompt: string, signal?: AbortSignal): Promise<{ text: string; model: ResearchModelId }> {
    const res = await fetch(LLM_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'deepseek', model: 'deepseek-chat', prompt, max_tokens: 2048 }),
        signal,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `LLM proxy failed (${res.status})`);
    }
    const data = await res.json();
    return { text: data.text ?? '', model: (data.model ?? 'deepseek-chat') as ResearchModelId };
}

// Replace inline [N] markers with clickable superscript badges that toggle the
// cited passage under the section.
function citeChildren(children: ReactNode, onCite: (id: number) => void): ReactNode {
    return Children.map(children, child => {
        if (typeof child !== 'string') return child;
        return child.split(/(\[\d+\])/g).map((part, i) => {
            const m = part.match(/^\[(\d+)\]$/);
            if (!m) return part;
            const id = parseInt(m[1], 10);
            return (
                <button
                    key={i}
                    onClick={() => onCite(id)}
                    className="mx-0.5 inline-flex items-center justify-center min-w-4 h-4 px-0.5 rounded-full bg-[#00F0FF]/15 text-[#00F0FF] text-[10px] font-bold hover:bg-[#00F0FF]/30 align-super"
                >
                    {id}
                </button>
            );
        });
    });
}

function BriefSection({ label, answer, citations, running }: {
    label: string;
    answer?: string;
    citations?: Citation[];
    running: boolean;
}) {
    const [openCite, setOpenCite] = useState<number | null>(null);
    const onCite = (id: number) => setOpenCite(prev => (prev === id ? null : id));
    const cited = citations?.find(c => c.id === openCite);

    return (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
            <p className="text-xs text-[#00F0FF] uppercase tracking-wider mb-3 font-semibold">{label}</p>
            {answer ? (
                <div className="text-sm text-[#A7B0C8] leading-relaxed space-y-2 [&_strong]:text-white">
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                            p: ({ children }) => <p>{citeChildren(children, onCite)}</p>,
                            li: ({ children }) => <li className="ml-4 list-disc">{citeChildren(children, onCite)}</li>,
                            strong: ({ children }) => <strong className="font-semibold text-white">{citeChildren(children, onCite)}</strong>,
                        }}
                    >
                        {answer}
                    </ReactMarkdown>
                </div>
            ) : (
                <div className="flex items-center gap-2 text-xs text-[#4A5568] py-2">
                    {running
                        ? <><span className="w-3 h-3 rounded-full border-2 border-[#00F0FF] border-t-transparent animate-spin" /> Analyzing filings…</>
                        : 'Not generated.'}
                </div>
            )}
            {cited && (
                <div className="mt-3 rounded-lg border border-[#00F0FF]/30 bg-[#00F0FF]/[0.04] p-3">
                    <p className="text-[10px] text-[#00F0FF] mb-1 font-semibold">[{cited.id}] {cited.title}</p>
                    {cited.sourceData?.text && (
                        <p className="text-xs text-[#A7B0C8] leading-relaxed">"{cited.sourceData.text}"</p>
                    )}
                </div>
            )}
            {(citations?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                    {citations!.map(c => (
                        <button
                            key={c.id}
                            onClick={() => onCite(c.id)}
                            title={c.title}
                            className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${openCite === c.id
                                ? 'border-[#00F0FF]/50 text-[#00F0FF] bg-[#00F0FF]/10'
                                : 'border-white/[0.08] text-[#4A5568] hover:text-[#A7B0C8]'}`}
                        >
                            [{c.id}] {c.title.length > 46 ? c.title.slice(0, 44) + '…' : c.title}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function CompanyBrief({ ticker }: { ticker: string }) {
    const [state, setState] = useState<GridState | null>(null);
    const [running, setRunning] = useState(false);
    const [cached, setCached] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    const briefName = `${ticker} Company Brief`;

    const run = useCallback(async () => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setCached(false);
        const def = {
            id: `brief-${ticker}`,
            name: briefName,
            tickers: [ticker],
            prompts: SEED_GRID_PROMPTS,
        };
        const initial = initializeGrid(def);
        setState(initial);
        setRunning(true);
        const deps: CellRunnerDeps = {
            callLLM: callDeepSeek,
            searchGravity: (q, t, signal) => {
                void signal;
                return queryGravityRAG(q, { companies: [t] });
            },
        };
        try {
            const final = await runGrid(initial, deps, {
                concurrency: 3,
                signal: controller.signal,
                onCellUpdate: s => setState({ ...s }),
            });
            if (!controller.signal.aborted) {
                setState(final);
                // Cache the completed brief for the rest of the day.
                saveGridRun(final).catch(() => { /* non-blocking */ });
            }
        } finally {
            if (abortRef.current === controller) setRunning(false);
        }
    }, [ticker, briefName]);

    // On ticker change: serve today's cached brief if present, else run fresh.
    useEffect(() => {
        let alive = true;
        (async () => {
            const hit = await loadTodaysRunByName(briefName).catch(() => null);
            if (!alive) return;
            if (hit) {
                setState(hit);
                setCached(true);
            } else {
                run();
            }
        })();
        return () => { alive = false; abortRef.current?.abort(); };
    }, [briefName, run]);

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#00F0FF]" />
                <p className="text-sm font-semibold text-white">AI Company Brief</p>
                <span className="text-[10px] text-[#4A5568]">filings-grounded · every claim cited</span>
                {cached && !running && (
                    <span className="text-[10px] text-[#00F0FF]/70 border border-[#00F0FF]/20 rounded px-1.5 py-0.5">cached today</span>
                )}
                <button
                    onClick={() => (running ? abortRef.current?.abort() : run())}
                    className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-white/[0.08] text-[11px] text-[#A7B0C8] hover:text-white hover:border-white/20 transition-colors"
                >
                    {running ? <><Square className="w-3 h-3" /> Stop</> : <><RefreshCw className="w-3 h-3" /> Regenerate</>}
                </button>
            </div>
            {SEED_GRID_PROMPTS.filter(p => !p.synthesis).map(p => {
                const cell = state?.cells[cellKey(ticker, p.id)];
                return (
                    <BriefSection
                        key={p.id}
                        label={p.label}
                        answer={cell?.status === 'done' ? cell.answer : undefined}
                        citations={cell?.citations}
                        running={running && cell?.status !== 'error'}
                    />
                );
            })}
        </div>
    );
}
