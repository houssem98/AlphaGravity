import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnswerBody, EngineMeta, MARKDOWN_COMPONENTS, lastAgentMeta } from './Assistant';

// DD-1 · rows 2 and 3 of the design regression table.
//
// Row 2 is a source scan by design: a hex literal or an off-scale radius is a
// bug whether or not it renders, because it cannot follow a theme change. Row 3
// is a render assertion — the footer must print what the server sent and
// nothing else. `Gemini` is checked both ways: it must not survive in source,
// and no engine identity may be produced without a reply carrying one.
const SRC = readFileSync(new URL('./Assistant.tsx', import.meta.url), 'utf8');

describe('row 2 — the Dexter tree uses the design system, not literals', () => {
  it('has no hex colour literal', () => {
    expect(SRC.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
  });

  it('has no arbitrary text-[Npx] size', () => {
    expect(SRC.match(/text-\[\d+px\]/g)).toBeNull();
  });

  it('has no rounded-2xl (16px is twice the system maximum radius)', () => {
    expect(SRC).not.toContain('rounded-2xl');
  });

  it('reads colour through the token vars the rest of the terminal uses', () => {
    expect(SRC).toContain('bg-[color:var(--bg)]');
    expect(SRC).toContain('border-[color:var(--line)]');
    expect(SRC).toContain('text-[color:var(--text-3)]');
  });
});

describe('row 3 — the footer names the real engine', () => {
  it('renders the provider and model the reply carried', () => {
    const html = renderToStaticMarkup(
      <EngineMeta meta={{ provider: 'deepseek', model: 'deepseek-v4-flash', ms: 32351 }} />,
    );
    expect(html).toContain('deepseek');
    expect(html).toContain('deepseek-v4-flash');
    expect(html).toContain('32351ms');
  });

  it('renders nothing when no turn carried an engine identity', () => {
    expect(renderToStaticMarkup(<EngineMeta meta={null} />)).toBe('');
  });

  it('takes the newest turn that reported one', () => {
    expect(
      lastAgentMeta([
        { provider: 'deepseek', model: 'deepseek-v4-flash', ms: 1000 },
        {},
        { provider: 'deepseek', model: 'deepseek-r2', ms: 32351 },
      ]),
    ).toEqual({ provider: 'deepseek', model: 'deepseek-r2', ms: 32351 });
  });

  it('reports nothing for an old localStorage session with no provider fields', () => {
    expect(lastAgentMeta([{}, { model: 'deepseek-v4-flash' }, { provider: 'deepseek' }])).toBeNull();
  });

  it('never says Gemini — the string is gone from the component tree', () => {
    expect(SRC).not.toMatch(/Gemini/i);
  });
});

// DD-2 · row 1. The typography plugin is not installed, so a `prose*` class is
// not a style — it is a style that silently does nothing. Every node type a live
// answer actually emits must be claimed by the component map instead.
const LIVE_SHAPED_ANSWER = [
  '## Direction',
  '',
  'BTC is **holding** the range with *no* breakout [1].',
  '',
  '### Levels',
  '',
  '- Support `58115.01`',
  '- Resistance `64243.53`',
  '',
  '| Level | Price | Kind |',
  '| --- | --- | --- |',
  '| S1 | 58115.01 | support |',
  '| R1 | 64243.53 | resistance |',
  '',
  '1. Wait for the retest',
  '2. Size to 1R',
  '',
  '> Not financial advice.',
  '',
  '```json',
  '{"stop": 57900}',
  '```',
  '',
  'Source: [Binance](https://binance.com)',
].join('\n');

describe('row 1 — markdown is really styled, not asking a plugin that is absent', () => {
  it('leaves no typography-plugin class in the source', () => {
    expect(SRC).not.toMatch(/\bprose\b|prose-/);
  });

  it('claims every node type a live answer emits', () => {
    for (const node of [
      'h2', 'h3', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'code', 'pre',
      'table', 'blockquote', 'a',
    ]) {
      expect(MARKDOWN_COMPONENTS[node as keyof typeof MARKDOWN_COMPONENTS]).toBeTypeOf('function');
    }
  });

  it('renders a live-shaped answer through the map, not browser defaults', () => {
    const html = renderToStaticMarkup(<AnswerBody text={LIVE_SHAPED_ANSWER} />);
    // `##` becomes a tracked Archivo Narrow label over a hairline
    expect(html).toMatch(/<h2[^>]*class="[^"]*font-display[^"]*text-label[^"]*"[^>]*>Direction<\/h2>/);
    expect(html).toMatch(/<h3[^>]*class="[^"]*text-data[^"]*"[^>]*>Levels<\/h3>/);
    expect(html).toContain('list-disc');
    expect(html).toContain('list-decimal');
    expect(html).toMatch(/<strong[^>]*class="[^"]*font-semibold/);
    expect(html).toMatch(/<em[^>]*class="[^"]*italic/);
    expect(html).toContain('border-l-2');
    expect(html).toContain('rel="noreferrer"');
    // remark-gfm must be wired or the pipe table stays literal text
    expect(html).toMatch(/<table[^>]*class=/);
    expect(html).not.toContain('| Level | Price | Kind |');
  });

  // Captured verbatim from a live prod reply on 2026-08-01
  // (POST /api/agent/chat, BTC, deepseek/deepseek-v4-flash, 17 citations, B/80).
  // The map has to handle what the model actually writes today, not only what a
  // synthetic sample exercises.
  it('renders the answer prod actually returned', () => {
    const live = readFileSync(new URL('./__fixtures__/dexter-prod-answer.md', import.meta.url), 'utf8');
    const html = renderToStaticMarkup(<AnswerBody text={live} />);
    // what the live answer is built from: bulleted levels and bold section leads
    expect(html.match(/<li\b/g)?.length).toBe(6);
    expect(html.match(/<strong\b/g)?.length).toBe(5);
    for (const li of html.matchAll(/<li\b[^>]*class="([^"]*)"/g)) expect(li[1]).toContain('text-body');
    // the [N] markers survive to DD-4, which turns them into chips
    expect(html).toContain('[1]');
  });

  it('sets every figure in Martian Mono, never sharing a typeface with a word', () => {
    const html = renderToStaticMarkup(<AnswerBody text={LIVE_SHAPED_ANSWER} />);
    const codes = [...html.matchAll(/<code\b[^>]*class="([^"]*)"/g)];
    expect(codes.length).toBeGreaterThan(0);
    for (const c of codes) expect(c[1]).toContain('font-mono');
    // the ladder of numbers lives in the table, so the table itself is mono
    expect(html).toMatch(/<table[^>]*class="[^"]*font-mono/);
  });
});
