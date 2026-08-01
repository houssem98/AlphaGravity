// DD-14 · row 17 — the ship shot.
//
// Renders the panel's own Turn for the reply prod actually returned, under the
// CSS bundle prod is actually serving, at the real rail width. This is the
// artefact the ledger's doctrine 8 asks for: proof from the deployed product,
// not from a fixture invented to look good.
//
//   tsx scripts/capture-dexter-ship.mjs
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { Turn } from '../src/components/trading/Assistant.tsx';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'e2e', 'fixtures');
const PROD = process.env.DEXTER_PROD ?? 'https://market-ui-self.vercel.app';

const index = await (await fetch(PROD + '/')).text();
const cssPath = index.match(/\/assets\/index-[A-Za-z0-9._-]+\.css/)?.[0];
if (!cssPath) throw new Error('no css bundle found in the prod index');
const css = await (await fetch(PROD + cssPath)).text();

const reply = JSON.parse(
  readFileSync(join(here, '..', 'src', 'components', 'trading', '__fixtures__', 'dexter-prod-ship.json'), 'utf8'),
);

const msg = {
  id: 'ship',
  role: 'assistant',
  content: reply.text,
  citations: reply.citations,
  fabricatedCites: reply.fabricatedCites,
  uncitedFigures: reply.uncitedFigures,
  trust: reply.trust,
  actions: reply.actions,
  steps: reply.steps,
  provider: reply.provider,
  model: reply.model,
  ms: reply.ms,
};

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'dexter-ship.css'), css);
writeFileSync(join(out, 'dexter-ship.html'), renderToStaticMarkup(React.createElement(Turn, { msg, traceOpen: true })));
console.log(`ship shot ready: ${cssPath}, ${reply.text.length} chars, ${reply.citations.length} citations, trust ${reply.trust.grade}/${reply.trust.score}`);
