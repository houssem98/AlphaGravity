import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnswerBody } from './Assistant';
import {
  renderLevelsBlock,
  renderPlanBlock,
  type DexterLevelsBlock,
  type DexterPlanBlock,
} from '../../services/dexterBlocks';
import { renderPlan } from '../../services/dexterRisk';

// DD-8 · rows 10 and 11. The blocks are emitted by the server from numbers that
// already validated — deterministic TA levels, and a risk block that passed
// parsePlan — so the client only paints what the server stood behind. Anything
// it does not recognise stays a code block.
const LEVELS: DexterLevelsBlock = {
  lastClose: 62546.01,
  trend: 'down',
  atr: 1699.38,
  unit: '',
  support: [{ price: 62211.53, touches: 3 }, { price: 61030.92, touches: 2 }],
  resistance: [{ price: 62921.235, touches: 2 }, { price: 63987.215, touches: 1 }],
};

const PLAN: DexterPlanBlock = {
  action: 'SELL', entry: 62546.01, stop: 64245.39, target: 59147.25,
  sizePct: 2, rr: 2, unit: '',
};

const render = (md: string) => renderToStaticMarkup(<AnswerBody text={md} />);

describe('row 10 — dexter blocks render as components', () => {
  it('renders a levels block as a ladder, not as JSON', () => {
    const html = render(renderLevelsBlock(LEVELS));
    expect(html).toContain('data-dexter-block="levels"');
    expect(html).not.toContain('"lastClose"');
    expect(html).toContain('62,546.01');
    // direction carries meaning: resistance down-toned, support up-toned
    expect(html).toContain('--down');
    expect(html).toContain('--up');
    expect(html.match(/touch(?:es)?</g)?.length).toBe(4);
  });

  it('orders the ladder as a chart reads — resistance above support', () => {
    const html = render(renderLevelsBlock(LEVELS));
    const rows = [...html.matchAll(/>(res|sup)</g)].map((m) => m[1]);
    expect(rows).toEqual(['res', 'res', 'sup', 'sup']);
    // and the highest resistance sits at the top
    expect(html.indexOf('63,987.215')).toBeLessThan(html.indexOf('62,921.235'));
  });

  it('renders a plan block as a card with an R:R bar', () => {
    const html = render(renderPlanBlock(PLAN));
    expect(html).toContain('data-dexter-block="plan"');
    expect(html).toContain('SELL');
    expect(html).toContain('2:1');
    expect(html).toContain('62,546.01');
    expect(html).toContain('64,245.39');
    expect(html).toContain('59,147.25');
    expect(html).toMatch(/width:\s*\d/);
  });

  it('falls back to a code block for an unknown dexter-* name, and never throws', () => {
    const html = render('```dexter-wormhole\n{"a":1}\n```');
    expect(html).toContain('<pre');
    expect(html).not.toContain('data-dexter-block');
    expect(html).toContain('{&quot;a&quot;:1}');
  });

  it('never rounds a level away from the price the TA found', () => {
    const html = render(
      renderLevelsBlock({ ...LEVELS, support: [{ price: 62211.53333333, touches: 3 }] }),
    );
    expect(html).toContain('62,211.53333333');
  });

  it('falls back to a code block when the body will not parse', () => {
    const html = render('```dexter-levels\nnot json at all\n```');
    expect(html).toContain('<pre');
    expect(html).not.toContain('data-dexter-block');
  });

  it('leaves ordinary fenced code exactly as it was', () => {
    const html = render('```json\n{"stop": 57900}\n```');
    expect(html).toContain('<pre');
    expect(html).not.toContain('data-dexter-block');
  });

  it('keeps the surrounding answer rendering normally', () => {
    const html = render(`## Direction\n\n${renderPlanBlock(PLAN)}\n\nStill bearish.`);
    expect(html).toContain('<h2');
    expect(html).toContain('data-dexter-block="plan"');
    expect(html).toContain('Still bearish.');
  });
});

describe('row 11 — an incomplete plan is never drawn as a card', () => {
  it.each([['entry'], ['stop'], ['target'], ['rr']])('warns when %s is missing', (field) => {
    const partial: Record<string, unknown> = { ...PLAN };
    delete partial[field];
    const html = render('```dexter-plan\n' + JSON.stringify(partial) + '\n```');
    expect(html).toContain('data-dexter-block="plan-incomplete"');
    expect(html).not.toContain('data-dexter-block="plan"');
    expect(html).toContain('incomplete plan');
    expect(html).toContain(field === 'rr' ? 'R:R' : field);
    expect(html).toContain('role="alert"');
  });

  it('names every missing number, not just the first', () => {
    const html = render('```dexter-plan\n{"action":"BUY","sizePct":2}\n```');
    for (const f of ['entry', 'stop', 'target', 'R:R']) expect(html).toContain(f);
  });

  it('rejects a non-numeric field rather than rendering it', () => {
    const html = render('```dexter-plan\n' + JSON.stringify({ ...PLAN, stop: 'tight' }) + '\n```');
    expect(html).toContain('data-dexter-block="plan-incomplete"');
    expect(html).toContain('stop');
  });
});

// Captured verbatim from a live prod reply on 2026-08-01 (1774 chars, trust
// B/79): the levels block the server prepended, with the deterministic TA the
// risk floor is also computed from.
describe('row 10 against the reply prod actually returned', () => {
  const live = JSON.parse(
    readFileSync(new URL('./__fixtures__/dexter-prod-levels.json', import.meta.url), 'utf8'),
  ) as { text: string };

  it('renders the live levels block as a ladder above the answer', () => {
    expect(live.text.startsWith('```dexter-levels')).toBe(true);
    const html = renderToStaticMarkup(<AnswerBody text={live.text} />);
    expect(html).toContain('data-dexter-block="levels"');
    expect(html).not.toContain('"lastClose"');
    // the 8 levels prod sent, each at full precision
    expect(html.match(/>(res|sup)</g)?.length).toBe(8);
    expect(html).toContain('65,654.97833333');
    expect(html).toContain('62,494');
    expect(html).toContain('down');
  });
});

describe('the server emits the plan block from the validated numbers', () => {
  it('renderPlan carries the block and keeps the prose lines', () => {
    const out = renderPlan(
      { action: 'SELL', entry: 62546.01, stop: 64245.39, target: 59147.25, sizePct: 2, rr: 2 },
      { symbol: 'BTC', isTN: false, isCrypto: true } as never,
    );
    expect(out).toContain('```dexter-plan');
    expect(out).toContain('**SELL** · entry 62546.01');
    // the card and the prose read the same numbers
    const html = render(out);
    expect(html).toContain('data-dexter-block="plan"');
    expect(html).toContain('64,245.39');
  });

  it('quotes a Tunisian plan in dinar in both the block and the prose', () => {
    const out = renderPlan(
      { action: 'BUY', entry: 13.4, stop: 12.9, target: 14.6, sizePct: 3, rr: 2.4 },
      { symbol: 'SFBT', isTN: true, isCrypto: false } as never,
    );
    expect(out).toContain('entry 13.4 TND');
    expect(render(out)).toContain('13.4 TND');
  });
});
