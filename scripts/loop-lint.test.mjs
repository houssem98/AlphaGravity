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

// A bash harness has no prompt line to lint, but its stop conditions and its
// judge discipline still apply. It must be linted on those and excused the rest,
// or a real loop escapes review by not being shaped like a prompt file.
writeFileSync(join(dir, 'HARNESS_LOOP.sh'),
    '#!/usr/bin/env bash\nMIN_SCORE=7.0\nMAX_ITER=3\n'
    + 'npm run eval 2>&1 | tee "${LOG}"\n');
const harness = run('HARNESS_LOOP.sh');
assert.match(harness.out, /harness, 4 checks apply/, 'a shell harness is linted on the 4 loop-level rules');
assert.match(harness.out, /judge-threshold/, 'a MIN_SCORE stop with no holdout must fail');
assert.doesNotMatch(harness.out, /usage|one-line|conventions/, 'prompt-shaped rules do not apply to a harness');
assert.equal(harness.code, 1, 'a failing harness exits 1');

// The same harness with the three named parts present must pass — otherwise
// judge-threshold is unsatisfiable and would just be noise.
writeFileSync(join(dir, 'FIXED_LOOP.sh'),
    '#!/usr/bin/env bash\n# TARGET: no [ ] remain.  BUDGET: 3 iterations.  STALL: 3 consecutive.\n'
    + '# Scored on a holdout split, graded by a distinct judge model, 11 trials per item.\n'
    + 'MIN_SCORE=7.0\nnpm run eval 2>&1 | tee "${LOG}"\n');
assert.match(run('FIXED_LOOP.sh').out, /FIXED_LOOP\.sh\s+—\s+PASS/, 'a disciplined harness passes');

// Threshold-shaped only: a passing mention of judging is not a judged stop.
writeFileSync(join(dir, 'MENTION_LOOP.sh'),
    '#!/usr/bin/env bash\n# TARGET: no [ ] remain.  BUDGET: 3 iterations.  STALL: 3 consecutive.\n'
    + '# some verification is live-run-only (judge-scored loop runs)\n'
    + 'npm run eval 2>&1 | tee "${LOG}"\n');
assert.doesNotMatch(run('MENTION_LOOP.sh').out, /judge-threshold/, 'a descriptive mention is not a judged stop');

// A markdown loop spec has no prompt line either, and is pasted whole, so it is
// held to the same four rules — otherwise a loop escapes by being a .md file.
writeFileSync(join(dir, 'SPEC_LOOP.md'),
    '# Discovery Loop\n\nRepeat until the completeness score >= 95%.\n');
const spec = run('SPEC_LOOP.md');
assert.match(spec.out, /spec, 4 checks apply/, 'a .md loop spec is linted as a whole file');
assert.match(spec.out, /stop-stall/, 'and must still name a stall condition');
assert.match(spec.out, /judge-threshold/, 'a self-assessed score threshold is a judged stop');
assert.equal(spec.code, 1, 'a .md loop with no stall exits 1');

// Scope: the linter must not be opt-out-able by filename or by extension. Ten .sh
// files sat outside the old `_LOOP.sh` suffix; seven .md specs sat outside .sh.
writeFileSync(join(dir, 'CRYPTO_LOOP_V2.sh'), header + 'Read docs/OPEN_LEDGER.md.\n');
const all = run().out;
assert.match(all, /CRYPTO_LOOP_V2\.sh/, 'a *_LOOP_V2.sh file is in scope');
assert.match(all, /HARNESS_LOOP\.sh/, 'LOOP-prefixed harnesses are in scope');
assert.match(all, /SPEC_LOOP\.md/, 'markdown loop specs are in scope');

rmSync(dir, { recursive: true, force: true });
console.log('loop-lint self-check: 29 assertions passed');
