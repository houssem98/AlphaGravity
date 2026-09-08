// CF-6 gate. Two halves, both required.
//
// 1. LIVE — /api/llm/health probes every model the picker offers and reports each
//    provider's own error text. Asserts the endpoint answers and that its verdict
//    for each provider matches an independent direct call to /api/llm/chat.
// 2. WIRING — the picker actually consumes it: every option in MODEL_CONFIG is
//    disabled when its provider reports ok:false, and the tooltip carries the
//    provider's error rather than a summary of it.
//
// Half 2 is read out of the source rather than asserted in prose, so the gate
// fails if someone later renders the picker without the health check.
import { readFileSync } from 'node:fs';

const ROOT = 'c:/Users/unicentrale/Downloads/antigravity';
const BASE = process.env.API_BASE ?? 'http://localhost:3002';
const brief = readFileSync(`${ROOT}/apps/market-ui/src/components/company/CompanyBrief.tsx`, 'utf8');

let failures = 0;
const check = (name, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? `\n      ${detail}` : ''}`);
};

// ─── 1. live probe ──────────────────────────────────────────────────────────
const res = await fetch(`${BASE}/api/llm/health?refresh=1`);
check('/api/llm/health answers 200', res.ok, `got ${res.status}`);
const body = await res.json();
const providers = body.providers ?? {};

// Every model the picker can select must appear in the health report.
const offered = [...brief.matchAll(/provider:\s*'([^']+)',\s*model:\s*'([^']+)'/g)]
  .map(([, provider, model]) => ({ provider, model }));
check('picker offers at least one model', offered.length > 0);
for (const { provider, model } of offered) {
  check(`health reports ${provider}`, providers[provider] !== undefined);
  check(`health probes the model the picker sends (${provider})`,
    providers[provider]?.model === model,
    `picker sends ${model}, health probed ${providers[provider]?.model}`);
}

// The verdict must match a direct call — a health check that disagrees with the
// real path is worse than none.
for (const { provider, model } of offered) {
  const r = await fetch(`${BASE}/api/llm/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, model, prompt: 'Reply with the single word: ok', max_tokens: 16 }),
  });
  const b = await r.json();
  const directOk = r.ok && (b.text ?? '').trim().length > 0;
  check(`health verdict matches a direct call (${provider}: ${directOk ? 'up' : 'down'})`,
    providers[provider]?.ok === directOk,
    `health said ok=${providers[provider]?.ok}, direct call said ok=${directOk}`);
}

// A down provider must carry the provider's own words.
for (const [name, p] of Object.entries(providers)) {
  if (p.ok) continue;
  check(`${name} reports a non-empty error`, typeof p.error === 'string' && p.error.length > 0);
}

// ─── 2. the picker is actually wired to it ──────────────────────────────────
check('brief fetches the health endpoint', /LLM_HEALTH_URL/.test(brief) && /fetch\(LLM_HEALTH_URL\)/.test(brief));
check('an option is disabled when its provider is down', /disabled=\{running \|\| dead\}/.test(brief));
check('the tooltip carries the provider error, not a summary',
  /title=\{dead \? `Unavailable — \$\{statusOf\(k\)!\.error\}`/.test(brief));
check('a dead provider cannot stay selected',
  /isDead\(model\)/.test(brief) && /patch\(ticker, \{ model: live \}\)/.test(brief));

const up = Object.entries(providers).filter(([, p]) => p.ok).map(([n]) => n);
const down = Object.entries(providers).filter(([, p]) => !p.ok).map(([n]) => n);
console.log(`\nproviders up:   ${up.join(', ') || '(none)'}`);
console.log(`providers down: ${down.join(', ') || '(none)'}`);
for (const [n, p] of Object.entries(providers)) if (!p.ok) console.log(`  ${n}: ${p.error}`);
console.log(`\nRESULT ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
