// V4-2 gate. No anonymous caller can make this server spend a provider's money.
//
// V3-8 asked that question of /api/llm/health and answered it there. It was never
// asked of the routers next door. Measured at 7419ccb:
//
//   firecrawl.ts  — ZERO occurrences of authMiddleware. POST /scrape, /search and
//                   /crawl each read FIRECRAWL_API_KEY. /crawl is the most
//                   expensive operation the vendor sells, took a caller-supplied
//                   url, and clamped `limit` but not `maxDepth`.
//   trading.ts    — ZERO occurrences of authMiddleware. GET /social/influencers/:asset
//                   calls api.tavily.com once PER INFLUENCER, and `?handles=` was
//                   caller-supplied and unbounded: one anonymous GET could buy a
//                   hundred Tavily searches.
//   index.ts      — installs no global auth middleware.
//
// Run from anywhere:  node docs/company-feature/gates/v4-2-gate.mjs
import { readFileSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let failures = 0;
const check = (name, ok, detail = '') => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `\n      ${detail}` : ''}`);
};

const firecrawl = strip(read('services/market-server/src/routes/firecrawl.ts'));
const trading = strip(read('services/market-server/src/routes/trading.ts'));
const index = strip(read('services/market-server/src/index.ts'));

// ─── firecrawl: the whole router is behind a viewer ─────────────────────────
check('the firecrawl router requires a viewer',
    /router\.use\(authMiddleware\)/.test(firecrawl),
    'firecrawl.ts still exposes the paid key with no inbound auth');

check('the viewer gate is installed BEFORE any route is declared',
    firecrawl.indexOf('router.use(authMiddleware)') < firecrawl.search(/router\.(post|get)\(/),
    'a route is declared above the auth middleware and escapes it');

// Every route that spends is metered; the status poll deliberately is not.
const paidRoutes = ['/scrape', '/search', '/crawl'];
for (const r of paidRoutes) {
    const at = firecrawl.indexOf(`router.post('${r}'`);
    const next = firecrawl.indexOf('router.', at + 10);
    const body = at >= 0 ? firecrawl.slice(at, next < 0 ? undefined : next) : '';
    check(`POST ${r} is metered per viewer`,
        /meterViewer\(req, res\)/.test(body),
        `no meter between the key check and the provider call for ${r}`);
    check(`POST ${r} meters BEFORE it calls the provider`,
        body.indexOf('meterViewer') < body.indexOf('await fetch('),
        `${r} issues the billable call before metering it`);
}

const pollAt = firecrawl.indexOf("router.get('/crawl/:id'");
const pollBody = pollAt >= 0 ? firecrawl.slice(pollAt) : '';
check('the crawl status poll is authed but NOT metered',
    pollAt >= 0 && !/meterViewer/.test(pollBody),
    'polling your own job burns your own quota and 429s you out of watching it');

check('maxDepth is clamped server-side',
    /Math\.min\(Math\.max\(maxDepth, 1\), \d+\)/.test(firecrawl),
    'the caller can still choose the crawl depth, and depth is what costs');
check('limit is still clamped server-side',
    /Math\.min\(limit, \d+\)/.test(firecrawl),
    'the crawl page budget is caller-controlled');

// ─── trading: the one route that spends is the one that is authed ───────────
check('the influencer route requires a viewer',
    /router\.get\('\/social\/influencers\/:asset', authMiddleware/.test(trading),
    'an anonymous GET still fans out to Tavily once per influencer');

check('the influencer route is metered per viewer',
    /meter\(`tavily:\$\{req\.user\?\.id/.test(trading),
    'an authenticated caller can still issue unbounded paid fan-out');

check('the fan-out has a ceiling the caller cannot raise',
    /slice\(0, MAX_INFLUENCERS\)/.test(trading),
    '`?handles=` is still unbounded: N handles is N paid calls in one request');

check('the ceiling is a real number',
    /const MAX_INFLUENCERS = \d+;/.test(trading));

// The public market-data routes must NOT have acquired auth — the /trading hub
// reads them anonymously and this gate exists to keep the fix narrow.
check('public market-data routes stay open',
    /router\.get\('\/quote', async \(req: Request/.test(trading)
    && /router\.get\('\/crypto\/markets'/.test(trading)
    && !/router\.get\('\/quote', authMiddleware/.test(trading),
    'the fix widened past the routes that actually spend money');

// ─── no global middleware is masking any of this ────────────────────────────
check('index.ts still installs no global auth (so per-router auth is load-bearing)',
    !/app\.use\(authMiddleware\)/.test(index),
    'a global auth would make these per-router checks untestable rather than true');

// ─── every router that spends is accounted for ──────────────────────────────
const SPENDERS = {
    'tavily.ts': /tavilyRouter\.use\(authMiddleware\)/,
    'firecrawl.ts': /router\.use\(authMiddleware\)/,
    'research.ts': /researchRouter\.use\(authMiddleware\)/,
    'claude.ts': /claudeRouter\.use\(authMiddleware\)/,
    'hermes.ts': /hermesRouter\.use\(authMiddleware\)/,
};
for (const [file, pattern] of Object.entries(SPENDERS)) {
    check(`${file} is behind a viewer`,
        pattern.test(strip(read(`services/market-server/src/routes/${file}`))),
        `${file} spends a provider key with no router-level auth`);
}

check('/api/llm/chat keeps its V2-6 auth',
    /llmRouter\.post\('\/chat', authMiddleware/.test(strip(read('services/market-server/src/routes/llm.ts'))));

console.log(`\nRESULT ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
