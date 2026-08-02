// Grid Research View — Hebbia Matrix / AlphaSense Generative Grid analogue.
// Rows=tickers × Columns=analyst prompts. Each cell is an independent
// cancellable LLM call with per-cell status.

import { useState, useRef, useEffect, useMemo, Children, type ReactNode } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { safeUrl } from '../../lib/safeUrl';
import { Play, X, Grid as GridIcon, Sparkles, Loader2, Check, AlertCircle, Download, Clock, Trash2, Copy, Check as CheckIcon, Share2, ExternalLink } from 'lucide-react';
import type { Citation } from '../../services/deepResearchService';
import {
    initializeGrid,
    runGrid,
    runGridCell,
    updateCell,
    toCSV,
    SEED_GRID_PROMPTS,
    cellKey,
    resolvePrompt,
    findUnmappedCites,
    figuresChanged,
    distinctiveTerms,
    buildMemo,
    type GridPrompt,
    type GridDef,
    type GridState,
    type GridCell,
    type CellRunnerDeps,
} from '../../services/gridResearch';
import { queryGravityRAG } from '../../services/gravitySearchService';
import { searchWeb as tavilySearchWeb } from '../../services/tavilyService';
import { scoreCellTrust, chipPropsFor, needsRerun, gradeDistribution, withTrust, type TrustChipProps, type TrustScore } from '../../services/gridTrust';
import { runGridRounds } from '../../services/gridTrustRunner';
import { localLessonStore, recordLessons, chronicConflictPrompts, chronicUnverifiedPrompts, rewordPromptIfChronic } from '../../services/gridLessons';
import { traceSummary, stepGlyph } from '../../services/gridTrace';
import { saveGridRun, loadLatestGridRun, listGridRuns, loadGridRun, deleteGridRun, type SavedGridRow } from '../../services/gridStore';
import { useGridRunStore, gridAbort } from '../../stores/gridRunStore';
import EdgarLink, { parseFilingTitle } from '../EdgarLink';
import { exportGridToXLSX, downloadBlob } from '../../services/gridExcel';
import { buildShareLink, readSharedGridFromUrl, clearSharedGridFromUrl } from '../../services/gridShare';
import { recordExport } from '../../services/auditClient';
import sp500 from '../../lib/sp500.json';

const LLM_PROXY_URL = `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/llm/chat`;
const GRAVITY_API = import.meta.env.VITE_GRAVITY_API_URL || 'http://localhost:8000';

const MODEL_CONFIG: Record<string, { provider: string; model: string }> = {
    deepseek: { provider: 'deepseek', model: 'deepseek-v4-flash' },
    claude: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    gemini: { provider: 'gemini', model: 'gemini-2.5-flash' },
};

async function callLLMProxy(prompt: string, modelKey: 'deepseek' | 'claude' | 'gemini', signal?: AbortSignal): Promise<{ text: string; model: any }> {
    const config = MODEL_CONFIG[modelKey];
    const res = await fetch(LLM_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, prompt, max_tokens: 2048 }),
        signal,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `LLM proxy failed (${res.status})`);
    }
    const data = await res.json();
    return { text: data.text ?? '', model: data.model ?? config.model };
}

async function searchGravityCell(query: string, ticker: string, signal?: AbortSignal) {
    return queryGravityRAG(query, { companies: [ticker] });
}

// AC-3 cell tools — live market-server endpoints (probed 2026-07-19).
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const fmtB = (n?: number) => (typeof n === 'number' && isFinite(n) ? `$${(n / 1e9).toFixed(1)}B` : 'n/a');
const fmtPct = (n?: number) => (typeof n === 'number' && isFinite(n) ? `${(n * 100).toFixed(1)}%` : 'n/a');

async function fetchMarketQuote(ticker: string, signal?: AbortSignal) {
    const r = await fetch(`${API_BASE}/api/quote?symbols=${encodeURIComponent(ticker)}`, { signal });
    if (!r.ok) throw new Error(`quote HTTP ${r.status}`);
    const q = (await r.json())?.quoteResponse?.result?.[0];
    if (!q?.regularMarketPrice) throw new Error('quote: empty result');
    const text = `${ticker} price $${q.regularMarketPrice} (${(q.regularMarketChangePercent ?? 0).toFixed(2)}% today), `
        + `prev close $${q.regularMarketPreviousClose}, market cap ${fmtB(q.marketCap)}, `
        + `52-week range $${q.fiftyTwoWeekLow}-$${q.fiftyTwoWeekHigh}`;
    return { text, data: q };
}

async function fetchFundamentals(ticker: string, signal?: AbortSignal) {
    const r = await fetch(`${API_BASE}/api/fundamentals?symbol=${encodeURIComponent(ticker)}`, { signal });
    if (!r.ok) throw new Error(`fundamentals HTTP ${r.status}`);
    const res = (await r.json())?.quoteSummary?.result?.[0];
    const sd = res?.summaryDetail, fd = res?.financialData, ks = res?.defaultKeyStatistics;
    if (!fd && !sd) throw new Error('fundamentals: empty result');
    const text = `${ticker} trailing P/E ${sd?.trailingPE?.toFixed?.(1) ?? 'n/a'}, EPS $${ks?.trailingEps ?? 'n/a'}, `
        + `revenue TTM ${fmtB(fd?.totalRevenue)}, FCF ${fmtB(fd?.freeCashflow)}, `
        + `gross margin ${fmtPct(fd?.grossMargins)}, operating margin ${fmtPct(fd?.operatingMargins)}, `
        + `analyst consensus ${fd?.recommendationKey ?? 'n/a'} (${fd?.numberOfAnalystOpinions ?? 0} analysts)`;
    return { text, data: { summaryDetail: sd, financialData: fd, defaultKeyStatistics: ks } };
}

const CELL_TOOLS = { marketQuote: fetchMarketQuote, fundamentals: fetchFundamentals };

// Web fallback (used only when RAG has no sources) — Tavily revived 2026-07-20.
async function searchWebCell(query: string): Promise<Citation[]> {
    const { results } = await tavilySearchWeb(query, 5);
    return results.map((r, i) => ({
        id: i + 1,
        title: r.title,
        url: r.url,
        source: 'tavily',
        publishedDate: r.publishedDate,
        sourceData: { text: r.content },
    }));
}

const DEFAULT_TICKERS = ['NVDA', 'AAPL', 'MSFT', 'GOOGL'];

// Typo guard: warn (never block — non-S&P tickers are valid, on-demand ingest
// covers them) when a ticker isn't in the S&P 500 list, and suggest the
// closest symbol at edit distance 1 (catches APPL→AAPL, MSFTT→MSFT, etc.).
const KNOWN_SYMBOLS = new Set((sp500 as { symbol: string }[]).map(s => s.symbol));

function editDistance(a: string, b: string): number {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => {
        const row = new Array<number>(b.length + 1).fill(0);
        row[0] = i;
        return row;
    });
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++)
        for (let j = 1; j <= b.length; j++)
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return dp[a.length][b.length];
}

function closestSymbol(ticker: string): string | null {
    for (const s of KNOWN_SYMBOLS) {
        if (Math.abs(s.length - ticker.length) <= 1 && editDistance(ticker, s) === 1) return s;
    }
    return null;
}

const SEED_PROMPT_IDS = new Set(SEED_GRID_PROMPTS.map(p => p.id));
const customFromDef = (def: GridDef): GridPrompt[] => def.prompts.filter(p => !SEED_PROMPT_IDS.has(p.id));

interface SourceViewerData {
    title: string;
    text: string;
    ticker?: string;
    date?: string;
    documentType?: string;
    section?: string;
    url?: string;
    chunk_id?: string;
    char_offset_start?: number;
    char_offset_end?: number;
}

export default function GridView() {
    const [tickersInput, setTickersInput] = useState(DEFAULT_TICKERS.join(', '));
    const [promptIds, setPromptIds] = useState<string[]>(SEED_GRID_PROMPTS.map(p => p.id));
    // NL custom columns: analyst-authored prompts on top of the seed set.
    const [customPrompts, setCustomPrompts] = useState<GridPrompt[]>([]);
    const [newColInput, setNewColInput] = useState('');
    // Run state lives in a store, not here — mode switches unmount GridView and
    // a running grid must survive that (see gridRunStore).
    const state = useGridRunStore(s => s.gridState);
    const setState = useGridRunStore(s => s.setGridState);
    const running = useGridRunStore(s => s.running);
    const setRunning = useGridRunStore(s => s.setRunning);
    const [selectedCell, setSelectedCell] = useState<GridCell | null>(null);
    const [editingCell, setEditingCell] = useState<{ ticker: string; promptId: string } | null>(null);
    const [editPrompt, setEditPrompt] = useState<string>("");
    const [history, setHistory] = useState<SavedGridRow[]>([]);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [selectedModel, setSelectedModel] = useState<'deepseek' | 'claude' | 'gemini'>('deepseek');
    const [sortBy, setSortBy] = useState<'ticker' | 'status' | 'duration' | null>(null);
    const [sortDesc, setSortDesc] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [copiedCell, setCopiedCell] = useState<string | null>(null);
    const [shareMsg, setShareMsg] = useState<string | null>(null);
    // Cells whose figures changed vs the previous run (P2.3 change-alerts).
    const changedCells = useGridRunStore(s => s.changedCells);
    const setChangedCells = useGridRunStore(s => s.setChangedCells);
    // AC-5: live per-cell trace-step labels while running
    const cellSteps = useGridRunStore(s => s.cellSteps);
    const setCellStep = useGridRunStore(s => s.setCellStep);
    const [sourceViewer, setSourceViewer] = useState<SourceViewerData | null>(null);
    const [chunkFullText, setChunkFullText] = useState<string | null>(null);
    // P4-b throughput: actual wall-time + cells/sec for the last run, so the
    // /100-cell SLA is measurable (was unmeasured).
    const runStats = useGridRunStore(s => s.runStats);
    const setRunStats = useGridRunStore(s => s.setRunStats);
    const [burst, setBurst] = useState(false);
    const [activeCitation, setActiveCitation] = useState<number | null>(null);
    const abortRef = gridAbort;
    const searchInputRef = useRef<HTMLInputElement | null>(null);

    // Click an inline [N] citation → reveal & highlight that source below.
    const openCitation = (id: number) => {
        setActiveCitation(id);
        requestAnimationFrame(() => {
            document.getElementById(`grid-src-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
        window.setTimeout(() => setActiveCitation(cur => (cur === id ? null : cur)), 2200);
    };

    const copyCell = async (ticker: string, promptId: string, answer: string) => {
        await navigator.clipboard.writeText(answer);
        setCopiedCell(`${ticker}::${promptId}`);
        setTimeout(() => setCopiedCell(null), 2000);
    };

    const refreshHistory = async () => {
        const rows = await listGridRuns(20).catch(() => []);
        setHistory(rows);
    };

    // Mount: a shared grid in the URL wins over last-run restore. Otherwise
    // restore the user's last run (best-effort; silent on failure/signed-out).
    useEffect(() => {
        let cancelled = false;
        // Remount with a run already in the store (mode switch mid-run): adopt
        // it instead of restoring the last saved run, which would clobber it.
        const live = useGridRunStore.getState().gridState;
        if (live) {
            setTickersInput(live.def.tickers.join(', '));
            setPromptIds(live.def.prompts.map(p => p.id));
            setCustomPrompts(customFromDef(live.def));
            refreshHistory();
            return () => { cancelled = true; };
        }
        const shared = readSharedGridFromUrl();
        if (shared) {
            setState(shared);
            setTickersInput(shared.def.tickers.join(', '));
            setPromptIds(shared.def.prompts.map(p => p.id));
            setCustomPrompts(customFromDef(shared.def));
            clearSharedGridFromUrl();
            refreshHistory();
            return () => { cancelled = true; };
        }
        // Deep link from Research Library: ?gridRun=<id> opens that saved run.
        const runId = new URLSearchParams(window.location.search).get('gridRun');
        if (runId) {
            loadGridRun(runId).then(s => {
                if (cancelled || !s) return;
                setState(s);
                setTickersInput(s.def.tickers.join(', '));
                setPromptIds(s.def.prompts.map(p => p.id));
                setCustomPrompts(customFromDef(s.def));
            }).catch(() => { /* ignore */ });
            const url = new URL(window.location.href);
            url.searchParams.delete('gridRun');
            window.history.replaceState(null, '', url.pathname + url.search);
            refreshHistory();
            return () => { cancelled = true; };
        }
        // Prefill from a company page's "Compare" action: ?tickers=NVDA,AMD,INTC
        // sets the ticker input ready to run (no auto-run — user picks prompts).
        const prefill = new URLSearchParams(window.location.search).get('tickers');
        if (prefill?.trim()) {
            setTickersInput(prefill.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).join(', '));
            const url = new URL(window.location.href);
            url.searchParams.delete('tickers');
            window.history.replaceState(null, '', url.pathname + url.search);
            refreshHistory();
            return () => { cancelled = true; };
        }
        loadLatestGridRun()
            .then(last => {
                if (cancelled || !last) return;
                setState(last);
                setTickersInput(last.def.tickers.join(', '));
                setPromptIds(last.def.prompts.map(p => p.id));
                setCustomPrompts(customFromDef(last.def));
            })
            .catch(() => { /* ignore */ });
        refreshHistory();
        return () => { cancelled = true; };
    }, []);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Escape: close modals
            if (e.key === 'Escape') {
                setSelectedCell(null);
                setEditingCell(null);
            }

            // E: edit selected cell
            if (e.key === 'e' && e.ctrlKey === false && e.metaKey === false && selectedCell?.status === 'done') {
                const prompt = state?.def.prompts.find(p => p.id === selectedCell.promptId);
                if (prompt) {
                    const resolved = resolvePrompt(prompt, selectedCell.ticker);
                    setEditPrompt(resolved);
                    setEditingCell({ ticker: selectedCell.ticker, promptId: selectedCell.promptId });
                    setSelectedCell(null);
                }
            }

            // Arrow keys: navigate between cells
            if (selectedCell && state && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
                const tickers = state.def.tickers;
                const prompts = state.def.prompts;
                const tickerIdx = tickers.indexOf(selectedCell.ticker);
                const promptIdx = prompts.findIndex(p => p.id === selectedCell.promptId);

                let newTickerIdx = tickerIdx;
                let newPromptIdx = promptIdx;

                if (e.key === 'ArrowUp' && tickerIdx > 0) newTickerIdx = tickerIdx - 1;
                if (e.key === 'ArrowDown' && tickerIdx < tickers.length - 1) newTickerIdx = tickerIdx + 1;
                if (e.key === 'ArrowLeft' && promptIdx > 0) newPromptIdx = promptIdx - 1;
                if (e.key === 'ArrowRight' && promptIdx < prompts.length - 1) newPromptIdx = promptIdx + 1;

                const newCell = state.cells[cellKey(tickers[newTickerIdx], prompts[newPromptIdx].id)];
                if (newCell?.status === 'done') {
                    setSelectedCell(newCell);
                }
            }

            // Ctrl+E: export CSV
            if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
                e.preventDefault();
                handleExportCSV();
            }

            // Ctrl/Cmd+K: focus search
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                searchInputRef.current?.focus();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedCell, state]);

    // M3: fetch full chunk text from the backend when the source modal opens with a chunk_id.
    useEffect(() => {
        setChunkFullText(null);
        if (!sourceViewer?.chunk_id) return;
        let alive = true;
        (async () => {
            try {
                const res = await fetch(
                    `${GRAVITY_API}/v1/documents/chunk/${encodeURIComponent(sourceViewer.chunk_id!)}/context?window=1`,
                    { headers: { 'X-API-Key': 'deep-research-internal' } },
                );
                const data = res.ok ? await res.json() : null;
                const cited = (data?.chunks ?? []).find((ch: any) => ch.is_cited);
                if (alive && cited?.text) setChunkFullText(cited.text);
            } catch { /* silent; falls back to sourceViewer.text */ }
        })();
        return () => { alive = false; };
    }, [sourceViewer?.chunk_id]);

    const allPrompts = [...SEED_GRID_PROMPTS, ...customPrompts];
    const activePrompts = allPrompts.filter(p => promptIds.includes(p.id));

    // GT-6: lessons from past hardened runs — chronic-offender hints + query rewording.
    const lessons = useMemo(() => localLessonStore.load(), [state]);
    const chronicConflicts = useMemo(() => chronicConflictPrompts(lessons), [lessons]);
    const chronicUnverified = useMemo(() => chronicUnverifiedPrompts(lessons), [lessons]);

    // M2 outliers: per column, salient terms unique to one company's cell.
    const outliersByCell = useMemo(() => {
        const map = new Map<string, string[]>();
        if (!state) return map;
        for (const p of state.def.prompts) {
            if (p.synthesis) continue;
            const texts = state.def.tickers.map(t => state.cells[cellKey(t, p.id)]?.answer || '');
            const dts = distinctiveTerms(texts);
            state.def.tickers.forEach((t, i) => {
                if (dts[i].length) map.set(cellKey(t, p.id), dts[i]);
            });
        }
        return map;
    }, [state]);

    const togglePrompt = (id: string) => {
        setPromptIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
    };

    // NL custom column: the analyst types a question; it becomes a new column.
    // Ensure a {ticker} slot so resolvePrompt can fill the row's company.
    const addColumn = () => {
        const q = newColInput.trim();
        if (!q) return;
        const prompt = /\{ticker\}/.test(q) ? q : `For {ticker}: ${q}`;
        const id = `custom-${Date.now()}`;
        const label = q.length > 24 ? `${q.slice(0, 24)}…` : q;
        setCustomPrompts(prev => [...prev, { id, label, prompt }]);
        setPromptIds(ids => [...ids, id]);
        setNewColInput('');
    };

    const removeColumn = (id: string) => {
        setCustomPrompts(prev => prev.filter(p => p.id !== id));
        setPromptIds(ids => ids.filter(x => x !== id));
    };

    const tickerWarnings = useMemo(() => {
        const tickers = tickersInput.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
        return [...new Set(tickers)]
            .filter(t => !KNOWN_SYMBOLS.has(t))
            .map(t => ({ ticker: t, suggestion: closestSymbol(t) }));
    }, [tickersInput]);

    const fixTicker = (from: string, to: string) => {
        setTickersInput(prev =>
            prev.split(',').map(t => (t.trim().toUpperCase() === from ? to : t.trim())).filter(Boolean).join(', ')
        );
    };

    const startRun = async () => {
        const tickers = tickersInput.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
        if (tickers.length === 0 || activePrompts.length === 0) return;

        const def: GridDef = {
            id: `grid-${Date.now()}`,
            name: `${tickers.length} tickers × ${activePrompts.length} prompts (${selectedModel})`,
            tickers,
            // GT-6 (b): chronically-unverified prompts lead metric-forward so
            // retrieval finds the exact figures that historically went missing.
            prompts: activePrompts.map(p => rewordPromptIfChronic(p, chronicUnverified)),
        };
        // Snapshot the previous run's answers (same ticker×prompt) to flag cells
        // whose figures move on this re-run. Empty on first run / changed grid.
        const prevCells = state?.cells ?? {};
        const initial = initializeGrid(def);
        setState(initial);
        setChangedCells(new Set());
        setRunning(true);
        setRunStats(null);
        const t0 = performance.now();
        const controller = new AbortController();
        abortRef.current = controller;

        const deps: CellRunnerDeps = {
            callLLM: (prompt, signal) => callLLMProxy(prompt, selectedModel, signal),
            searchGravity: searchGravityCell,
            searchWeb: searchWebCell,
            tools: CELL_TOOLS,
            onStep: (t, p, label) => setCellStep(cellKey(t, p), label),
        };

        try {
            const final = await runGrid(initial, deps, {
                // Free Gemini key (~15 req/min) must stay serial or it 429s on
                // most cells. Paid DeepSeek/Claude handle parallel fan-out, so
                // run the grid concurrently for them (huge wall-time win).
                concurrency: selectedModel === 'gemini' ? 1 : 6,
                signal: controller.signal,
                onCellUpdate: (s, cell) => {
                    setState({ ...s });
                    setCellStep(cellKey(cell.ticker, cell.promptId), null);
                    if (cell.status === 'done' && cell.answer) {
                        const prev = prevCells[cellKey(cell.ticker, cell.promptId)];
                        if (prev?.answer && figuresChanged(prev.answer, cell.answer)) {
                            setChangedCells(prevSet => new Set(prevSet).add(cellKey(cell.ticker, cell.promptId)));
                        }
                    }
                },
            });
            setState(final);
            // P4-b: record actual throughput. per100S extrapolates this run's
            // cells/sec to 100 cells (the SLA unit), so a small run still reports
            // a comparable /100 figure.
            const wallS = (performance.now() - t0) / 1000;
            const doneCount = Object.values(final.cells).filter(c => c.status === 'done').length;
            if (doneCount > 0) {
                const per100S = (wallS / doneCount) * 100;
                setRunStats({ cells: doneCount, wallS: Math.round(wallS), per100S: Math.round(per100S) });
                console.log(`[grid throughput] ${doneCount} cells in ${wallS.toFixed(1)}s → ${per100S.toFixed(0)}s/100 (model=${selectedModel}, conc=${selectedModel === 'gemini' ? 1 : 6})`);
            }
            // Success micro-interaction: cyan/gold particle burst (spec §11.4)
            const anyDone = Object.values(final.cells).some(c => c.status === 'done');
            if (anyDone && !controller.signal.aborted) {
                setBurst(true);
                setTimeout(() => setBurst(false), 1000);
            }
            // Best-effort persist — non-blocking. Refresh history on success.
            saveGridRun(final).then(() => refreshHistory()).catch(() => { /* ignore */ });
        } finally {
            abortRef.current = null;
            setRunning(false);
        }
    };

    const reRunCell = async (ticker: string, promptId: string, customPrompt?: string) => {
        if (!state) return;
        const prompt = state.def.prompts.find(p => p.id === promptId);
        if (!prompt) return;

        setState(s => s ? updateCell(s, ticker, promptId, { status: 'running' }) : s);

        const deps: CellRunnerDeps = {
            callLLM: (p, signal) => callLLMProxy(p, selectedModel, signal),
            searchGravity: searchGravityCell,
            searchWeb: searchWebCell,
            tools: CELL_TOOLS,
            onStep: (t, p, label) => setCellStep(cellKey(t, p), label),
        };

        try {
            // If custom prompt provided, create a modified def with the custom prompt
            let def = state.def;
            if (customPrompt) {
                def = {
                    ...state.def,
                    prompts: state.def.prompts.map(p =>
                        p.id === promptId ? { ...p, prompt: customPrompt } : p
                    ),
                };
            }
            const cell = await runGridCell(def, ticker, promptId, deps, undefined, state);
            setState(s => s ? updateCell(s, ticker, promptId, cell) : s);
            setCellStep(cellKey(ticker, promptId), null);
            setEditingCell(null);
        } catch (e: any) {
            setState(s => s ? updateCell(s, ticker, promptId, {
                status: 'error',
                error: e?.message ?? 'Unknown error',
            }) : s);
        }
    };

    const stampedName = (ext: string) =>
        `grid-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${ext}`;

    // GT-8: every export carries verification status — score before exporting.
    const handleExportCSV = () => {
        if (!state) return;
        const blob = new Blob([toCSV(withTrust(state))], { type: 'text/csv;charset=utf-8' });
        downloadBlob(blob, stampedName('csv'));
        recordExport('csv', { bytes: blob.size, destination: stampedName('csv') });
    };

    const handleExportXLSX = async () => {
        if (!state) return;
        const blob = await exportGridToXLSX(withTrust(state));
        downloadBlob(blob, stampedName('xlsx'));
        recordExport('xlsx', { bytes: blob.size, destination: stampedName('xlsx') });
    };

    const handleExportMemo = () => {
        if (!state) return;
        const blob = new Blob([buildMemo(withTrust(state), outliersByCell)], { type: 'text/markdown;charset=utf-8' });
        downloadBlob(blob, stampedName('md'));
        recordExport('memo', { bytes: blob.size, destination: stampedName('md') });
    };

    const handleShare = async () => {
        if (!state) return;
        const link = buildShareLink(state);
        if (!link) {
            setShareMsg('Grid too large to share by link — use Excel export');
            setTimeout(() => setShareMsg(null), 3500);
            return;
        }
        await navigator.clipboard.writeText(link);
        recordExport('share_link', { bytes: link.length });
        setShareMsg('Share link copied');
        setTimeout(() => setShareMsg(null), 2000);
    };

    const handleLoadHistory = async (id: string) => {
        setHistoryOpen(false);
        const loaded = await loadGridRun(id);
        if (loaded) {
            setState(loaded);
            setTickersInput(loaded.def.tickers.join(', '));
            setPromptIds(loaded.def.prompts.map(p => p.id));
            setCustomPrompts(customFromDef(loaded.def));
        }
    };

    const handleDeleteHistory = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        await deleteGridRun(id);
        await refreshHistory();
    };

    // GT-4: continuation hardening — verification rounds over the CURRENT run
    // state (round 1 is never re-run). Same abort + store plumbing as startRun.
    const hardenRun = async () => {
        if (!state || running) return;
        setRunning(true);
        const controller = new AbortController();
        abortRef.current = controller;
        const deps: CellRunnerDeps = {
            callLLM: (prompt, signal) => callLLMProxy(prompt, selectedModel, signal),
            searchGravity: searchGravityCell,
            searchWeb: searchWebCell,
            tools: CELL_TOOLS,
            onStep: (t, p, label) => setCellStep(cellKey(t, p), label),
        };
        try {
            const final = await runGridRounds(state.def, deps, {
                maxRounds: 3,
                resumeState: state,
                signal: controller.signal,
                onCellUpdate: (s, cell) => {
                    setState({ ...s });
                    setCellStep(cellKey(cell.ticker, cell.promptId), null);
                },
            });
            setState(final);
            recordLessons(final); // GT-6: learn from every hardened run
            saveGridRun(final).then(() => refreshHistory()).catch(() => { /* ignore */ });
        } finally {
            abortRef.current = null;
            setRunning(false);
        }
    };

    // Lazy trust over the current run (row 11: old runs without trust never
    // throw — score on render). Synthesis cells are never graded.
    const trustSummary = useMemo(() => {
        if (!state) return null;
        let belowB = 0, rerunnable = 0, contradictions = 0, maxRounds = 1;
        for (const c of Object.values(state.cells)) {
            if (c.ticker === 'ALL' || c.status !== 'done') continue;
            const t = c.trust ?? scoreCellTrust(c);
            if (t.grade !== 'A' && t.grade !== 'B') belowB += 1;
            if (needsRerun(t)) rerunnable += 1;
            if (c.contradictions?.length) contradictions += 1;
            if ((c.rounds ?? 1) > maxRounds) maxRounds = c.rounds ?? 1;
        }
        return { belowB, rerunnable, contradictions, maxRounds };
    }, [state]);

    const cancelRun = () => {
        abortRef.current?.abort();
        if (state) {
            let next = state;
            for (const [k, c] of Object.entries(state.cells)) {
                if (c.status === 'pending' || c.status === 'running') {
                    next = updateCell(next, c.ticker, c.promptId, { status: 'cancelled' });
                }
                void k;
            }
            setState({ ...next });
        }
    };

    const progress = state
        ? {
            done: Object.values(state.cells).filter(c => c.status === 'done').length,
            failed: Object.values(state.cells).filter(c => c.status === 'error').length,
            cancelled: Object.values(state.cells).filter(c => c.status === 'cancelled').length,
            total: Object.values(state.cells).length,
        }
        : null;

    // Sort tickers based on current sort setting
    const getSortedTickers = () => {
        if (!state || !sortBy) return state?.def.tickers ?? [];

        const tickers = [...state.def.tickers];
        const collator = new Intl.Collator();

        if (sortBy === 'ticker') {
            tickers.sort((a, b) => collator.compare(a, b));
        } else if (sortBy === 'status' || sortBy === 'duration') {
            tickers.sort((a, b) => {
                let aVal: any = null;
                let bVal: any = null;

                // Get first non-synthesis prompt
                const firstPrompt = state.def.prompts.find(p => !p.synthesis);
                if (!firstPrompt) return 0;

                const aCell = state.cells[cellKey(a, firstPrompt.id)];
                const bCell = state.cells[cellKey(b, firstPrompt.id)];

                if (sortBy === 'status') {
                    const statusOrder = { done: 0, error: 1, running: 2, pending: 3, cancelled: 4 };
                    aVal = statusOrder[aCell?.status as keyof typeof statusOrder] ?? 5;
                    bVal = statusOrder[bCell?.status as keyof typeof statusOrder] ?? 5;
                } else if (sortBy === 'duration') {
                    aVal = aCell?.durationMs ?? 0;
                    bVal = bCell?.durationMs ?? 0;
                }

                return sortDesc ? bVal - aVal : aVal - bVal;
            });
        }

        return sortDesc && sortBy !== 'status' ? tickers.reverse() : tickers;
    };

    const sortedTickers = getSortedTickers();

    // Filter tickers based on search query
    const getFilteredTickers = () => {
        if (!searchQuery.trim() || !state) return sortedTickers;

        const query = searchQuery.toLowerCase();
        return sortedTickers.filter(ticker => {
            // Match ticker name
            if (ticker.toLowerCase().includes(query)) return true;

            // Match any cell content
            for (const prompt of state.def.prompts) {
                const cell = state.cells[cellKey(ticker, prompt.id)];
                if (cell?.answer && cell.answer.toLowerCase().includes(query)) {
                    return true;
                }
            }
            return false;
        });
    };

    const filteredTickers = getFilteredTickers();

    return (
        <div className="relative overflow-hidden p-6 bg-gradient-to-b from-[#0b0c12] via-[#0f0f1a] to-[#0b0c12] text-[color:var(--text-2)] min-h-screen" style={{
            '--scrollbar-track': '#1a1a2e',
            '--scrollbar-thumb': '#d4af37',
        } as React.CSSProperties}>
            <style>{`
                .scrollbar-thin::-webkit-scrollbar {
                    height: 8px;
                    width: 8px;
                }
                .scrollbar-thin::-webkit-scrollbar-track {
                    background: #1a1a2e;
                }
                .scrollbar-thin::-webkit-scrollbar-thumb {
                    background: #d4af37;
                    border-radius: 4px;
                }
                .scrollbar-thin::-webkit-scrollbar-thumb:hover {
                    background: #ffed4e;
                }
                /* Research Grid design spec — neon glow + module utilities */
                .glow-cyan {
                    box-shadow: 0 0 8px #00f0ff, 0 0 20px rgba(0, 240, 255, 0.3);
                }
                .glow-cyan-strong {
                    box-shadow: 0 0 16px #00f0ff, 0 0 50px rgba(0, 240, 255, 0.5);
                }
                .glow-cyan-bottom {
                    box-shadow: 0 6px 18px -4px rgba(0, 240, 255, 0.45), 0 0 30px rgba(0, 240, 255, 0.12), inset 1px 1px 0 0 rgba(255, 255, 255, 0.06);
                }
                .glow-gold {
                    box-shadow: 0 0 6px #f4c95f;
                }
                .metallic-header {
                    background: linear-gradient(to bottom, #3a2f1f, #2a2418);
                }
                .card-module {
                    background: #0f1118;
                    border: 1px solid rgba(0, 240, 255, 0.1);
                    border-radius: 10px;
                    transition: all 0.2s ease;
                }
                .card-module:hover {
                    border-color: rgba(0, 240, 255, 0.4);
                }
                /* Faint noise texture overlay for expensive terminal feel (spec §11.1) */
                .noise-overlay {
                    position: absolute;
                    inset: 0;
                    pointer-events: none;
                    opacity: 0.03;
                    z-index: 0;
                    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
                }
                @media (prefers-reduced-motion: reduce) {
                    .glow-cyan, .glow-cyan-strong { transition: none; }
                }
            `}</style>
            <div className="noise-overlay" aria-hidden />
            <div className="relative z-10 max-w-[1600px] mx-auto">
                {/* Header */}
                <div className="flex items-center gap-4 mb-8">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-gradient-to-br from-[#d4af37] to-[#aa8c2c] shadow-lg shadow-[#d4af37]/40">
                        <GridIcon className="w-5 h-5 text-[#0a0a0a]" />
                    </div>
                    <div>
                        <motion.h1
                            animate={{
                                textShadow: [
                                    '0 0 8px rgba(244, 201, 95, 0.4)',
                                    '0 0 18px rgba(244, 201, 95, 0.7)',
                                    '0 0 8px rgba(244, 201, 95, 0.4)',
                                ],
                            }}
                            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                            className="font-display font-bold text-3xl text-[#d4af37] tracking-tight"
                        >
                            Research Grid
                        </motion.h1>
                        <p className="text-xs font-bold text-[#00d9ff] mt-1 uppercase tracking-widest">Tickers × Prompts · One Cited Answer Per Cell</p>
                    </div>
                </div>

                {/* Config */}
                <div className="mt-8 p-6 rounded-2xl bg-gradient-to-b from-[#1a1c24]/80 to-[#0f1118]/80 border border-[#d4af37]/30 glow-cyan-bottom backdrop-blur-md">
                    <label className="text-xs font-bold text-[#d4af37] block mb-2 uppercase tracking-wider">Tickers (comma-separated)</label>
                    <input
                        type="text"
                        value={tickersInput}
                        onChange={e => setTickersInput(e.target.value)}
                        placeholder="NVDA, AAPL, MSFT"
                        disabled={running}
                        className="w-full px-4 py-2.5 rounded-md text-sm bg-[#0a0a0a] border border-[#d4af37]/30 text-[#00d9ff] placeholder:text-[#666] focus:outline-none focus:ring-2 focus:ring-[#d4af37]/50 focus:border-[#d4af37] disabled:opacity-40 transition-all"
                    />
                    {tickerWarnings.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                            {tickerWarnings.map(w => (
                                <span key={w.ticker} className="inline-flex items-center gap-1.5 text-xs text-amber-400">
                                    <AlertCircle className="w-3.5 h-3.5" />
                                    {w.ticker} is not in the S&amp;P 500
                                    {w.suggestion && (
                                        <button
                                            onClick={() => fixTicker(w.ticker, w.suggestion!)}
                                            disabled={running}
                                            className="font-bold text-[#00f0ff] hover:underline cursor-pointer disabled:opacity-40"
                                        >
                                            Did you mean {w.suggestion}?
                                        </button>
                                    )}
                                </span>
                            ))}
                        </div>
                    )}

                    <label className="text-xs font-bold text-[#d4af37] block mt-4 mb-3 uppercase tracking-wider">LLM Model</label>
                    <div className="flex gap-2 mb-6">
                        {([
                            { key: 'deepseek', name: 'DeepSeek', cost: '$' },
                            { key: 'claude', name: 'Claude', cost: '$$' },
                            { key: 'gemini', name: 'Gemini', cost: 'Free' },
                        ] as const).map(({ key, name, cost }) => (
                            <motion.button
                                key={key}
                                onClick={() => setSelectedModel(key)}
                                disabled={running}
                                whileHover={{ scale: running ? 1 : 1.03 }}
                                whileTap={{ scale: running ? 1 : 0.98 }}
                                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                                className={`px-4 py-2 rounded-full text-xs font-bold border uppercase tracking-wider ${
                                    selectedModel === key
                                        ? 'border-[#00f0ff] text-white bg-[#00f0ff]/20 glow-cyan'
                                        : 'border-[#d4af37]/40 text-[#a0a8b8] hover:text-[#d4af37] hover:border-[#d4af37]/60'
                                } disabled:opacity-40 cursor-pointer`}
                            >
                                {name} <span className="opacity-70">({cost})</span>
                            </motion.button>
                        ))}
                    </div>

                    <label className="text-xs font-bold text-[#d4af37] block mt-4 mb-3 uppercase tracking-wider">Analyst Prompts</label>
                    <div className="flex flex-wrap gap-2 mb-3">
                        {allPrompts.map(p => {
                            const active = promptIds.includes(p.id);
                            const isCustom = p.id.startsWith('custom-');
                            return (
                                <motion.button
                                    key={p.id}
                                    onClick={() => togglePrompt(p.id)}
                                    disabled={running}
                                    whileHover={{ scale: running ? 1 : 1.03 }}
                                    whileTap={{ scale: running ? 1 : 0.98 }}
                                    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                                    className={`group px-4 py-2 rounded-full text-xs font-bold border uppercase tracking-wider inline-flex items-center gap-1.5 ${active
                                        ? 'border-[#00f0ff] text-white bg-[#00f0ff]/20 glow-cyan'
                                        : 'border-[#d4af37]/40 text-[#a0a8b8] hover:text-[#d4af37] hover:border-[#d4af37]/60'
                                        } disabled:opacity-40 cursor-pointer`}
                                >
                                    {p.label}
                                    {chronicConflicts.has(p.id) && (
                                        <span title="Chronic offender: this prompt's figures conflicted in >30% of past hardened cells" className="text-amber-400">⚠</span>
                                    )}
                                    {isCustom && (
                                        <X
                                            className="w-3 h-3 opacity-50 hover:opacity-100"
                                            onClick={(e) => { e.stopPropagation(); removeColumn(p.id); }}
                                        />
                                    )}
                                </motion.button>
                            );
                        })}
                    </div>
                    {/* NL custom column — type a question, get a column */}
                    <div className="flex items-center gap-2 mb-6">
                        <input
                            value={newColInput}
                            onChange={(e) => setNewColInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') addColumn(); }}
                            disabled={running}
                            placeholder='+ Add a custom column — e.g. "pricing power evidence" or "exposure to China"'
                            className="flex-1 px-4 py-2 rounded-full text-xs bg-[#0a0a0a] border border-[#d4af37]/30 text-[#e8e8f0] placeholder-[#5a6070] focus:border-[#00f0ff]/60 focus:outline-none disabled:opacity-40"
                        />
                        <button
                            onClick={addColumn}
                            disabled={running || !newColInput.trim()}
                            className="px-4 py-2 rounded-full text-xs font-bold border border-[#00f0ff]/50 text-[#00f0ff] hover:bg-[#00f0ff]/10 disabled:opacity-40 cursor-pointer uppercase tracking-wider"
                        >
                            Add
                        </button>
                    </div>

                    <div className="flex items-center gap-3">
                        {!running ? (
                            <motion.button
                                onClick={startRun}
                                disabled={!tickersInput.trim() || activePrompts.length === 0}
                                whileHover={{ scale: 1.03 }}
                                whileTap={{ scale: 0.97 }}
                                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                                className="flex items-center gap-2 px-8 py-3 rounded-xl text-sm font-bold bg-[#00f0ff] text-[#0a0a0a] glow-cyan disabled:opacity-40 disabled:shadow-none uppercase tracking-wider"
                            >
                                <Play className="w-4 h-4" />
                                Run Grid
                            </motion.button>
                        ) : (
                            <motion.button
                                onClick={cancelRun}
                                animate={{
                                    boxShadow: [
                                        '0 0 12px rgba(0,240,255,0.4), 0 0 40px rgba(0,240,255,0.25)',
                                        '0 0 22px rgba(0,240,255,0.6), 0 0 70px rgba(0,240,255,0.4)',
                                        '0 0 12px rgba(0,240,255,0.4), 0 0 40px rgba(0,240,255,0.25)',
                                    ],
                                }}
                                transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                                className="flex items-center gap-2 px-8 py-3 rounded-xl text-sm font-bold text-[#00f0ff] border-2 border-[#00f0ff]/70 bg-[#00f0ff]/5 hover:bg-[#ff4444]/15 hover:text-[#ff4444] hover:border-[#ff4444] active:scale-95 transition-colors uppercase tracking-wider"
                            >
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Processing… <span className="opacity-60">/ Cancel</span>
                            </motion.button>
                        )}
                        {progress && (
                            <span className="relative text-xs font-bold text-[#00f0ff] uppercase tracking-wider">
                                <AnimatedCount value={progress.done} />/{progress.total} DONE
                                {progress.failed > 0 && <span className="text-[#ff4444]"> · {progress.failed} FAILED</span>}
                                {progress.cancelled > 0 && <span className="text-[#888]"> · {progress.cancelled} CANCELLED</span>}
                                {trustSummary && trustSummary.maxRounds > 1 && (
                                    <span title={`Verification rounds ran (max ${trustSummary.maxRounds} rounds on a cell)`} className="text-[#00ff9d]"> · ⛨ HARDENED R{trustSummary.maxRounds}</span>
                                )}
                                {trustSummary && trustSummary.contradictions > 0 && (
                                    <span title="Cells where verification found a conflicting figure" className="text-[#ff4444]"> · ⚠ {trustSummary.contradictions} CONFLICT{trustSummary.contradictions > 1 ? 'S' : ''}</span>
                                )}
                                <ParticleBurst show={burst} />
                            </span>
                        )}

                        <div className="flex-1" />

                        {runStats && !running && (
                            <span
                                title={`${runStats.cells} cells in ${runStats.wallS}s · extrapolated to 100 cells`}
                                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-sm text-xs font-mono ${runStats.per100S <= 60 ? 'text-[color:var(--up)]' : 'text-[color:var(--text-3)]'}`}
                            >
                                <Clock className="w-3 h-3" />
                                {runStats.per100S}s/100
                            </span>
                        )}

                        {state && !running && progress && progress.done > 0 && trustSummary && trustSummary.belowB > 0 && (
                            <button
                                onClick={hardenRun}
                                title={`${trustSummary.belowB} cell(s) below grade B — ${trustSummary.rerunnable} will be adversarially re-verified (grade D/F only)`}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-[#0a0a0a] bg-[#00ff9d] hover:shadow-md hover:shadow-[#00ff9d]/40 active:scale-95 transition-all uppercase tracking-wider"
                            >
                                <Check className="w-3.5 h-3.5" />
                                Harden
                            </button>
                        )}

                        {state && !running && progress && progress.done > 0 && (
                            <>
                                <button
                                    onClick={handleExportCSV}
                                    title="Export CSV"
                                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-[color:var(--text-2)] border border-[color:var(--line)] hover:text-[color:var(--text)] hover:border-[color:var(--text-2)] hover:shadow-sm hover:bg-[color:var(--surface-2)] transition-all"
                                >
                                    <Download className="w-3.5 h-3.5" />
                                    CSV
                                </button>
                                <button
                                    onClick={handleExportXLSX}
                                    title="Export Excel (formatted, with Sources sheet)"
                                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-[color:var(--accent-ink)] bg-gradient-to-br from-[color:var(--accent)] to-[color:color-mix(in_oklch,var(--accent)_80%,black)] hover:shadow-md hover:shadow-[color:color-mix(in_oklch,var(--accent)_30%,transparent)] active:scale-95 transition-all"
                                >
                                    <Download className="w-3.5 h-3.5" />
                                    Excel
                                </button>
                                <button
                                    onClick={handleExportMemo}
                                    title="Export a formatted research memo (Markdown, with sources + outliers)"
                                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-[color:var(--text-2)] border border-[color:var(--line)] hover:text-[color:var(--text)] hover:border-[color:var(--text-2)] hover:shadow-sm hover:bg-[color:var(--surface-2)] transition-all"
                                >
                                    <Download className="w-3.5 h-3.5" />
                                    Memo
                                </button>
                                <button
                                    onClick={handleShare}
                                    title="Copy a shareable link to this grid"
                                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-[color:var(--text-2)] border border-[color:var(--line)] hover:text-[color:var(--text)] hover:border-[color:var(--text-2)] hover:shadow-sm hover:bg-[color:var(--surface-2)] transition-all"
                                >
                                    <Share2 className="w-3.5 h-3.5" />
                                    {shareMsg ?? 'Share'}
                                </button>
                            </>
                        )}

                        {history.length > 0 && (
                            <div className="relative">
                                <button
                                    onClick={() => setHistoryOpen(o => !o)}
                                    title="Recent runs"
                                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-[color:var(--text-2)] border border-[color:var(--line)] hover:text-[color:var(--text)] hover:border-[color:var(--text-2)] hover:shadow-sm hover:bg-[color:var(--surface-2)] transition-all"
                                >
                                    <Clock className="w-3.5 h-3.5" />
                                    History ({history.length})
                                </button>
                                {historyOpen && (
                                    <>
                                        <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setHistoryOpen(false)} />
                                        <div className="fixed inset-y-0 right-0 w-[400px] max-w-full z-50 flex flex-col" style={{ background: 'var(--bg)', borderLeft: '1px solid rgba(255,255,255,0.08)' }}>
                                            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
                                                <div className="flex items-center gap-2">
                                                    <span className="w-5 h-5 rounded-full bg-[var(--accent)]/20 text-[var(--accent)] text-[10px] font-bold flex items-center justify-center">
                                                        {history.length}
                                                    </span>
                                                    <span className="text-xs font-semibold text-white">History</span>
                                                </div>
                                                <button onClick={() => setHistoryOpen(false)} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
                                                    <X className="w-4 h-4 text-[var(--text-2)]" />
                                                </button>
                                            </div>
                                            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
                                                {history.map(row => {
                                                    const cells = Object.values(row.cells ?? {});
                                                    const rag = cells.some(c => c.ragUsed);
                                                    const preview = cells.find(c => c.answer)?.answer;
                                                    // GT-5 row 11: derived lazily; legacy rows without trust never throw.
                                                    const grades = gradeDistribution(row.cells ?? {});
                                                    return (
                                                        <div
                                                            key={row.id}
                                                            onClick={() => handleLoadHistory(row.id)}
                                                            className="group flex items-start gap-2 rounded-lg bg-white/[0.03] border border-white/[0.06] p-3 cursor-pointer hover:bg-white/[0.05] hover:border-white/[0.12] transition-colors"
                                                        >
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-2 mb-1.5">
                                                                    <span className="text-xs font-semibold text-white truncate">{row.name}</span>
                                                                    {rag && (
                                                                        <span className="shrink-0 px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] text-[9px] uppercase tracking-wider">
                                                                            RAG
                                                                        </span>
                                                                    )}
                                                                    {grades && (
                                                                        <span title="Trust grade distribution (lazily scored)" className="shrink-0 px-1.5 py-0.5 rounded bg-white/[0.06] text-[var(--text-2)] text-[9px] font-mono">
                                                                            {grades}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                {preview && (
                                                                    <p className="text-xs leading-relaxed text-[var(--text-2)] line-clamp-2">
                                                                        {preview.replace(/[*#`]/g, '')}
                                                                    </p>
                                                                )}
                                                                <p className="text-[10px] text-[var(--text-3)] mt-1.5">
                                                                    {new Date(row.created_at).toLocaleString()}
                                                                </p>
                                                            </div>
                                                            <button
                                                                onClick={(e) => handleDeleteHistory(row.id, e)}
                                                                title="Delete"
                                                                className="p-1.5 rounded-lg text-[var(--text-3)] opacity-0 group-hover:opacity-100 hover:bg-white/10 hover:text-[color:var(--down)] transition-all"
                                                            >
                                                                <Trash2 className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Search */}
                {state && (
                    <div className="mt-6 flex items-center gap-2.5">
                        <div className="relative flex-1">
                            <motion.input
                                ref={searchInputRef}
                                type="text"
                                placeholder="Search cells by ticker or content..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                whileFocus={{ boxShadow: '0 0 0 1px #00f0ff, 0 0 20px rgba(0, 240, 255, 0.25)' }}
                                className="w-full px-4 py-2.5 pr-16 rounded-xl text-sm bg-[#111218] border border-white/10 text-[#e8e8f0] placeholder:text-[#666] focus:outline-none focus:border-[#00f0ff]/60 transition-colors"
                            />
                            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-mono text-[#a0a8b8] border border-white/10 bg-[#0a0b10] pointer-events-none">
                                ⌘K
                            </kbd>
                        </div>
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="px-3 py-2 rounded-lg text-xs font-medium text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface-2)] transition-all"
                            >
                                Clear
                            </button>
                        )}
                        {filteredTickers.length !== sortedTickers.length && (
                            <span className="text-xs font-semibold text-[color:var(--text-3)] px-3 py-2 rounded-lg bg-[color:var(--surface)]">
                                {filteredTickers.length} / {sortedTickers.length}
                            </span>
                        )}
                    </div>
                )}

                {/* Grid */}
                {state && (
                    <div className="mt-6 rounded-lg border border-[#d4af37]/30 overflow-hidden shadow-2xl shadow-[#d4af37]/20 bg-[#0a0a0a]">
                        <div className="overflow-x-hidden">
                            <table className="w-full table-fixed text-xs border-collapse">
                                <colgroup>
                                    {/* Fixed narrow TICKER column; all prompt columns split the remaining width equally so the whole table fits without horizontal scroll / zoom-out */}
                                    <col style={{ width: '72px' }} />
                                    {state.def.prompts.map(p => (
                                        <col key={p.id} />
                                    ))}
                                </colgroup>
                                <thead className="sticky top-0 z-20">
                                    <tr className="bg-gradient-to-r from-[#2d2416]/80 via-[#3d3420]/80 to-[#2d2416]/80 border-b-2 border-[#d4af37]/40">
                                        <th
                                            onClick={() => {
                                                if (sortBy === 'ticker') {
                                                    setSortDesc(!sortDesc);
                                                } else {
                                                    setSortBy('ticker');
                                                    setSortDesc(false);
                                                }
                                            }}
                                            className="sticky left-0 z-30 px-2 py-3 text-left font-bold text-[10px] text-[#d4af37] bg-[#2d2416]/90 cursor-pointer hover:text-[#ffed4e] transition-colors uppercase tracking-wider"
                                        >
                                            <div className="flex items-center gap-1.5">
                                                TICKER
                                                {sortBy === 'ticker' && (
                                                    <span className="text-xs">{sortDesc ? '↓' : '↑'}</span>
                                                )}
                                            </div>
                                        </th>
                                        {state.def.prompts.map(p => (
                                            <th
                                                key={p.id}
                                                className={`px-2 py-3 text-left font-bold text-[10px] cursor-pointer transition-colors uppercase tracking-wider break-words ${
                                                    p.synthesis
                                                        ? 'bg-[#1a1a1a] text-[#00d9ff] hover:bg-[#00d9ff]/10'
                                                        : 'bg-[#2d2416]/80 text-[#d4af37] hover:text-[#ffed4e]'
                                                }`}
                                            >
                                                {p.label}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[color:var(--line)]">
                                    {filteredTickers.length === 0 ? (
                                        <tr>
                                            <td colSpan={state.def.prompts.length + 1} className="px-3 py-6 text-center text-xs text-[color:var(--text-3)]">
                                                No cells match your search
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredTickers.map((ticker, idx) => (
                                        <motion.tr
                                            key={ticker}
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: Math.min(idx * 0.03, 0.4), type: 'spring', stiffness: 120, damping: 18 }}
                                            className={`transition-colors border-b border-[#333] hover:shadow-[inset_3px_0_0_0_#00f0ff] ${
                                                idx % 2 === 0
                                                    ? 'bg-[#0a0a0a]'
                                                    : 'bg-[#111111]'
                                            } hover:bg-[#1a1a2e]/60`}
                                        >
                                            <td className="sticky left-0 z-10 px-2 py-3 font-mono font-bold text-xs text-[#00d9ff] border-r border-[#d4af37]/30 bg-inherit whitespace-nowrap">
                                                {ticker}
                                            </td>
                                            {state.def.prompts.map(p => {
                                                // Comparison column stays empty in per-ticker rows —
                                                // aggregate answer renders as a glowing card in the bottom row (spec §6.2).
                                                if (p.synthesis) {
                                                    return (
                                                        <td key={p.id} className="px-2 py-3 align-middle border-r border-[#333] text-center">
                                                            <span className="text-[#2a2a3a] text-xs">·</span>
                                                        </td>
                                                    );
                                                }
                                                const cell = state.cells[cellKey(ticker, p.id)];
                                                const isCopied = copiedCell === `${ticker}::${p.id}`;
                                                const isChanged = changedCells.has(cellKey(ticker, p.id));
                                                const outlierTerms = outliersByCell.get(cellKey(ticker, p.id));
                                                return (
                                                    <td
                                                        key={p.id}
                                                        className={`px-2 py-3 align-top relative group border-r border-[#333] ${
                                                            cell?.status === 'done'
                                                                ? 'cursor-pointer hover:bg-[#1a1a2e]/40'
                                                                : ''
                                                        }`}
                                                        onClick={() => cell?.status === 'done' && setSelectedCell(cell)}
                                                    >
                                                        {isChanged && (
                                                            <span
                                                                title="Figures changed vs your last run"
                                                                className="absolute top-1 right-1 z-10 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-amber-400/20 text-amber-300 border border-amber-400/40"
                                                            >
                                                                Changed
                                                            </span>
                                                        )}
                                                        {outlierTerms && outlierTerms.length > 0 && (
                                                            <span
                                                                title={`Only ${ticker} flags: ${outlierTerms.join(', ')}`}
                                                                className="absolute top-1 left-1 z-10 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-violet-500/25 text-violet-200 border border-violet-400/40"
                                                            >
                                                                ⚡ {outlierTerms[0]}
                                                            </span>
                                                        )}
                                                        <CellContent cell={cell} loading={running} stepLabel={cellSteps[cellKey(ticker, p.id)]} />
                                                        {cell?.status === 'done' && cell?.answer && (
                                                            <button
                                                                onClick={e => {
                                                                    e.stopPropagation();
                                                                    copyCell(ticker, p.id, cell.answer!);
                                                                }}
                                                                className="absolute top-1 right-1 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity bg-[#1a1a2e] border border-[#d4af37]/30 hover:bg-[#d4af37] hover:text-[#0a0a0a]"
                                                                title="Copy to clipboard"
                                                            >
                                                                {isCopied ? (
                                                                    <CheckIcon className="w-3 h-3 text-[#00ff00]" />
                                                                ) : (
                                                                    <Copy className="w-3 h-3 text-[#888]" />
                                                                )}
                                                            </button>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </motion.tr>
                                    )))}
                                    {/* Comparison row — glowing cyan info card sits bottom-right under the Comparison column (spec §6.2) */}
                                    {state.def.prompts.some(p => p.synthesis) && (
                                        <tr className="bg-gradient-to-r from-[#0b0c12] via-[#10131c] to-[#0b0c12] border-t-2 border-[#00f0ff]/40">
                                            <td className="sticky left-0 z-10 px-2 py-4 font-mono font-bold text-[9px] text-[#00f0ff] border-r border-[#d4af37]/30 bg-[#0b0c12] uppercase tracking-wider align-top">
                                                <span className="flex items-center gap-1.5 leading-tight break-words">
                                                    <span className="inline-block w-1.5 h-1.5 shrink-0 rounded-full bg-[#00f0ff] glow-cyan" />
                                                    Comp
                                                </span>
                                            </td>
                                            {state.def.prompts.map(p => {
                                                if (!p.synthesis) {
                                                    // Empty cells across the comparison row.
                                                    return <td key={p.id} className="px-2 py-4 border-r border-[#1a1a22]" />;
                                                }
                                                const cell = state.cells[cellKey('ALL', p.id)];
                                                const ready = cell?.status === 'done';
                                                const answer = cell?.answer ?? '';
                                                return (
                                                    <td key={p.id} className="px-2 py-4 align-top">
                                                        {ready ? (
                                                            <motion.div
                                                                onClick={() => setSelectedCell(cell)}
                                                                whileHover={{ y: -3, boxShadow: '0 0 20px #00f0ff, 0 0 60px rgba(0, 240, 255, 0.55)' }}
                                                                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                                                                className="cursor-pointer rounded-xl border border-[#00f0ff]/70 bg-[#0f1118] glow-cyan-strong p-3 space-y-1.5"
                                                            >
                                                                <span className="inline-block px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#00f0ff]/25 text-[#00f0ff] uppercase tracking-wider">
                                                                    Comparison
                                                                </span>
                                                                <p className="text-[10px] leading-snug text-[#e0e4f0] line-clamp-4 w-full break-words">
                                                                    {answer.slice(0, 180)}{answer.length > 180 ? '…' : ''}
                                                                </p>
                                                                {cell?.durationMs && (
                                                                    <div className="flex items-center gap-1 text-[9px] text-[#666]">
                                                                        <span className="font-bold text-[#888]">{(cell.durationMs / 1000).toFixed(1)}s</span>
                                                                        <span>•</span>
                                                                        <span className="truncate">{cell.modelUsed}</span>
                                                                    </div>
                                                                )}
                                                            </motion.div>
                                                        ) : (
                                                            <CellContent cell={cell} loading={running} stepLabel={cellSteps[cellKey('ALL', p.id)]} />
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {!state && (
                    <div className="mt-10 flex flex-col items-center justify-center py-14 text-center">
                        <div className="w-12 h-12 rounded-sm flex items-center justify-center mb-5 bg-[color:var(--accent)]">
                            <Sparkles className="w-5 h-5 text-[color:var(--accent-ink)]" />
                        </div>
                        <h2 className="font-display text-h4 font-medium text-[color:var(--text)] mb-1">Build your analyst grid</h2>
                        <p className="text-sm text-[color:var(--text-3)] max-w-md">
                            Pick tickers and prompts above, then run the grid to get parallel cited answers for every cell.
                        </p>
                    </div>
                )}
            </div>

            {/* Cell detail modal */}
            {selectedCell && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 backdrop-blur-sm"
                    style={{ background: 'color-mix(in oklch, var(--bg) 88%, transparent)' }}
                    onClick={() => setSelectedCell(null)}
                >
                    <div
                        className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl p-8 bg-[color:var(--surface)] border border-[color:var(--line)] shadow-2xl shadow-[color:color-mix(in_oklch,var(--accent)_15%,transparent)]"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-4 mb-8">
                            <div>
                                <div className="inline-block px-3 py-1.5 mb-3 rounded-lg text-xs font-bold text-[color:var(--accent)] bg-[color:color-mix(in_oklch,var(--accent)_18%,transparent)] border border-[color:color-mix(in_oklch,var(--accent)_35%,transparent)] uppercase tracking-wide">
                                    {selectedCell.ticker}
                                </div>
                                <h2 className="font-display text-3xl font-bold text-[color:var(--text)]">
                                    {allPrompts.find(p => p.id === selectedCell.promptId)?.label}
                                </h2>
                            </div>
                            <button
                                onClick={() => setSelectedCell(null)}
                                className="flex-shrink-0 p-2 rounded-lg text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface-2)] transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        {selectedCell.contradictions && selectedCell.contradictions.length > 0 && (
                            <div className="mb-6 px-4 py-3 rounded-lg bg-[#ff4444]/10 border border-[#ff4444]/30">
                                <p className="text-xs font-bold text-[#ff6666] uppercase tracking-wider mb-2">
                                    ⚠ Verification conflicts — both values shown, neither auto-resolved
                                </p>
                                <ul className="space-y-1 text-xs text-[#ffb0b0] font-mono">
                                    {selectedCell.contradictions.map((c, i) => <li key={i}>{c}</li>)}
                                </ul>
                            </div>
                        )}
                        <div className="mb-6">
                            <CellAnswer
                                text={selectedCell.answer ?? ''}
                                citations={selectedCell.citations ?? []}
                                onOpenCitation={openCitation}
                            />
                        </div>
                        {selectedCell.steps && selectedCell.steps.length > 0 && (() => {
                            const ts = traceSummary(selectedCell.steps!);
                            return (
                                <details className="mb-6 rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3" open>
                                    <summary className="cursor-pointer text-xs font-bold text-[#00d9ff] uppercase tracking-wider">
                                        Tools — called {ts.tools} · {(ts.totalMs / 1000).toFixed(1)}s{ts.failed > 0 ? ` · ${ts.failed} failed` : ''}
                                    </summary>
                                    <ul className="mt-3 space-y-1.5">
                                        {selectedCell.steps!.map((s, i) => (
                                            <li key={i} className="flex items-center gap-2 text-xs font-mono">
                                                <span className={s.status === 'failed' ? 'text-[#ff6666]' : s.status === 'empty' ? 'text-[#888]' : 'text-[#00ff9d]'} title={s.error}>
                                                    {stepGlyph(s.status)}
                                                </span>
                                                <span className="text-[#e8e8f0]">{s.label}</span>
                                                <span className="text-[#666]">({(s.ms / 1000).toFixed(1)}s)</span>
                                                {s.meta && <span className="text-[#666] truncate">— {s.meta}</span>}
                                                {s.error && <span className="text-[#ff6666] truncate">— {s.error}</span>}
                                            </li>
                                        ))}
                                    </ul>
                                </details>
                            );
                        })()}
                        {(() => {
                            // Regular cells: show only sources the answer cites ([N] markers).
                            // Synthesis/comparison cells (ticker 'ALL'): show the full
                            // aggregated evidence base — it's built from the cells, not
                            // inline-cited, so a [N] filter would hide everything.
                            const isSynthesis = selectedCell.ticker === 'ALL';
                            const all = selectedCell.citations ?? [];
                            let shown = all;
                            if (!isSynthesis) {
                                const cited = new Set([...(selectedCell.answer ?? '').matchAll(/\[(\d+)\]/g)].map(m => Number(m[1])));
                                shown = all.filter(c => cited.has(c.id));
                            }
                            return shown.length > 0 && (
                                <CellSources citations={shown} activeId={activeCitation} onOpenSource={setSourceViewer} />
                            );
                        })()}
                        <div className="mt-8 flex items-center justify-between pt-6 border-t-2 border-[color:color-mix(in_oklch,var(--accent)_20%,transparent)]">
                            <div className="flex items-center gap-2.5 text-xs text-[color:var(--text-3)]">
                                <span className="font-bold">{((selectedCell.durationMs ?? 0) / 1000).toFixed(1)}s</span>
                                <span className="opacity-40">•</span>
                                <span className="font-medium">{selectedCell.modelUsed}</span>
                                {selectedCell.ragUsed && (
                                    <>
                                        <span className="opacity-40">•</span>
                                        <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-[color:color-mix(in_oklch,var(--accent)_25%,transparent)] text-[color:var(--accent)] border border-[color:color-mix(in_oklch,var(--accent)_40%,transparent)]">
                                            SEC RAG
                                        </span>
                                    </>
                                )}
                                {selectedCell.status === 'done' && selectedCell.ticker !== 'ALL' && (
                                    <>
                                        <span className="opacity-40">•</span>
                                        <TrustChip trust={selectedCell.trust ?? scoreCellTrust(selectedCell)} />
                                        {(selectedCell.rounds ?? 1) > 1 && (
                                            <span className="text-[10px] font-bold text-[#00ff9d]">R{selectedCell.rounds}</span>
                                        )}
                                    </>
                                )}
                            </div>
                            <button
                                onClick={() => {
                                    const prompt = state?.def.prompts.find(p => p.id === selectedCell.promptId);
                                    if (prompt) {
                                        const resolved = resolvePrompt(prompt, selectedCell.ticker);
                                        setEditPrompt(resolved);
                                        setEditingCell({ ticker: selectedCell.ticker, promptId: selectedCell.promptId });
                                        setSelectedCell(null);
                                    }
                                }}
                                className="px-6 py-3 rounded-lg text-sm font-bold bg-gradient-to-br from-[color:var(--accent)] to-[color:color-mix(in_oklch,var(--accent)_80%,black)] text-[color:var(--accent-ink)] hover:shadow-lg hover:shadow-[color:color-mix(in_oklch,var(--accent)_30%,transparent)] active:scale-95 transition-all uppercase tracking-wide"
                            >
                                Edit & Re-run
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Cell edit modal */}
            {editingCell && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 backdrop-blur-sm"
                    style={{ background: 'color-mix(in oklch, var(--bg) 88%, transparent)' }}
                    onClick={() => setEditingCell(null)}
                >
                    <div
                        className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl p-8 bg-[color:var(--surface)] border border-[color:var(--line)] shadow-2xl shadow-[color:color-mix(in_oklch,var(--accent)_15%,transparent)]"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-4 mb-8">
                            <div>
                                <div className="inline-block px-3 py-1.5 mb-3 rounded-lg text-xs font-bold text-[color:var(--accent)] bg-[color:color-mix(in_oklch,var(--accent)_18%,transparent)] border border-[color:color-mix(in_oklch,var(--accent)_35%,transparent)] uppercase tracking-wide">
                                    {editingCell.ticker}
                                </div>
                                <h2 className="font-display text-3xl font-bold text-[color:var(--text)]">
                                    Edit prompt
                                </h2>
                            </div>
                            <button
                                onClick={() => setEditingCell(null)}
                                className="flex-shrink-0 p-2.5 rounded-lg text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface-2)] transition-colors"
                            >
                                <X className="w-6 h-6" />
                            </button>
                        </div>
                        <div className="mb-8">
                            <label className="block text-xs font-bold text-[color:var(--text)] mb-3 uppercase tracking-wider">
                                Prompt text
                            </label>
                            <textarea
                                value={editPrompt}
                                onChange={e => setEditPrompt(e.target.value)}
                                className="w-full h-56 px-4 py-3 rounded-xl text-sm bg-[color:var(--bg)] border border-[color:var(--line)] text-[color:var(--text)] placeholder:text-[color:var(--text-4)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)] focus:ring-offset-0 focus:border-transparent resize-none font-mono leading-relaxed shadow-sm"
                                placeholder="Enter your custom prompt..."
                            />
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={() => reRunCell(editingCell.ticker, editingCell.promptId, editPrompt)}
                                className="flex-1 px-6 py-3 rounded-lg text-sm font-bold bg-gradient-to-br from-[color:var(--accent)] to-[color:color-mix(in_oklch,var(--accent)_80%,black)] text-[color:var(--accent-ink)] hover:shadow-lg hover:shadow-[color:color-mix(in_oklch,var(--accent)_30%,transparent)] active:scale-95 transition-all uppercase tracking-wide"
                            >
                                Re-run cell
                            </button>
                            <button
                                onClick={() => setEditingCell(null)}
                                className="px-6 py-3 rounded-lg text-sm font-semibold border-2 border-[color:var(--line)] text-[color:var(--text-2)] hover:text-[color:var(--text)] hover:border-[color:var(--text-2)] hover:shadow-sm transition-all"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Source viewer modal */}
            {sourceViewer && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 backdrop-blur-sm"
                    style={{ background: 'color-mix(in oklch, var(--bg) 88%, transparent)' }}
                    onClick={() => setSourceViewer(null)}
                >
                    <div
                        className="w-full max-w-4xl max-h-[85vh] overflow-y-auto rounded-2xl p-8 bg-[color:var(--surface)] border border-[color:var(--line)] shadow-2xl shadow-[color:color-mix(in_oklch,var(--accent)_15%,transparent)]"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-4 mb-6">
                            <div>
                                <div className="inline-block px-3 py-1.5 mb-3 rounded-lg text-xs font-bold text-[color:var(--accent)] bg-[color:color-mix(in_oklch,var(--accent)_18%,transparent)] border border-[color:color-mix(in_oklch,var(--accent)_35%,transparent)] uppercase tracking-wide">
                                    {sourceViewer.documentType || 'Source'}
                                </div>
                                <h2 className="font-display text-2xl font-bold text-[color:var(--text)]">
                                    {sourceViewer.title}
                                </h2>
                                {sourceViewer.date && (
                                    <p className="text-xs text-[color:var(--text-3)] mt-2">{sourceViewer.date}</p>
                                )}
                                {sourceViewer.section && (
                                    <p className="text-xs text-[color:var(--text-3)] mt-1">Section: {sourceViewer.section}</p>
                                )}
                            </div>
                            <button
                                onClick={() => setSourceViewer(null)}
                                className="flex-shrink-0 p-2.5 rounded-lg text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface-2)] transition-colors"
                            >
                                <X className="w-6 h-6" />
                            </button>
                        </div>
                        <div className="prose prose-invert max-w-none text-sm leading-relaxed text-[color:var(--text-2)] bg-[color:var(--bg)] rounded-lg p-4 border border-[color:var(--line)]">
                            {(() => {
                                const full = chunkFullText || sourceViewer.text;
                                const s = sourceViewer.char_offset_start;
                                const e = sourceViewer.char_offset_end;
                                if (chunkFullText && s != null && e != null && s >= 0 && e > s && e <= full.length) {
                                    return (
                                        <p className="whitespace-pre-wrap">
                                            {full.slice(0, s)}
                                            <mark className="bg-[color:color-mix(in_oklch,var(--accent)_30%,transparent)] text-[color:var(--text)] rounded px-0.5">
                                                {full.slice(s, e)}
                                            </mark>
                                            {full.slice(e)}
                                        </p>
                                    );
                                }
                                return <p className="whitespace-pre-wrap">{full}</p>;
                            })()}
                        </div>
                        {/* Resolve to the real filing document (same as Quick Answer),
                            falling back to the citation's own url when there's no ticker. */}
                        {sourceViewer.ticker ? (() => {
                            const fromTitle = parseFilingTitle(sourceViewer.title);
                            // Deliberately NOT sourceViewer.date: for XBRL facts that is
                            // financials.filing_date, which holds the period END
                            // (FY2021 -> 2021-12-31), not the SEC filed date
                            // (2022-02-07). Feeding a period end to the resolver silently
                            // returns the company's LATEST filing instead of the cited one.
                            return (
                                <EdgarLink
                                    ticker={sourceViewer.ticker}
                                    snippet={sourceViewer.text}
                                    filingType={fromTitle.filingType || sourceViewer.documentType || ''}
                                    filingDate={fromTitle.filingDate}
                                    className="inline-flex items-center gap-1.5 mt-4 text-xs font-semibold text-[color:var(--accent)] hover:underline"
                                />
                            );
                        })() : sourceViewer.url && (
                            <a
                                href={safeUrl(sourceViewer.url)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 mt-4 text-xs font-semibold text-[color:var(--accent)] hover:underline"
                            >
                                View on SEC EDGAR
                                <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// GT-4 row 12: grade chip. F/D red, C amber, A/B green, honest-empty cyan
// ("honest" styling, never failure styling). Tooltip lists the earned reasons.
const CHIP_CLASSES: Record<TrustChipProps['tone'], string> = {
    green: 'bg-[#00ff9d]/15 text-[#00ff9d] border border-[#00ff9d]/40',
    honest: 'bg-[#00d9ff]/15 text-[#00d9ff] border border-[#00d9ff]/40',
    amber: 'bg-amber-400/15 text-amber-300 border border-amber-400/40',
    red: 'bg-[#ff4444]/15 text-[#ff6666] border border-[#ff4444]/40',
};

function TrustChip({ trust }: { trust: TrustScore }) {
    const p = chipPropsFor(trust);
    return (
        <span title={p.title} className={`inline-block px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${CHIP_CLASSES[p.tone]}`}>
            {p.label}
        </span>
    );
}

function CellContent({ cell, loading, stepLabel }: { cell?: GridCell; loading?: boolean; stepLabel?: string }) {
    if (!cell || cell.status === 'pending') {
        // During an active run, pending cells render skeletons (spec §11.4)
        return loading ? <SkeletonCard /> : <span className="text-[#444] text-[10px]">—</span>;
    }
    if (cell.status === 'running') {
        return <SkeletonCard active stepLabel={stepLabel} />;
    }
    if (cell.status === 'error') {
        return (
            <div className="flex items-start gap-1 text-[10px] text-[#ff4444]" title={cell.error}>
                <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span className="truncate max-w-[150px]">{cell.error || 'Error'}</span>
            </div>
        );
    }
    if (cell.status === 'cancelled') {
        return <span className="text-[10px] text-[#888]">Cancelled</span>;
    }
    const isNoData = cell.modelUsed === 'no-sources';
    const excerpt = (cell.answer ?? '').slice(0, 120);
    // Row 11: saved runs without trust score lazily on render; synthesis never graded.
    const trust = cell.ticker !== 'ALL' ? (cell.trust ?? scoreCellTrust(cell)) : undefined;

    // Self-contained "module card" per design spec §6.2:
    // faint cyan border, rounded corners, top-left badge, padded body.
    // Framer Motion spring hover lift + glow intensify (spec §10.2).
    return (
        <motion.div
            whileHover={{ y: -3, boxShadow: '0 0 14px #00f0ff, 0 0 35px rgba(0, 240, 255, 0.35)' }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className="card-module p-2.5 space-y-1.5"
        >
            {(isNoData || cell.ragUsed || trust) && (
                <div className="flex items-center gap-1 flex-wrap">
                    {isNoData ? (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#888]/20 text-[#888] uppercase tracking-wider">
                            FLAG
                        </span>
                    ) : cell.ragUsed ? (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#00f0ff]/20 text-[#00f0ff] uppercase tracking-wider">
                            RAG
                        </span>
                    ) : null}
                    {trust && <TrustChip trust={trust} />}
                    {cell.contradictions && cell.contradictions.length > 0 && (
                        <span
                            title={`Verification conflict:\n${cell.contradictions.join('\n')}`}
                            className="inline-block px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#ff4444]/20 text-[#ff6666] border border-[#ff4444]/40 uppercase tracking-wider"
                        >
                            ⚠ conflict
                        </span>
                    )}
                    {(cell.rounds ?? 1) > 1 && (
                        <span title={`${cell.rounds} research rounds`} className="text-[8px] font-bold text-[#00ff9d]">
                            R{cell.rounds}
                        </span>
                    )}
                    {cell.steps && cell.steps.length > 0 && (() => {
                        const ts = traceSummary(cell.steps);
                        return (
                            <span
                                title={cell.steps.map(s => `${stepGlyph(s.status)} ${s.label} (${(s.ms / 1000).toFixed(1)}s)`).join('\n')}
                                className="text-[8px] font-bold text-[#00d9ff]"
                            >
                                ⚡{ts.tools}·{(ts.totalMs / 1000).toFixed(1)}s
                            </span>
                        );
                    })()}
                </div>
            )}
            <p className={`text-[10px] leading-snug line-clamp-3 w-full break-words ${
                isNoData
                    ? 'text-[#a0a8b8] italic'
                    : 'text-[#e0e4f0]'
            }`}>
                {excerpt}{(cell.answer ?? '').length > 120 ? '…' : ''}
            </p>
            {cell.durationMs && (
                <div className="flex items-center gap-1 text-[9px] text-[#666]">
                    <span className="font-bold text-[#888]">{(cell.durationMs / 1000).toFixed(1)}s</span>
                    <span>•</span>
                    <span className="truncate">{cell.modelUsed}</span>
                </div>
            )}
        </motion.div>
    );
}

// Pulsing skeleton card shown while a cell is pending/running during a run (spec §11.4).
function SkeletonCard({ active, stepLabel }: { active?: boolean; stepLabel?: string }) {
    return (
        <motion.div
            animate={{ opacity: [0.45, 0.85, 0.45] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
            className={`card-module p-2.5 space-y-1.5 w-full ${active ? 'glow-cyan' : ''}`}
        >
            <div className="h-2 w-8 rounded bg-[#00f0ff]/20" />
            <div className="h-1.5 w-full rounded bg-white/10" />
            <div className="h-1.5 w-[85%] rounded bg-white/10" />
            <div className="h-1.5 w-[60%] rounded bg-white/10" />
            {/* AC-5 live ticker: the step actually running right now */}
            {active && stepLabel && (
                <div className="text-[9px] font-mono text-[#00d9ff] truncate">{stepLabel}…</div>
            )}
        </motion.div>
    );
}

// DONE counter that springs up to its target value (spec §11.4).
function AnimatedCount({ value }: { value: number }) {
    const mv = useMotionValue(0);
    const rounded = useTransform(mv, v => Math.round(v));
    useEffect(() => {
        const controls = animate(mv, value, { duration: 0.5, ease: 'easeOut' });
        return () => controls.stop();
    }, [value, mv]);
    return <motion.span>{rounded}</motion.span>;
}

// Cyan/gold particle burst on run completion (spec §11.4).
function ParticleBurst({ show }: { show: boolean }) {
    const dots = [
        { dx: -14, dy: -12, c: '#00f0ff' },
        { dx: 16, dy: -10, c: '#f4c95f' },
        { dx: -10, dy: 12, c: '#f4c95f' },
        { dx: 14, dy: 14, c: '#00f0ff' },
    ];
    return (
        <AnimatePresence>
            {show && (
                <span className="absolute left-1/2 top-1/2 pointer-events-none">
                    {dots.map((d, i) => (
                        <motion.span
                            key={i}
                            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                            animate={{ x: d.dx, y: d.dy, opacity: 0, scale: 0.4 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.8, ease: 'easeOut' }}
                            className="absolute w-1.5 h-1.5 rounded-full"
                            style={{ background: d.c, boxShadow: `0 0 6px ${d.c}` }}
                        />
                    ))}
                </span>
            )}
        </AnimatePresence>
    );
}

// ─── World-class answer renderer (mirrors the search "quick answer") ───────────
// Markdown body + inline [N] markers turned into clickable citation chips.

function injectCites(
    children: ReactNode,
    map: Map<number, Citation>,
    onOpen: (id: number) => void,
): ReactNode {
    return Children.map(children, (child) => {
        if (typeof child !== 'string') return child;
        const parts = child.split(/(\[\d+\])/g);
        return parts.map((part, i) => {
            const m = part.match(/^\[(\d+)\]$/);
            if (!m) return part;
            const num = parseInt(m[1], 10);
            if (!map.has(num)) {
                // Unverified: LLM emitted [N] with no matching source. Flag it
                // amber so it can't be mistaken for a real, clickable citation.
                return (
                    <sup key={i} title="Unverified — no source returned for this citation"
                         className="text-amber-400/80 text-[10px] font-bold align-super cursor-help">
                        [{num}?]
                    </sup>
                );
            }
            return (
                <button
                    key={i}
                    onClick={() => onOpen(num)}
                    title={map.get(num)!.title}
                    className="tap-cite mx-0.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-[#00f0ff]/20 text-[#00f0ff] text-[10px] font-bold align-super hover:bg-[#00f0ff]/40 hover:shadow-[0_0_8px_rgba(0,240,255,0.5)] active:scale-95 transition-all"
                >
                    {num}
                </button>
            );
        });
    });
}

function CellAnswer({ text, citations, onOpenCitation }: {
    text: string;
    citations: Citation[];
    onOpenCitation: (id: number) => void;
}) {
    const map = new Map(citations.map(c => [c.id, c]));
    const cite = (children: ReactNode) => injectCites(children, map, onOpenCitation);
    const md = text.trim().replace(/\n{3,}/g, '\n\n');
    const unmapped = findUnmappedCites(text, citations);

    return (
        <div className="text-[#e8e8f0] text-sm leading-7 space-y-3.5 break-words">
            {unmapped.length > 0 && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>{unmapped.length} citation{unmapped.length > 1 ? 's' : ''} ({unmapped.map(n => `[${n}]`).join(', ')}) have no source — treat as unverified.</span>
                </div>
            )}
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    p: ({ children }) => <p className="leading-7">{cite(children)}</p>,
                    strong: ({ children }) => <strong className="font-semibold text-white">{cite(children)}</strong>,
                    em: ({ children }) => <em className="italic text-[#cfd3e0]">{cite(children)}</em>,
                    a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noopener noreferrer"
                           className="text-[#00f0ff] underline decoration-[#00f0ff]/40 hover:decoration-[#00f0ff]">
                            {cite(children)}
                        </a>
                    ),
                    ul: ({ children }) => <ul className="list-disc pl-5 space-y-1.5 marker:text-[#00f0ff]/60">{children}</ul>,
                    ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1.5 marker:text-[#00f0ff]/60">{children}</ol>,
                    li: ({ children }) => <li className="leading-7">{cite(children)}</li>,
                    h1: ({ children }) => <h1 className="font-display text-lg font-bold text-white mt-5 mb-2">{cite(children)}</h1>,
                    h2: ({ children }) => <h2 className="font-display text-base font-bold text-white mt-5 mb-2">{cite(children)}</h2>,
                    h3: ({ children }) => <h3 className="font-display text-sm font-bold text-[#d4af37] mt-4 mb-1.5 uppercase tracking-wide">{cite(children)}</h3>,
                    blockquote: ({ children }) => (
                        <blockquote className="pl-3 border-l-2 border-[#00f0ff]/40 text-[#a0a8b8] italic">{children}</blockquote>
                    ),
                    hr: () => <hr className="border-white/[0.08] my-4" />,
                    code: ({ children }) => (
                        <code className="font-mono text-[12px] bg-white/[0.06] text-[#00f0ff] px-1 py-0.5 rounded">{children}</code>
                    ),
                    pre: ({ children }) => (
                        <pre className="font-mono text-[12px] bg-white/[0.03] border border-white/[0.06] rounded-lg p-3 overflow-x-auto">{children}</pre>
                    ),
                    table: ({ children }) => (
                        <div className="overflow-x-auto rounded-lg border border-white/[0.08] my-3">
                            <table className="w-full text-[12.5px] border-collapse">{children}</table>
                        </div>
                    ),
                    thead: ({ children }) => <thead className="bg-white/[0.04]">{children}</thead>,
                    tr: ({ children }) => <tr className="border-b border-white/[0.06] last:border-0">{children}</tr>,
                    th: ({ children }) => (
                        <th className="px-3 py-2 text-left font-semibold text-[#d4af37] uppercase tracking-wider text-[11px]">{cite(children)}</th>
                    ),
                    td: ({ children }) => <td className="px-3 py-2 text-[#e8e8f0] align-top">{cite(children)}</td>,
                }}
            >
                {md}
            </ReactMarkdown>
        </div>
    );
}

function CellSources({ citations, activeId, onOpenSource }: { citations: Citation[]; activeId: number | null; onOpenSource?: (data: SourceViewerData) => void }) {
    const handleSourceClick = (e: React.MouseEvent, c: Citation) => {
        // Always open the passage modal (never navigate). Real SEC URLs are shown
        // as a "View on EDGAR" link inside the modal; gravity:// is internal-only.
        e.preventDefault();
        const isGravity = c.url?.startsWith('gravity://');
        onOpenSource?.({
            title: c.title,
            text: c.sourceData?.text || 'Source text not available for this run. Re-run the cell to capture passage text.',
            ticker: c.sourceData?.ticker,
            date: c.sourceData?.date,
            documentType: c.sourceData?.documentType,
            section: c.sourceData?.section,
            url: isGravity ? undefined : c.url,
            chunk_id: c.chunk_id,
            char_offset_start: c.char_offset_start,
            char_offset_end: c.char_offset_end,
        });
    };

    return (
        <div className="mt-8 pt-6 border-t border-[#d4af37]/20">
            <h3 className="font-bold text-xs text-[#d4af37] mb-3 uppercase tracking-wider">
                Sources ({citations.length})
            </h3>
            <ul className="space-y-1.5">
                {citations.map(c => {
                    const active = activeId === c.id;
                    // Split "Label: value" so the value reads as an italic quote/figure.
                    const ci = c.title.indexOf(': ');
                    const label = ci >= 0 ? c.title.slice(0, ci) : c.title;
                    const value = ci >= 0 ? c.title.slice(ci + 2) : '';
                    return (
                        <li key={c.id} id={`grid-src-${c.id}`}>
                            <button
                                onClick={(e: React.MouseEvent) => handleSourceClick(e, c)}
                                className={`group block w-full text-left text-xs leading-relaxed cursor-pointer rounded px-1 -mx-1 transition-colors ${
                                    active ? 'bg-[#00f0ff]/10' : 'hover:bg-white/[0.04]'
                                }`}
                            >
                                <sup className="text-[#00f0ff] font-semibold mr-1.5 align-super text-[10px]">[{c.id}]</sup>
                                <span className="text-[#e8e8f0] group-hover:text-white transition-colors">{label}</span>
                                {value && <span className="italic text-[#9aa4b8]">: {value}</span>}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
