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
import type { Request, Response } from 'express';

export const gravityRouter = Router();

const GRAVITY_BASE = process.env.GRAVITY_API_URL ?? 'http://localhost:8000';
const TIMEOUT_MS = 30_000;

// Read per call, not at module load. Binding it at import time means the value
// depends on whether dotenv ran first, which is invisible until something reads
// the wrong one — as this file's own test did, silently sending no key at all.
const gravityKey = () => process.env.GRAVITY_API_KEY ?? '';

// ─── CF-12 · per-viewer metering ─────────────────────────────────────────────
//
// The service key carries tier:unlimited and auth.py deliberately routes API keys
// around _apply_entitlement, so it bypasses every tier and rate limit the billing
// work built. CF-2 moved that key here, which fixed the leak and created a new
// problem: every anonymous viewer now shares ONE key, so a limit on the key is a
// limit on all of them at once — the first heavy user of the minute would 429
// everybody else.
//
// So the key is not what gets metered. Two paths:
//
//   signed in  — the viewer's own bearer token is forwarded and the service key is
//                NOT sent, so gravity-api resolves their real subscription tier
//                through _apply_entitlement. The paywall works as designed.
//   anonymous  — the service key is used, and this proxy meters per client so one
//                viewer cannot spend the shared allowance.
const ANON_PER_MIN = Number(process.env.GRAVITY_ANON_PER_MIN ?? 20);
const ANON_PER_HOUR = Number(process.env.GRAVITY_ANON_PER_HOUR ?? 200);

type Bucket = { minute: number[]; hour: number[] };
const buckets = new Map<string, Bucket>();

function clientKey(req: Request): string {
    const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    return fwd || req.socket.remoteAddress || 'unknown';
}

/** null when allowed; otherwise the window that is full and when it frees up. */
export function meter(key: string, now = Date.now()): { window: string; retryAfter: number } | null {
    const b = buckets.get(key) ?? { minute: [], hour: [] };
    b.minute = b.minute.filter(t => now - t < 60_000);
    b.hour = b.hour.filter(t => now - t < 3_600_000);

    if (b.minute.length >= ANON_PER_MIN) {
        buckets.set(key, b);
        return { window: 'minute', retryAfter: Math.ceil((60_000 - (now - b.minute[0])) / 1000) };
    }
    if (b.hour.length >= ANON_PER_HOUR) {
        buckets.set(key, b);
        return { window: 'hour', retryAfter: Math.ceil((3_600_000 - (now - b.hour[0])) / 1000) };
    }
    b.minute.push(now);
    b.hour.push(now);
    buckets.set(key, b);
    return null;
}

/** Test seam — the buckets are module state and outlive a single request. */
export function _resetMeter(): void { buckets.clear(); }

/**
 * Headers for the upstream call, or a 429 already sent.
 *
 * Returns null when the request was rejected, so the caller stops.
 */
function upstreamHeaders(req: Request, res: Response, json = false): Record<string, string> | null {
    const h: Record<string, string> = {};
    if (json) h['Content-Type'] = 'application/json';

    const bearer = req.headers.authorization;
    if (typeof bearer === 'string' && bearer.startsWith('Bearer ')) {
        // Signed in: their token, their tier, their limits. No service key.
        h.Authorization = bearer;
        return h;
    }

    const full = meter(clientKey(req));
    if (full) {
        res.set('Retry-After', String(full.retryAfter))
            .status(429)
            .json({
                error: `Anonymous request limit reached (per ${full.window}). `
                    + `Sign in for your plan's limits, or retry in ${full.retryAfter}s.`,
                retryAfter: full.retryAfter,
            });
        return null;
    }
    const key = gravityKey();
    if (key) h['X-API-Key'] = key;
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
gravityRouter.post('/search', (req, res) => {
    const headers = upstreamHeaders(req, res, true);
    if (!headers) return;
    return forward(res, '/v1/search', {
        method: 'POST',
        headers,
        body: JSON.stringify(req.body),
    });
});

// Source viewer — the passage around a cited chunk.
gravityRouter.get('/chunk/:chunkId/context', (req, res) => {
    const headers = upstreamHeaders(req, res);
    if (!headers) return;
    const window = Number(req.query.window) || 1;
    return forward(
        res,
        `/v1/documents/chunk/${encodeURIComponent(req.params.chunkId)}/context?window=${window}`,
        { headers },
    );
});

// Saved searches.
gravityRouter.post('/workspaces', (req, res) => {
    const headers = upstreamHeaders(req, res, true);
    if (!headers) return;
    return forward(res, '/v1/workspaces', {
        method: 'POST',
        headers,
        body: JSON.stringify(req.body),
    });
});
