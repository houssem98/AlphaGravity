#!/usr/bin/env node
// graph-lint — makes the mermaid "graph of loops" in a ledger fail when it drifts.
//
//   node scripts/graph-lint.mjs                    # every docs/*.md
//   node scripts/graph-lint.mjs docs/X_ROADMAP.md  # one
//   node scripts/graph-lint.mjs --self-check
//
// docs/LOOP_CONVENTIONS.md §10 recorded three loop graphs as "known decoration":
// no loop prompt cites them and nothing fails when they stop matching the code.
// An unread diagram rots into a lie. The literature's version of the same point
// is that a workflow graph earns its keep by being executed or searched, not
// drawn — AFlow (arXiv 2410.10762) searches code-represented workflow graphs,
// SEW (arXiv 2505.18646) evolves the topology itself.
//
// This is the cheap half: the graph cannot be executed, but every concrete thing
// it names can be resolved. A node that cites a file, a ledger section, a task
// ID or a code symbol is checkable; a graph that cites none of those is prose in
// a box, and gets reported as DECORATION.
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
const selfCheck = process.argv.includes('--self-check');

const tracked = new Set(
    execFileSync('git', ['ls-files'], { encoding: 'utf8', maxBuffer: 64e6 }).split('\n').filter(Boolean));
const basenames = new Set([...tracked].map(p => p.split('/').pop()));

// `py` was missing, and half this repository is Python. A graph over
// services/gravity-api named files this could not see, so it reported the mix
// as "0 path" and the graph passed on its §sections alone — the scope opt-out
// in LOOP_STANDARD §7, where a checker's extension list becomes an accidental
// exemption and the files that escape are the ones nobody notices escaping.
const PATH_RE = /\b[\w./-]*[\w-]\.(?:ts|tsx|mjs|js|json|md|sh|sql|yml|py)\b/g;
const SECTION_RE = /§\s?(\d+)/g;
const TASK_RE = /\b([A-Z]{2,3})-(\d+)\b/g;
// A camelCase identifier long enough not to be an English word in disguise,
// OR a snake_case one — the same opt-out as the extension list above, since a
// Python codebase names almost nothing in camelCase. Both forms are still
// confirmed by `git grep`, so a name that resolves is a name that exists and a
// coincidental match costs nothing.
const SYMBOL_RE = /\b(?:[a-z][a-z0-9]{2,}[A-Z][A-Za-z0-9]{3,}|_?[a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g;

const symbolCache = new Map();
const symbolExists = (s) => {
    if (!symbolCache.has(s)) {
        let ok = false;
        try { execFileSync('git', ['grep', '-qwI', s], { stdio: 'ignore' }); ok = true; } catch { ok = false; }
        symbolCache.set(s, ok);
    }
    return symbolCache.get(s);
};

/** Returns { graphs, refs, broken } for one document's source text. */
export function lintDoc(doc, text, resolvers) {
    const { pathOk, sectionOk, taskOk, symOk } = resolvers;
    const graphs = [...text.matchAll(/```mermaid\n([\s\S]*?)```/g)].map(m => m[1]);
    const out = [];

    for (const [i, graph] of graphs.entries()) {
        // Labels only: node ids and arrows name nothing real.
        const labels = [...graph.matchAll(/[[{(]"?(.*?)"?[\]})]/g)].map(m => m[1]).join(' | ');
        const refs = [];
        const add = (kind, raw, ok) => refs.push({ kind, raw, ok });

        for (const m of labels.matchAll(PATH_RE)) add('path', m[0], pathOk(m[0]));
        for (const m of labels.matchAll(SECTION_RE)) add('section', `§${m[1]}`, sectionOk(m[1]));
        for (const m of labels.matchAll(TASK_RE)) add('task', m[0], taskOk(m[0]));
        for (const m of labels.matchAll(SYMBOL_RE)) add('symbol', m[0], symOk(m[0]));

        // Dedupe: the same file named by three nodes is one claim, not three.
        const seen = new Map();
        for (const r of refs) seen.set(`${r.kind}:${r.raw}`, r);
        out.push({ doc, index: i, refs: [...seen.values()] });
    }
    return out;
}

function run() {
    const docs = files.length ? files : readdirSync('docs').filter(f => f.endsWith('.md')).map(f => `docs/${f}`);
    let failed = 0, decoration = 0, checked = 0;

    for (const doc of docs) {
        const text = readFileSync(doc, 'utf8').replace(/\r\n/g, '\n');
        if (!text.includes('```mermaid')) continue;
        const headings = new Set([...text.matchAll(/^##+\s*(\d+)[.\s]/gm)].map(m => m[1]));

        const results = lintDoc(doc, text, {
            pathOk: p => tracked.has(p.replace(/^\.\//, '')) || basenames.has(p.split('/').pop()),
            sectionOk: n => headings.has(n),
            taskOk: t => new RegExp(`\\*\\*${t}\\b|\\b${t}\\b`).test(text.replace(/```mermaid[\s\S]*?```/g, '')),
            symOk: symbolExists,
        });

        for (const g of results) {
            checked++;
            const bad = g.refs.filter(r => !r.ok);
            if (g.refs.length === 0) {
                decoration++;
                console.log(`\n${doc} · graph ${g.index}  —  DECORATION  ·  names nothing checkable`);
                console.log('   cite a file, a §section, a task ID or a code symbol — or delete the graph');
                continue;
            }
            // Print the mix, not just the count: a graph resolving only §sections
            // is checked more weakly than one naming files and symbols, and that
            // difference should be visible rather than hidden behind "PASS".
            const mix = [...g.refs.reduce((m, r) => m.set(r.kind, (m.get(r.kind) ?? 0) + 1), new Map())]
                .map(([k, n]) => `${n} ${k}`).join(', ');
            const status = bad.length ? `FAIL ${bad.length}/${g.refs.length}` : `PASS ${g.refs.length} refs`;
            console.log(`\n${doc} · graph ${g.index}  —  ${status}  ·  ${mix}`);
            for (const r of bad) console.log(`   ✗ ${r.kind.padEnd(8)} ${r.raw}  does not resolve`);
            if (bad.length) failed++;
        }
    }

    console.log(`\n${'-'.repeat(60)}`);
    console.log(`${checked} graph(s), ${failed} drifted, ${decoration} decorative`);
    process.exit(failed + decoration > 0 ? 1 : 0);
}

if (!import.meta.main) {
    // imported for lintDoc — do not lint the repo as a side effect
} else if (selfCheck) {
    const assert = (await import('node:assert/strict')).default;
    const yes = () => true, no = () => false;
    const doc = '```mermaid\nflowchart TD\n  A["run scripts/x.mjs at §6 for DI-3 via scoreAnswerTrust"] --> B[done]\n```';

    const all = lintDoc('t.md', doc, { pathOk: yes, sectionOk: yes, taskOk: yes, symOk: yes });
    assert.equal(all.length, 1, 'one graph found');
    assert.deepEqual(all[0].refs.map(r => r.kind).sort(),
        ['path', 'section', 'symbol', 'task'], 'all four reference classes extracted');
    assert.equal(all[0].refs.every(r => r.ok), true, 'resolvable refs pass');

    // Mutation: break each resolver in turn and the graph must fail.
    for (const k of ['pathOk', 'sectionOk', 'taskOk', 'symOk']) {
        const r = lintDoc('t.md', doc, { pathOk: yes, sectionOk: yes, taskOk: yes, symOk: yes, [k]: no });
        assert.equal(r[0].refs.some(x => !x.ok), true, `${k} failing must surface`);
    }

    // A graph naming nothing concrete is reported, not silently passed.
    const bare = lintDoc('t.md', '```mermaid\nflowchart TD\n  A[think] --> B[ship]\n```',
        { pathOk: yes, sectionOk: yes, taskOk: yes, symOk: yes });
    assert.equal(bare[0].refs.length, 0, 'prose-only graph yields no refs');

    // Node ids outside labels are not claims about the repo.
    const ids = lintDoc('t.md', '```mermaid\nflowchart TD\n  config.ts --> other.ts\n```',
        { pathOk: no, sectionOk: no, taskOk: no, symOk: no });
    assert.equal(ids[0].refs.length, 0, 'bare node ids are not linted');

    console.log('graph-lint self-check: 9 assertions passed');
} else {
    run();
}
