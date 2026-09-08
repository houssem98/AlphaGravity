// CF-11 · an empty completion is a failed call.
//
// `content ?? ''` turned a reasoning model's `content: null` into an empty string,
// so /api/llm/chat answered HTTP 200 with "" and emitted a trace saying ok:true.
// The AI Company Brief rendered "Not generated." for every section and nothing
// anywhere reported a failure. This asserts both halves of the fix: the response
// status, and what the trace records.

import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { llmRouter, parseCompletion } from './llm.js';

// A DeepSeek response exactly as a reasoning model returns one: the budget went
// to reasoning_content, and `content` is null.
const { reasoningModelReply } = vi.hoisted(() => ({
    reasoningModelReply: {
        choices: [{
            message: { role: 'assistant', content: null, reasoning_content: 'x'.repeat(4096) },
            finish_reason: 'length',
        }],
    },
}));

// llm.ts calls providers through undici's fetch, not the global one, so the
// global is left alone — which also keeps this test's own request to the server
// real rather than intercepting it.
vi.mock('undici', async (importOriginal) => {
    const actual = await importOriginal<typeof import('undici')>();
    return {
        ...actual,
        fetch: async () => new Response(JSON.stringify(reasoningModelReply), {
            status: 200, headers: { 'Content-Type': 'application/json' },
        }),
    };
});

describe('parseCompletion', () => {
    it('returns the text when there is text', () => {
        expect(parseCompletion(
            { choices: [{ message: { content: 'AAPL revenue was $391B.' } }] }, 'deepseek-chat', 2048,
        )).toBe('AAPL revenue was $391B.');
    });

    it('throws on a reasoning model that produced no content, and names the cause', () => {
        let err: any;
        try { parseCompletion(reasoningModelReply, 'deepseek-v4-flash', 2048); } catch (e) { err = e; }
        expect(err).toBeInstanceOf(Error);
        expect(err.status).toBe(502);
        // The message has to be actionable — this is the sentence that would have
        // saved the time CF-1 cost.
        expect(err.message).toContain('deepseek-v4-flash');
        expect(err.message).toContain('reasoning_content');
        expect(err.message).toContain('deepseek-chat');
    });

    it('throws on a plain empty completion, carrying finish_reason when present', () => {
        let err: any;
        try {
            parseCompletion({ choices: [{ message: { content: '   ' }, finish_reason: 'stop' }] }, 'm', 512);
        } catch (e) { err = e; }
        expect(err.status).toBe(502);
        expect(err.message).toContain('finish_reason: stop');
    });

    it('throws on a malformed response rather than yielding empty string', () => {
        expect(() => parseCompletion({}, 'm', 512)).toThrow();
        expect(() => parseCompletion({ choices: [] }, 'm', 512)).toThrow();
    });
});

describe('POST /api/llm/chat with an empty completion', () => {
    let server: Server;
    let base: string;
    const logged: string[] = [];

    beforeAll(async () => {
        process.env.DEEPSEEK_API_KEY = 'test-key';
        // emitTrace writes one JSON line to stdout; that line is the trace.
        vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            logged.push(args.map(String).join(' '));
        });

        const app = express();
        app.use(express.json());
        app.use('/api/llm', llmRouter);
        await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        vi.restoreAllMocks();
        await new Promise<void>(resolve => server.close(() => resolve()));
    });

    it('answers non-2xx instead of 200 with an empty string', async () => {
        const res = await fetch(`${base}/api/llm/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider: 'deepseek', model: 'deepseek-v4-flash',
                prompt: 'AAPL investment thesis', max_tokens: 2048,
            }),
        });
        expect(res.ok).toBe(false);
        expect(res.status).toBeGreaterThanOrEqual(400);

        const body = await res.json();
        expect(body.error).toContain('reasoning_content');
        // And crucially: no `text` field a caller could render as an answer.
        expect(body.text).toBeUndefined();
    });

    it('records ok:false in the emitted trace', () => {
        const traces = logged
            .map(l => { try { return JSON.parse(l); } catch { return null; } })
            .filter(t => t?.event === 'llm_call');

        expect(traces.length).toBeGreaterThan(0);
        for (const t of traces) {
            expect(t.ok).toBe(false);
            expect(t.outputChars).toBe(0);
            expect(t.errorMessage).toBeTruthy();
        }
    });
});
