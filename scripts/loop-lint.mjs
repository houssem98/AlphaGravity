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

// A loop stops on a number a model produced, rather than on a command's exit code.
// Threshold-shaped only: QA_LOOP.sh mentions "judge-scored loop runs" as a
// category of verification, which is not a stop rule, and flagging it would
// train the reader to skim past this check.
const JUDGED = /MIN_SCORE|\b(?:judge|rubric|rating|score)\b[^\n]{0,40}(?:>=|≥|threshold|at least\s*\d|\d\s*\/\s*\d)/i;
// The checks that still mean something for a file with no /loop prompt line — a
// bash harness that runs the loop itself, or a markdown loop spec. Stop conditions
// and judge discipline are properties of the loop, not of the prompt, so those
// files are held to these four and excused the prompt-shaped rest.
const WHOLE_FILE_CHECKS = new Set(['stop-target', 'stop-budget', 'stop-stall', 'judge-threshold']);

// Scope by the word LOOP, not by the `_LOOP.sh` suffix, and not by extension.
// The suffix let ten .sh files opt out (CRYPTO_LOOP_V2..V10, LOOP_SELF_IMPROVE);
// the extension let seven .md loop specs opt out on top of that. A checker whose
// scope is a naming convention checks whatever agrees to be checked.
const files = process.argv.slice(2).length
    ? process.argv.slice(2)
    : readdirSync('.').filter(f => /\.(sh|md)$/.test(f) && f.includes('LOOP')).sort();

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
    // A loop that stops on a model-graded score is stopping on a noisy measurement.
    // "The Coin Flip Judge?" (arXiv 2606.13685) reports pairwise preferences
    // flipping 13.6% of the time on identical repeated evaluations, 76% cross-judge
    // agreement (kappa 0.51), and ~11 trials needed for a majority vote to recover
    // the 50-trial verdict at 95%. LOOP_STANDARD.md §2 already demands a holdout and
    // a different model for verification; this makes those two mechanical, and adds
    // the trial count, because one judge call at a threshold is a coin with a bias.
    ['judge-threshold', 'a score-graded stop names a holdout, a distinct judge, and a trial count',
        ({ raw }) => !JUDGED.test(raw)
            || (/holdout|held-out|hold-out/i.test(raw)
                && /judge[ _-]?model|(?:different|distinct|separate|second)\s+(?:model|judge)/i.test(raw)
                && /trials?|n\s*=\s*\d|repeat/i.test(raw))],
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

    // Three shapes of loop file live here. Most are a header plus one long prompt
    // line fed to /loop. Some are bash harnesses that run the loop themselves, and
    // some are markdown loop specs pasted in whole — neither has a prompt line to
    // lint, but stop conditions and judge discipline still apply, so those are held
    // to the four loop-level rules and excused the prompt-shaped rest rather than
    // drowned in irrelevant failures.
    //
    // A .md loop is a whole-file spec by definition. For .sh, shell expansion in the
    // final line means that line is code being run, not prose being sent — length
    // cannot separate the two, because a terse delegating prompt is legitimately short.
    const wholeFile = file.endsWith('.md') || /\$\{|\$\(|\|\||2>|>>/.test(prompt);

    // A loop whose ledger has no unchecked boxes cannot run again, so its
    // prompt costs nothing and its missing stop conditions cannot bite. Report
    // it and move on — a linter that fails on dead files teaches you to ignore
    // the linter. It still fails if its ledger is missing entirely.
    // Search the whole file for the shapes that have no prompt line: a .md spec
    // names its ledger in prose, not on its last line.
    const ledger = (wholeFile ? raw : prompt).match(/docs\/[A-Z0-9_]+\.md/)?.[0];
    if (ledger && existsSync(ledger)) {
        const open = (readFileSync(ledger, 'utf8').match(/^- \[ \]/gm) ?? []).length;
        if (open === 0) {
            console.log(`\n${file}  —  CLOSED  ·  ${ledger} has no open tasks, not linted`);
            rows.push({ file, chars: 0, bad: [] });
            continue;
        }
    }

    const ctx = wholeFile
        ? { raw, head: '', prompt: raw, conventions: false }
        : { raw, head, prompt, conventions };
    const results = CHECKS
        .filter(([id]) => !wholeFile || WHOLE_FILE_CHECKS.has(id))
        .map(([id, desc, test]) => {
            let ok = false;
            try { ok = !!test(ctx); } catch { ok = false; }
            return { id, desc, ok };
        });

    const bad = results.filter(r => !r.ok);
    if (bad.length) failed++;
    // A .md spec is pasted whole, so its per-wakeup cost is the file. A .sh harness
    // is executed, not sent, so its last line costs nothing per tick.
    const chars = file.endsWith('.md') ? raw.length : wholeFile ? 0 : prompt.length;
    rows.push({ file, chars, bad });

    const warn = !wholeFile && bad.length === 0 && prompt.length > PROMPT_TARGET;
    const status = bad.length === 0 ? (warn ? 'PASS (warn)' : 'PASS') : `FAIL ${bad.length}`;
    const shape = wholeFile
        ? `${file.endsWith('.md') ? 'spec' : 'harness'}, ${results.length} checks apply`
        : `prompt ${prompt.length} chars`;
    console.log(`\n${file}  —  ${status}  ·  ${shape}`);
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
