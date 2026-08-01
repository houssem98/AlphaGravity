// DD-13: capture what e2e/dexterNarrow.spec.ts measures — the production CSS
// and the panel's own markup for a worst-case reply. Run after a deploy:
//
//   node scripts/capture-dexter-fixtures.mjs
//
// Fetching the shipped CSS rather than building it locally means the 380px
// measurement is taken against the bundle that is actually serving users.
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

// The worst case this panel can be handed: a levels ladder, a wide gfm table,
// a long unbroken token, citations with full payloads, a trust strip with
// several reasons, a failed step with a long error, and a drawing.
const live = JSON.parse(
  readFileSync(join(here, '..', 'src', 'components', 'trading', '__fixtures__', 'dexter-prod-levels.json'), 'utf8'),
);
const actions = JSON.parse(
  readFileSync(join(here, '..', 'src', 'components', 'trading', '__fixtures__', 'dexter-prod-actions.json'), 'utf8'),
);

const content = [
  live.text,
  '',
  '| Level | Price | Kind | Source | Distance | Touched |',
  '| --- | --- | --- | --- | --- | --- |',
  '| S1 | 58115.01 | support | deterministic TA over 120 bars | -6.2% | 4 |',
  '',
  'Reference 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48000000000000 and',
  'https://example.com/a/very/long/url/that/cannot/be/broken/at/a/space/at/all/ever',
  '',
  '```json',
  '{"entry": 61000.00, "stop": 57900.00, "note": "one very long unwrapped line of machine output"}',
  '```',
].join('\n');

const msg = {
  id: 'narrow',
  role: 'assistant',
  content,
  citations: live.citations,
  uncitedFigures: live.uncitedFigures,
  trust: live.trust,
  actions: actions.actions,
  fabricatedCites: [9],
  steps: [
    ...actions.steps,
    {
      label: 'Reading the social feed', tool: 'social', ms: 4200, status: 'failed',
      error: 'social feed unavailable: HTTP 502 from the upstream provider after 3 retries',
    },
  ],
};

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'dexter-prod.css'), css);
writeFileSync(join(out, 'dexter-turn.html'), renderToStaticMarkup(React.createElement(Turn, { msg })));
console.log(`captured ${cssPath} (${css.length} bytes) + turn markup`);
