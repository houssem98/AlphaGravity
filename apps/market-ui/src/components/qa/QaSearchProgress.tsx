// Quick-Answer search progress. A projection of the backend event stream and
// nothing else.
//
// What this component used to do: hold an array of scripted log lines — "Dense
// vector search · Qdrant + voyage-finance-2…", "Sparse BM25 keyword search ·
// Elasticsearch…", "Knowledge-graph traversal · Neo4j…", "Cross-encoder rerank ·
// Cohere rerank-v3.5…" — and reveal them one per 650ms interval on every query,
// with no reference to any backend event. On a deployment where Elasticsearch
// and Neo4j are not configured, the user still watched them "run". It also
// stamped each row with `new Date()` at render time, so the timestamps tracked
// the wall clock rather than the work, showed a `validating` stage the pipeline
// never emits, and reported "N citations verified" from the citation count
// rather than from any verdict.
//
// Every line below now comes from an event the server sent. If the server sends
// nothing, this shows nothing.

import { useEffect, useRef } from 'react';
import {
    Brain, Layers, ListFilter, PenLine,
    CheckCircle2, Loader2, Sparkles, Zap, XCircle, AlertTriangle,
} from 'lucide-react';
import type {
    SearchStatus, PipelineEvent, RetrievalReport, GravityCitation,
} from '../../hooks/useGravitySearch';
import { STAGE_LABELS, verificationSummary } from '../../hooks/useGravitySearch';

interface Props {
    status: SearchStatus;
    sourcesCount: number;
    citations: GravityCitation[];
    events: PipelineEvent[];
    retrieval: RetrievalReport | null;
}

// Four display groups over the six stages the backend emits. The two
// primary-source stages are alternative routes through retrieval, so they share
// its column — but the caption under that column reports what the server said,
// never a fixed claim about how many channels exist.
const STAGES = [
    { key: 'understand', Icon: Brain,      label: 'Understand' },
    { key: 'retrieve',   Icon: Layers,     label: 'Retrieve'   },
    { key: 'rerank',     Icon: ListFilter, label: 'Rerank'     },
    { key: 'generate',   Icon: PenLine,    label: 'Generate'   },
] as const;

const STAGE_COLUMN: Partial<Record<SearchStatus, number>> = {
    understanding: 0,
    searching: 1,
    resolving_primary_source: 1,
    answering_from_verified_evidence: 1,
    reranking: 2,
    reasoning: 3,
    complete: 4,
};

const STAGE_COLORS = ['var(--accent)', 'var(--accent)', 'oklch(0.785 0.170 72)', 'var(--up)'];

function clockOf(ts: number): string {
    return new Date(ts).toLocaleTimeString('en-US', {
        hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
}

export default function QaSearchProgress({
    status, sourcesCount, citations, events, retrieval,
}: Props) {
    const logRef = useRef<HTMLDivElement>(null);

    const columnIdx = STAGE_COLUMN[status] ?? -1;
    const isTerminalFailure = status === 'error' || status === 'cancelled';

    // Stage progress is "column N of 4" — a count of stages the server actually
    // reported, not a hand-picked percentage per status.
    const pct = columnIdx < 0
        ? 0
        : Math.round((Math.min(columnIdx, STAGES.length) / STAGES.length) * 100);

    useEffect(() => {
        logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
    }, [events.length]);

    // The caption under Retrieve reports the channels the server named. Before
    // the first retrieval event there is no honest count, so it says so.
    const failedChannels = Object.keys(retrieval?.channels_failed ?? {});
    const retrieveDesc = retrieval
        ? failedChannels.length > 0
            ? `${retrieval.channels_used.length} of ${retrieval.channels_used.length + failedChannels.length} channels`
            : `${retrieval.channels_used.length} channel${retrieval.channels_used.length === 1 ? '' : 's'}`
        : 'not yet reported';
    const stageDesc = ['Query intent', retrieveDesc, 'Cross-encoder', 'Cited answer'];

    const verdicts = verificationSummary(citations);
    const verifiedCount = verdicts.verified ?? 0;
    const flagged = (verdicts.unsupported ?? 0) + (verdicts.conflicting ?? 0);

    const footerLine = isTerminalFailure
        ? (status === 'cancelled' ? 'Cancelled' : 'Search failed')
        : failedChannels.length > 0
            ? `Degraded — ${failedChannels.join(', ')} did not respond`
        : citations.length > 0
            ? `${verifiedCount} of ${citations.length} citation${citations.length === 1 ? '' : 's'} verified` +
              (flagged > 0 ? ` · ${flagged} flagged` : '')
            : STAGE_LABELS[status] ?? 'Working';

    return (
        <div className="rise-in">
            {/* ── Header ── */}
            <div className="flex items-center gap-3 mb-6">
                <div className="relative flex-shrink-0">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center relative"
                        style={{ background: 'color-mix(in oklch, var(--accent) 22%, var(--surface))', border: '1px solid color-mix(in oklch, var(--accent) 40%, transparent)' }}>
                        {isTerminalFailure
                            ? <XCircle className="w-4 h-4" style={{ color: 'var(--down)' }} />
                            : <Sparkles className="w-4 h-4" style={{ color: 'var(--accent)' }} />}
                    </div>
                </div>
                <div className="min-w-0">
                    <h3 className="font-display text-[15px] font-semibold text-[var(--text)]">Quick Answer</h3>
                    <p className="text-[12px] text-[var(--text-3)] mt-0.5">{STAGE_LABELS[status] ?? 'Working'}</p>
                </div>
                {sourcesCount > 0 && (
                    <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full font-num"
                        style={{ background: 'color-mix(in oklch, var(--accent) 10%, transparent)', border: '1px solid color-mix(in oklch, var(--accent) 22%, transparent)' }}>
                        <Layers className="w-3 h-3" style={{ color: 'var(--accent)' }} />
                        <span className="text-[11px] font-semibold tabular-nums" style={{ color: 'var(--accent)' }}>{sourcesCount} sources</span>
                    </div>
                )}
            </div>

            {/* ── Stage pipeline ── */}
            <div className="flex items-start mb-6">
                {STAGES.map((stage, i) => {
                    const isComplete = i < columnIdx;
                    const isCurrent = i === columnIdx;
                    const { Icon } = stage;
                    const c = STAGE_COLORS[i];
                    return (
                        <div key={stage.key} className="flex items-center flex-1">
                            <div className="flex flex-col items-center flex-1">
                                <div className="w-9 h-9 rounded-full flex items-center justify-center mb-2 transition-all duration-700"
                                    style={{
                                        background: isComplete ? 'color-mix(in oklch, var(--up) 15%, transparent)'
                                            : isCurrent ? `color-mix(in oklch, ${c} 16%, transparent)` : 'rgba(255,255,255,0.03)',
                                        border: isComplete ? '1px solid color-mix(in oklch, var(--up) 35%, transparent)'
                                            : isCurrent ? `1px solid color-mix(in oklch, ${c} 45%, transparent)` : '1px solid var(--line)',
                                    }}>
                                    {isComplete && <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--up)' }} />}
                                    {isCurrent && !isTerminalFailure && <Loader2 className="w-4 h-4 animate-spin" style={{ color: c }} />}
                                    {isCurrent && isTerminalFailure && <AlertTriangle className="w-4 h-4" style={{ color: 'var(--down)' }} />}
                                    {!isComplete && !isCurrent && <Icon className="w-4 h-4" style={{ color: 'var(--text-4)' }} />}
                                </div>
                                <span className="font-display text-[11px] font-semibold text-center leading-tight"
                                    style={{ color: isComplete ? 'var(--up)' : isCurrent ? c : 'var(--text-4)' }}>
                                    {stage.label}
                                </span>
                                <span className="text-[10px] text-center mt-0.5 leading-tight"
                                    style={{ color: isCurrent ? 'var(--text-3)' : 'var(--text-4)' }}>
                                    {stageDesc[i]}
                                </span>
                            </div>
                            {i < STAGES.length - 1 && (
                                <div className="h-px w-8 flex-shrink-0 mb-8 relative overflow-hidden rounded-full" style={{ background: 'var(--line)' }}>
                                    {isComplete && <div className="absolute inset-0" style={{ background: 'color-mix(in oklch, var(--up) 40%, transparent)' }} />}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* ── Event log — one row per event the server sent ── */}
            <div className="rounded-[var(--radius-lg)] overflow-hidden border border-[var(--line)]" style={{ background: 'color-mix(in oklch, var(--bg) 70%, black)' }}>
                <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-[var(--line)]">
                    <div className="flex gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#FF5F57' }} />
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#FFBD2E' }} />
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#28C840' }} />
                    </div>
                    <div className="flex-1 flex items-center justify-center gap-2">
                        <Zap className="w-3 h-3 text-[var(--text-4)]" />
                        <span className="text-[11px] font-num text-[var(--text-3)]">retrieval-engine · server events</span>
                    </div>
                </div>

                <div ref={logRef} className="p-3.5 font-num space-y-1.5 min-h-[180px] max-h-[280px] overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
                    {events.length === 0 && (
                        <div className="text-[11.5px] text-[var(--text-4)]">Waiting for the first event from the server…</div>
                    )}
                    {events.map((e) => {
                        const col = e.stage ? STAGE_COLUMN[e.stage] ?? 0 : 0;
                        const c = e.type === 'error' || e.type === 'cancelled'
                            ? 'var(--down)'
                            : STAGE_COLORS[Math.min(col, STAGE_COLORS.length - 1)];
                        return (
                            <div key={`${e.seq}-${e.type}`} className="flex items-start gap-3 text-[11.5px]">
                                <span className="flex-shrink-0 tabular-nums text-[var(--text-4)]">{clockOf(e.ts)}</span>
                                <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide"
                                    style={{ background: `color-mix(in oklch, ${c} 14%, transparent)`, color: c }}>
                                    {e.stage ? STAGES[STAGE_COLUMN[e.stage] ?? 0]?.label ?? e.type : e.type}
                                </span>
                                <span style={{ color: 'var(--text-3)' }}>
                                    {e.label}
                                    {e.replayed && (
                                        <span className="ml-1.5 text-[9.5px] uppercase tracking-wide text-[var(--text-4)]">replayed</span>
                                    )}
                                </span>
                            </div>
                        );
                    })}
                </div>

                <div className="px-3.5 pb-3.5 pt-2 border-t border-[var(--line)]">
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] font-num text-[var(--text-3)]">{footerLine}</span>
                        <span className="text-[12px] font-num font-bold tabular-nums" style={{ color: 'var(--accent)' }}>{pct}%</span>
                    </div>
                    <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                        <div className="h-full rounded-full transition-all duration-700 ease-out"
                            style={{ width: `${pct}%`, background: isTerminalFailure ? 'var(--down)' : 'linear-gradient(90deg, var(--accent), oklch(0.785 0.170 72), var(--up))' }} />
                    </div>
                </div>
            </div>
        </div>
    );
}
