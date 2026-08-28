// Module-level Quick-Answer store — one entry per conversation, so a QA stream
// keeps running (the WebSocket writes here) after SearchPage unmounts and the
// SAME thread resumes on return. Mirrors researchStore / companyBriefStore: the
// socket is held module-level and closed only by explicit user action (Cancel /
// New), never by a component unmount.
import { create } from 'zustand';
import { getAccessToken } from '../services/supabase';
import { useBackgroundStore } from './backgroundStore';
import {
    cleanAnswer, INITIAL_SEARCH_STATE, toPipelineEvent, isBackendStage,
    type GravitySearchState, type SearchStatus, type SearchFilters, type AgentTraceStep,
    type GravityCitation, type GravitySource, type GravityMetric, type ChartSpec,
    type AnswerState, type ConfidenceLabel, type RetrievalReport,
} from '../hooks/useGravitySearch';
import { createQaConversation, saveQaTurn, conversationTitle } from '../services/qaHistory';

const GRAVITY_WS = (() => {
    const base = import.meta.env.VITE_GRAVITY_API_URL || 'http://localhost:8000';
    return `${base.replace(/^http/, 'ws').replace(/\/+$/, '')}/v1/search/stream`;
})();

export interface ChatTurn {
    role: 'user' | 'assistant';
    content: string;
    citations?: GravityCitation[];
    sources?: GravitySource[];
    structuredData?: GravityMetric[];
    chartSpecs?: ChartSpec[];
    followUpQueries?: string[];
}

export interface QaEntry {
    search: GravitySearchState;
    thread: ChatTurn[];          // committed past turns
    currentQuery: string | null; // the live exchange's question
    supabaseId: string | null;   // qa_conversations.id — null until first persist
    persisted: boolean;          // dedupe the persist per completed turn
    bgJobId: string | null;
}

export const qaDefault: QaEntry = {
    search: INITIAL_SEARCH_STATE,
    thread: [],
    currentQuery: null,
    supabaseId: null,
    persisted: false,
    bgJobId: null,
};

interface QaState {
    activeConvId: string;
    byConv: Record<string, QaEntry>;
    setActiveConv: (id: string) => void;
    patch: (id: string, p: Partial<QaEntry>) => void;
    loadThread: (id: string, thread: ChatTurn[]) => void;
}

export const useQaStore = create<QaState>((set) => ({
    activeConvId: crypto.randomUUID(),
    byConv: {},
    setActiveConv: (id) => set({ activeConvId: id }),
    patch: (id, p) => set((s) => ({
        byConv: { ...s.byConv, [id]: { ...(s.byConv[id] ?? qaDefault), ...p } },
    })),
    loadThread: (id, thread) => set((s) => ({
        byConv: { ...s.byConv, [id]: { ...qaDefault, thread, supabaseId: id, persisted: true } },
    })),
}));

// Module-level socket handles, keyed by conversation — a run is superseded or
// cancelled only here, never by a component unmount.
const qaSockets: Record<string, WebSocket | null> = {};
const qaReconnect: Record<string, number> = {};
// The trace id addresses the run on the server. Cancel names it, and every
// reconnect re-sends it so the server attaches instead of re-running.
const qaTraceIds: Record<string, string> = {};

const store = () => useQaStore.getState();

// Persist a finished turn (creating the conversation row on the first answer).
// Runs even if SearchPage is unmounted, so a stream that completes in the
// background is still saved.
async function finalizeTurn(id: string): Promise<void> {
    const e = store().byConv[id];
    if (!e || e.persisted) return;
    const q = e.currentQuery;
    const s = e.search;
    if (!q || !s.finalAnswer) return;
    store().patch(id, { persisted: true });
    let sid = e.supabaseId;
    if (!sid) {
        sid = await createQaConversation(conversationTitle(q));
        if (sid) store().patch(id, { supabaseId: sid });
    }
    if (!sid) return;
    await saveQaTurn(sid, { role: 'user', content: q });
    await saveQaTurn(sid, {
        role: 'assistant',
        content: s.finalAnswer,
        citations: s.citations,
        sources: s.sources,
        structuredData: s.structuredData,
        chartSpecs: s.chartSpecs,
        followUpQueries: s.followUpQueries,
    });
}

// Patch just the search sub-state; when it turns terminal, close out the bg job
// and persist the finished turn.
function patchSearch(id: string, updater: (prev: GravitySearchState) => GravitySearchState): void {
    const entry = store().byConv[id] ?? qaDefault;
    const next = updater(entry.search);
    store().patch(id, { search: next });
    if (next.status === 'complete' || next.status === 'error' || next.status === 'cancelled') {
        const jobId = store().byConv[id]?.bgJobId;
        if (jobId) {
            useBackgroundStore.getState().endJob(jobId);
            store().patch(id, { bgJobId: null });
        }
        if (next.status === 'complete') void finalizeTurn(id);
    }
}

/**
 * `query` is what the reader typed and what the thread shows. `prompt` is what
 * actually goes on the wire, and differs only for an analysis command: `/risks
 * AMD` is the turn, and the authored paragraph it stands for is the request.
 * Displaying the expansion instead is the failure the Company Brief shipped —
 * the authored prompt came back at the reader as though it were the answer.
 */
export function runQa(id: string, query: string, filters?: SearchFilters, prompt?: string): void {
    const q = query.trim();
    if (!q) return;
    const wire = prompt?.trim() || q;
    const entry = store().byConv[id] ?? qaDefault;

    // Commit the previous finished exchange into the thread before starting a new
    // one — the live block always renders only the current exchange.
    let thread = entry.thread;
    if (entry.currentQuery && entry.search.finalAnswer) {
        const s = entry.search;
        thread = [
            ...thread,
            { role: 'user', content: entry.currentQuery },
            {
                role: 'assistant', content: s.finalAnswer,
                citations: s.citations, sources: s.sources,
                structuredData: s.structuredData, chartSpecs: s.chartSpecs,
                followUpQueries: s.followUpQueries,
            },
        ];
    }

    // Background job so the global indicator shows the in-flight turn and routes
    // back here. Ended in patchSearch on terminal, or in cancelQa.
    const jobId = crypto.randomUUID();
    useBackgroundStore.getState().startJob({ id: jobId, label: q, kind: 'qa', href: '/search', startedAt: Date.now() });

    store().patch(id, {
        thread,
        currentQuery: q,
        persisted: false,
        bgJobId: jobId,
        search: { ...INITIAL_SEARCH_STATE, status: 'understanding' },
    });

    // Supersede any in-flight socket for this conversation.
    qaSockets[id]?.close();
    qaSockets[id] = null;
    qaReconnect[id] = 0;

    const traceId = crypto.randomUUID();
    qaTraceIds[id] = traceId;

    // Browsers can't set WS headers, so the token is passed as a query param. A
    // FRESH token is fetched on every attempt (initial + reconnects).
    async function connect() {
        let authToken = '';
        try { authToken = (await getAccessToken()) ?? ''; } catch { /* dev bypass / no auth */ }

        const params = new URLSearchParams({ trace_id: traceId });
        if (authToken) params.set('token', authToken);
        const ws = new WebSocket(`${GRAVITY_WS}?${params.toString()}`);
        qaSockets[id] = ws;

        ws.onopen = () => {
            qaReconnect[id] = 0;
            ws.send(JSON.stringify({
                query: wire,
                trace_id: traceId,
                conversation_id: id,
                filters: filters && Object.keys(filters).length > 0 ? filters : undefined,
            }));
        };

        ws.onmessage = (ev) => {
            if (qaSockets[id] !== ws) return; // superseded — discard late frames
            try {
                const msg = JSON.parse(ev.data as string);
                const { type, data } = msg;
                // Every frame the server sends becomes a log line, and only a
                // frame the server sent can. The progress view reads this array
                // and has no timeline of its own.
                const logged = toPipelineEvent(msg);
                patchSearch(id, (prev) => {
                    const withEvent = logged
                        // A reconnect replays the buffer, so drop anything this
                        // client has already recorded rather than double-logging.
                        && !prev.events.some(e => e.seq === logged.seq && e.type === logged.type)
                        ? { ...prev, events: [...prev.events, logged] }
                        : prev;
                    prev = withEvent;
                    switch (type) {
                        case 'status':
                            // An unrecognised status leaves the stage where it
                            // was. It used to be written straight into state,
                            // and the progress map turned anything it did not
                            // know into "no stage at all" — which is what
                            // resolving_primary_source did to the whole display.
                            return isBackendStage(data.status)
                                ? { ...prev, status: data.status as SearchStatus }
                                : prev;
                        case 'retrieval':
                            return { ...prev, retrieval: data as RetrievalReport };
                        case 'cancelled':
                            return { ...prev, status: 'cancelled', answerState: 'CANCELLED' };
                        case 'sources':
                            return { ...prev, sources: data.sources ?? [] };
                        case 'token':
                            return { ...prev, streamingAnswer: prev.streamingAnswer + (data.token ?? '') };
                        case 'answer':
                            return {
                                ...prev,
                                status: 'complete',
                                finalAnswer: cleanAnswer(data.answer ?? ''),
                                streamingAnswer: '',
                                citations: data.citations ?? [],
                                // The word the server sent, kept as a word. It
                                // was coerced into a number and rendered as
                                // `Math.round(confidence * 100)` — NaN for
                                // every value the server actually sends.
                                confidence: (data.confidence ?? null) as ConfidenceLabel,
                                // The evidence gate's verdict for the answer as
                                // a whole. Dropped entirely until now, so an
                                // answer the backend had marked UNSUPPORTED
                                // rendered in the same frame as a cited one.
                                answerState: (data.answer_state ?? 'ANSWERED') as AnswerState,
                                followUpQueries: data.follow_up_queries ?? [],
                                structuredData: data.structured_data ?? [],
                                chartSpecs: data.chart_specs ?? [],
                            };
                        case 'agent_trace':
                            return {
                                ...prev,
                                agentSteps: [
                                    ...prev.agentSteps,
                                    {
                                        agent: data.agent,
                                        action: data.action,
                                        detail: data.detail ?? '',
                                        iteration: data.iteration ?? 0,
                                        quality_score: data.quality_score,
                                        timestamp: Date.now(),
                                    } as AgentTraceStep,
                                ],
                            };
                        case 'agent_trace_complete':
                            return {
                                ...prev,
                                agentTraceComplete: true,
                                totalIterations: data.total_iterations ?? 0,
                                totalCostUsd: data.total_cost_usd ?? null,
                            };
                        case 'metadata':
                            return {
                                ...prev,
                                latencyMs: data.latency_ms ?? null,
                                modelUsed: data.model_used ?? null,
                                cacheHit: data.cache_hit ?? false,
                            };
                        case 'error':
                            if (prev.finalAnswer || prev.streamingAnswer) return prev;
                            return { ...prev, status: 'error', answerState: 'SYSTEM_ERROR', error: data.message ?? 'Search failed' };
                        default:
                            return prev;
                    }
                });
            } catch { /* ignore malformed frames */ }
        };

        ws.onclose = () => {
            if (qaSockets[id] !== ws) return;
            patchSearch(id, (prev) => {
                if (prev.status === 'complete' || prev.status === 'error'
                    || prev.status === 'cancelled') return prev;

                // A dropped socket that had already delivered sources used to be
                // marked `complete` — the UI declaring an answer finished that
                // the server never sent. Reconnect instead: the run is addressed
                // by trace_id and the server attaches this connection to the run
                // already in flight, replaying what was missed rather than
                // starting (and billing) a second search.
                if ((qaReconnect[id] ?? 0) < 3) {
                    const delay = 1000 * Math.pow(2, qaReconnect[id]++);
                    setTimeout(connect, delay);
                    return prev;
                }
                return {
                    ...prev,
                    status: 'error',
                    answerState: 'SYSTEM_ERROR',
                    error: prev.sources.length > 0 || prev.streamingAnswer
                        ? 'The connection dropped before the answer finished, and could not be resumed. The partial result above is incomplete.'
                        : 'Could not connect to the Gravity backend. Check VITE_GRAVITY_API_URL and that the API is reachable.',
                };
            });
        };

        ws.onerror = () => { if (qaSockets[id] !== ws) return; /* onclose handles reconnect */ };
    }

    void connect();
}

export function cancelQa(id: string): void {
    // Closing the socket is not cancellation: the server kept retrieving and
    // generating, and kept paying for it. Send the cancel frame first so the
    // run's task is actually cancelled, then stop reconnecting and close.
    const ws = qaSockets[id];
    const traceId = qaTraceIds[id];
    if (ws && ws.readyState === WebSocket.OPEN && traceId) {
        try { ws.send(JSON.stringify({ type: 'cancel', trace_id: traceId })); } catch { /* socket already gone */ }
    }
    // Block the reconnect path — otherwise onclose would resume the very run
    // the user just cancelled.
    qaReconnect[id] = 99;
    ws?.close();
    qaSockets[id] = null;
    const e = store().byConv[id];
    if (e?.bgJobId) useBackgroundStore.getState().endJob(e.bgJobId);
    store().patch(id, {
        search: { ...(e?.search ?? INITIAL_SEARCH_STATE), status: 'cancelled', answerState: 'CANCELLED' },
        bgJobId: null,
    });
}
