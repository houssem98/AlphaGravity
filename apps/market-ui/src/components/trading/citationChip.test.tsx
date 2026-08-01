import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnswerBody, CiteChip, Turn, citeAnchorId, type Message } from './Assistant';
import type { DexterCitation } from '../../services/dexterTools';

// DD-4 · row 4. An [N] with a matching source is a live chip whose target is
// the id-N source row; an [N] with no matching source renders in the
// fabricated style and never becomes a chip. Without a citations array at all
// (an old localStorage message) the marker stays the literal text it was.
const CITES: DexterCitation[] = [
  {
    id: 1,
    title: 'BTC price structure (deterministic TA over 120 bars)',
    source: 'getChartData',
    text: 'Snapped to the engine prices: 58115→58115.01, 62290→62272.2',
  },
];

describe('row 4 — citation chips', () => {
  it('renders a matched [N] as a chip targeting the id-N source row', () => {
    const html = renderToStaticMarkup(
      <AnswerBody text="Support holds at 62211.53 [1]." citations={CITES} anchorScope="m1" />,
    );
    expect(html).toMatch(/<button[^>]*data-cite-target="dexter-cite-m1-1"/);
    // hover previews the tool payload
    expect(html).toMatch(/<button[^>]*title="[^"]*getChartData/);
    expect(html).not.toContain('[1]');
  });

  it('renders an unmatched [N] in the fabricated style, never as a chip', () => {
    const html = renderToStaticMarkup(
      <AnswerBody text="Momentum turned [2]." citations={CITES} anchorScope="m1" />,
    );
    expect(html).not.toContain('<button');
    expect(html).toMatch(/<span[^>]*class="[^"]*--down[^"]*"[^>]*>\[2\]<\/span>/);
  });

  it('reaches markers in lists, tables and bold — where the live answer puts them', () => {
    const md = [
      '- **Support:** 62211.53 [1]',
      '',
      '| Level | Src |',
      '| --- | --- |',
      '| 58115.01 | [1] |',
    ].join('\n');
    const html = renderToStaticMarkup(<AnswerBody text={md} citations={CITES} anchorScope="m1" />);
    expect(html.match(/data-cite-target="dexter-cite-m1-1"/g)?.length).toBe(2);
  });

  it('never touches a marker inside code — fenced content is data', () => {
    const html = renderToStaticMarkup(
      <AnswerBody text={'the raw output was `plan [1]`'} citations={CITES} anchorScope="m1" />,
    );
    expect(html).not.toContain('<button');
    expect(html).toContain('plan [1]');
  });

  it('leaves [N] as literal text when the message has no citations at all', () => {
    const html = renderToStaticMarkup(<AnswerBody text="Old answer [1]." />);
    expect(html).not.toContain('<button');
    expect(html).not.toContain('--down');
    expect(html).toContain('[1]');
  });

  it('scopes anchors by message so two answers citing [1] cannot collide', () => {
    expect(citeAnchorId('m1', 1)).not.toBe(citeAnchorId('m2', 1));
    const msg: Message = {
      id: 'm9',
      role: 'assistant',
      content: 'Support [1].',
      citations: CITES,
    };
    const html = renderToStaticMarkup(<Turn msg={msg} />);
    // the chip in the prose and the source row in the evidence panel agree
    expect(html).toContain('data-cite-target="dexter-cite-m9-1"');
    expect(html).toContain('id="dexter-cite-m9-1"');
  });

  it('CiteChip with no cite renders down-toned text, not a button', () => {
    const html = renderToStaticMarkup(<CiteChip n={4} scope="x" />);
    expect(html).not.toContain('<button');
    expect(html).toContain('--down');
  });

  // Captured verbatim from a live prod reply on 2026-08-01: 1769 chars,
  // 19 [N] markers, 17 citations, trust B/79, 0 fabricated.
  it('turns every marker in a real prod answer into a reachable chip', () => {
    const live = JSON.parse(
      readFileSync(new URL('./__fixtures__/dexter-prod-cited.json', import.meta.url), 'utf8'),
    ) as { text: string; citations: DexterCitation[] };
    const markers = [...live.text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    expect(markers.length).toBe(19);

    const html = renderToStaticMarkup(
      <AnswerBody text={live.text} citations={live.citations} anchorScope="live" />,
    );
    const chips = html.match(/data-cite-target="dexter-cite-live-\d+"/g) ?? [];
    expect(chips.length).toBe(markers.length);
    // every chip points at a source row this reply actually carries
    const ids = new Set(live.citations.map((c) => c.id));
    for (const m of markers) expect(ids.has(m)).toBe(true);
    // nothing was left behind as literal text
    expect(html).not.toMatch(/\[\d+\]/);
  });
});
