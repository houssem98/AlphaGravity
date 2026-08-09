#!/usr/bin/env node
// governance — the kill authority that sits OUTSIDE the task loop.
//
//   node scripts/governance.mjs                       # the CT2 ledger
//   node scripts/governance.mjs docs/OTHER.md         # any ledger with a §7 and a §8
//   node scripts/governance.mjs --self-check
//
// docs/COMMAND_TERMINAL_V2_ROADMAP.md §5 V1: a loop that evaluates its own three
// stop conditions cannot be stopped by the thing it is failing to satisfy. This
// script is that authority — a non-zero exit halts the loop whatever the task
// ledger says (§9 KILL). It reads the ledger and nothing else; it never writes.
//
// Four rules, three of them rows in §6:
//   R1-gate  no product task may be [x] while CT2-1 is [ ]
//   R9       a task's iteration count exceeded its declared ceiling      (V2)
//   R10      3 consecutive iterations, no row state change, no new mode  (V3)
//   R11      a `review: human` task is [x] with no §8 escalation entry   (V4)
//
// §8 grammar, so the log is both readable and parseable:
//   - CT2-1 · iter 1 · R1 green, R9 green · <measured numbers>  [· fail: <mode>]
//   - ESCALATION · CT2-4 · <what was asked, what came back>
// A per-task override is `ceiling: N` on the §7 task line; otherwise DEFAULT_CEILING.
import { readFileSync } from 'node:fs';

const DEFAULT_CEILING = 4;
const LEDGER = 'docs/COMMAND_TERMINAL_V2_ROADMAP.md';

// From "## n." to the next "## <digit>." heading, or to the end of the document.
// NOT a lookahead with `\Z`: JS has no `\Z` anchor, so that escape matches a
// literal "Z" and silently truncated §8 at the first ISO timestamp in it —
// every entry logged after `…T16:06:56Z` was invisible to the checks below.
const section = (text, n) => {
    const start = new RegExp(`^##\\s*${n}\\.`, 'm').exec(text);
    if (!start) return '';
    const rest = text.slice(start.index);
    const next = /\n##\s*\d+\./.exec(rest);
    return next ? rest.slice(0, next.index) : rest;
};

/** Pure: ledger source text in, violations out. Exported for --self-check. */
export function govern(text) {
    const src = text.replace(/\r\n/g, '\n');
    const tasks = section(src, 7).split(/\n(?=-\s*\[)/).slice(1).map(block => ({
        id: (block.match(/\b([A-Z]{2,3}\d?-\d+)\b/) ?? [, '?'])[1],
        checked: /^-\s*\[x\]/i.test(block),
        review: (block.match(/review:\s*`?(auto|human)`?/i) ?? [, 'auto'])[1].toLowerCase(),
        ceiling: Number((block.match(/ceiling:\s*(\d+)/) ?? [, DEFAULT_CEILING])[1]),
    }));

    const log = section(src, 8);
    const iters = [...log.matchAll(/^-\s*`?([A-Z]{2,3}\d?-\d+)`?\s*·\s*iter\s*(\d+)\b(.*)$/gm)].map(m => ({
        task: m[1],
        n: Number(m[2]),
        sig: [...m[3].matchAll(/\bR(\d+)\s+(green|red|blocked|n\/a)\b/g)]
            .map(r => `R${r[1]}=${r[2]}`).sort().join(','),
        mode: (m[3].match(/fail:\s*([^·\n]+)/) ?? [, ''])[1].trim(),
    }));
    const escalated = new Set([...log.matchAll(/^-\s*\*{0,2}ESCALATION\*{0,2}\s*·\s*`?([A-Z]{2,3}\d?-\d+)`?/gm)].map(m => m[1]));

    const v = [];
    const gate = tasks.find(t => t.id.endsWith('-1'));
    if (gate && !gate.checked) {
        for (const t of tasks) {
            if (t !== gate && t.checked) v.push({ row: 'R1-gate', task: t.id, msg: `[x] while ${gate.id} is still [ ] — the gate cannot fail yet` });
        }
    }

    for (const t of tasks) {
        const mine = iters.filter(i => i.task === t.id);
        const count = Math.max(mine.length, ...mine.map(i => i.n), 0);
        if (count > t.ceiling) v.push({ row: 'R9', task: t.id, msg: `${count} iterations against a ceiling of ${t.ceiling}` });
        if (t.checked && t.review === 'human' && !escalated.has(t.id))
            v.push({ row: 'R11', task: t.id, msg: 'review: human closed with no §8 ESCALATION entry' });
    }

    const seen = new Set();
    for (const [i, rec] of iters.entries()) {
        if (rec.mode) seen.add(rec.mode);
        const w = iters.slice(i, i + 3);
        const fresh = w.slice(1).some(r => r.mode && !seen.has(r.mode));
        if (w.length === 3 && w.every(r => r.sig === rec.sig) && !fresh)
            v.push({ row: 'R10', task: rec.task, msg: `iters ${w.map(r => r.n).join(',')} — row state "${rec.sig || 'none recorded'}" unchanged, no new failure mode` });
    }

    return { violations: v, tasks, iters, escalated: [...escalated] };
}

function run(file) {
    const { violations, tasks, iters } = govern(readFileSync(file, 'utf8'));
    const open = tasks.filter(t => !t.checked).length;
    for (const x of violations) console.log(`  ✗ ${x.row.padEnd(8)} ${x.task}  ${x.msg}`);
    console.log(`governance · ${file} · ${tasks.length - open}/${tasks.length} closed, ${iters.length} iterations logged, ${violations.length} violation(s)`);
    if (violations.length) console.log('§9 KILL — halt the loop. The task ledger does not get a vote.');
    process.exit(violations.length ? 1 : 0);
}

const args = process.argv.slice(2);
if (!import.meta.main) {
    // imported for govern() — do not judge the repo as a side effect
} else if (args.includes('--self-check')) {
    // Counted, not estimated: three of these run inside a loop over R9/R10/R11,
    // so the number of assert CALLS in the file is not the number executed.
    let checks = 0;
    const strict = (await import('node:assert/strict')).default;
    const assert = new Proxy(strict, { get: (t, k) => (...a) => { checks++; return Reflect.get(t, k)(...a); } });
    const { spawnSync } = await import('node:child_process');
    const { writeFileSync, mkdtempSync, mkdirSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join, resolve } = await import('node:path');

    const led = (t7, t8) => `## 7. Task ledger\n\n${t7}\n\n## 8. Progress log\n\n${t8}\n\n## 9. Stop\n`;
    const CLEAN = led(
        '- [x] **XX-1 · The harness. `review: auto`. Rows R1.**\n- [ ] **XX-2 · Probe. `review: human`. Rows R2.**',
        '- XX-1 · iter 1 · R1 green · 12 rows, 3 with document_id');

    assert.equal(govern(CLEAN).violations.length, 0, 'a clean ledger has no violations');
    assert.equal(govern(CLEAN).tasks.length, 2, 'both §7 tasks parsed');
    assert.equal(govern(CLEAN).tasks[1].review, 'human', 'review tier parsed');
    assert.equal(govern(CLEAN).tasks[0].ceiling, DEFAULT_CEILING, 'ceiling defaults');
    assert.equal(govern(CLEAN).iters.length, 1, 'the §8 iteration line parsed');

    // A section ends at the next heading or at the end of the document — never at
    // a capital letter. `\Z` is not a JS anchor, and the version that used it cut
    // §8 at the first ISO timestamp, hiding every entry logged after it.
    const withZ = led('- [ ] **XX-1 · H. `review: auto`.**',
        '- XX-1 · iter 1 · R1 green · probed at 2026-08-09T16:06:56Z\n'
        + '- ESCALATION · XX-1 · asked, answered\n- XX-1 · iter 2 · R1 green · SIZE IN MB');
    assert.equal(govern(withZ).iters.length, 2, 'entries after a capital Z still parse');
    assert.equal(govern(withZ).escalated.length, 1, 'an escalation after a capital Z still parses');
    // And the section must still STOP at the next heading.
    assert.equal(govern(led('- [ ] **XX-1 · H. `review: auto`.**', '- XX-1 · iter 1 · R1 green')
        + '\n- XX-9 · iter 7 · R1 green\n').iters.length, 1, '§9 content is not read as §8');

    // R1-gate: a product task cannot close before the gate that would fail it.
    const gated = govern(led('- [ ] **XX-1 · Harness. `review: auto`.**\n- [x] **XX-2 · Probe. `review: auto`.**', '- none'));
    assert.equal(gated.violations.some(x => x.row === 'R1-gate'), true, 'R1-gate fires');

    // R9: iteration count past the declared ceiling.
    const over = govern(led('- [ ] **XX-1 · Harness. `review: auto`. ceiling: 2**',
        '- XX-1 · iter 1 · R1 red\n- XX-1 · iter 2 · R1 red · fail: a\n- XX-1 · iter 3 · R1 red · fail: b'));
    assert.equal(over.violations.some(x => x.row === 'R9'), true, 'R9 fires past the ceiling');
    assert.equal(govern(led('- [ ] **XX-1 · Harness. `review: auto`. ceiling: 9**',
        '- XX-1 · iter 1 · R1 red\n- XX-1 · iter 2 · R1 red · fail: a')).violations.length, 0,
        'a generous ceiling does not fire R9');

    // R10: 3 consecutive iterations, same row state, no new failure mode.
    const stall = led('- [ ] **XX-1 · Harness. `review: auto`. ceiling: 9**',
        '- XX-1 · iter 1 · R2 red · fail: 422\n- XX-1 · iter 2 · R2 red · fail: 422\n- XX-1 · iter 3 · R2 red · fail: 422');
    assert.equal(govern(stall).violations.some(x => x.row === 'R10'), true, 'R10 fires on a stall');
    const moved = led('- [ ] **XX-1 · Harness. `review: auto`. ceiling: 9**',
        '- XX-1 · iter 1 · R2 red · fail: 422\n- XX-1 · iter 2 · R2 red · fail: 422\n- XX-1 · iter 3 · R2 green');
    assert.equal(govern(moved).violations.some(x => x.row === 'R10'), false, 'a row changing state clears R10');
    const newmode = led('- [ ] **XX-1 · Harness. `review: auto`. ceiling: 9**',
        '- XX-1 · iter 1 · R2 red · fail: 422\n- XX-1 · iter 2 · R2 red · fail: 422\n- XX-1 · iter 3 · R2 red · fail: cors');
    assert.equal(govern(newmode).violations.some(x => x.row === 'R10'), false, 'a new failure mode is progress');

    // R11: a human-reviewed task closed with no escalation entry.
    const unreviewed = led('- [x] **XX-1 · Probe. `review: human`.**', '- XX-1 · iter 1 · R1 green');
    assert.equal(govern(unreviewed).violations.some(x => x.row === 'R11'), true, 'R11 fires without an escalation');
    const reviewed = led('- [x] **XX-1 · Probe. `review: human`.**',
        '- ESCALATION · XX-1 · asked whether to add a route; answered no\n- XX-1 · iter 1 · R1 green');
    assert.equal(govern(reviewed).violations.some(x => x.row === 'R11'), false, 'an escalation entry clears R11');
    assert.equal(govern(reviewed).escalated.length, 1, 'the escalation entry parsed');
    assert.equal(govern(led('- [x] **XX-1 · Probe. `review: auto`.**', '- none')).violations.length, 0,
        'review: auto closes itself');

    // Exit codes: R1 asserts a synthetic violation of each of R9/R10/R11 exits non-zero.
    const dir = mkdtempSync(join(tmpdir(), 'governance-'));
    mkdirSync(join(dir, 'docs'), { recursive: true });
    const SELF = resolve('scripts/governance.mjs');
    const exitOn = (body) => {
        const f = join(dir, 'docs', 'L.md');
        writeFileSync(f, body);
        return spawnSync(process.execPath, [SELF, f], { encoding: 'utf8' });
    };
    assert.equal(exitOn(CLEAN).status, 0, 'a clean ledger exits 0');
    for (const [row, body] of [['R9', over && led('- [ ] **XX-1 · H. `review: auto`. ceiling: 2**',
        '- XX-1 · iter 1 · R1 red\n- XX-1 · iter 2 · R1 red · fail: a\n- XX-1 · iter 3 · R1 red · fail: b')],
    ['R10', stall], ['R11', unreviewed]]) {
        const r = exitOn(body);
        assert.equal(r.status, 1, `${row} violation exits non-zero`);
        assert.match(r.stdout, new RegExp(row), `${row} is named in the output`);
        assert.match(r.stdout, /KILL/, 'and the kill line is printed');
    }
    rmSync(dir, { recursive: true, force: true });

    console.log(`governance self-check: ${checks} assertions passed`);
} else {
    run(args.find(a => !a.startsWith('--')) ?? LEDGER);
}
