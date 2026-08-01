import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnswerBody, Turn, type Message } from './Assistant';

// DD-13 · rows 12 and 16.
//
// Doctrine 6: a reply missing citations / trust / steps renders text only, with
// no empty shells and no crash. `Assistant.tsx:372-381` restores the last 40
// messages from localStorage, and those were written by every build that came
// before this ledger — including ones that predate `actions`, `provider` and
// `uncitedFigures`. Every shape below is one this panel can be handed.
const SRC = readFileSync(new URL('./Assistant.tsx', import.meta.url), 'utf8');

const render = (msg: Message) => renderToStaticMarkup(<Turn msg={msg} />);

// The panels that must not appear when their data is absent.
const SHELLS = [
  'Sources',
  'data-trust-grade',
  'data-chart-actions',
  'data-trace-timeline',
  'fabricated citation',
  'data-stage-checklist',
];

describe('row 12 — an old message renders text only', () => {
  const bare: Message = { id: 'old-1', role: 'assistant', content: 'BTC is holding the range.' };

  it('renders the text', () => {
    expect(render(bare)).toContain('BTC is holding the range.');
  });

  it('renders no empty panel of any kind', () => {
    const html = render(bare);
    for (const shell of SHELLS) expect(html).not.toContain(shell);
  });

  it('renders the greeting the panel opens with', () => {
    const greeting: Message = {
      id: '1',
      role: 'assistant',
      content: 'Hello! I am your AI Trading Assistant.',
    };
    expect(render(greeting)).toContain('AI Trading Assistant');
    for (const shell of SHELLS) expect(render(greeting)).not.toContain(shell);
  });
});

describe('row 12 — every partial shape survives', () => {
  const shapes: Array<[string, Message]> = [
    ['citations only', { id: 'a', role: 'assistant', content: 'Support at 62211.53 [1].', citations: [{ id: 1, title: 'BTC levels', source: 'taLevels', text: 'levels' }] }],
    ['trust only', { id: 'b', role: 'assistant', content: 'No data.', trust: { grade: 'F', score: 0, rounds: 1, reasons: ['no answer produced'] } }],
    ['steps only', { id: 'c', role: 'assistant', content: 'Ran.', steps: [{ label: 'Answering', tool: 'llm', ms: 12, status: 'ok' }] }],
    ['actions only', { id: 'd', role: 'assistant', content: 'Drew.', actions: [{ type: 'fibonacci', args: {} }] }],
    ['uncited only', { id: 'e', role: 'assistant', content: 'Target $64,250.', uncitedFigures: ['$64,250'] }],
    ['empty citations array', { id: 'f', role: 'assistant', content: 'Nothing cited.', citations: [] }],
    ['empty steps array', { id: 'g', role: 'assistant', content: 'No steps.', steps: [] }],
    ['empty actions array', { id: 'h', role: 'assistant', content: 'No draw.', actions: [] }],
    ['empty answer text', { id: 'i', role: 'assistant', content: '', trust: { grade: 'F', score: 0, rounds: 1, reasons: ['no answer produced'] } }],
  ];

  it.each(shapes)('renders %s without crashing', (_name, msg) => {
    expect(() => render(msg)).not.toThrow();
  });

  it('shows no evidence panel for an empty citations array', () => {
    expect(render(shapes[5][1])).not.toContain('Sources');
  });

  it('shows no timeline for an empty steps array', () => {
    expect(render(shapes[6][1])).not.toContain('data-trace-timeline');
  });

  it('shows no confirmation for an empty actions array', () => {
    expect(render(shapes[7][1])).not.toContain('data-chart-actions');
  });

  it('still renders the verdict when the answer itself came back empty', () => {
    const html = render(shapes[8][1]);
    expect(html).toContain('data-trust-grade="F"');
    expect(html).toContain('no answer produced');
  });

  it('marks nothing when uncitedFigures arrives without citations', () => {
    // no citations array means no chip/mark pass at all — the text is untouched
    expect(render(shapes[4][1])).not.toContain('data-uncited');
  });
});

describe('row 12 — a malformed message does not take the panel down', () => {
  it('survives a null-ish content', () => {
    const broken = { id: 'x', role: 'assistant', content: undefined } as unknown as Message;
    expect(() => render(broken)).not.toThrow();
  });

  it('survives a citation array holding a malformed entry', () => {
    const msg = {
      id: 'y',
      role: 'assistant',
      content: 'Cited [1].',
      citations: [{ id: 1 }],
    } as unknown as Message;
    expect(() => render(msg)).not.toThrow();
  });

  it('survives a step with no status', () => {
    const msg = {
      id: 'z',
      role: 'assistant',
      content: 'Ran.',
      steps: [{ label: 'Odd', tool: 'x', ms: 1 }],
    } as unknown as Message;
    expect(() => render(msg)).not.toThrow();
  });

  it('renders an unknown dexter block as code rather than throwing', () => {
    expect(() =>
      renderToStaticMarkup(<AnswerBody text={'```dexter-future\n{"x":1}\n```'} />),
    ).not.toThrow();
  });
});

describe('row 16 — nothing in the panel can scroll the body sideways', () => {
  it('gives every wide surface its own overflow container', () => {
    // markdown tables, code blocks and the levels ladder each scroll alone
    expect(SRC.match(/overflow-x-auto/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('lets the message column shrink instead of forcing a minimum', () => {
    expect(SRC).toContain('min-w-0');
    expect(SRC.match(/\b(w|min-w|max-w)-\[\d+px\]/g)).toBeNull();
  });

  it('wraps long unbroken strings everywhere they can appear', () => {
    // citation payloads, trust reasons, action labels, step errors, links
    expect(SRC.match(/break-words/g)?.length).toBeGreaterThanOrEqual(8);
  });

  it('never lets the header row itself grow with the quote', () => {
    expect(SRC).toMatch(/truncate font-mono/);
    expect(SRC).toMatch(/ml-auto flex shrink-0/);
  });

  it('keeps the panel column a flex column that owns its own scroll', () => {
    expect(SRC).toMatch(/flex flex-col h-full/);
    expect(SRC).toMatch(/flex-1 overflow-y-auto/);
  });
});
