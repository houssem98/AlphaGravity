// V4-4 gate. A citation is filing evidence only if it IS a filing.
//
// V3-7 stopped feeding Devil's Advocate the pipeline's synthesised answer and
// started feeding it `citations[]`. That was the right move and it is not being
// reopened. What it did not do was check WHAT those citations are.
//
// The backend classifies every one — `Citation.source_class` is
// SEC_EVIDENCE | LOCAL_EVIDENCE | WEB_EVIDENCE, and `Citation.verification_status`
// carries a deterministic outcome (app/api/schemas/search.py). At 7419ccb the
// client type did not declare `source_class` at all, so nothing downstream could
// tell a 10-K passage from a blog post, and every citation went to the model
// under a heading reading NUMBERED FILING PASSAGES.
//
// A news article presented that way is the component asserting provenance the
// source does not have.
//
// Run from anywhere:  node docs/company-feature/gates/v4-4-gate.mjs
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

// ─── the admission rule exists and is the right one ─────────────────────────
check('citations are filtered before they are called evidence',
    /\.filter\(c =>/.test(src),
    'every citation is still admitted as a filing passage regardless of what it is');

check('admission requires the SEC classification',
    /c\.source_class === 'SEC_EVIDENCE'/.test(src),
    'source_class is not consulted, so a WEB_EVIDENCE citation is sent as a filing passage');

check('admission also requires the accession that names the filing',
    /c\.accession \|\| c\.accession_number/.test(src),
    'a citation with no accession names no filing and is still admitted as one');

// ─── the two refusals are distinguishable ───────────────────────────────────
const runStart = src.indexOf('const run = async');
const runBody = runStart >= 0 ? src.slice(runStart, src.indexOf('return (', runStart)) : '';
check('the run handler was located', runBody.length > 0);

check('sources that exist but do not qualify produce their own refusal',
    /if \(!cites\.length && all\.length\)/.test(runBody),
    '"found nothing" and "found only unverifiable sources" are reported identically');

check('that refusal says the sources were not verified filings',
    /verified SEC filing passage/.test(runBody),
    'the refusal does not tell the reader WHY the sources were rejected');

check('the empty case still refuses too',
    /if \(!cites\.length\) \{/.test(runBody),
    'V3-7 refusal on zero citations was lost');

// ─── refusal happens before the money is spent ──────────────────────────────
const unqualifiedAt = runBody.indexOf('!cites.length && all.length');
const emptyAt = runBody.indexOf('if (!cites.length) {');
const fetchAt = runBody.indexOf('await fetch(LLM_PROXY_URL');
check('an unqualified-only set refuses BEFORE the billable call',
    unqualifiedAt >= 0 && fetchAt > unqualifiedAt,
    'the LLM is called even when no citation qualifies as filing evidence');
check('an empty set refuses BEFORE the billable call',
    emptyAt >= 0 && fetchAt > emptyAt);

// ─── only admitted citations reach the prompt and the source list ───────────
check('the prompt is built from the filtered set, not the raw one',
    /cites\.map\(c => \[/.test(src) && !/all\.map\(c => \[/.test(src),
    'the evidence block is built from every citation rather than the admitted ones');

check('the rendered source list is built from the filtered set',
    /devilSources: cites\.map/.test(src),
    'the [N] list shown to the reader includes citations that were not sent as filings');

check('the heading still claims filings, which is now true',
    /NUMBERED FILING PASSAGES/.test(src),
    'the heading changed rather than the contract');

// ─── the type carries the classification ────────────────────────────────────
const svc = strip(read('apps/market-ui/src/services/gravitySearchService.ts'));
check('the client citation type declares source_class',
    /source_class\?: string;/.test(svc),
    'the backend sends the classification and the client type does not admit it exists');
check('citations are passed through without dropping fields',
    /citations: data\.citations \|\| \[\]/.test(svc),
    'a mapping step could silently drop source_class before any consumer sees it');

// ─── the backend contract this depends on really exists ─────────────────────
const schema = read('services/gravity-api/app/api/schemas/search.py');
check('Citation still declares source_class with the three classes',
    /source_class: str = Field\(""/.test(schema)
    && /SEC_EVIDENCE \| LOCAL_EVIDENCE \| WEB_EVIDENCE/.test(schema),
    'the classification this gate relies on has changed shape');
check('Citation still declares an accession',
    /accession: str = Field\(""/.test(schema));

// ─── V3-7 is not reopened ───────────────────────────────────────────────────
check('V3-7 holds: the synthesised answer is still not the evidence',
    !/const facts\s*=\s*rag\?\.available && rag\.answer/.test(src),
    'the model is being given a summary again');
check('V3-7 holds: passages are still numbered by citation id',
    /\[\$\{c\.id\}\]/.test(src));

console.log(`\nRESULT ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
