// Company Brief — AlphaSense-style AI tearsheet: a one-ticker Research Grid run.
// Reuses the grid engine (SEED_GRID_PROMPTS × runGrid × Gravity RAG) so every
// section is a cited, filings-grounded answer — no new infrastructure.

import { useState, useEffect, useCallback, useRef, Children, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkles, RefreshCw, Square, Download } from 'lucide-react';
import {
    initializeGrid, runGrid, cellKey, buildMemo, SEED_GRID_PROMPTS,
    type GridState, type CellRunnerDeps,
} from '../../services/gridResearch';
import { downloadBlob } from '../../services/gridExcel';
import type { Citation, ResearchModelId } from '../../services/deepResearchService';
import { queryGravityRAG } from '../../services/gravitySearchService';
import { saveGridRun, loadTodaysRunByName } from '../../services/gridStore';
import { useBackgroundStore } from '../../stores/backgroundStore';
import { useCompanyBriefStore, briefDefault, briefAborts } from '../../stores/companyBriefStore';

const LLM_PROXY_URL = `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/llm/chat`;

// Fallback LLM (used only when a cell has sources but RAG returns no grounded
// answer). Model choice mirrors GridView's picker.
type ModelKey = 'deepseek' | 'claude' | 'gemini';
const MODEL_CONFIG: Record<ModelKey, { provider: string; model: string; label: string }> = {
    deepseek: { provider: 'deepseek', model: 'deepseek-v4-flash', label: 'DeepSeek' },
    claude:   { provider: 'anthropic', model: 'claude-sonnet-4-6', label: 'Claude' },
    gemini:   { provider: 'gemini', model: 'gemini-2.5-flash', label: 'Gemini' },
};

// Same proxy contract as GridView's callLLMProxy (kept local — it's 12 lines).
function makeCallLLM(modelKey: ModelKey) {
    const cfg = MODEL_CONFIG[modelKey];
    return async function callLLM(prompt: string, signal?: AbortSignal): Promise<{ text: string; model: ResearchModelId }> {
        const res = await fetch(LLM_PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: cfg.provider, model: cfg.model, prompt, max_tokens: 2048 }),
            signal,
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
            throw new Error(err.error || `LLM proxy failed (${res.status})`);
        }
        const data = await res.json();
        return { text: data.text ?? '', model: (data.model ?? cfg.model) as ResearchModelId };
    };
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
    // Live brief state lives in the store, keyed by ticker — so this component
    // is a pure view over it and can leave/return without dropping the run.
    const entry = useCompanyBriefStore((s) => s.byTicker[ticker]) ?? briefDefault;
    const { state, running, cached, model } = entry;
    const patch = useCompanyBriefStore((s) => s.patch);
    const setModel = (m: ModelKey) => patch(ticker, { model: m });
    const startBgJob = useBackgroundStore((s) => s.startJob);
    const endBgJob = useBackgroundStore((s) => s.endJob);

    const briefName = `${ticker} Company Brief`;

    const run = useCallback(async () => {
        briefAborts[ticker]?.abort();
        const controller = new AbortController();
        briefAborts[ticker] = controller;
        const def = {
            id: `brief-${ticker}`,
            name: briefName,
            tickers: [ticker],
            prompts: SEED_GRID_PROMPTS,
        };
        const initial = initializeGrid(def);
        patch(ticker, { state: initial, running: true, cached: false });
        // Background job so the brief keeps running (and caches) after the user
        // leaves the company page, and shows in the global activity indicator.
        const jobId = `brief-${ticker}-${Date.now()}`;
        startBgJob({ id: jobId, label: briefName, kind: 'brief', href: `/companies/${ticker}`, startedAt: Date.now() });
        const deps: CellRunnerDeps = {
            callLLM: makeCallLLM(model),
            searchGravity: (q, t, signal) => {
                void signal;
                return queryGravityRAG(q, { companies: [t] });
            },
        };
        try {
            const final = await runGrid(initial, deps, {
                concurrency: 3,
                signal: controller.signal,
                onCellUpdate: s => patch(ticker, { state: { ...s } }),
            });
            if (!controller.signal.aborted) {
                patch(ticker, { state: final });
                // Cache the completed brief for the rest of the day.
                saveGridRun(final).catch(() => { /* non-blocking */ });
            }
        } finally {
            endBgJob(jobId);
            if (briefAborts[ticker] === controller) patch(ticker, { running: false });
        }
    }, [ticker, briefName, model, patch, startBgJob, endBgJob]);

    // On ticker change: if the store already holds a live or finished session
    // for this ticker, resume it (render the store) — do NOT restart. Otherwise
    // serve today's cache, else run fresh. Model changes don't re-trigger this.
    const runRef = useRef(run);
    runRef.current = run;
    useEffect(() => {
        const cur = useCompanyBriefStore.getState().byTicker[ticker];
        if (cur && (cur.running || cur.state)) return; // already running / done → resume
        let alive = true;
        (async () => {
            const hit = await loadTodaysRunByName(briefName).catch(() => null);
            if (!alive) return;
            // A run may have begun for this ticker while we awaited the cache.
            const now = useCompanyBriefStore.getState().byTicker[ticker];
            if (now && (now.running || now.state)) return;
            if (hit) patch(ticker, { state: hit, cached: true });
            else runRef.current();
        })();
        // Do NOT abort on unmount: the run lives in the store and keeps going.
        return () => { alive = false; };
    }, [ticker, briefName, patch]);

    const hasAnswers = !!state && Object.values(state.cells).some(c => c.status === 'done' && c.answer);

    const exportMemo = () => {
        if (!state) return;
        const blob = new Blob([buildMemo(state)], { type: 'text/markdown;charset=utf-8' });
        downloadBlob(blob, `${ticker}_brief_${new Date().toISOString().slice(0, 10)}.md`);
    };

    return (
        <div className="space-y-4">
            {/* MB-11: title, strapline and the model picker measured 475px in a
                358px column at 390px and were clipped with no scroller. Wrapping
                is enough — the picker keeps its own row and the strapline, which
                is the least load-bearing of the three, drops out under sm. */}
            <div className="flex flex-wrap items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#00F0FF]" />
                <p className="text-sm font-semibold text-white">AI Company Brief</p>
                <span className="hidden sm:inline text-[10px] text-[#4A5568]">filings-grounded · every claim cited</span>
                {cached && !running && (
                    <span className="text-[10px] text-[#00F0FF]/70 border border-[#00F0FF]/20 rounded px-1.5 py-0.5">cached today</span>
                )}
                <div className="ml-auto flex items-center gap-2">
                    <div className="flex rounded-lg border border-white/[0.08] overflow-hidden">
                        {(Object.keys(MODEL_CONFIG) as ModelKey[]).map(k => (
                            <button
                                key={k}
                                onClick={() => setModel(k)}
                                disabled={running}
                                title={k === 'deepseek' ? 'DeepSeek — cheap, default' : k === 'claude' ? 'Claude — highest quality' : 'Gemini — free'}
                                className={`px-2 py-1 text-[10px] font-medium transition-colors disabled:opacity-40 ${model === k
                                    ? 'bg-[#00F0FF]/15 text-[#00F0FF]'
                                    : 'text-[#4A5568] hover:text-[#A7B0C8]'}`}
                            >
                                {MODEL_CONFIG[k].label}
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={exportMemo}
                        disabled={!hasAnswers}
                        title="Download the brief as a Markdown memo"
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-white/[0.08] text-[11px] text-[#A7B0C8] hover:text-white hover:border-white/20 disabled:opacity-40 transition-colors"
                    >
                        <Download className="w-3 h-3" /> Memo
                    </button>
                    <button
                        onClick={() => (running ? briefAborts[ticker]?.abort() : run())}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-white/[0.08] text-[11px] text-[#A7B0C8] hover:text-white hover:border-white/20 transition-colors"
                    >
                        {running ? <><Square className="w-3 h-3" /> Stop</> : <><RefreshCw className="w-3 h-3" /> Regenerate</>}
                    </button>
                </div>
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
