#!/usr/bin/env node
// loop-prompt — hands you the /loop line for a loop file, in any shell.
//
//   node scripts/loop-prompt.mjs                       # list the loops that can run
//   node scripts/loop-prompt.mjs MOBILE_PARITY_LOOP.sh # print the /loop line
//   node scripts/loop-prompt.mjs MOBILE_PARITY -c      # ... and put it on the clipboard
//   node scripts/loop-prompt.mjs --self-check
//
// The documented invocation is `/loop $(tail -1 X_LOOP.sh)`, which is POSIX. In
// PowerShell there is no `tail` and `$( )` does not substitute the same way, so the
// line silently fails to expand and you paste the literal string instead. Node runs
// identically in both, so this does the reading.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/** The prompt is the last non-blank line of the file. Same rule loop-lint uses. */
export function promptOf(text) {
    return text.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim() !== '').pop() ?? '';
}

/** Accepts MOBILE_PARITY, MOBILE_PARITY_LOOP, or the full filename. */
export function resolveLoop(name, files) {
    if (files.includes(name)) return name;
    const up = name.toUpperCase();
    return files.find(f => f === `${up}.sh` || f === `${up}_LOOP.sh` || f.startsWith(up)) ?? null;
}

const loopFiles = () => existsSync('.')
    ? readdirSync('.').filter(f => /\.(sh|md)$/.test(f) && f.includes('LOOP')).sort()
    : [];

/** Open tasks in the ledger the file names — a loop with none cannot run.
 *  Searches the whole text for shapes with no prompt line (a .md spec names its
 *  ledger in prose), which is the rule loop-lint uses. Reading only the last line
 *  reported COMPANY_LOOP.md as having no ledger when its ledger is simply closed. */
export function openTasks(text, file) {
    const where = file.endsWith('.md') ? text : promptOf(text);
    const ledger = where.match(/docs\/[A-Z0-9_]+\.md/)?.[0];
    if (!ledger || !existsSync(ledger)) return null;
    return (readFileSync(ledger, 'utf8').match(/^- \[ \]/gm) ?? []).length;
}

const args = process.argv.slice(2);

if (args.includes('--self-check')) {
    const assert = (await import('node:assert/strict')).default;
    assert.equal(promptOf('# header\n\nthe prompt line\n'), 'the prompt line', 'last non-blank line wins');
    assert.equal(promptOf('# header\r\nthe prompt\r\n\r\n'), 'the prompt', 'CRLF is normalised');
    assert.equal(promptOf(''), '', 'an empty file yields an empty prompt');
    const files = ['MOBILE_PARITY_LOOP.sh', 'GRID_LOOP.sh', 'LOOP_TASK.md'];
    assert.equal(resolveLoop('MOBILE_PARITY_LOOP.sh', files), 'MOBILE_PARITY_LOOP.sh', 'exact filename resolves');
    assert.equal(resolveLoop('MOBILE_PARITY', files), 'MOBILE_PARITY_LOOP.sh', 'bare prefix resolves');
    assert.equal(resolveLoop('grid', files), 'GRID_LOOP.sh', 'lowercase resolves');
    assert.equal(resolveLoop('NOPE', files), null, 'an unknown name resolves to null');
    // The ledger must be found in a .md spec's prose, not only on its last line —
    // this is the disagreement with loop-lint that reported COMPANY_LOOP.md wrong.
    const spec = 'see docs/COMPANY_INTELLIGENCE_ROADMAP.md for the plan\n\nsome closing prose\n';
    assert.notEqual(openTasks(spec, 'COMPANY_LOOP.md'), null, 'a .md spec names its ledger in prose');
    assert.equal(openTasks(spec, 'COMPANY_LOOP.sh'), null, 'a .sh loop names it on the last line only');
    console.log('loop-prompt self-check: 9 assertions passed');
    process.exit(0);
}

const files = loopFiles();
const name = args.find(a => !a.startsWith('-'));

if (!name) {
    console.log('\nloop files that can still run:\n');
    let live = 0;
    for (const f of files) {
        const open = openTasks(readFileSync(f, 'utf8'), f);
        if (open === 0) continue;                       // closed ledger, cannot run
        live++;
        console.log(`   ${f.padEnd(32)} ${open === null ? 'no ledger named' : `${open} open task(s)`}`);
    }
    if (live === 0) console.log('   (none — every ledger is closed)');
    console.log(`\nnode scripts/loop-prompt.mjs <name> [-c]\n`);
    process.exit(0);
}

const file = resolveLoop(name, files);
if (!file) {
    console.error(`no loop file matches "${name}". Try: node scripts/loop-prompt.mjs`);
    process.exit(1);
}

const line = `/loop ${promptOf(readFileSync(file, 'utf8'))}`;

if (args.includes('-c') || args.includes('--copy')) {
    // `clip` on Windows, `pbcopy` on macOS, `xclip` elsewhere. Printing is the
    // fallback, because a copy that silently did nothing is worse than no copy.
    const [cmd, cmdArgs] = process.platform === 'win32' ? ['clip', []]
        : process.platform === 'darwin' ? ['pbcopy', []]
            : ['xclip', ['-selection', 'clipboard']];
    try {
        execFileSync(cmd, cmdArgs, { input: line });
        console.error(`${file} · ${line.length} chars · copied, paste it into Claude Code`);
        process.exit(0);
    } catch {
        console.error(`(${cmd} unavailable — printing instead)`);
    }
}

console.log(line);
