// Gravity proxy — server-side key injection.
//
// The browser used to send `X-API-Key: deep-research-internal` itself. That key
// is on gravity-api's static internal allowlist, which carries tier=unlimited and
// deliberately skips _apply_entitlement, so anyone reading the bundle in devtools
// held an unlimited, un-rate-limited account. These three routes are the only
// gravity-api calls the browser actually needed it for; the key now lives here.
//
// Deliberately NOT a generic passthrough: a wildcard proxy that injects an
// unlimited-tier key would let a caller relay any gravity-api endpoint with those
// rights, which is worse than the leak it replaces. One handler per real need.

import { Router } from 'express';

export const gravityRouter = Router();

const GRAVITY_BASE = process.env.GRAVITY_API_URL ?? 'http://localhost:8000';
const GRAVITY_KEY = process.env.GRAVITY_API_KEY ?? '';
const TIMEOUT_MS = 30_000;

function keyHeaders(json = false): Record<string, string> {
    const h: Record<string, string> = GRAVITY_KEY ? { 'X-API-Key': GRAVITY_KEY } : {};
    if (json) h['Content-Type'] = 'application/json';
    return h;
}

async function forward(res: any, path: string, init: RequestInit) {
    try {
        const upstream = await fetch(`${GRAVITY_BASE}${path}`, {
            ...init,
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const body = await upstream.text();
        res.status(upstream.status)
            .type(upstream.headers.get('content-type') ?? 'application/json')
            .send(body);
    } catch (e: any) {
        res.status(502).json({ error: e?.message ?? 'Gravity proxy failed' });
    }
}

// The RAG call behind the Research Grid, the AI Company Brief and Devil's Advocate.
gravityRouter.post('/search', (req, res) =>
    forward(res, '/v1/search', {
        method: 'POST',
        headers: keyHeaders(true),
        body: JSON.stringify(req.body),
    }));

// Source viewer — the passage around a cited chunk.
gravityRouter.get('/chunk/:chunkId/context', (req, res) => {
    const window = Number(req.query.window) || 1;
    return forward(
        res,
        `/v1/documents/chunk/${encodeURIComponent(req.params.chunkId)}/context?window=${window}`,
        { headers: keyHeaders() },
    );
});

// Saved searches.
gravityRouter.post('/workspaces', (req, res) =>
    forward(res, '/v1/workspaces', {
        method: 'POST',
        headers: keyHeaders(true),
        body: JSON.stringify(req.body),
    }));
