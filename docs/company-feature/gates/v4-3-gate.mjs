// V4-3 gate. A disputed figure is never rendered as the figure.
//
// V3-3 did the server half: a (metric, period) whose rows disagree comes back
// `ambiguous: true`, names every value in `conflicting_values`, and carries no
// accession. The client half was never written. At 7419ccb, DataTab.tsx:47-53
// rendered `m.value` unconditionally and GravityMetric declared none of
// `ambiguous`, `conflicting_values`, `unit_reason` — so the fields crossed the
// wire invisible to TypeScript and to the reader.
//
// What a user saw for a disputed fact: the number, formatted normally, with prose
// in the Source column. That reads as "we could not find the filing", not as
// "two filings disagree about this number".
//
// BEHAVIOURAL: the real component is compiled and rendered to static HTML.
//
// Run from anywhere:  node docs/company-feature/gates/v4-3-gate.mjs
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n');
const win = (u) => new URL(u, root).pathname.replace(/^\/([A-Za-z]:)/, '$1');

let failures = 0;
const check = (name, ok, detail = '') => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `\n      ${detail}` : ''}`);
};

// Bundled INSIDE the repo: the externals (react, react-dom) resolve up the
// directory tree to node_modules, which an OS temp dir cannot do.
const dir = mkdtempSync(join(win('.'), '.v4-gate-'));
let html = '', plainHtml = '';
try {
    const esbuild = await import(pathToFileURL(win('node_modules/esbuild/lib/main.js')).href);
    const bundle = await esbuild.build({
        stdin: {
            contents: `
                import { renderToStaticMarkup } from 'react-dom/server';
                import DataTab from ${JSON.stringify(win('apps/market-ui/src/components/company/DataTab.tsx'))};
                export function render(metrics) {
                    return renderToStaticMarkup(
                        DataTab({ metrics, documents: [], overview: null, onSelectSource: () => {} }));
                }
            `,
            resolveDir: win('apps/market-ui/src'),
            loader: 'tsx',
        },
        bundle: true, format: 'esm', platform: 'node', write: false,
        jsx: 'automatic',
        external: ['react', 'react-dom', 'react/jsx-runtime', 'lucide-react'],
        absWorkingDir: win('.'),
    });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
    writeFileSync(join(dir, 'd.js'), bundle.outputFiles[0].text);
    const mod = await import(pathToFileURL(join(dir, 'd.js')).href);

    html = mod.render([{
        metric: 'Revenue', value: 32681000000, unit: 'USD', period: 'FY2024',
        ambiguous: true, conflicting_values: [32681000000, 24575000000],
        source_reason: 'MMM has more than one reported value for Revenue in FY2024.',
        accession: null,
    }]);
    plainHtml = mod.render([{
        metric: 'Revenue', value: 32681000000, unit: 'USD', period: 'FY2024',
        ambiguous: false, conflicting_values: [32681000000],
        accession: '0000066740-25-000009', cik: 66740, filing_type: '10-K', filed: '2025-02-06',
    }]);
} catch (e) {
    console.log(`FAIL  DataTab could not be compiled and rendered\n      ${e.message}`);
    rmSync(dir, { recursive: true, force: true });
    process.exit(1);
}

// ─── the disputed row ───────────────────────────────────────────────────────
check('a disputed row is marked machine-readably',
    /data-ambiguous="true"/.test(html),
    'nothing in the rendered value cell says this figure is in dispute');

check('the dispute is stated in words the reader can see',
    /In dispute/i.test(html),
    'the cell renders a bare number for a figure two filings disagree about');

check('every reported value is shown, not one of them',
    /data-disputed-values="2"/.test(html),
    'the competing values are not all rendered');

check('the first reported value is shown', /32\.68B/.test(html), `rendered: ${html.slice(0, 400)}`);
check('the SECOND, disagreeing value is shown too',
    /24.57B/.test(html),
    'only one of two disagreeing values reached the screen - that is the silent choice V3-3 refused to make on the server');

check('the values are formatted through the unit-aware formatter',
    /\$32\.68B/.test(html) && /\$24.57B/.test(html),
    'the disputed values are not formatted as money despite a USD unit');

check('the reason is carried for the reader',
    /more than one reported value/.test(html),
    'the server stated why and the cell dropped it');

// ─── a normal row is untouched ──────────────────────────────────────────────
check('a non-disputed row carries no dispute marker',
    !/data-ambiguous/.test(plainHtml) && !/In dispute/i.test(plainHtml),
    'an undisputed figure was marked as disputed');
check('a non-disputed row still renders its value',
    /\$32\.68B/.test(plainHtml), `rendered: ${plainHtml.slice(0, 300)}`);
check('a non-disputed row still links its filing',
    /0000066740-25-000009/.test(plainHtml),
    'V2-8 provenance was lost from the undisputed path');

// ─── V4-6 · one formatter owns the cell ─────────────────────────────────────
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');
const src = strip(read('apps/market-ui/src/components/company/DataTab.tsx'));
check('the cell no longer tests one hardcoded currency spelling',
    !/m\.unit === 'USD'/.test(src),
    "`m.unit === 'USD'` is still there: the server's own \"USD M\" misses currency formatting");
check('the cell formats through formatFinancialValue',
    /formatFinancialValue\(/.test(src),
    'the value cell formats outside the unified formatter V2-1 and V3-1 established');

// ─── the type declares what the wire carries ────────────────────────────────
const types = strip(read('apps/market-ui/src/components/company/types.ts'));
for (const f of ['ambiguous', 'conflicting_values', 'unit_reason']) {
    check(`GravityMetric declares \`${f}\``,
        new RegExp(`${f}\\??:`).test(types),
        `the server sends ${f} and the client type does not admit it exists`);
}

rmSync(dir, { recursive: true, force: true });
console.log(`\nRESULT ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
