import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnswerBody } from './Assistant';

// DD-2 · row 16. The panel is a side rail — at 380px a wide level table or a
// long unbroken figure must scroll inside its own box, never drag the body
// sideways. jsdom has no layout engine, so this asserts the containment
// structure that decides the outcome: each wide block owns an
// `overflow-x-auto` parent, and everything else is told to wrap.
const SRC = readFileSync(new URL('./Assistant.tsx', import.meta.url), 'utf8');

const WIDE_ANSWER = [
  '| Level | Price | Kind | Source | Distance | Touched |',
  '| --- | --- | --- | --- | --- | --- |',
  '| S1 | 58115.01 | support | deterministic TA over 120 bars | -6.2% | 4 |',
  '| R1 | 64243.53 | resistance | deterministic TA over 120 bars | +3.7% | 2 |',
  '',
  '```json',
  '{"entry": 61000.00, "stop": 57900.00, "target": 68000.00, "rr": 2.26, "note": "one very long unwrapped line of machine output that must not widen the panel"}',
  '```',
  '',
  'Reference 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48000000000000 and',
  'https://example.com/a/very/long/url/that/cannot/be/broken/at/a/space/at/all/ever',
].join('\n');

describe('row 16 — nothing widens the panel at 380px', () => {
  const html = renderToStaticMarkup(<AnswerBody text={WIDE_ANSWER} />);

  it('scrolls a wide table inside its own container', () => {
    expect(html).toMatch(/<div[^>]*class="[^"]*overflow-x-auto[^"]*"[^>]*><table\b/);
  });

  it('scrolls a long code block inside itself', () => {
    expect(html).toMatch(/<pre[^>]*class="[^"]*overflow-x-auto/);
  });

  it('breaks unbreakable tokens in prose rather than pushing them out', () => {
    for (const p of html.matchAll(/<p\b[^>]*class="([^"]*)"/g)) expect(p[1]).toContain('break-words');
    expect(html).toMatch(/<a\b[^>]*class="[^"]*break-words/);
  });

  it('gives the answer body a min-w-0 so a flex parent can shrink it', () => {
    expect(html).toMatch(/^<div[^>]*class="min-w-0/);
  });

  it('sets no fixed pixel width anywhere in the panel', () => {
    expect(SRC.match(/\b(w|min-w|max-w)-\[\d+px\]/g)).toBeNull();
  });
});
