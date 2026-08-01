import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnswerBody } from './Assistant';
import { figureSpans, uncitedFigures, type DexterCitation } from '../../services/dexterTools';

// DD-6 · row 5. The reply already says how many figures are unsupported; what
// was missing is WHERE. Each flagged figure is marked at its position, and a
// figure sitting in a sentence that carries a marker is never flagged — the
// client reads the same `figureSpans` rule the trust score is built on, so the
// answer text and the grade cannot disagree.
//
// A bare integer is not a market figure (`isMarketFigure`), so the samples here
// use the shapes prod actually emits: $64,250 / 62211.53 / 12%.
const CITES: DexterCitation[] = [
  { id: 1, title: 'BTC price structure', source: 'taLevels', text: 'levels' },
];

const marked = (html: string) =>
  [...html.matchAll(/data-uncited="true"[^>]*>([^<]*)</g)].map((m) => m[1]);

describe('row 5 — uncited figures are located, not just counted', () => {
  it('marks a figure whose sentence carries no marker', () => {
    const html = renderToStaticMarkup(
      <AnswerBody text="Momentum stalls near $64,250." citations={CITES} anchorScope="m1" />,
    );
    expect(marked(html)).toEqual(['$64,250']);
  });

  it('never marks a figure inside a cited sentence', () => {
    const html = renderToStaticMarkup(
      <AnswerBody text="Support holds at 62211.53 [1]." citations={CITES} anchorScope="m1" />,
    );
    expect(marked(html)).toEqual([]);
  });

  it('marks only the uncited occurrence when a figure appears in both', () => {
    const text = 'Support sits at 62211.53 [1]. A retest of 62211.53 would confirm.';
    // the server's own rule flags the figure, because one occurrence is bare
    expect(uncitedFigures(text)).toContain('62211.53');
    const html = renderToStaticMarkup(
      <AnswerBody text={text} citations={CITES} anchorScope="m1" />,
    );
    // exactly one of the two occurrences carries the mark
    expect(marked(html)).toEqual(['62211.53']);
    expect(html.match(/62211\.53/g)?.length).toBe(2);
  });

  it('marks figures inside lists and bold, where the live answer puts them', () => {
    const html = renderToStaticMarkup(
      <AnswerBody
        text={'- **Resistance:** $64,250 is untested\n- Support 58115.01 [1] holds'}
        citations={CITES}
        anchorScope="m1"
      />,
    );
    expect(marked(html)).toEqual(['$64,250']);
  });

  it('carries a tooltip that says why the figure is flagged', () => {
    const html = renderToStaticMarkup(
      <AnswerBody text="Target 68000.00." citations={CITES} anchorScope="m1" />,
    );
    expect(html).toMatch(/title="no source in this sentence[^"]*unsupported"/);
    expect(html).toContain('border-dotted');
  });

  it('marks nothing when the message carried no citations array at all', () => {
    const html = renderToStaticMarkup(<AnswerBody text="Old answer at $64,250." />);
    expect(marked(html)).toEqual([]);
  });

  it('never lets a code-fenced number desync the marks that follow it', () => {
    const text = 'The raw payload was `62211.53` and momentum stalls near $64,250.';
    const html = renderToStaticMarkup(
      <AnswerBody text={text} citations={CITES} anchorScope="m1" />,
    );
    expect(marked(html)).toEqual(['$64,250']);
  });
});

describe('row 5 against the reply prod actually returned', () => {
  const live = JSON.parse(
    readFileSync(new URL('./__fixtures__/dexter-prod-cited.json', import.meta.url), 'utf8'),
  ) as { text: string; citations: DexterCitation[]; uncitedFigures: string[] };

  it('marks every figure the server flagged, and only those', () => {
    const html = renderToStaticMarkup(
      <AnswerBody text={live.text} citations={live.citations} anchorScope="live" />,
    );
    const shown = new Set(marked(html).map((s) => s.replace(/\s+/g, '').toLowerCase()));
    // every mark corresponds to a figure the server listed as uncited
    for (const s of shown) expect(live.uncitedFigures).toContain(s);
    // and every listed figure that occurs bare in the text got marked
    const bare = new Set(figureSpans(live.text).filter((s) => s.uncited).map((s) => s.norm));
    expect([...shown].sort()).toEqual([...bare].sort());
  });
});

// Captured verbatim from a live prod reply on 2026-08-01: 1303 chars, 17
// citations, trust B/78, and the first probe of the run that flagged figures —
// two of them, both sitting in bullet sentences with no marker, one line below
// a cited figure that must stay unflagged.
describe('row 5 against a live reply that really had uncited figures', () => {
  const live = JSON.parse(
    readFileSync(new URL('./__fixtures__/dexter-prod-uncited.json', import.meta.url), 'utf8'),
  ) as { text: string; citations: DexterCitation[]; uncitedFigures: string[] };

  it('marks the two figures prod flagged, at every position they are bare', () => {
    expect(live.uncitedFigures).toEqual(['62,211.53', '62,921.235']);
    const html = renderToStaticMarkup(
      <AnswerBody
        text={live.text}
        citations={live.citations}
        uncited={live.uncitedFigures}
        anchorScope="live"
      />,
    );
    // the server dedupes to 2 norms; the text holds 3 bare occurrences of them
    expect(marked(html)).toEqual(['62,921.235', '62,211.53', '62,921.235']);
    expect([...new Set(marked(html))].sort()).toEqual(live.uncitedFigures);
  });

  it('leaves the cited figure one line above them untouched', () => {
    const html = renderToStaticMarkup(
      <AnswerBody
        text={live.text}
        citations={live.citations}
        uncited={live.uncitedFigures}
        anchorScope="live"
      />,
    );
    expect(live.text).toContain('62,546.01 [1]');
    expect(marked(html)).not.toContain('62,546.01');
    // the same figure IS cited earlier in the answer — that occurrence stays clean
    expect(live.text).toContain('**62,211.53**: if it holds');
    expect(marked(html).filter((m) => m === '62,211.53')).toHaveLength(1);
  });
});
