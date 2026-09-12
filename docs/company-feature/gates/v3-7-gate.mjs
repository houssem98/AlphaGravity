// V3-7 gate. Devil's Advocate cites evidence it was actually given.
//
// The component set `facts = rag.answer` — the RAG pipeline's own SYNTHESISED
// paragraph — and handed it to the model under the heading VERIFIED DATA with an
// instruction to "Cite inline like [1]". Nothing numbered was ever sent, so every
// [N] the model emitted indexed a list that did not exist, and citeChildren
// faithfully rendered those markers as superscripts pointing at nothing.
//
// GravityRAGResult has carried `citations[]` all along — each an exact source
// passage with its own id, title and URL.
//
// Run from anywhere:  node docs/company-feature/gates/v3-7-gate.mjs
import { readFileSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n');
const strip = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');

let failures = 0;
const check = (name, ok, detail = '') => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `\n      ${detail}` : ''}`);
};

const raw = read('apps/market-ui/src/components/company/DevilsAdvocate.tsx');
const src = strip(raw);

// ─── what the model is given ────────────────────────────────────────────────
check('the synthesised answer is no longer passed off as the evidence',
    !/const facts\s*=\s*rag\?\.available && rag\.answer/.test(src),
    '`facts = rag.answer` — the model is still given a summary and told it is verified data');

check('the evidence is built from the RAG citations',
    /\brag\??\.?(\w+\s*\?\s*)?citations\b/.test(src) || /\bcites\b/.test(src),
    'nothing reads `citations` off the RAG result');

check('each passage is numbered with the citation id the answer must use',
    /\[\$\{c\.id\}\]/.test(src),
    'the evidence block does not number its passages by `citation.id`');

check('each passage carries its exact source text',
    /c\.text/.test(src),
    'the evidence block sends titles without the passage text they identify');

// ─── the refusal ────────────────────────────────────────────────────────────
const runStart = src.indexOf('const run = async');
const runBody = runStart >= 0 ? src.slice(runStart, src.indexOf('return (', runStart)) : '';
check('the run handler was located', runBody.length > 0);

check('zero citations refuses instead of calling the model',
    /if \(!cites\.length\) \{[\s\S]*?return;\s*\}/.test(runBody),
    'there is no early return on an empty citation list');

const refusalAt = runBody.search(/if \(!cites\.length\)/);
const fetchAt = runBody.indexOf('await fetch(LLM_PROXY_URL');
check('the refusal happens BEFORE the billable LLM call',
    refusalAt >= 0 && fetchAt > refusalAt,
    `refusal at ${refusalAt}, LLM call at ${fetchAt} — an evidence-less run can still spend`);

check('the refusal says which of the two failures happened',
    /rag\?\.available\s*\?/.test(runBody),
    'a search that ran and found nothing reads the same as a search that could not run');

// ─── the prompt no longer asks for citations it did not supply ──────────────
check('the prompt names the numbered passages it actually sends',
    /NUMBERED FILING PASSAGES/.test(src),
    'the prompt still calls the payload VERIFIED DATA without numbering it');

check('the prompt forbids a number that was not supplied',
    /use no number that is not listed/i.test(src),
    'the model is not told that the citation list is closed');

// ─── the markers resolve in the UI ──────────────────────────────────────────
check('the citations are kept alongside the answer',
    /devilSources/.test(src),
    'the numbered sources are not persisted, so the rendered [N] resolve to nothing');

check('a source list is rendered for the reader',
    /data-devil-sources/.test(raw),
    'no source list is rendered beneath the answer');

check('each rendered source is keyed by the id the markers use',
    /data-devil-source=\{s\.id\}/.test(raw),
    'the rendered list is not addressable by citation id');

check('the superscript renderer is still wired to the answer',
    /citeChildren/.test(src),
    'the [N] markers are no longer rendered as citations');

// ─── the store can hold them ────────────────────────────────────────────────
const store = strip(read('apps/market-ui/src/stores/companyBriefStore.ts'));
check('the store declares the source list',
    /devilSources:\s*DevilSource\[\]/.test(store),
    'BriefEntry has no devilSources field');
check('the store defaults it to empty, not undefined',
    /devilSources:\s*\[\]/.test(store),
    'briefDefault does not initialise devilSources');

// ─── the contract it depends on really exists ───────────────────────────────
const svc = read('apps/market-ui/src/services/gravitySearchService.ts');
check('GravityRAGResult still carries citations with id and text',
    /citations:\s*Array<\{[\s\S]*?id:\s*number;[\s\S]*?text:\s*string;/.test(svc),
    'the citation contract this gate relies on has changed');

console.log(`\nRESULT ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
