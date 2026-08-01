import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { EngineMeta, lastAgentMeta } from './Assistant';

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
