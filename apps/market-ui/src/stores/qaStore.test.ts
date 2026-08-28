import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Quick Answer roadmap, Phases 5, 6 and 9: cancellation must reach the server,
// a reconnect must resume the run rather than start a second one, and a dropped
// connection must never be reported as a finished answer.
//
// The store holds its socket at module level, so the test replaces the global
// WebSocket with a recorder and drives the store through it. Supabase and the
// history writer are stubbed — they are external boundaries, not the behaviour
// under test.

vi.mock('../services/supabase', () => ({ getAccessToken: async () => 'tok' }));
const savedTurns: unknown[] = [];
vi.mock('../services/qaHistory', () => ({
    createQaConversation: async () => 'conv-1',
    saveQaTurn: async (_id: string, turn: unknown) => { savedTurns.push(turn); },
    conversationTitle: (q: string) => q,
}));
vi.mock('./backgroundStore', () => ({
    useBackgroundStore: { getState: () => ({ startJob() {}, endJob() {} }) },
}));

class FakeSocket {
    static instances: FakeSocket[] = [];
    static OPEN = 1;
    readyState = 1;
    sent: string[] = [];
    closed = false;
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;

    constructor(public url: string) {
        FakeSocket.instances.push(this);
    }
    send(payload: string) { this.sent.push(payload); }
    close() { this.closed = true; this.onclose?.(); }

    // helpers
    open() { this.onopen?.(); }
    emit(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
}

const CONV = 'conv-under-test';

async function loadStore() {
    vi.resetModules();
    FakeSocket.instances = [];
    (globalThis as Record<string, unknown>).WebSocket = FakeSocket;
    return await import('./qaStore');
}

/** Let the store's async connect() settle so the socket exists. */
async function settle() {
    for (let i = 0; i < 10 && FakeSocket.instances.length === 0; i++) {
        await new Promise(r => setTimeout(r, 0));
    }
}

beforeEach(() => {
    vi.useRealTimers();
    if (!(globalThis as Record<string, unknown>).crypto) {
        (globalThis as Record<string, unknown>).crypto = {} as Crypto;
    }
});

afterEach(() => {
    delete (globalThis as Record<string, unknown>).WebSocket;
});

describe('cancellation reaches the server', () => {
    it('sends a cancel frame naming the run before closing the socket', async () => {
        const { runQa, cancelQa } = await loadStore();
        runQa(CONV, 'NVDA revenue FY2025');
        await settle();

        const ws = FakeSocket.instances[0];
        expect(ws, 'no socket was opened').toBeTruthy();
        ws.open();

        const opening = JSON.parse(ws.sent[0]);
        const traceId = opening.trace_id;
        expect(traceId, 'the query frame carries no trace id').toBeTruthy();

        cancelQa(CONV);

        // Closing the socket was the whole of the old implementation: the
        // server kept retrieving and generating, and kept billing for it.
        const cancelFrames = ws.sent.slice(1).map(s => JSON.parse(s));
        expect(cancelFrames).toHaveLength(1);
        expect(cancelFrames[0]).toEqual({ type: 'cancel', trace_id: traceId });
        expect(ws.closed).toBe(true);
    });

    it('leaves the search in a cancelled state, not idle and not complete', async () => {
        const { runQa, cancelQa, useQaStore } = await loadStore();
        runQa(CONV, 'q');
        await settle();
        FakeSocket.instances[0].open();

        cancelQa(CONV);

        const s = useQaStore.getState().byConv[CONV].search;
        expect(s.status).toBe('cancelled');
        expect(s.answerState).toBe('CANCELLED');
        expect(s.finalAnswer).toBe('');
    });

    it('does not reconnect after a cancel', async () => {
        const { runQa, cancelQa } = await loadStore();
        runQa(CONV, 'q');
        await settle();
        const ws = FakeSocket.instances[0];
        ws.open();

        cancelQa(CONV);          // close() fires onclose internally
        await new Promise(r => setTimeout(r, 50));

        // A reconnect here would resume the very run the user just stopped.
        expect(FakeSocket.instances).toHaveLength(1);
    });
});

describe('the same trace id is re-sent on reconnect', () => {
    it('reuses the trace id so the server attaches instead of re-running', async () => {
        const { runQa } = await loadStore();
        runQa(CONV, 'q');
        await settle();

        const first = FakeSocket.instances[0];
        first.open();
        const traceId = JSON.parse(first.sent[0]).trace_id;

        // Socket drops with no answer delivered.
        first.onclose?.();
        await new Promise(r => setTimeout(r, 1200));   // first backoff is 1s

        expect(FakeSocket.instances.length).toBeGreaterThan(1);
        const second = FakeSocket.instances[1];
        second.open();
        expect(JSON.parse(second.sent[0]).trace_id).toBe(traceId);
        expect(second.url).toContain(`trace_id=${traceId}`);
    });
});

describe('a dropped connection is never reported as a finished answer', () => {
    it('does not mark the search complete just because sources arrived', async () => {
        const { runQa, useQaStore } = await loadStore();
        runQa(CONV, 'q');
        await settle();
        const ws = FakeSocket.instances[0];
        ws.open();

        ws.emit({ type: 'sources', seq: 1, ts: 1, data: { sources: [{ chunk_id: 'c1' }] } });
        ws.onclose?.();

        // The old store returned status 'complete' here — the UI declaring an
        // answer finished that the server never sent.
        const s = useQaStore.getState().byConv[CONV].search;
        expect(s.status).not.toBe('complete');
        expect(s.finalAnswer).toBe('');
    });
});

describe('server events become state', () => {
    it('records the real retrieval report and the answer state', async () => {
        const { runQa, useQaStore } = await loadStore();
        runQa(CONV, 'q');
        await settle();
        const ws = FakeSocket.instances[0];
        ws.open();

        ws.emit({
            type: 'retrieval', seq: 1, ts: 1,
            data: {
                channels_used: ['dense_pg'], channels_dark: ['bm25_es'],
                candidates: 12, passages_used: 3, retrieval_ms: 41.2, rerank_ms: 7.5,
            },
        });
        ws.emit({
            type: 'answer', seq: 2, ts: 2,
            data: { answer: 'No supporting evidence found.', citations: [],
                    confidence: 'NONE', answer_state: 'UNSUPPORTED' },
        });

        const s = useQaStore.getState().byConv[CONV].search;
        expect(s.retrieval?.channels_used).toEqual(['dense_pg']);
        expect(s.retrieval?.channels_dark).toEqual(['bm25_es']);
        // Both fields used to be discarded: answer_state entirely, and the
        // confidence word coerced into a number that rendered as NaN.
        expect(s.answerState).toBe('UNSUPPORTED');
        expect(s.confidence).toBe('NONE');
    });

    it('ignores a status the backend does not define', async () => {
        const { runQa, useQaStore } = await loadStore();
        runQa(CONV, 'q');
        await settle();
        const ws = FakeSocket.instances[0];
        ws.open();

        ws.emit({ type: 'status', seq: 1, ts: 1, data: { status: 'understanding' } });
        ws.emit({ type: 'status', seq: 2, ts: 2, data: { status: 'not_a_real_stage' } });

        expect(useQaStore.getState().byConv[CONV].search.status).toBe('understanding');
    });

    it('logs one line per server event and never duplicates a replayed one', async () => {
        const { runQa, useQaStore } = await loadStore();
        runQa(CONV, 'q');
        await settle();
        const ws = FakeSocket.instances[0];
        ws.open();

        ws.emit({ type: 'status', seq: 1, ts: 1, data: { status: 'understanding' } });
        ws.emit({ type: 'status', seq: 1, ts: 1, data: { status: 'understanding' }, replayed: true });

        const events = useQaStore.getState().byConv[CONV].search.events;
        expect(events).toHaveLength(1);
    });
});

// ── Phase 11: a cancelled run must not persist as a completed answer ──────
describe('persistence', () => {
    it('persists nothing when the search is cancelled', async () => {
        savedTurns.length = 0;
        const { runQa, cancelQa } = await loadStore();
        runQa(CONV, 'q');
        await settle();
        const ws = FakeSocket.instances[0];
        ws.open();
        ws.emit({ type: 'sources', seq: 1, ts: 1, data: { sources: [{ chunk_id: 'c1' }] } });

        cancelQa(CONV);
        await new Promise(r => setTimeout(r, 30));

        expect(savedTurns).toHaveLength(0);
    });

    it('persists the turn when the server actually answered', async () => {
        savedTurns.length = 0;
        const { runQa } = await loadStore();
        runQa(CONV, 'q');
        await settle();
        const ws = FakeSocket.instances[0];
        ws.open();
        ws.emit({
            type: 'answer', seq: 1, ts: 1,
            data: { answer: 'Revenue was $130,497 million.', citations: [], answer_state: 'ANSWERED' },
        });
        await new Promise(r => setTimeout(r, 30));

        expect(savedTurns.length).toBeGreaterThan(0);
    });
});

// ── Phase 9.3 / 11: a turn restored from history must not claim verification ──
describe('history turns cannot display an unearned verified badge', () => {
    it('a legacy persisted citation loads back without a verdict, so no badge', async () => {
        const { useQaStore } = await loadStore();
        const { showsVerifiedBadge } = await import('../lib/answerState');

        // Exactly what Supabase holds for a turn written before verdicts
        // existed: `is_verified` was whatever the model reported as entailed.
        const legacy = {
            citation_number: 1, chunk_id: 'c1', text: 'Revenue was $130,497 million.',
            document_title: 'NVDA 10-K', ticker: 'NVDA', section: 'Item 7',
            is_verified: true,
        } as unknown as import('../hooks/useGravitySearch').GravityCitation;

        useQaStore.getState().loadThread(CONV, [
            { role: 'user', content: 'q' },
            { role: 'assistant', content: 'a', citations: [legacy] },
        ]);

        const restored = useQaStore.getState().byConv[CONV].thread[1].citations!;
        expect(restored[0].is_verified).toBe(true);          // persisted as-is
        expect(restored[0].verification_status).toBeUndefined();
        // …but the badge is driven by the verdict, so nothing is claimed.
        expect(showsVerifiedBadge(restored[0])).toBe(false);
    });

    it('a turn persisted with a real verdict still shows the badge', async () => {
        const { useQaStore } = await loadStore();
        const { showsVerifiedBadge } = await import('../lib/answerState');

        useQaStore.getState().loadThread(CONV, [
            { role: 'user', content: 'q' },
            {
                role: 'assistant', content: 'a',
                citations: [{
                    citation_number: 1, chunk_id: 'c1', text: 't',
                    document_title: 'd', ticker: 'NVDA', section: 's',
                    is_verified: true, verification_status: 'verified',
                } as unknown as import('../hooks/useGravitySearch').GravityCitation],
            },
        ]);

        const restored = useQaStore.getState().byConv[CONV].thread[1].citations!;
        expect(showsVerifiedBadge(restored[0])).toBe(true);
    });

    it('the verdict is part of what gets persisted for a new turn', async () => {
        savedTurns.length = 0;
        const { runQa } = await loadStore();
        runQa(CONV, 'q');
        await settle();
        const ws = FakeSocket.instances[0];
        ws.open();
        ws.emit({
            type: 'answer', seq: 1, ts: 1,
            data: {
                answer: 'Revenue was $130,497 million.',
                answer_state: 'ANSWERED',
                citations: [{
                    citation_number: 1, chunk_id: 'c1', text: 't',
                    is_verified: false, verification_status: 'conflicting',
                    verification_reasons: ['period_mismatch'],
                }],
            },
        });
        await new Promise(r => setTimeout(r, 30));

        const assistant = savedTurns.find(
            (t): t is { role: string; citations: { verification_status?: string }[] } =>
                (t as { role?: string }).role === 'assistant',
        );
        expect(assistant).toBeTruthy();
        // Without this the next reader of the history has no way to tell a
        // checked citation from an unchecked one.
        expect(assistant!.citations[0].verification_status).toBe('conflicting');
    });
});
