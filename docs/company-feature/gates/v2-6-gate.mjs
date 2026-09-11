// V2-6 gate. /api/llm/chat is not an open spend endpoint.
//
// The route took caller-supplied provider, model, prompt and max_tokens and
// invoked a provider with SERVER-side credentials under no inbound auth at all
// — the only Authorization in the file was the outbound provider header.
// Anyone who could reach market-server could choose the model and spend the
// credits.
//
// Run from the repo root:  node docs/company-feature/gates/v2-6-gate.mjs
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `\n      ${detail}` : ''}`);
};

// Three gates in the previous ledger matched their own explanatory text, and
// this header names every construct the row forbids. Source shape is asserted
// against code with the comments removed.
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const llm = stripComments(read('services/market-server/src/routes/llm.ts'));
const gravity = stripComments(read('services/market-server/src/routes/gravity.ts'));

// ─── the behaviour, end to end on a real socket ─────────────────────────────
const SUITE = 'src/routes/llm.auth.test.ts';
let out = '';
let suiteOk = true;
try {
  out = execFileSync('npx', ['vitest', 'run', SUITE], {
    cwd: new URL('../../../services/market-server/', import.meta.url),
    encoding: 'utf8', stdio: 'pipe', shell: true,
  });
} catch (e) {
  suiteOk = false;
  out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
}
check(`${SUITE} passes`, suiteOk, out.trim().split('\n').slice(-15).join('\n      '));

// A green suite proves nothing if it does not contain the three cases the row
// names. These are checked in the suite's SOURCE, so the assertions cannot be
// quietly dropped while the file keeps passing.
const suite = stripComments(read('services/market-server/' + SUITE));
check('the suite asserts an unauthenticated request is refused',
  /toBe\(401\)/.test(suite), 'no 401 assertion in the suite');
check('the suite asserts the metered viewer is eventually refused',
  /toBe\(429\)/.test(suite), 'no 429 assertion in the suite');
check('the suite asserts the cap holds for an over-large request',
  /capMaxTokens\(1_000_000\)|capMaxTokens\(200_000\)/.test(suite),
  'nothing drives capMaxTokens past the ceiling');

// ─── the route carries a viewer ─────────────────────────────────────────────
const chat = llm.slice(llm.indexOf("llmRouter.post('/chat'"));
check('the route names /chat', chat.length > 0);
check('the chat route is guarded by authMiddleware',
  /llmRouter\.post\(\s*'\/chat'\s*,\s*authMiddleware/.test(chat),
  'authMiddleware is not the first thing on the route');
check('authMiddleware is the real one, imported from the middleware',
  /import\s*\{[^}]*\bauthMiddleware\b[^}]*\}\s*from\s*'\.\.\/middleware\/auth\.js'/.test(llm),
  'it is defined locally, so it is not the project-wide check');

// ─── metered per viewer, like /api/gravity/search ───────────────────────────
check('the chat route meters before it does anything else',
  chat.indexOf('meter(') > -1
  && chat.indexOf('meter(') < chat.indexOf('callProvider'),
  'the meter runs after the provider call, or not at all');
check('it is the same meter /api/gravity/search uses',
  /import\s*\{[^}]*\bmeter\b[^}]*\}\s*from\s*'\.\/gravity\.js'/.test(llm)
  && /export function meter\(/.test(gravity),
  'a second, separate meter was written instead of the one already in use');
check('it is keyed by the viewer, not by their address',
  /meter\(`llm:\$\{req\.user/.test(chat),
  'the meter key does not carry the viewer id');
check('a full bucket answers 429 with a Retry-After',
  /status\(429\)/.test(chat) && /Retry-After/.test(chat));

// ─── max_tokens is a ceiling, not a suggestion ──────────────────────────────
check('the caller-supplied max_tokens is not destructured straight out of the body',
  !/const\s*\{[^}]*max_tokens[^}]*\}\s*=\s*req\.body/.test(chat),
  '`max_tokens` still comes off the body untouched');
check('max_tokens passes through a cap',
  /max_tokens\s*=\s*capMaxTokens\(/.test(chat), 'nothing caps it');
check('the cap is read from the server environment, not the request',
  /LLM_MAX_TOKENS_CAP/.test(llm) && !/req\.body[^\n]*CAP/.test(llm));
check('what reaches the provider is the capped value',
  /callProvider\(provider,\s*model,\s*prompt,\s*max_tokens\)/.test(chat),
  'the provider is called with something other than the capped budget');
check('the trace records the budget actually sent',
  /maxTokens:\s*max_tokens/.test(chat), 'the emitted trace does not say what was spent');

// ─── every browser caller sends its token ───────────────────────────────────
const CALLERS = [
  'apps/market-ui/src/components/company/CompanyBrief.tsx',
  'apps/market-ui/src/components/company/DevilsAdvocate.tsx',
  'apps/market-ui/src/components/grid/GridView.tsx',
  'apps/market-ui/src/services/deepResearchService.ts',
  'apps/market-ui/src/services/selfImprovementHarness.ts',
  'apps/market-ui/src/services/firecrawlService.ts',
];
for (const f of CALLERS) {
  const src = stripComments(read(f));
  if (!/\/api\/llm\/chat/.test(src)) {
    check(`${f.split('/').pop()} still calls /api/llm/chat`, false,
      'the caller moved — this gate is checking the wrong file');
    continue;
  }
  check(`${f.split('/').pop()} sends an Authorization header`,
    /authHeader\(\)/.test(src) || /authHeaders\(\)/.test(src),
    'it posts to the spend endpoint with no token, so it will 401');
}

// And the helper it uses really produces the header.
const supabase = stripComments(read('apps/market-ui/src/services/supabase.ts'));
check('authHeader returns a bearer when there is a session',
  /export const authHeader[\s\S]{0,400}Authorization:\s*`Bearer \$\{token\}`/.test(supabase),
  'authHeader does not build an Authorization header');

console.log(`      vitest: ${out.trim().split('\n').filter(Boolean).pop() ?? '(no output)'}`);
console.log(`\nRESULT ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
