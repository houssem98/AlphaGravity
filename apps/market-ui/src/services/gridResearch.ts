// Grid Research — Hebbia Matrix / AlphaSense Generative Grid analogue.
// Rows = tickers or documents. Columns = analyst prompt templates.
// Each cell = one cited answer. Cells run independently, in parallel,
// with per-cell status/error isolation so one failure doesn't tank the grid.
//
// This module owns:
//   • the data model (GridDef, GridState, GridCell)
//   • pure state transitions (initialize, updateCell, allCellIds)
//   • the cell runner signature (runGridCell) — impure but mockable
//
// It does NOT own React rendering or persistence; those live in stores + pages.

import type { Citation, ResearchModelId } from './deepResearchService.js';
import type { TrustScore } from './gridTrust.js';
import { newTrace, type CellStep } from './gridTrace.js';
import { queryGravityRAG, formatRAGSourcesForPrompt, type GravityRAGResult } from './gravitySearchService.js';

// The backend answer ends with a "Sources" footer (rich `[N] label: value`
// lines) that duplicates the source list AND defeats the cited-only filter
// (every [N] appears there). Split it off: return prose-only + the rich labels
// keyed by id, so the UI renders ONE clickable list with the good labels.
// P3.1: the comparison/synthesis row is built FROM the per-ticker cells, so its
// evidence is the union of those cells' citations. Dedupe by title+url, renumber.
export function aggregateCitations(def: GridDef, state: GridState): Citation[] {
    const seen = new Set<string>();
    const out: Citation[] = [];
    for (const p of def.prompts) {
        if (p.synthesis) continue;
        for (const t of def.tickers) {
            for (const c of state.cells[cellKey(t, p.id)]?.citations ?? []) {
                const key = `${c.title || ''}|${c.url || ''}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({ ...c, id: out.length + 1 });
            }
        }
    }
    return out;
}

// M4: render the whole grid as a polished Markdown research memo — the analyst's
// deliverable, done. Sectioned by company, each question with its answer, outlier
// callouts, and real sources. Pure → testable, downloadable as .md.
export function buildMemo(state: GridState, outliers?: Map<string, string[]>): string {
    const { def, cells } = state;
    const out: string[] = [];
    const regular = def.prompts.filter(p => !p.synthesis);
    out.push(`# ${def.name} — Research Memo`);
    out.push(`*Generated ${new Date().toISOString().slice(0, 10)} · ${def.tickers.length} companies × ${regular.length} questions*`);
    out.push('');
    for (const ticker of def.tickers) {
        out.push(`## ${ticker}`);
        for (const p of regular) {
            const cell = cells[cellKey(ticker, p.id)];
            if (!cell?.answer) continue;
            // GT-8: a hardened grid exports its verification status inline.
            const grade = cell.trust ? ` — Trust ${cell.trust.grade}${cell.trust.honest ? ' (honest)' : ''}` : '';
            out.push(`### ${p.label}${grade}`);
            const o = outliers?.get(cellKey(ticker, p.id));
            if (o?.length) out.push(`> ⚡ Unique to ${ticker}: ${o.join(', ')}`);
            if (cell.contradictions?.length) {
                out.push(`> ⚠ CONTRADICTION (unresolved — both values shown): ${cell.contradictions.join('; ')}`);
            }
            out.push(cell.answer.trim());
            if (cell.citations?.length) {
                out.push('');
                out.push('**Sources:**');
                for (const c of cell.citations) {
                    const link = c.url && !c.url.startsWith('gravity://') ? ` — ${c.url}` : '';
                    out.push(`- [${c.id}] ${c.title}${link}`);
                }
            }
            out.push('');
        }
    }
    for (const p of def.prompts.filter(p => p.synthesis)) {
        const cell = cells[cellKey('ALL', p.id)];
        if (cell?.answer) {
            out.push(`## ${p.label}`);
            out.push(cell.answer.trim());
            out.push('');
        }
    }
    // GT-8 Trust section: per-company grades + every unresolved contradiction.
    const graded = def.tickers.some(t => regular.some(p => cells[cellKey(t, p.id)]?.trust));
    if (graded) {
        out.push('## Trust');
        out.push('*A = figures stable across ≥2 verification rounds · B = grounded or honest-empty · C = LLM-only ceiling · D/F = needs re-verification*');
        for (const ticker of def.tickers) {
            const parts = regular
                .map(p => {
                    const c = cells[cellKey(ticker, p.id)];
                    return c?.trust ? `${p.label} ${c.trust.grade}${c.contradictions?.length ? '⚠' : ''}` : null;
                })
                .filter(Boolean);
            if (parts.length) out.push(`- ${ticker}: ${parts.join(', ')}`);
        }
        const conflicts: string[] = [];
        for (const ticker of def.tickers) {
            for (const p of regular) {
                const c = cells[cellKey(ticker, p.id)];
                for (const contra of c?.contradictions ?? []) conflicts.push(`- ${ticker} ${p.label}: ${contra}`);
            }
        }
        if (conflicts.length) {
            out.push('');
            out.push('**⚠ Contradictions (unresolved):**');
            out.push(...conflicts);
        }
        out.push('');
    }
    return out.join('\n');
}

// M2 outlier highlighting: salient risk/event terms. A term that appears in
// exactly ONE cell of a column is "distinctive" — e.g. only one company in the
// grid flags litigation. That's the insight a wall of cells hides.
const SALIENT_TERMS = [
    'litigation', 'lawsuit', 'investigation', 'subpoena', 'antitrust', 'impairment',
    'going concern', 'restructuring', 'recall', 'data breach', 'dilution', 'covenant',
    'default', 'tariff', 'sanction', 'layoff', 'material weakness', 'write-down',
    'guidance cut', 'decline', 'shortage', 'dependence', 'concentration',
];

// For a column's cell texts (in order), return the salient terms UNIQUE to each
// cell within that column (present here, in no sibling). Empty array = not an outlier.
export function distinctiveTerms(texts: string[]): string[][] {
    const lower = texts.map(t => (t || '').toLowerCase());
    return lower.map(text => {
        if (!text) return [];
        return SALIENT_TERMS.filter(term =>
            text.includes(term) && lower.filter(t => t.includes(term)).length === 1
        );
    });
}

// Material-change detection for re-runs (P2.3). LLM phrasing drifts every run,
// so a raw text diff is all false positives. What actually matters is whether the
// NUMBERS moved — new figure = new data = worth flagging. Extract the financial
// figures (ignoring [N] citation markers) and compare the sets.
export function extractFigures(text: string): string[] {
    if (!text) return [];
    const clean = text.replace(/\[\d+\]/g, ' ');
    const m = clean.match(/\$?\d[\d,]*(?:\.\d+)?\s?(?:%|bn|billion|trillion|million|[mbk])?\b/gi) || [];
    return [...new Set(m.map(s => s.replace(/\s+/g, '').toLowerCase()))].sort();
}

export function figuresChanged(oldText: string, newText: string): boolean {
    const a = extractFigures(oldText);
    const b = extractFigures(newText);
    return a.length !== b.length || a.join('|') !== b.join('|');
}

// Hallucination guard: every [N] marker in the prose must map to a returned
// citation id. Returns the sorted unique ids that DON'T — i.e. fabricated cites
// the LLM emitted with no backing source. Empty = clean.
export function findUnmappedCites(text: string, citations: { id: number }[]): number[] {
    const ids = new Set(citations.map(c => c.id));
    const used = new Set([...text.matchAll(/\[(\d+)\]/g)].map(m => Number(m[1])));
    return [...used].filter(n => !ids.has(n)).sort((a, b) => a - b);
}

export function splitAnswerSources(answer: string): { prose: string; labels: Map<number, string> } {
    const labels = new Map<number, string>();
    const m = answer.match(/\n+\s*#{0,6}\s*\**\s*Sources\s*\**\s*\n([\s\S]*)$/i);
    if (!m || m.index === undefined) return { prose: answer, labels };
    const lineRe = /^\s*\[(\d+)\]\s*(.+?)\s*$/gm;
    let hit: RegExpExecArray | null;
    while ((hit = lineRe.exec(m[1]))) labels.set(Number(hit[1]), hit[2]);
    if (labels.size === 0) return { prose: answer, labels };
    return { prose: answer.slice(0, m.index).trimEnd(), labels };
}

export interface GridPrompt {
    id: string;
    label: string;                 // column header
    prompt: string;                // the templated instruction; `{ticker}` is substituted
    synthesis?: boolean;           // if true, this cell compares all tickers (no {ticker} substitution)
}

export interface GridDef {
    id: string;
    name: string;
    tickers: string[];
    prompts: GridPrompt[];
}

export type CellStatus = 'pending' | 'running' | 'done' | 'error' | 'cancelled';

export interface GridCell {
    ticker: string;
    promptId: string;
    status: CellStatus;
    answer?: string;
    citations?: Citation[];
    error?: string;
    durationMs?: number;
    modelUsed?: ResearchModelId | string;
    ragUsed?: boolean;
    // GT-2 trust layer (all optional — old saved runs stay loadable, row 11)
    trust?: TrustScore;
    rounds?: number;
    contradictions?: string[];
    roundHistory?: Array<{ answer: string; figures: string[] }>;
    // AC-1 agentic trace (optional + additive — legacy cells render unchanged)
    steps?: CellStep[];
}

export interface GridState {
    def: GridDef;
    cells: Record<string, GridCell>;   // keyed by cellKey(ticker, promptId)
    startedAt?: string;
    completedAt?: string;
}

export function cellKey(ticker: string, promptId: string): string {
    return `${ticker}::${promptId}`;
}

export function initializeGrid(def: GridDef): GridState {
    const cells: Record<string, GridCell> = {};
    for (const ticker of def.tickers) {
        for (const p of def.prompts) {
            cells[cellKey(ticker, p.id)] = {
                ticker,
                promptId: p.id,
                status: 'pending',
            };
        }
    }
    // Initialize synthesis cells (for "ALL" ticker)
    for (const p of def.prompts) {
        if (p.synthesis) {
            cells[cellKey('ALL', p.id)] = {
                ticker: 'ALL',
                promptId: p.id,
                status: 'pending',
            };
        }
    }
    return { def, cells };
}

export function updateCell(
    state: GridState,
    ticker: string,
    promptId: string,
    patch: Partial<GridCell>,
): GridState {
    const k = cellKey(ticker, promptId);
    const existing = state.cells[k];
    if (!existing) return state;
    return {
        ...state,
        cells: { ...state.cells, [k]: { ...existing, ...patch } },
    };
}

export function allCellIds(def: GridDef): Array<{ ticker: string; promptId: string }> {
    const out: Array<{ ticker: string; promptId: string }> = [];
    for (const ticker of def.tickers) {
        for (const p of def.prompts) {
            out.push({ ticker, promptId: p.id });
        }
    }
    return out;
}

export function gridProgress(state: GridState): { done: number; total: number; failed: number } {
    const values = Object.values(state.cells);
    return {
        total: values.length,
        done: values.filter(c => c.status === 'done').length,
        failed: values.filter(c => c.status === 'error').length,
    };
}

export function resolvePrompt(prompt: GridPrompt, ticker: string): string {
    return prompt.prompt.replace(/\{ticker\}/g, ticker);
}

// ─── Cell runner ─────────────────────────────────────────────────────────────
// One LLM call per cell (not the full deep-research pipeline). Keeps per-cell
// latency to a few seconds so a 10×5 grid finishes in under a minute.

// AC-3: optional per-cell tools. Each returns a short human-readable snapshot
// (`text`) the analyze step can cite, plus the raw payload. Absent tools =
// byte-identical legacy behavior (row 9).
export interface ToolResult { text: string; data?: unknown }
export interface CellTools {
    marketQuote?: (ticker: string, signal?: AbortSignal) => Promise<ToolResult>;
    fundamentals?: (ticker: string, signal?: AbortSignal) => Promise<ToolResult>;
    webSearch?: (query: string, signal?: AbortSignal) => Promise<ToolResult>;
}

export interface CellRunnerDeps {
    callLLM: (prompt: string, signal?: AbortSignal) => Promise<{ text: string; model: ResearchModelId }>;
    searchWeb?: (query: string, signal?: AbortSignal) => Promise<Citation[]>;
    searchGravity?: (query: string, ticker: string, signal?: AbortSignal) => Promise<GravityRAGResult>;
    tools?: CellTools;
    // AC-5 live ticker: fired when a trace step starts, so the UI can show the
    // current step inside the running cell. Purely observational.
    onStep?: (ticker: string, promptId: string, label: string) => void;
}

// Build the cross-doc comparison prompt for a synthesis cell. Groups answers BY
// DIMENSION (each prompt → every ticker side-by-side) rather than by ticker, so
// the LLM can compare head-to-head per dimension instead of summarising blobs.
// Returns null when no completed cells exist to compare. Pure → unit-testable.
export function buildSynthesisPrompt(
    def: GridDef,
    state: GridState,
    prompt: GridPrompt,
): string | null {
    const nonSynthesis = def.prompts.filter(p => !p.synthesis);

    const byDimension: string[] = [];
    let anyAnswers = false;
    for (const p of nonSynthesis) {
        const perTicker: string[] = [];
        for (const t of def.tickers) {
            const cell = state.cells[cellKey(t, p.id)];
            if (cell?.status === 'done' && cell.answer) {
                anyAnswers = true;
                perTicker.push(`  - ${t}: ${cell.answer}`);
            }
        }
        if (perTicker.length > 0) {
            byDimension.push(`### ${p.label}\n${perTicker.join('\n')}`);
        }
    }

    if (!anyAnswers) return null;

    return (
        `You are comparing ${def.tickers.length} companies head-to-head. Below is the ` +
        `research grouped BY DIMENSION (each section lists every company's answer for ` +
        `that dimension):\n\n${byDimension.join('\n\n')}\n\n` +
        `${prompt.prompt}\n\n` +
        `Format: lead with a markdown comparison table (rows = companies, columns = the ` +
        `key dimensions above, cells = a terse verdict/figure). Then a short ranked verdict ` +
        `naming the winner per dimension and the overall pick. Cite specific figures where present.`
    );
}

// AC-4 (row 8): successful tool snapshots become REAL evidence — appended as
// cited lines whose [N] markers resolve to new citation entries carrying the
// snapshot text. Tool figures are clickable and count for figure-adjacency
// exactly like RAG cites. Pure → unit-testable.
export function attachToolEvidence(
    answer: string,
    citations: Citation[],
    tools: { quote?: ToolResult; fundamentals?: ToolResult },
    ticker: string,
): { answer: string; citations: Citation[] } {
    let nextId = Math.max(0, ...citations.map(c => c.id)) + 1;
    const lines: string[] = [];
    const extra: Citation[] = [];
    if (tools.quote) {
        extra.push({
            id: nextId,
            title: `${ticker} live quote (market-server, real-time)`,
            url: `market://quote/${ticker}`,
            source: 'market-server',
            sourceData: { text: tools.quote.text, ticker },
        });
        lines.push(`Live market: ${tools.quote.text} [${nextId}]`);
        nextId += 1;
    }
    if (tools.fundamentals) {
        extra.push({
            id: nextId,
            title: `${ticker} fundamentals TTM (market-server)`,
            url: `market://fundamentals/${ticker}`,
            source: 'market-server',
            sourceData: { text: tools.fundamentals.text, ticker },
        });
        lines.push(`Fundamentals (TTM): ${tools.fundamentals.text} [${nextId}]`);
    }
    if (extra.length === 0) return { answer, citations };
    return { answer: `${answer}\n\n${lines.join('\n')}`, citations: [...citations, ...extra] };
}

export async function runGridCell(
    def: GridDef,
    ticker: string,
    promptId: string,
    deps: CellRunnerDeps,
    signal?: AbortSignal,
    state?: GridState,  // for synthesis cells: need all ticker answers
): Promise<GridCell> {
    const prompt = def.prompts.find(p => p.id === promptId);
    if (!prompt) {
        return {
            ticker, promptId,
            status: 'error',
            error: `Unknown prompt id: ${promptId}`,
        };
    }

    const started = Date.now();

    // AC-2: every call the cell makes is recorded as a trace step. The trace
    // never changes behavior — errors re-throw into the existing handlers.
    const trace = newTrace();
    const note = (label: string) => { try { deps.onStep?.(ticker, promptId, label); } catch { /* observer never breaks the cell */ } };

    // ── Synthesis cells: compare all tickers ────────────────────────────
    if (prompt.synthesis && state) {
        try {
            const synthesisPrompt = buildSynthesisPrompt(def, state, prompt);
            if (!synthesisPrompt) {
                return {
                    ticker,
                    promptId,
                    status: 'error',
                    error: 'No completed cells to synthesize',
                    durationMs: Date.now() - started,
                };
            }

            note('Analyzing');
            const { text, model } = await trace.step('Analyzing', 'llm',
                () => deps.callLLM(synthesisPrompt, signal));
            return {
                ticker,
                promptId,
                status: 'done',
                answer: text,
                citations: aggregateCitations(def, state),
                durationMs: Date.now() - started,
                modelUsed: model,
                steps: trace.done(),
            };
        } catch (e: any) {
            if (signal?.aborted) {
                return { ticker, promptId, status: 'cancelled', durationMs: Date.now() - started };
            }
            return {
                ticker, promptId,
                status: 'error',
                error: e?.message ?? 'Unknown error',
                durationMs: Date.now() - started,
            };
        }
    }

    // ── Regular per-ticker cells ───────────────────────────────────────
    const resolved = resolvePrompt(prompt, ticker);

    try {
        // ── Tools fan-out (AC-3): parallel with RAG; failures are recorded by
        // the trace and swallowed here — one dead tool never kills the cell.
        const toolResults: { quote?: ToolResult; fundamentals?: ToolResult } = {};
        const toolTasks: Promise<void>[] = [];
        if (deps.tools?.marketQuote) {
            note('Fetching market data');
            toolTasks.push(trace.step('Fetching market data', 'marketQuote',
                () => deps.tools!.marketQuote!(ticker, signal),
                { meta: r => r.text.slice(0, 120) })
                .then(r => { toolResults.quote = r; }, () => { /* traced as failed */ }));
        }
        if (deps.tools?.fundamentals) {
            note('Pulling fundamentals');
            toolTasks.push(trace.step('Pulling fundamentals', 'fundamentals',
                () => deps.tools!.fundamentals!(ticker, signal),
                { meta: r => r.text.slice(0, 120) })
                .then(r => { toolResults.fundamentals = r; }, () => { /* traced as failed */ }));
        }

        // ── RAG retrieval (primary) ────────────────────────────────────────
        let ragResult: GravityRAGResult | null = null;
        if (deps.searchGravity) {
            try {
                note('Searching SEC filings');
                ragResult = await trace.step('Searching SEC filings', 'rag',
                    () => deps.searchGravity!(`${ticker} ${resolved}`, ticker, signal),
                    { isEmpty: r => !r.available || !r.answer, meta: r => `${r.sources?.length ?? 0} passages` });
            } catch { /* soft-fail */ }
        }
        await Promise.all(toolTasks);

        // If RAG returned a grounded answer, use it directly — no LLM call needed.
        if (ragResult?.available && ragResult.answer) {
            // Strip the baked-in "Sources" footer; keep its rich labels by id.
            const { prose, labels } = splitAnswerSources(ragResult.answer);
            // The answer's inline [N] markers map to citation.id. Prefer the
            // footer's rich labels (e.g. "AAPL 10-K FY2020, Revenue (SEC XBRL)…")
            // for the title — the structured citations' `source` is often just
            // the ticker — and pull passage text from the structured citation by
            // id for the click-through modal.
            const structById = new Map((ragResult.citations ?? []).map(c => [c.id, c]));
            let ragCitations: Citation[];
            if (labels.size > 0) {
                ragCitations = [...labels.entries()].sort((a, b) => a[0] - b[0]).map(([id, label]) => {
                    const c = structById.get(id);
                    return {
                        id,
                        title: label,
                        url: c?.url || `gravity://source/${id}`,
                        source: 'gravity',
                        publishedDate: c?.date || undefined,
                        chunk_id: c?.chunk_id,
                        char_offset_start: c?.char_offset_start,
                        char_offset_end: c?.char_offset_end,
                        sourceData: {
                            text: c?.text || label, ticker: c?.ticker, date: c?.date, section: c?.section,
                        // Verified filing provenance travels to the source
                        // modal, so its EDGAR link opens the filing rather than
                        // a company listing. Undefined for web sources.
                        accession: c?.accession, cik: c?.cik,
                        filing_url: c?.filing_url, document_url: c?.document_url,
                        source_url: c?.source_url, canonical_url: c?.canonical_url,
                        },
                    };
                });
            } else if (ragResult.citations && ragResult.citations.length > 0) {
                ragCitations = ragResult.citations.map(c => ({
                    id: c.id,
                    title: [c.source, c.ticker && `(${c.ticker})`, c.date && `[${c.date}]`].filter(Boolean).join(' '),
                    url: c.url || `gravity://source/${c.id}`,
                    source: 'gravity',
                    publishedDate: c.date || undefined,
                    chunk_id: c.chunk_id,
                    char_offset_start: c.char_offset_start,
                    char_offset_end: c.char_offset_end,
                    sourceData: {
                        text: c.text, ticker: c.ticker, date: c.date, section: c.section,
                        accession: c.accession, cik: c.cik,
                        filing_url: c.filing_url, document_url: c.document_url,
                        source_url: c.source_url, canonical_url: c.canonical_url,
                    },
                }));
            } else {
                ragCitations = ragResult.sources.map((s, i) => ({
                    id: i + 1,
                    title: [s.title, s.ticker && `(${s.ticker})`, s.date && `[${s.date}]`].filter(Boolean).join(' '),
                    url: `gravity://source/${s.id}`,
                    source: 'gravity',
                    publishedDate: s.date || undefined,
                    sourceData: {
                        text: s.text, ticker: s.ticker, date: s.date,
                        documentType: s.document_type, section: s.section,
                        accession: s.accession, cik: s.cik,
                        filing_url: s.filing_url, document_url: s.document_url,
                        source_url: s.source_url, canonical_url: s.canonical_url,
                    },
                }));
            }
            const enriched = attachToolEvidence(prose, ragCitations, toolResults, ticker);
            return {
                ticker, promptId,
                status: 'done',
                answer: enriched.answer,
                citations: enriched.citations,
                durationMs: Date.now() - started,
                modelUsed: 'gravity-rag',
                ragUsed: true,
                steps: trace.done(),
            };
        }

        // ── Optional web context (fallback when RAG unavailable) ──────────
        let citations: Citation[] = [];
        if (deps.searchWeb) {
            try {
                note('Searching the web');
                citations = await trace.step('Searching the web', 'webSearch',
                    () => deps.searchWeb!(`${ticker} ${prompt.label}`, signal),
                    { isEmpty: c => c.length === 0, meta: c => `${c.length} results` });
            } catch { /* soft-fail */ }
        }

        // ── NO DATA: Return early instead of hallucinating ────────────────
        // Row 6: only SUCCESSFUL tool results exist in toolResults — a failed
        // tool's data can never reach the LLM.
        const toolBlock = [
            toolResults.quote && `Live market data (real-time quote):\n${toolResults.quote.text}`,
            toolResults.fundamentals && `Fundamentals snapshot (TTM):\n${toolResults.fundamentals.text}`,
        ].filter(Boolean).join('\n\n');
        const hasRagSources = ragResult && ragResult.sources && ragResult.sources.length > 0;
        const hasWebCitations = citations.length > 0;
        if (!hasRagSources && !hasWebCitations && !toolBlock) {
            return {
                ticker, promptId,
                status: 'done',
                answer: `No data available for "${resolved}" in SEC filings or public sources. Check investor relations page or earnings call transcripts for this specific metric.`,
                citations: [],
                durationMs: Date.now() - started,
                modelUsed: 'no-sources',
                ragUsed: false,
                steps: trace.done(),
            };
        }

        // ── Only call LLM if we have sources ──────────────────────────────
        const ragBlock = ragResult ? formatRAGSourcesForPrompt(ragResult) : '';
        const webBlock = citations.length
            ? `\n\nWeb context (cite by [n]):\n${citations.map(c => `[${c.id}] ${c.title}: ${c.url}`).join('\n')}\n\n`
            : '';
        const contextBlock = [ragBlock, webBlock, toolBlock].filter(Boolean).join('\n\n');

        const fullPrompt = `You are a sell-side equity analyst. Answer concisely (under 150 words) with citations like [1].\n\n${contextBlock}\n\nQuestion: ${resolved}`;

        note('Analyzing');
        const { text, model } = await trace.step('Analyzing', 'llm',
            () => deps.callLLM(fullPrompt, signal));

        const enriched = attachToolEvidence(text, citations, toolResults, ticker);
        return {
            ticker, promptId,
            status: 'done',
            answer: enriched.answer,
            citations: enriched.citations,
            durationMs: Date.now() - started,
            modelUsed: model,
            steps: trace.done(),
        };
    } catch (e: any) {
        if (signal?.aborted || /abort/i.test(e?.name ?? '')) {
            return { ticker, promptId, status: 'cancelled', durationMs: Date.now() - started, steps: trace.done() };
        }
        return {
            ticker, promptId,
            status: 'error',
            error: e?.message || String(e),
            durationMs: Date.now() - started,
            steps: trace.done(),
        };
    }
}

// Run the whole grid with bounded concurrency. Emits updated state after each
// cell completes so the UI can render progressively.
export async function runGrid(
    state: GridState,
    deps: CellRunnerDeps,
    options: {
        concurrency?: number;
        signal?: AbortSignal;
        onCellUpdate?: (state: GridState, cell: GridCell) => void;
    } = {},
): Promise<GridState> {
    const concurrency = options.concurrency ?? 4;
    const ids = allCellIds(state.def);
    let current: GridState = { ...state, startedAt: state.startedAt ?? new Date().toISOString() };

    // Separate regular cells from synthesis cells
    const regularIds = ids.filter(id => !state.def.prompts.find(p => p.id === id.promptId)?.synthesis);
    const synthesisCells = state.def.prompts.filter(p => p.synthesis);

    // ── Run regular cells in parallel ──────────────────────────────────
    let cursor = 0;
    const workers: Promise<void>[] = [];
    for (let w = 0; w < Math.min(concurrency, regularIds.length); w += 1) {
        workers.push((async () => {
            while (cursor < regularIds.length) {
                if (options.signal?.aborted) return;
                const idx = cursor;
                cursor += 1;
                const { ticker, promptId } = regularIds[idx];
                current = updateCell(current, ticker, promptId, { status: 'running' });
                const cell = await runGridCell(state.def, ticker, promptId, deps, options.signal);
                current = updateCell(current, ticker, promptId, cell);
                options.onCellUpdate?.(current, cell);
            }
        })());
    }
    await Promise.all(workers);

    // ── Run synthesis cells sequentially ───────────────────────────────
    for (const synthPrompt of synthesisCells) {
        if (options.signal?.aborted) break;
        // Synthesis cell: ticker represents "all tickers"
        const ticker = 'ALL';
        current = updateCell(current, ticker, synthPrompt.id, { status: 'running' });
        const cell = await runGridCell(state.def, ticker, synthPrompt.id, deps, options.signal, current);
        current = updateCell(current, ticker, synthPrompt.id, cell);
        options.onCellUpdate?.(current, cell);
    }

    return { ...current, completedAt: new Date().toISOString() };
}

// ─── Seed prompts ────────────────────────────────────────────────────────────
// Typical analyst workflow: one ticker × these 6 questions answers ~80% of
// quick triage on a watchlist.

// Phrased for what the corpus actually holds (SEC 10-K/10-Q filings): MD&A,
// Item 1A risk factors, reported financials. Asking for analyst consensus /
// price targets / peer multiples yields honest-but-empty declines.
//
// Each prompt carries an output contract: retrieval keywords lead (the text is
// also the search query), format rules trail. STYLE forbids the two answer
// pathologies that make cells unreadable: meta-narration about "the provided
// sources", and multi-paragraph apologetic declines.
const STYLE = 'Format: 3-5 tight bullet points, bold every figure, cite inline. '
    + 'Never describe or apologize for the sources; if the filings lack something, '
    + 'give ONE short line saying what they do show instead.';

export const SEED_GRID_PROMPTS: GridPrompt[] = [
    { id: 'thesis',    label: 'Thesis',         prompt: `{ticker} investment thesis, growth drivers, margins, disclosed risks and headwinds from recent 10-K and 10-Q filings. Give BULL: 2 bullets (drivers + figures) then BEAR: 2 bullets (risks + figures). ${STYLE}` },
    { id: 'moat',      label: 'Moat',           prompt: `{ticker} competitive advantages, market position, scale, switching costs, brand, intellectual property, network effects as described in the business section and MD&A. 3 bullets naming each advantage + evidence, end with one line: how durable and why. ${STYLE}` },
    { id: 'catalysts', label: 'Growth Drivers', prompt: `{ticker} growth drivers, strategic initiatives, fastest growing segments and products management highlights in MD&A. 3 bullets, each = driver → segment/product → growth figure. ${STYLE}` },
    { id: 'risks',     label: 'Risks',          prompt: `{ticker} risk factors, Item 1A, principal risks, quantified exposures disclosed in filings. Top 3, numbered, each with the quantified exposure where given. ${STYLE}` },
    { id: 'valuation', label: 'Financials',     prompt: `{ticker} revenue, gross margin, operating margin, net income trajectory across reported fiscal periods. One bullet per metric with period-over-period figures, end with verdict: IMPROVING or DETERIORATING and the single biggest driver. ${STYLE}` },
    { id: 'preview',   label: 'Latest Quarter', prompt: `{ticker} most recent 10-Q quarterly results versus prior-year quarter: revenue, margins, earnings deltas and management's stated drivers of change. One bullet per delta with both figures, one bullet for management's explanation. ${STYLE}` },
    { id: 'synthesis', label: '🔍 Comparison',  prompt: 'Synthesize the individual theses across all tickers. Output a ranked list (strongest conviction first): each entry = ticker, one-line thesis, strongest edge, biggest disclosed risk. End with three one-liners: strongest growth trajectory, most durable moat, biggest risk overall.', synthesis: true },
];

// ─── CSV Export ──────────────────────────────────────────────────────────────
// RFC-4180: wrap fields that contain comma / quote / newline in double quotes;
// escape embedded quotes by doubling them. Empty strings are allowed.

function csvEscape(value: unknown): string {
    const s = value == null ? '' : String(value);
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

export function toCSV(state: GridState): string {
    // GT-8: exports carry verification status — trailing `trust` column holds
    // per-prompt grades in column order (⚠ marks an unresolved contradiction).
    const header = ['ticker', ...state.def.prompts.map(p => p.label), 'trust'];
    const rows: string[][] = [header];

    // Regular ticker rows
    for (const ticker of state.def.tickers) {
        const row: string[] = [ticker];
        const grades: string[] = [];
        for (const p of state.def.prompts) {
            const cell = state.cells[cellKey(ticker, p.id)];
            if (!cell || cell.status === 'pending') row.push('');
            else if (cell.status === 'running') row.push('(running)');
            else if (cell.status === 'error') row.push(`(error: ${cell.error ?? 'unknown'})`);
            else if (cell.status === 'cancelled') row.push('(cancelled)');
            else row.push(cell.answer ?? '');
            if (!p.synthesis) {
                grades.push(cell?.trust ? `${cell.trust.grade}${cell.contradictions?.length ? '⚠' : ''}` : '·');
            }
        }
        row.push(grades.join(' '));
        rows.push(row);
    }

    // Synthesis row (if any synthesis cells exist)
    const synthesisCells = state.def.prompts.filter(p => p.synthesis);
    if (synthesisCells.length > 0) {
        const synthRow: string[] = ['[COMPARISON]'];
        for (const p of state.def.prompts) {
            const cell = state.cells[cellKey('ALL', p.id)];
            if (!cell || cell.status === 'pending') synthRow.push('');
            else if (cell.status === 'running') synthRow.push('(running)');
            else if (cell.status === 'error') synthRow.push(`(error: ${cell.error ?? 'unknown'})`);
            else if (cell.status === 'cancelled') synthRow.push('(cancelled)');
            else synthRow.push(cell.answer ?? '');
        }
        synthRow.push(''); // trust column — synthesis is never graded
        rows.push(synthRow);
    }

    return rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
}
