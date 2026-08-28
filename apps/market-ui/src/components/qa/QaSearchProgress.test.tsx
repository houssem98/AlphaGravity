import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import QaSearchProgress from './QaSearchProgress';
import {
    toPipelineEvent, describeRetrieval, verificationSummary, isBackendStage,
    type PipelineEvent, type GravityCitation,
} from '../../hooks/useGravitySearch';

// Quick Answer roadmap, Phases 1 and 9: the progress view is a projection of
// backend events and may not narrate work of its own.
//
// The component this replaces held an array of scripted lines naming Qdrant,
// Elasticsearch, Neo4j, SPLADE and Cohere, revealed on a 650ms timer on every
// query — including on deployments where those services are not configured at
// all. These tests fail if that behaviour returns.

const PROVIDER_NAMES = [
    'Qdrant', 'Elasticsearch', 'Neo4j', 'SPLADE', 'Cohere',
    'voyage-finance', 'rerank-v3.5', 'BM25',
];

function ev(partial: Partial<PipelineEvent>): PipelineEvent {
    return {
        seq: 1, type: 'status', stage: 'understanding',
        label: 'Understanding the question', ts: 1_700_000_000_000,
        replayed: false, ...partial,
    };
}

function render(props: Partial<Parameters<typeof QaSearchProgress>[0]> = {}) {
    return renderToStaticMarkup(
        <QaSearchProgress
            status="understanding"
            sourcesCount={0}
            citations={[]}
            events={[]}
            retrieval={null}
            {...props}
        />,
    );
}

// ── The source itself may not carry provider narration ───────────────────
describe('no scripted provider narration', () => {
    it('the component source names no retrieval provider', () => {
        // A source scan, because the failure mode is a hard-coded string that
        // renders unconditionally — which no state-based test would catch if
        // the string were added back under a new condition.
        const src = readFileSync(new URL('./QaSearchProgress.tsx', import.meta.url), 'utf8');
        // Strip the header comment, which describes the removed behaviour and
        // therefore legitimately mentions those names.
        const code = src.slice(src.indexOf("import { useEffect"));
        for (const name of PROVIDER_NAMES) {
            expect(code, `component still names ${name}`).not.toContain(name);
        }
    });

    it('the component source has no interval or timeout driving progress', () => {
        const src = readFileSync(new URL('./QaSearchProgress.tsx', import.meta.url), 'utf8');
        const code = src.slice(src.indexOf("import { useEffect"));
        expect(code).not.toContain('setInterval');
        expect(code).not.toContain('setTimeout');
    });
});

// ── Nothing is shown that the server did not send ────────────────────────
describe('renders only what the server sent', () => {
    it('shows no log lines at all when no events have arrived', () => {
        const html = render();
        expect(html).toContain('Waiting for the first event');
        for (const name of PROVIDER_NAMES) {
            expect(html).not.toContain(name);
        }
    });

    it('names a channel only after a retrieval event names it', () => {
        const before = render();
        expect(before).toContain('not yet reported');

        const after = render({
            status: 'reranking',
            retrieval: {
                channels_used: ['dense_pg'], channels_dark: ['bm25_es'],
                candidates: 12, passages_used: 3, retrieval_ms: 41.2, rerank_ms: 7.5,
            },
            events: [ev({
                seq: 2, type: 'retrieval', stage: 'searching',
                label: describeRetrieval({
                    channels_used: ['dense_pg'], channels_dark: ['bm25_es'],
                    candidates: 12, passages_used: 3, retrieval_ms: 41.2, rerank_ms: 7.5,
                }),
            })],
        });
        expect(after).toContain('dense_pg');
        expect(after).toContain('1 channel');
        // A dark channel is reported as dark, never as one that ran.
        expect(after).toContain('returned nothing');
    });

    it('renders the server timestamp, not the render-time clock', () => {
        const ts = Date.UTC(2026, 0, 2, 3, 4, 5);
        const html = render({ events: [ev({ ts })] });
        const expected = new Date(ts).toLocaleTimeString('en-US', {
            hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
        expect(html).toContain(expected);
    });

    it('marks replayed events so a reconnect is visible as a replay', () => {
        const html = render({ events: [ev({ replayed: true })] });
        expect(html.toLowerCase()).toContain('replayed');
    });
});

// ── Verification is counted from verdicts, not from citation count ───────
describe('verification is reported from verdicts', () => {
    const cite = (verification_status: string): GravityCitation => ({
        citation_number: 1, chunk_id: 'c1', text: 't', document_title: 'd',
        ticker: 'NVDA', section: 's', is_verified: verification_status === 'verified',
        verification_status: verification_status as GravityCitation['verification_status'],
    });

    it('counts only verified citations as verified', () => {
        const html = render({
            status: 'reasoning',
            citations: [cite('verified'), cite('unsupported'), cite('partially_supported')],
        });
        // The old footer said "3 citations verified" — it counted citations,
        // so every citation was verified by definition.
        expect(html).toContain('1 of 3 citations verified');
        expect(html).toContain('1 flagged');
        expect(html).not.toContain('3 of 3');
    });

    it('verificationSummary buckets every verdict', () => {
        expect(verificationSummary([cite('verified'), cite('verified'), cite('conflicting')]))
            .toEqual({ verified: 2, conflicting: 1 });
    });
});

// ── Terminal states are distinct and honest ──────────────────────────────
describe('terminal states', () => {
    it('cancelled is shown as cancelled, not as complete', () => {
        const html = render({ status: 'cancelled' });
        expect(html).toContain('Cancelled');
        expect(html).not.toContain('Complete');
    });

    it('progress does not advance past the stage the server reported', () => {
        // `understanding` is column 0 of 4 → 0%. The old component hard-coded
        // 15% for this status, and 93% for a `validating` stage the backend
        // never emits.
        expect(render({ status: 'understanding' })).toContain('>0%<');
        expect(render({ status: 'reasoning' })).toContain('>75%<');
    });
});

// ── The projection rejects anything the server did not send ──────────────
describe('toPipelineEvent', () => {
    it('returns null for frames that carry no operational line', () => {
        expect(toPipelineEvent({ type: 'token', data: { token: 'hi' } })).toBeNull();
        expect(toPipelineEvent({ type: 'answer', data: {} })).toBeNull();
        expect(toPipelineEvent(null)).toBeNull();
        expect(toPipelineEvent({})).toBeNull();
        expect(toPipelineEvent('not an object')).toBeNull();
    });

    it('preserves the server sequence and timestamp', () => {
        const e = toPipelineEvent({
            type: 'status', data: { status: 'reranking' }, seq: 7, ts: 1_700_000_000,
        });
        expect(e).not.toBeNull();
        expect(e!.seq).toBe(7);
        expect(e!.ts).toBe(1_700_000_000 * 1000);
        expect(e!.stage).toBe('reranking');
    });

    it('keeps a stage the old map would have thrown away', () => {
        // `resolving_primary_source` is emitted by the pipeline and was absent
        // from the frontend's status map, so `STATUS_STAGE[status] ?? -1` reset
        // the whole progress display mid-run.
        const e = toPipelineEvent({ type: 'status', data: { status: 'resolving_primary_source' } });
        expect(e!.stage).toBe('resolving_primary_source');
        expect(isBackendStage('resolving_primary_source')).toBe(true);
    });

    it('does not treat an unknown stage as a known one', () => {
        expect(isBackendStage('validating')).toBe(false);
        expect(isBackendStage('totally_made_up')).toBe(false);
        const e = toPipelineEvent({ type: 'status', data: { status: 'totally_made_up' } });
        expect(e!.stage).toBeNull();
    });

    it('describes a cancel frame as a server-side stop', () => {
        const e = toPipelineEvent({ type: 'cancelled', data: { status: 'cancelled' } });
        expect(e!.stage).toBe('cancelled');
        expect(e!.label).toContain('server');
    });

    it('reports the model actually used from metadata', () => {
        const e = toPipelineEvent({
            type: 'metadata', data: { model_used: 'deepseek-chat', latency_ms: 812 },
        });
        expect(e!.label).toBe('Answered by deepseek-chat in 812ms');
    });
});

// ── Phase 7: a failed channel is not an empty one ────────────────────────
describe('degraded retrieval is reported as degraded', () => {
    const degraded = {
        channels_used: ['dense_pg'],
        channels_dark: [],
        channels_failed: { bm25_es: 'ConnectionError' },
        degraded: true,
        candidates: 4, passages_used: 2, retrieval_ms: 30, rerank_ms: 5,
    };

    it('says a failed channel failed, not that it returned nothing', () => {
        const line = describeRetrieval(degraded);
        expect(line).toContain('1 failed: bm25_es');
        expect(line).not.toContain('returned nothing');
    });

    it('shows the degraded state in the footer', () => {
        const html = render({ status: 'reranking', retrieval: degraded });
        expect(html).toContain('Degraded');
        expect(html).toContain('bm25_es');
    });

    it('counts the failed channel against the total, not out of it', () => {
        const html = render({ status: 'reranking', retrieval: degraded });
        // 1 of 2, not "1 channel" as though only one had ever been asked.
        expect(html).toContain('1 of 2 channels');
    });

    it('an all-empty but healthy run is not called degraded', () => {
        const html = render({
            status: 'reranking',
            retrieval: { ...degraded, channels_failed: {}, degraded: false, channels_dark: ['bm25_es'] },
        });
        expect(html).not.toContain('Degraded');
        expect(html).toContain('1 channel');
    });
});
