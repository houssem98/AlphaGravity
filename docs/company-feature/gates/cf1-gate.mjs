// CF-1 gate. Reads the brief's DEFAULT config out of the real source files
// (not a transcription), fires all 6 non-synthesis seed prompts at the live
// /api/llm/chat proxy, and reports the text length each one came back with.
// Non-empty for 6/6 == pass.
import { readFileSync } from 'node:fs';

const ROOT = 'c:/Users/unicentrale/Downloads/antigravity/apps/market-ui/src';
const PROXY = process.env.PROXY ?? 'http://localhost:3002/api/llm/chat';
const TICKER = process.env.TICKER ?? 'AAPL';

const grid = readFileSync(`${ROOT}/services/gridResearch.ts`, 'utf8');
const brief = readFileSync(`${ROOT}/components/company/CompanyBrief.tsx`, 'utf8');
const store = readFileSync(`${ROOT}/stores/companyBriefStore.ts`, 'utf8');

// STYLE — the concatenated literal appended to every seed prompt.
const styleSrc = grid.match(/const STYLE =([\s\S]*?);\n/)[1];
const STYLE = [...styleSrc.matchAll(/'([^']*)'/g)].map(m => m[1]).join('');

// The 6 sections the brief renders: SEED_GRID_PROMPTS minus synthesis.
const block = grid.match(/SEED_GRID_PROMPTS[^=]*=\s*\[([\s\S]*?)\n\];/)[1];
const prompts = [...block.matchAll(/\{\s*id:\s*'([^']+)'[\s\S]*?prompt:\s*(`[\s\S]*?`|'[\s\S]*?')\s*(,\s*synthesis:\s*true)?\s*\}/g)]
  .filter(m => !m[3])
  .map(m => ({
    id: m[1],
    text: m[2].slice(1, -1).replace(/\$\{STYLE\}/g, STYLE).replace(/\{ticker\}/g, TICKER),
  }));

// The default config, read the same way the app resolves it.
const defaultKey = store.match(/briefDefault[^=]*=\s*\{[\s\S]*?model:\s*'([^']+)'/)[1];
const cfg = brief.match(new RegExp(`${defaultKey}:\\s*\\{\\s*provider:\\s*'([^']+)',\\s*model:\\s*'([^']+)'`));
const maxTokens = Number(brief.match(/max_tokens:\s*(\d+)/)[1]);
const [, provider, model] = cfg;

console.log(`config  default key='${defaultKey}' -> provider=${provider} model=${model} max_tokens=${maxTokens}`);
console.log(`proxy   ${PROXY}`);
console.log(`ticker  ${TICKER}`);
console.log(`prompts ${prompts.length}\n`);

let pass = 0;
for (const p of prompts) {
  const t0 = Date.now();
  let line;
  try {
    const res = await fetch(PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, model, prompt: p.text, max_tokens: maxTokens }),
    });
    const body = await res.json();
    const text = body.text ?? '';
    const ok = res.ok && text.trim().length > 0;
    if (ok) pass++;
    line = `${ok ? 'PASS' : 'FAIL'}  ${p.id.padEnd(10)} http=${res.status} chars=${String(text.length).padStart(5)} ${Date.now() - t0}ms`;
    if (!ok) line += `\n      body: ${JSON.stringify(body).slice(0, 300)}`;
    else line += `\n      head: ${JSON.stringify(text.slice(0, 90))}`;
  } catch (e) {
    line = `FAIL  ${p.id.padEnd(10)} threw: ${e.message}`;
  }
  console.log(line);
}
console.log(`\nRESULT ${pass}/${prompts.length} non-empty`);
process.exit(pass === prompts.length ? 0 : 1);
