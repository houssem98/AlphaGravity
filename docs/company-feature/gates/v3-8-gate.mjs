// V3-8 gate. An unauthenticated caller cannot make this server spend provider
// credits.
//
// GET /api/llm/health has no inbound auth, and it honoured `?refresh=1` by
// skipping its five-minute cache and calling DeepSeek, Anthropic and Gemini live
// — three billable provider calls per request, from anyone who could reach the
// server, repeatable as fast as they could send. V2-6 hardened /chat; this was
// the same exposure one route over.
//
// WHO may read provider availability is a product question and is deliberately
// unchanged (escalation E-3). What is gated here is the spend.
//
// Run from anywhere:  node docs/company-feature/gates/v3-8-gate.mjs
import { readFileSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n');

let failures = 0;
const check = (name, ok, detail = '') => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `\n      ${detail}` : ''}`);
};

const raw = read('services/market-server/src/routes/llm.ts');
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ─── the caller-controlled bypass is gone ───────────────────────────────────
check('no caller-supplied refresh parameter is read anywhere in this file',
    !/req\.query\.refresh/.test(src),
    '`req.query.refresh` still reaches the probe path');

check('the health route reads no request input at all',
    /llmRouter\.get\('\/health',\s*async \(_req, res\)/.test(src),
    'the health handler still takes a named request — it should need nothing from the caller');

check('no query parameter can skip the cache',
    !/const fresh\s*=/.test(src) && !/!fresh &&/.test(src),
    'a `fresh` bypass is still in the handler');

// ─── the cold path is coalesced ─────────────────────────────────────────────
check('concurrent cold requests share one in-flight probe',
    /healthInFlight/.test(src),
    'N simultaneous first-requests still cause N rounds of provider calls');

check('the in-flight promise is awaited rather than re-created',
    /if \(healthInFlight\) return \{ data: await healthInFlight/.test(src),
    'a second caller arriving during a probe starts its own');

check('the in-flight handle is released when the probe settles',
    /finally \{\s*healthInFlight = null;\s*\}/.test(src),
    'a failed probe would wedge the route on a dead promise');

check('the cache is still honoured before any probe',
    /if \(healthCache && now - healthCache\.at < HEALTH_TTL_MS\)/.test(src),
    'the TTL check is gone, so every request probes');

check('the TTL is still a real window, not zero',
    /const HEALTH_TTL_MS = 5 \* 60_000;/.test(src),
    'the cache window changed — a shorter one is more provider calls');

// ─── the probe is reached through exactly one path ──────────────────────────
const probeCalls = (src.match(/probeProvider\(/g) || []).length;
check('probeProvider is defined once and called from one place',
    probeCalls === 2,
    `probeProvider appears ${probeCalls} times (its definition plus one call site expected) — a second call site is a second billable path`);

check('the probe still has a hard token ceiling',
    /const HEALTH_PROBE_TOKENS = 16;/.test(src),
    'the probe budget changed');

// ─── the route still answers the question it exists for ─────────────────────
check('the response still reports each provider',
    /res\.json\(\{ providers: data, cached/.test(src),
    'the health payload changed shape — CompanyBrief reads `providers`');

check('the response still says whether it was served from cache',
    /cached,/.test(src),
    'the caller can no longer tell a cached answer from a fresh one');

// ─── nothing in the repo asks for a forced refresh ──────────────────────────
for (const p of [
    'apps/market-ui/src/components/company/CompanyBrief.tsx',
]) {
    check(`${p.split('/').pop()} does not request a forced refresh`,
        !/health\?refresh|refresh=1/.test(read(p)),
        'a caller still asks for the bypass that no longer exists');
}

// ─── /chat's V2-6 defences are still standing ───────────────────────────────
check("V2-6's auth on /chat is untouched",
    /llmRouter\.post\('\/chat',\s*authMiddleware/.test(src),
    'the chat route lost its auth middleware');
check("V2-6's per-viewer meter on /chat is untouched",
    /meter\(`llm:\$\{req\.user\?\.id \?\? 'unknown'\}`\)/.test(src),
    'the chat route lost its meter');

console.log(`\nRESULT ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
