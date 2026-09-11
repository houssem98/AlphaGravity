// CF-25 gate. A search that did not finish must not be reported as an empty corpus.
//
// The AI Company Brief rendered, for every cell:
//   No data available for "<the entire prompt>" in SEC filings or public sources.
//
// That is a claim about what AMD filed. The truth was a timeout I introduced in
// CF-2: the proxy aborted at 30s while the browser was willing to wait 45s, and a
// cold /v1/search for AMD measured 30.097s — a 97ms margin. Warm cells squeaked
// through, cold ones did not, so it looked like flaky data rather than a clock.
//
// Run with market-server and gravity-api up:
//   node docs/company-feature/gates/cf25-gate.mjs
import { readFileSync } from 'node:fs';

const ROOT = 'c:/Users/unicentrale/Downloads/antigravity';
const PROXY = process.env.PROXY ?? 'http://127.0.0.1:3002';

const proxySrc = readFileSync(`${ROOT}/services/market-server/src/routes/gravity.ts`, 'utf8');
const clientSrc = readFileSync(`${ROOT}/apps/market-ui/src/services/gravitySearchService.ts`, 'utf8');
const gridSrc = readFileSync(`${ROOT}/apps/market-ui/src/services/gridResearch.ts`, 'utf8');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `\n      ${detail}` : ''}`);
};

// ─── the clock ──────────────────────────────────────────────────────────────
const proxyMs = Number(proxySrc.match(/TIMEOUT_MS = ([\d_]+)/)[1].replace(/_/g, ''));
const clientMs = Number(clientSrc.match(/RAG_TIMEOUT_MS = ([\d_]+)/)[1].replace(/_/g, ''));
check('the proxy waits at least as long as the client that calls it',
  proxyMs >= clientMs,
  `proxy ${proxyMs}ms < client ${clientMs}ms — the proxy kills calls the browser still wants`);
console.log(`      proxy ${proxyMs / 1000}s vs client ${clientMs / 1000}s`);

// ─── a fault is reported as a fault ─────────────────────────────────────────
check('a non-ok response carries a stated failure, not a bare empty result',
  /return \{ \.\.\.EMPTY_RESULT, failure:/.test(clientSrc));
check('a timeout says it timed out, and for how long',
  /failure: isTimeout/.test(clientSrc) && /timed out after \$\{RAG_TIMEOUT_MS/.test(clientSrc));
check('the cell distinguishes a failed search from an empty one',
  /ragResult\?\.failure\s*\n?\s*\?\s*`Search did not complete/.test(gridSrc),
  'the "No data available" sentence is still unconditional');
check('and marks the cell so the failure is machine-readable',
  /modelUsed: ragResult\?\.failure \? 'search-failed' : 'no-sources'/.test(gridSrc));
check('the cell counts citations as evidence, not sources alone',
  /ragResult\.citations\?\.length \?\? 0\) > 0/.test(gridSrc),
  'a cache hit returns citations with no sources and would blank the cell');

// ─── the two cells from the screenshot ──────────────────────────────────────
const PROMPTS = [
  ['THESIS', 'AMD investment thesis growth drivers margins disclosed risks headwinds'],
  ['MOAT', 'AMD competitive advantages market position scale switching costs brand'],
];

for (const [label, query] of PROMPTS) {
  const t0 = Date.now();
  let body, status;
  try {
    const r = await fetch(`${PROXY}/api/gravity/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query, filters: { companies: ['AMD'] },
        options: { reasoning_depth: 'fast', stream: false },
      }),
    });
    status = r.status;
    body = await r.json();
  } catch (e) {
    check(`${label}: the request completes`, false, e.message);
    continue;
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const sources = body?.sources?.length ?? 0;

  check(`${label}: the proxy does not abort the call`, status === 200 && !body?.error,
    `http=${status} error=${JSON.stringify(body?.error ?? null)} after ${secs}s`);
  // Evidence, not specifically `sources`. A cache hit returns the answer and its
  // citations with an EMPTY sources array — measured on AMD: cache_hit true, 0
  // sources, 4 citations, 10,377 chars — and a cell built only on `sources`
  // blanked all of that as "no data available in SEC filings".
  const cites = body?.citations?.length ?? 0;
  const answerChars = (body?.answer ?? '').length;
  check(`${label}: the search returns usable evidence`, sources > 0 || cites > 0,
    `${sources} sources, ${cites} citations, ${answerChars} chars after ${secs}s`);
  check(`${label}: and an answer to render`, answerChars > 0, `${answerChars} chars`);
  console.log(`      ${label}: ${sources} sources, ${cites} citations, ${answerChars} chars, `
    + `${secs}s${body?.metadata?.cache_hit ? ' (cache hit)' : ''}`);
}

console.log(`\nRESULT ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
