// CF-16 gate. A typecheck command that cannot fail is not a typecheck.
//
// Injects a deliberate type error into a real source file, runs each candidate
// command, and restores the file. A command that reports success on code that does
// not compile is recorded as such.
//
// The finding this row came from: `tsc --noEmit -p tsconfig.json` prints
// "No errors found" no matter what, because that root config is references-only
// (`"files": []`). It passed during CF-9 while CompanyPage.tsx referenced three
// undefined names. The repo's own `npm run typecheck` targets tsconfig.app.json and
// is correct — the broken command was one I invented, not one the project ships.
//
// Run from apps/market-ui:  node ../../docs/company-feature/gates/cf16-gate.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const TARGET = 'src/components/company/FilingsTab.tsx';
const POISON = '\nconst __cf16_deliberate: number = "not a number";\n';

const COMMANDS = [
  { cmd: 'npm run typecheck', mustFail: true, note: "the project's documented command" },
  { cmd: 'npx tsc -b', mustFail: true, note: 'what the build runs' },
  { cmd: 'npx tsc --noEmit -p tsconfig.json', mustFail: false, note: 'references-only root — checks nothing' },
];

const run = (cmd) => {
  try { execSync(cmd, { stdio: 'pipe' }); return true; } catch { return false; }
};

const original = readFileSync(TARGET, 'utf8');
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `\n      ${detail}` : ''}`);
};

try {
  // Sanity: the tree must be clean before poisoning it, or every result is noise.
  check('the tree typechecks before the error is injected', run('npm run typecheck'),
    'npm run typecheck already fails — fix that before trusting this gate');

  writeFileSync(TARGET, original + POISON, 'utf8');

  for (const { cmd, mustFail, note } of COMMANDS) {
    const passed = run(cmd);
    if (mustFail) {
      check(`\`${cmd}\` fails on code that does not compile`, !passed,
        `it reported success — ${note}`);
    } else {
      // Not a failure of the repo; a fact about the command, recorded so nobody
      // reaches for it again believing it grades something.
      console.log(`NOTE  \`${cmd}\` reported ${passed ? 'SUCCESS on broken code' : 'failure'} — ${note}`);
    }
  }
} finally {
  writeFileSync(TARGET, original, 'utf8');
}

check('the file is restored byte-for-byte', readFileSync(TARGET, 'utf8') === original);
check('the tree typechecks again after restore', run('npm run typecheck'));

console.log(`\nRESULT ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
