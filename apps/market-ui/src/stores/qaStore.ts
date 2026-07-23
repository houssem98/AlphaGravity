// Module-level Quick-Answer store — one entry per conversation, so a QA stream
// keeps running (the WebSocket writes here) after SearchPage unmounts and the
// SAME thread resumes on return. Mirrors researchStore / companyBriefStore: the
// socket is held module-level and closed only by explicit user action (Cancel /
// New), never by a component unmount.
import { create } from 'zustand';
import { getAccessToken } from '../services/supabase';
import { useBackgroundStore } from './backgroundStore';
import {
    cleanAnswer, INITIAL_SEARCH_STATE,
    type GravitySearchState, type SearchStatus, type SearchFilters, type AgentTraceStep,
    type GravityCitation, type GravitySource, type GravityMetric, type ChartSpec,
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
    if (next.status === 'complete' || next.status === 'error') {
        const jobId = store().byConv[id]?.bgJobId;
        if (jobId) {
            useBackgroundStore.getState().endJob(jobId);
            store().patch(id, { bgJobId: null });
        }
        if (next.status === 'complete') void finalizeTurn(id);
    }
}

export function runQa(id: string, query: string, filters?: SearchFilters): void {
    const q = query.trim();
    if (!q) return;
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
                query: q,
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
                patchSearch(id, (prev) => {
                    switch (type) {
                        case 'status':
                            return { ...prev, status: data.status as SearchStatus };
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
                                confidence: data.confidence ?? 0,
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
                            return { ...prev, status: 'error', error: data.message ?? 'Search failed' };
                        default:
                            return prev;
                    }
                });
            } catch { /* ignore malformed frames */ }
        };

        ws.onclose = () => {
            if (qaSockets[id] !== ws) return;
            patchSearch(id, (prev) => {
                if (prev.status === 'complete' || prev.status === 'error') return prev;
                if (prev.finalAnswer || prev.streamingAnswer || prev.sources.length > 0) {
                    return { ...prev, status: 'complete' };
                }
                if ((qaReconnect[id] ?? 0) < 3) {
                    const delay = 1000 * Math.pow(2, qaReconnect[id]++);
                    setTimeout(connect, delay);
                    return prev;
                }
                return {
                    ...prev,
                    status: 'error',
                    error: 'Could not connect to the Gravity backend. Check VITE_GRAVITY_API_URL and that the API is reachable.',
                };
            });
        };

        ws.onerror = () => { if (qaSockets[id] !== ws) return; /* onclose handles reconnect */ };
    }

    void connect();
}

export function cancelQa(id: string): void {
    qaSockets[id]?.close();
    qaSockets[id] = null;
    const e = store().byConv[id];
    if (e?.bgJobId) useBackgroundStore.getState().endJob(e.bgJobId);
    store().patch(id, {
        search: { ...(e?.search ?? INITIAL_SEARCH_STATE), status: 'idle' },
        bgJobId: null,
    });
}
