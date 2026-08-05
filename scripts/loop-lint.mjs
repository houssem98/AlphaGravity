#!/usr/bin/env node
// loop-lint — checks every *_LOOP.sh against docs/LOOP_CONVENTIONS.md.
//
//   node scripts/loop-lint.mjs            # all loops
//   node scripts/loop-lint.mjs GRID_LOOP.sh
//
// A loop file is: header comments, then ONE final line that is the /loop prompt.
// The prompt is re-sent on every wakeup, so its length is a running cost, not a
// one-off. These checks are the nine parts of ~/.claude/LOOP_STANDARD.md reduced
// to what can be verified mechanically — a rule with no check is a wish.
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const CONVENTIONS = 'docs/LOOP_CONVENTIONS.md';
// Two thresholds rather than one, because a single number could not tell a loop
// with many REAL deltas apart from one that inlined the shared contract. Above
// the hard cap a prompt is provably carrying contract text; between the two it
// may simply be a loop with a lot of genuine doctrine, so it warns.
// Do not trim real doctrine to hit a number — fix the number or accept the warn.
const PROMPT_TARGET = 1500;
const PROMPT_HARD_CAP = 3000;

const files = process.argv.slice(2).length
    ? process.argv.slice(2)
    : readdirSync('.').filter(f => /_LOOP\.sh$/.test(f)).sort();

if (files.length === 0) {
    console.log('no *_LOOP.sh files found');
    process.exit(0);
}

/** [id, description, test] — test returns true when the rule HOLDS. */
const CHECKS = [
    ['usage', 'header shows how to feed it to /loop',
        ({ head }) => /\/loop\s+\$\(tail -1/.test(head)],
    ['one-line', 'the prompt is the single last line',
        ({ prompt }) => prompt.length > 0 && !prompt.includes('\n')],
    ['ledger', 'names a ledger doc that exists on disk',
        ({ prompt }) => {
            const m = prompt.match(/docs\/[A-Z0-9_]+\.md/);
            return !!m && existsSync(m[0]);
        }],
    ['first-unchecked', 'takes only the first unchecked task',
        ({ prompt }) => /first unchecked \[ \]/.test(prompt)],
    ['acceptance', 'names the acceptance-test rows',
        ({ prompt, conventions }) => /acceptance test|Section 6 row|§6 row/i.test(prompt) || conventions],
    ['stop-target', 'stop condition: target',
        ({ prompt, conventions }) => /no \[ \] (remain|left)|TARGET/i.test(prompt) || conventions],
    ['stop-budget', 'stop condition: budget (with a number)',
        ({ prompt, conventions }) => /BUDGET \(|budget of \d|\d+ (tasks|iterations)/i.test(prompt) || conventions],
    ['stop-stall', 'stop condition: stall',
        ({ prompt, conventions }) => /STALL|3 consecutive/i.test(prompt) || conventions],
    ['escalation', 'escalation triggers named',
        ({ prompt, conventions }) => /ESCALATE|escalation|blocked on user-only/i.test(prompt) || conventions],
    ['cadence', 'cadence stated with a number',
        ({ prompt, conventions }) => /\b\d+\s*(seconds|s)\b|ScheduleWakeup \d/.test(prompt) || conventions],
    ['persistence', 'survives a 429 / usage limit',
        ({ prompt, conventions }) => /429|usage limit|rate limit/i.test(prompt) || conventions],
    ['commit', 'commit message format fixed',
        ({ prompt, conventions }) => /commit .*message|feat\(/i.test(prompt) || conventions],
    ['no-push', 'forbids an unasked push',
        ({ prompt, conventions }) => /never git push|no git push/i.test(prompt) || conventions],
    ['real-numbers', 'log line must carry real numbers',
        ({ prompt, conventions }) => /REAL numbers|no adjectives/i.test(prompt) || conventions],
    ['conventions', `points at ${CONVENTIONS} instead of inlining it`,
        ({ conventions }) => conventions],
    ['budget-size', `prompt under the ${PROMPT_HARD_CAP}-char hard cap`,
        ({ prompt }) => prompt.length <= PROMPT_HARD_CAP],
];

let failed = 0;
const rows = [];

for (const file of files) {
    const raw = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const lines = raw.split('\n').filter(l => l.trim() !== '');
    const prompt = lines[lines.length - 1] ?? '';
    const head = lines.slice(0, -1).join('\n');
    const conventions = prompt.includes(CONVENTIONS);

    // A loop whose ledger has no unchecked boxes cannot run again, so its
    // prompt costs nothing and its missing stop conditions cannot bite. Report
    // it and move on — a linter that fails on dead files teaches you to ignore
    // the linter. It still fails if its ledger is missing entirely.
    const ledger = prompt.match(/docs\/[A-Z0-9_]+\.md/)?.[0];
    if (ledger && existsSync(ledger)) {
        const open = (readFileSync(ledger, 'utf8').match(/^- \[ \]/gm) ?? []).length;
        if (open === 0) {
            console.log(`\n${file}  —  CLOSED  ·  ${ledger} has no open tasks, not linted`);
            rows.push({ file, chars: 0, bad: [] });
            continue;
        }
    }

    const ctx = { raw, head, prompt, conventions };
    const results = CHECKS.map(([id, desc, test]) => {
        let ok = false;
        try { ok = !!test(ctx); } catch { ok = false; }
        return { id, desc, ok };
    });

    const bad = results.filter(r => !r.ok);
    if (bad.length) failed++;
    rows.push({ file, chars: prompt.length, bad });

    const warn = bad.length === 0 && prompt.length > PROMPT_TARGET;
    const status = bad.length === 0 ? (warn ? 'PASS (warn)' : 'PASS') : `FAIL ${bad.length}`;
    console.log(`\n${file}  —  ${status}  ·  prompt ${prompt.length} chars`);
    for (const b of bad) console.log(`   ✗ ${b.id.padEnd(16)} ${b.desc}`);
    if (warn) {
        console.log(`   ! size             ${prompt.length - PROMPT_TARGET} over the ${PROMPT_TARGET}-char target — confirm every line is a real delta`);
    }
}

const total = rows.reduce((a, r) => a + r.chars, 0);
const over = rows.filter(r => r.chars > PROMPT_HARD_CAP);
console.log(`\n${'-'.repeat(60)}`);
console.log(`${files.length} loop(s), ${failed} failing, ${total} prompt chars total`);
if (over.length) {
    const excess = over.reduce((a, r) => a + r.chars - PROMPT_TARGET, 0);
    console.log(`${over.length} over the ${PROMPT_HARD_CAP}-char hard cap, ${excess} chars above target combined —`);
    console.log(`that excess is re-sent on EVERY wakeup of EVERY one of those loops.`);
}
process.exit(failed > 0 ? 1 : 0);
