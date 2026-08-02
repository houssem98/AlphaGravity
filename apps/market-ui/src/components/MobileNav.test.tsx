import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import MobileNav, { isActivePath } from './MobileNav';
import { NAV_ITEMS } from '../lib/navItems';

// MB-3 · rows 4 and 6 of docs/MOBILE_APP_ROADMAP.md.
//
// Row 4 is a source scan: the failure mode it guards against is a *copied*
// nav list, which renders identically on the day it is written and drifts on
// every day after. Row 6 is measured off the rendered markup — a 32px tab is a
// mis-tap whether or not it looks fine in a screenshot.
const NAV_SRC = readFileSync(new URL('./MobileNav.tsx', import.meta.url), 'utf8');
const LAYOUT_SRC = readFileSync(new URL('./AppLayout.tsx', import.meta.url), 'utf8');

const render = (path: string) =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <MobileNav />
    </MemoryRouter>,
  );

describe('row 4 — one nav list, imported by both shells', () => {
  it('imports NAV_ITEMS rather than declaring its own', () => {
    expect(NAV_SRC).toContain("from '../lib/navItems'");
    // A literal `to:` in this file would mean a second, forkable list.
    expect(NAV_SRC).not.toMatch(/\bto:\s*['"]\//);
  });

  it('the desktop rail still imports the same list', () => {
    expect(LAYOUT_SRC).toContain("from '../lib/navItems'");
  });

  it('renders every destination — four as tabs, the rest behind More', () => {
    const html = render('/search');
    for (const { to } of NAV_ITEMS.slice(0, 4)) expect(html).toContain(`href="${to}"`);
    // The sheet is portalled and closed at rest, so the secondary hrefs are not
    // in the markup; what matters is that the split covers the list exactly.
    expect(NAV_ITEMS.length).toBeGreaterThan(4);
    expect(html).toContain('More destinations');
  });

  it('marks exactly one tab current per route', () => {
    const html = render('/history');
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
  });

  it('treats a company subroute as the Companies destination', () => {
    expect(isActivePath('/companies/AAPL', '/companies')).toBe(true);
    expect(isActivePath('/companies', '/companies')).toBe(true);
    expect(isActivePath('/history', '/companies')).toBe(false);
  });

  it('lights More when the active route lives inside the sheet', () => {
    // /settings is a SECONDARY item, so no tab is current but More is.
    const html = render('/settings');
    expect(html).toContain('More destinations');
    expect(html.match(/aria-current="page"/g)).toBeNull();
    expect(html).toContain('var(--accent)');
  });
});

describe('row 6 — every mobile target clears 44px', () => {
  it('gives each tab a 44px floor', () => {
    const html = render('/search');
    // 5 tabs: 4 primary + More.
    expect(html.match(/min-h-\[44px\]/g)?.length).toBe(5);
  });

  it('gives the sheet rows and sign-out the same floor', () => {
    // Three literal sites — the shared TAB constant, the sheet's destination
    // rows, and sign-out — which render as 5 tabs and 6 sheet rows. Counting
    // the source sites is what catches a new control added without the floor.
    expect(NAV_SRC.match(/min-h-\[44px\]/g)?.length).toBe(3);
    expect(NAV_SRC).toMatch(/min-h-\[44px\][^`]*Sign Out|Sign Out[\s\S]{0,400}/);
  });

  it('labels every tab in text, not in a title tooltip', () => {
    const html = render('/search');
    expect(html).not.toContain('title=');
    for (const { label, to } of NAV_ITEMS.slice(0, 4)) {
      expect(html).toContain(to === '/trading' ? '>AI<' : `>${label}<`);
    }
  });

  it('pays for its own safe-area inset', () => {
    expect(render('/search')).toContain('padding-bottom:var(--safe-b)');
  });

  it('is not fixed — fixed anchors to the layout viewport, not the visible one', () => {
    // Measured on prod at iPhone 14: window.innerHeight 743 vs a 664px visible
    // area, so `fixed bottom-0` put the bar 79px under the fold with no scroll
    // able to reach it. The bar must ride the h-dvh column instead.
    // Scoped to className strings — the comment above the fix names the very
    // classes it warns against, and a bare source scan would match the warning.
    expect(NAV_SRC).not.toMatch(/className="[^"]*\bfixed\b[^"]*bottom-0/);
    expect(render('/search')).not.toMatch(/class="[^"]*\bfixed\b/);
    expect(LAYOUT_SRC).toContain('h-dvh md:h-auto flex flex-col md:block');
  });
});

describe('row 6 — the shell hands the phone its space back', () => {
  it('hides the rail and its margin below md', () => {
    expect(LAYOUT_SRC).toContain('hidden md:flex');
    expect(LAYOUT_SRC).toContain('md:ml-14');
    expect(LAYOUT_SRC).not.toMatch(/className="flex-1 ml-14"/);
  });

  it('lets the content column shrink instead of pushing the shell sideways', () => {
    expect(LAYOUT_SRC).toContain('flex-1 min-w-0');
  });

  it('spans the header full-width below md', () => {
    expect(LAYOUT_SRC).toContain('left-0 md:left-14');
  });

  it('scrolls the content column so the bar is a sibling, not an overlay', () => {
    expect(LAYOUT_SRC).toContain('flex-1 overflow-y-auto');
  });

  it('mounts the mobile nav', () => {
    expect(LAYOUT_SRC).toContain('<MobileNav />');
  });
});
