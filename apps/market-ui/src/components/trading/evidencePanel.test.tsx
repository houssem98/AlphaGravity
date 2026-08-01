import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { FabricatedBanner, Turn, citationMs, citeAnchorId, type Message } from './Assistant';
import type { DexterCitation } from '../../services/dexterTools';
import type { CellStep } from '../../services/gridTrace';

// DD-5 · rows 6 and 8.
//
// Row 6: the price-snap trail is the strongest proof the agent did not invent a
// level. `truncate` at 11px in a capped bubble clipped it to about four words.
// It must now render end to end.
// Row 8: a fabricated citation is stated before the prose it undermines.

// Verbatim from the 2026-08-01 live probe recorded in section 0, fault F5.
const SNAP_TRAIL =
  "Drawing dispatched…Snapped to the engine's own prices: 58115→58115.01, " +
  '62290→62272.2, 64250→64243.535, 59130→59130.91, 57957→57957.6';

const CITES: DexterCitation[] = [
  { id: 1, title: 'BTC price structure', source: 'taLevels', text: SNAP_TRAIL },
  { id: 2, title: '@BenjaminCowen (788000 followers)', source: 'social', text: 'neutral — 106239 views' },
];

const STEPS: CellStep[] = [
  { label: 'Reading the levels', tool: 'taLevels', ms: 432, status: 'ok' },
  { label: 'Answering', tool: 'llm', ms: 29319, status: 'ok' },
];

const withEvidence = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  role: 'assistant',
  content: 'Support holds at 62211.53 [1].',
  citations: CITES,
  steps: STEPS,
  ...over,
});

describe('row 6 — evidence renders end to end', () => {
  const html = renderToStaticMarkup(<Turn msg={withEvidence()} />);

  it('never truncates a citation payload', () => {
    expect(html).not.toContain('truncate');
  });

  it('renders the price-snap trail readable to its last character', () => {
    expect(html).toContain('58115→58115.01');
    expect(html).toContain('57957→57957.6');
  });

  it('gives each citation its own card with the tool name and the DD-4 anchor', () => {
    for (const c of CITES) {
      expect(html).toContain(`id="${citeAnchorId('m1', c.id)}"`);
      expect(html).toContain(c.source);
    }
  });

  it('shows a latency only where a step actually timed that source', () => {
    expect(citationMs('taLevels', STEPS)).toBe(432);
    expect(citationMs('social', STEPS)).toBeUndefined();
    expect(citationMs('taLevels', undefined)).toBeUndefined();
    // the sources block ends where the trace panel begins
    const sources = html.slice(
      html.indexOf('Sources'),
      html.indexOf('border-t border-[color:var(--line)] pt-2'),
    );
    // exactly one latency in the whole block: the one step that timed a source
    expect(sources.match(/\d+ms/g)).toEqual(['432ms']);
    expect(sources).toContain('taLevels');
    expect(sources).toContain('social');
  });

  it('renders no panel at all when the reply carried no evidence', () => {
    const bare = renderToStaticMarkup(
      <Turn msg={{ id: 'm2', role: 'assistant', content: 'No data available.' }} />,
    );
    expect(bare).not.toContain('Sources');
  });
});

describe('row 8 — the fabricated banner sits above the answer', () => {
  it('renders the banner before the answer body, not after it', () => {
    const html = renderToStaticMarkup(<Turn msg={withEvidence({ fabricatedCites: [7, 9] })} />);
    const banner = html.indexOf('fabricated citation');
    const body = html.indexOf('Support holds at');
    expect(banner).toBeGreaterThan(-1);
    expect(banner).toBeLessThan(body);
    expect(html).toContain('[7] [9]');
    expect(html).toContain('role="alert"');
  });

  it('renders nothing when no citation was fabricated', () => {
    expect(renderToStaticMarkup(<FabricatedBanner fabricated={[]} />)).toBe('');
    expect(renderToStaticMarkup(<FabricatedBanner />)).toBe('');
  });

  it('keeps the warning at full strength — down tone, never cosmetically softened', () => {
    const html = renderToStaticMarkup(<FabricatedBanner fabricated={[3]} />);
    expect(html).toContain('--down');
    expect(html).toContain('1 fabricated citation:');
  });
});

describe('rows 6 and 8 against the reply prod actually returned', () => {
  const live = JSON.parse(
    readFileSync(new URL('./__fixtures__/dexter-prod-cited.json', import.meta.url), 'utf8'),
  ) as { text: string; citations: DexterCitation[]; fabricatedCites: number[] };

  it('renders all 17 live citation payloads in full, with no banner', () => {
    const html = renderToStaticMarkup(
      <Turn
        msg={{
          id: 'live',
          role: 'assistant',
          content: live.text,
          citations: live.citations,
          fabricatedCites: live.fabricatedCites,
        }}
      />,
    );
    expect(live.citations.length).toBe(17);
    for (const c of live.citations) expect(html).toContain(c.text);
    expect(live.fabricatedCites).toEqual([]);
    expect(html).not.toContain('fabricated citation');
  });
});
