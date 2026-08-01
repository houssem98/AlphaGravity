import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChartActions, Turn, describeAction, type Message } from './Assistant';
import type { ClientAction } from '../../services/dexterTools';

// DD-11 · row 15. The confirmation used to hang off `isDrawing`, a flag derived
// from the reply instead of read from it, so a chart mutation could not name
// itself. It is driven by `reply.actions` now. Every price in those args
// already passed the DX-5 gate and was snapped to a level the engine computed.
const SR: ClientAction = {
  type: 'support_resistance',
  args: { levels: [58115.01, 62272.2, 64243.535] },
};
const FIB: ClientAction = { type: 'fibonacci', args: { levels: [62742.47, 65744.6] } };
const PATTERN: ClientAction = {
  type: 'pattern',
  args: { points: [{ price: 58115.01, label: 'left shoulder' }, { price: 64243.535, label: 'head' }] },
};

const turn = (actions?: ClientAction[]) =>
  renderToStaticMarkup(
    <Turn msg={{ id: 'm1', role: 'assistant', content: 'Drew the levels.', actions } as Message} />,
  );

describe('row 15 — the confirmation is driven by reply.actions', () => {
  it('renders when the reply drew something', () => {
    const html = turn([SR]);
    expect(html).toContain('data-chart-actions="1"');
    expect(html).toContain('drawn on the chart');
  });

  it('renders nothing when the reply drew nothing', () => {
    expect(turn([])).not.toContain('data-chart-actions');
    expect(turn(undefined)).not.toContain('data-chart-actions');
    expect(renderToStaticMarkup(<ChartActions />)).toBe('');
  });

  it('names what was drawn, not just that something was', () => {
    const html = turn([SR]);
    expect(html).toContain('support / resistance');
    expect(html).not.toContain('Chart updated with analysis');
  });

  it('lists every drawing when a reply dispatched more than one', () => {
    const html = turn([SR, FIB]);
    expect(html).toContain('data-chart-actions="2"');
    expect(html).toContain('support / resistance');
    expect(html).toContain('Fibonacci retracement');
    expect(html.match(/<li\b/g)?.length).toBe(2);
  });
});

describe('row 15 — describeAction reads only what the args carry', () => {
  it('counts levels', () => {
    expect(describeAction(SR)).toBe('support / resistance · 3 levels');
  });

  it('counts pattern points', () => {
    expect(describeAction(PATTERN)).toBe('pattern · 2 levels');
  });

  it('singularises one level', () => {
    expect(describeAction({ type: 'order_block', args: { levels: [61030.92] } }))
      .toBe('order block · 1 level');
  });

  it('says only the name when the drawing carried no prices', () => {
    expect(describeAction({ type: 'pattern', args: {} })).toBe('pattern');
    expect(describeAction({ type: 'pattern', args: { points: [] } })).toBe('pattern');
  });

  it('falls back to the raw type for a drawing kind it does not know', () => {
    expect(describeAction({ type: 'volume_profile', args: {} })).toBe('volume profile');
  });

  it('ignores non-numeric level entries rather than counting them', () => {
    expect(describeAction({ type: 'fibonacci', args: { levels: [1.5, 'high', null] } }))
      .toBe('Fibonacci retracement · 1 level');
  });
});

// Captured verbatim from a live prod reply on 2026-08-01: "Draw the key
// support and resistance levels for BTC" → 200 in 33.46s, 1 action carrying 9
// gated levels, trust C/68.
describe('row 15 against the drawing prod actually dispatched', () => {
  const live = JSON.parse(
    readFileSync(new URL('./__fixtures__/dexter-prod-actions.json', import.meta.url), 'utf8'),
  ) as { actions: ClientAction[] };

  it('names the real drawing and counts its real levels', () => {
    expect(live.actions).toHaveLength(1);
    expect(describeAction(live.actions[0])).toBe('support / resistance · 9 levels');
  });

  it('renders that confirmation on the turn', () => {
    const html = turn(live.actions);
    expect(html).toContain('data-chart-actions="1"');
    expect(html).toContain('support / resistance · 9 levels');
  });
});

describe('row 15 — the dead flag is gone', () => {
  const src = readFileSync(new URL('./Assistant.tsx', import.meta.url), 'utf8');

  it('never reads or writes isDrawing outside a comment', () => {
    const code = src
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/**'))
      .join('\n');
    expect(code).not.toContain('isDrawing');
  });

  it('stores the actions the reply returned on the message', () => {
    expect(src).toMatch(/actions: reply\.actions/);
  });

  // Doctrine 6: an old localStorage turn predates the field and must still render.
  it('renders an old message that has no actions field at all', () => {
    const html = renderToStaticMarkup(
      <Turn msg={{ id: 'old', role: 'assistant', content: 'Older answer.' } as Message} />,
    );
    expect(html).toContain('Older answer.');
    expect(html).not.toContain('data-chart-actions');
  });
});
