import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { quotePrice } from './Assistant';

// DD-12 · rows 2 and 16. The header and composer were the last consumer-chat
// surfaces in the panel: a 40px avatar, an 18px bold title, a blur-gradient
// hover glow, and a 56px pill input. Both are terminal chrome now, on tokens,
// and the cancel affordance sits where the hand already is.
const SRC = readFileSync(new URL('./Assistant.tsx', import.meta.url), 'utf8');

describe('row 2 — the chrome is on tokens', () => {
  it('carries no hex literal, no arbitrary px size, no off-scale radius', () => {
    expect(SRC.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
    expect(SRC.match(/text-\[\d+px\]/g)).toBeNull();
    expect(SRC).not.toContain('rounded-2xl');
  });

  it('retires the blur-gradient hover glow', () => {
    expect(SRC).not.toContain('blur');
    expect(SRC).not.toMatch(/group-hover:opacity/);
  });

  it('leaves no gradient anywhere in the panel', () => {
    expect(SRC).not.toContain('bg-gradient-to');
  });

  it('sizes the header as one terminal row, like the app own Topbar', () => {
    expect(SRC).toMatch(/flex h-10 shrink-0 items-center[^"]*bg-\[color:var\(--surface\)\]/);
  });
});

describe('row 2 — the quote is Martian Mono in the listing currency', () => {
  it('quotes a dollar listing in dollars', () => {
    expect(quotePrice(62546.01, false)).toBe('$62546.01');
  });

  it('quotes a Tunisian listing in dinar, with no dollar sign anywhere', () => {
    expect(quotePrice(13.4, true)).toBe('13.40 TND');
    expect(quotePrice(13.4, true)).not.toContain('$');
  });

  it('keeps four decimals below 1 so a micro-cap does not round to zero', () => {
    expect(quotePrice(0.4321, false)).toBe('$0.4321');
    expect(quotePrice(0.00012345, true)).toBe('0.0001 TND');
  });

  it('renders the quote in the mono face, never sharing a typeface with a word', () => {
    expect(SRC).toMatch(/font-mono text-label">\s*<span className="text-\[color:var\(--text-3\)\]">\{currentAsset\}/);
  });
});

describe('row 16 — the chrome survives a 380px rail', () => {
  it('lets the quote shrink and truncate rather than push the row wide', () => {
    expect(SRC).toMatch(/flex min-w-0 items-baseline gap-1\.5 truncate font-mono/);
  });

  it('keeps the action cluster from being squeezed', () => {
    expect(SRC).toMatch(/ml-auto flex shrink-0 items-center/);
  });

  it('lets the composer input shrink inside its row', () => {
    expect(SRC).toMatch(/min-w-0 flex-1 rounded-sm/);
  });

  it('hides the button words on a narrow rail but keeps the icons', () => {
    expect(SRC.match(/hidden sm:inline/g)?.length).toBe(2);
  });

  it('sets no fixed pixel width anywhere', () => {
    expect(SRC.match(/\b(w|min-w|max-w)-\[\d+px\]/g)).toBeNull();
  });
});

describe('DD-12 — the actions the task says to keep', () => {
  it('keeps the Analyze action in the header', () => {
    expect(SRC).toContain('ANALYZE');
    expect(SRC).toMatch(/onClick=\{handleAnalyze\}/);
  });

  it('turns the send control into a stop control while a run is in flight', () => {
    expect(SRC).toMatch(/isLoading \? \(\s*<button\s+onClick=\{\(\) => abortRef\.current\?\.abort\(\)\}/);
    expect(SRC).toContain('STOP');
  });

  it('still sends when idle, and refuses to send an empty message', () => {
    expect(SRC).toMatch(/onClick=\{handleSend\}\s+disabled=\{!input\.trim\(\)\}/);
  });
});
