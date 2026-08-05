#!/usr/bin/env node
// Self-check for loop-lint.mjs.  node scripts/loop-lint.test.mjs
//
// The linter has real branching — delegation to the conventions file, the
// CLOSED skip, two size bands — and none of it was checked. A linter nobody
// tests is a linter that quietly passes everything.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const LINT = resolve('scripts/loop-lint.mjs');
const dir = mkdtempSync(join(tmpdir(), 'loop-lint-'));
mkdirSync(join(dir, 'docs'), { recursive: true });

const header = '# X — feed the last line to /loop:\n#   /loop $(tail -1 X_LOOP.sh)\n';
const write = (name, prompt) => writeFileSync(join(dir, name), header + prompt + '\n');
const ledger = (name, body) => writeFileSync(join(dir, 'docs', name), body);

const run = (...args) => {
    const r = spawnSync(process.execPath, [LINT, ...args], { cwd: dir, encoding: 'utf8' });
    return { out: r.stdout + r.stderr, code: r.status };
};

ledger('OPEN_LEDGER.md', '- [ ] task one\n- [x] task zero\n');
ledger('CLOSED_LEDGER.md', '- [x] task one\n');

// A loop that delegates to the conventions file earns the delegated checks.
write('GOOD_LOOP.sh',
    'Read docs/OPEN_LEDGER.md. Do the first unchecked [ ] task in §7 under the '
    + 'standard loop contract in docs/LOOP_CONVENTIONS.md. BUDGET: 3 tasks.');

const good = run('GOOD_LOOP.sh');
assert.match(good.out, /GOOD_LOOP\.sh\s+—\s+PASS/, 'a delegating loop should pass');
assert.equal(good.code, 0, 'passing lint exits 0');

// The same loop with the pointer removed must lose the delegated checks —
// otherwise "points at the conventions file" is decorative.
write('BARE_LOOP.sh', 'Read docs/OPEN_LEDGER.md. Do the first unchecked [ ] task in §7.');
const bare = run('BARE_LOOP.sh');
assert.match(bare.out, /FAIL/, 'a loop inlining nothing and delegating nothing should fail');
assert.match(bare.out, /conventions/, 'and should say the conventions pointer is missing');
assert.match(bare.out, /stop-stall/, 'and should name the missing stall condition');
assert.equal(bare.code, 1, 'failing lint exits 1');

// A ledger with no open tasks cannot run again, so it is reported, not linted.
write('DEAD_LOOP.sh', 'Read docs/CLOSED_LEDGER.md. Anything at all.');
const dead = run('DEAD_LOOP.sh');
assert.match(dead.out, /DEAD_LOOP\.sh\s+—\s+CLOSED/, 'a closed ledger should be skipped');
assert.equal(dead.code, 0, 'a closed loop is not a failure');

// A named ledger that does not exist is a broken loop, closed or not.
write('MISSING_LOOP.sh',
    'Read docs/NO_SUCH_LEDGER.md under docs/LOOP_CONVENTIONS.md. BUDGET: 3 tasks.');
const missing = run('MISSING_LOOP.sh');
assert.match(missing.out, /FAIL/, 'a missing ledger must fail');
assert.match(missing.out, /ledger/, 'and must say which check failed');

// Size: warn between the target and the cap, fail above the cap.
const filler = (n) => 'x'.repeat(n);
write('WARN_LOOP.sh',
    'Read docs/OPEN_LEDGER.md. Do the first unchecked [ ] task in §7 under '
    + 'docs/LOOP_CONVENTIONS.md. BUDGET: 3 tasks. ' + filler(1600));
const warn = run('WARN_LOOP.sh');
assert.match(warn.out, /PASS \(warn\)/, 'over target but under cap should warn');
assert.equal(warn.code, 0, 'a warning is not a failure');

write('HUGE_LOOP.sh',
    'Read docs/OPEN_LEDGER.md. Do the first unchecked [ ] task in §7 under '
    + 'docs/LOOP_CONVENTIONS.md. BUDGET: 3 tasks. ' + filler(3200));
const huge = run('HUGE_LOOP.sh');
assert.match(huge.out, /FAIL/, 'over the hard cap must fail');
assert.match(huge.out, /budget-size/, 'and must name the size check');

rmSync(dir, { recursive: true, force: true });
console.log('loop-lint self-check: 14 assertions passed');
