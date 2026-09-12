// V3-6 gate. A resolver that cannot run does not become permission to navigate.
//
// TickerEntry caught the resolve failure and called `onOpen(q.toUpperCase())`, so
// a network fault in the CHECK became a licence to skip the check — and "APPL"
// opened a full company profile with every surface empty, indistinguishable from
// a real registrant with nothing indexed. That is precisely the state CF-24 was
// written to prevent, reachable by unplugging the network.
//
// Structural: the catch branch is read directly and must not navigate.
//
// Run from anywhere:  node docs/company-feature/gates/v3-6-gate.mjs
import { readFileSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n');

let failures = 0;
const check = (name, ok, detail = '') => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `\n      ${detail}` : ''}`);
};

const raw = read('apps/market-ui/src/components/company/TickerEntry.tsx');
// Comments are stripped before any check: this ledger's comments QUOTE the code
// they replaced, so a check that reads them grades the prose, not the program.
const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');

// ─── the catch branch ───────────────────────────────────────────────────────
const catchStart = src.search(/\}\s*catch\s*(\([^)]*\))?\s*\{/);
check('the submit handler still has a catch branch', catchStart >= 0,
    'no catch found — the resolver failure path has moved or vanished');

// From the catch brace to the `finally`, which every version of this handler has.
const finallyAt = src.indexOf('} finally {', catchStart);
check('the catch branch is bounded by the finally', finallyAt > catchStart);
const body = catchStart >= 0 && finallyAt > catchStart ? src.slice(catchStart, finallyAt) : '';

check('a resolver fault does NOT navigate',
    !/\bonOpen\s*\(/.test(body),
    `the catch branch still calls onOpen — an unverified ticker is opened on a network fault:\n      ${body.trim().replace(/\n\s*/g, ' ').slice(0, 240)}`);

check('a resolver fault is SAID, in a state the render can show',
    /\bsetResult\s*\(/.test(body),
    'the catch branch sets no result state, so the fault is silent');

check('the failure state names the fault rather than showing a bare ticker',
    /reason\s*:/.test(body),
    'no `reason` is set, so the card has nothing to explain');

check('the failure state carries no resolved ticker',
    /ticker\s*:\s*null/.test(body),
    'the error state claims a resolved ticker it does not have');

// ─── the escape is still offered ────────────────────────────────────────────
check('a non-resolved result still renders the explicit "Open anyway" escape',
    /Open \{value\.trim\(\)\.toUpperCase\(\)\} anyway/.test(src),
    'the manual escape is gone — refusing without one IS a dead end');

check('the escape is a deliberate click, not an automatic call',
    /onClick=\{\(\) => onOpen\(value\.trim\(\)\.toUpperCase\(\)\)\}/.test(src),
    'the escape no longer goes through an explicit onClick');

// ─── a confident resolution is untouched ────────────────────────────────────
check('a resolved ticker still opens straight away',
    /if \(body\.status === 'resolved' && body\.ticker\) \{\s*onOpen\(body\.ticker\);/.test(src),
    'the happy path changed — CF-24 requires a confident resolution to open without a confirm');

// ─── the error state can actually reach the render ──────────────────────────
check('the render shows any non-resolved status, including the error one',
    /result && result\.status !== 'resolved'/.test(src),
    'the failure card is gated on a status the catch branch does not set');

check("'error' is a declared resolution status",
    /status:\s*'resolved'\s*\|\s*'unknown'\s*\|\s*'error'/.test(src),
    'the Resolution type does not admit the error state the catch branch sets');

console.log(`\nRESULT ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
