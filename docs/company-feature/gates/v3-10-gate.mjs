// V3-10 gate. The anonymous meter keys on something the caller cannot choose.
//
// Promoted out of the V3 audit's "Unverified" list once the evidence was actually
// gathered. `clientKey()` took the FIRST value of `x-forwarded-for` and keyed the
// rate-limit bucket on it, and `index.ts` never called `app.set('trust proxy')` —
// so Express's default of `false` left that header completely unvalidated. A
// caller sending a fresh random `X-Forwarded-For` on every request got a fresh
// bucket every time, and GRAVITY_ANON_PER_MIN / _PER_HOUR bound nobody at all.
//
// Anonymous requests are served with the SHARED service key (CF-2), so this is
// the whole of the defence around that key's allowance.
//
// Behavioural: the real meter and the real clientKey, under Express's real
// trust-proxy resolution.
//
// Run from anywhere:  node docs/company-feature/gates/v3-10-gate.mjs
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n');
const win = (u) => new URL(u, root).pathname.replace(/^\/([A-Za-z]:)/, '$1');

let failures = 0;
const check = (name, ok, detail = '') => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `\n      ${detail}` : ''}`);
};

// ─── the meter and the key, compiled from source ────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'v3-10-'));
let mod;
try {
    const esbuild = await import(pathToFileURL(win('node_modules/esbuild/lib/main.js')).href);
    // gravity.ts pulls in the whole proxy; only the metering half is under test,
    // so it is sliced from clientKey to the end of _resetMeter.
    const src = read('services/market-server/src/routes/gravity.ts');
    const start = src.indexOf('export function clientKey');
    const end = src.indexOf('export function _resetMeter');
    if (start < 0 || end < 0) throw new Error('clientKey/_resetMeter not found — is clientKey exported?');
    const consts = src.match(/const ANON_PER_MIN[\s\S]*?const buckets = new Map<string, Bucket>\(\);/);
    if (!consts) throw new Error('the bucket declarations were not found');
    const body = [
        'type Bucket = { minute: number[]; hour: number[] };',
        consts[0].replace(/type Bucket[\s\S]*?\n/, ''),
        src.slice(start, src.indexOf('\n', src.indexOf('}', end))),
    ].join('\n').replace(/\bRequest\b/g, 'any');

    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
    writeFileSync(join(dir, 'm.js'), esbuild.transformSync(body, { loader: 'ts', format: 'esm' }).code);
    mod = await import(pathToFileURL(join(dir, 'm.js')).href);
} catch (e) {
    console.log(`FAIL  the metering half of gravity.ts could not be compiled\n      ${e.message}`);
    rmSync(dir, { recursive: true, force: true });
    process.exit(1);
}
const { clientKey, meter, _resetMeter } = mod;

// ─── how Express resolves req.ip under a hop count ──────────────────────────
// Rather than model it, the real express is asked: a request whose socket is the
// proxy and whose XFF the client forged must resolve to the address the TRUSTED
// hop appended, not to the forgery.
let express;
try {
    express = (await import(pathToFileURL(win('node_modules/express/index.js')).href)).default;
} catch (e) {
    console.log(`FAIL  express could not be loaded to resolve req.ip\n      ${e.message}`);
    rmSync(dir, { recursive: true, force: true });
    process.exit(1);
}

/** A request as Express would hand it to the route, for a given XFF header. */
function reqWith(xff, socketAddr = '10.0.0.1') {
    const app = express();
    app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));
    const req = Object.create(express.request);
    Object.assign(req, {
        app,
        headers: xff === null ? {} : { 'x-forwarded-for': xff },
        connection: { remoteAddress: socketAddr },
        socket: { remoteAddress: socketAddr },
    });
    return req;
}

// The client forges a value; the trusted edge proxy appends the real one.
const forgedA = reqWith('1.1.1.1, 203.0.113.7');
const forgedB = reqWith('2.2.2.2, 203.0.113.7');
const keyA = clientKey(forgedA);
const keyB = clientKey(forgedB);

check('a forged X-Forwarded-For does not change the bucket key',
    keyA === keyB,
    `two requests from one client keyed as ${keyA} and ${keyB} — the limiter can be reset at will`);

check('the key is the address the trusted proxy appended',
    keyA === '203.0.113.7',
    `key was ${JSON.stringify(keyA)}, not the value the edge proxy added`);

check('two genuinely different clients still get different buckets',
    clientKey(reqWith('1.1.1.1, 203.0.113.7')) !== clientKey(reqWith('1.1.1.1, 198.51.100.4')),
    'every client now shares one bucket — the limit would be global');

check('a request with no forwarding header falls back to the socket',
    clientKey(reqWith(null, '198.51.100.9')) === '198.51.100.9',
    'a direct request has no usable key');

// ─── the meter itself still bites on that key ───────────────────────────────
_resetMeter();
const ANON_PER_MIN = Number(process.env.GRAVITY_ANON_PER_MIN ?? 20);
let blocked = null;
for (let i = 0; i <= ANON_PER_MIN; i++) {
    // Alternate the forged prefix on every request: under the old key this reset
    // the bucket each time and nothing was ever refused.
    blocked = meter(clientKey(reqWith(`${i}.${i}.${i}.${i}, 203.0.113.7`)));
}
check('a client rotating its forged header is still rate-limited',
    blocked !== null && blocked.window === 'minute',
    `${ANON_PER_MIN + 1} requests with rotating forged headers were all allowed`);

check('the refusal still names the window and a retry time',
    blocked !== null && typeof blocked.retryAfter === 'number' && blocked.retryAfter > 0,
    `got ${JSON.stringify(blocked)}`);

_resetMeter();
check('a fresh bucket allows the first request',
    meter(clientKey(reqWith('9.9.9.9, 203.0.113.7'))) === null);

// ─── the source ─────────────────────────────────────────────────────────────
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const gravity = strip(read('services/market-server/src/routes/gravity.ts'));
check('clientKey no longer reads the raw header',
    !/req\.headers\['x-forwarded-for'\]/.test(gravity),
    'the raw x-forwarded-for header is still read for the bucket key');
check('clientKey reads req.ip', /req\.ip \|\|/.test(gravity),
    'clientKey does not use Express\'s resolved client address');

const index = strip(read('services/market-server/src/index.ts'));
check('the app declares how many proxies it trusts',
    /app\.set\('trust proxy'/.test(index),
    "without `trust proxy`, req.ip is the socket address and x-forwarded-for is unvalidated");
check('the hop count is configurable per deployment',
    /TRUST_PROXY_HOPS/.test(index),
    'the hop count is hardcoded — a server reached directly needs 0');
check('trust proxy is set before any route is mounted',
    index.indexOf("app.set('trust proxy'") < index.indexOf("app.use('/api/gravity'"),
    'the setting is applied after the router that depends on it');

rmSync(dir, { recursive: true, force: true });
console.log(`\nRESULT ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
