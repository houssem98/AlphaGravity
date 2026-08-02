import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// MB-1 · rows 1, 2 and 3 of docs/MOBILE_APP_ROADMAP.md.
//
// These are source scans by design. The document contract lives in files no
// component renders — index.html, the manifest, the icon — so there is nothing
// to mount and assert against; the artefact itself is the assertion. Row 3 is
// the same shape: `h-screen` on an app shell is a bug on iOS whether or not a
// test can observe the toolbar collapsing.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

const HTML = read('../index.html');
const MANIFEST = read('../public/manifest.webmanifest');
const ICON = read('../public/icon.svg');
const CSS = read('./index.css');

// The one hex the token rule allows outside .tsx/.css: --bg's dark value, which
// <meta> and JSON cannot read as a variable. Keep it equal to index.css:16.
const BG = '#070A12';

describe('row 1 — index.html carries the mobile document contract', () => {
  it('opts into the full screen so the insets have something to give back', () => {
    expect(HTML).toContain('viewport-fit=cover');
  });

  it('still sizes to the device and starts unzoomed', () => {
    expect(HTML).toContain('width=device-width');
    expect(HTML).toContain('initial-scale=1.0');
  });

  it('paints the browser chrome in --bg rather than white', () => {
    expect(HTML).toMatch(new RegExp(`<meta name="theme-color" content="${BG}"`, 'i'));
  });

  it('declares the dark surface it actually renders', () => {
    expect(HTML).toContain('name="color-scheme"');
  });

  it('is installable on both platforms', () => {
    expect(HTML).toContain('rel="manifest"');
    expect(HTML).toContain('name="apple-mobile-web-app-capable"');
    expect(HTML).toContain('name="mobile-web-app-capable"');
  });

  it('pairs the translucent status bar with the cover it needs', () => {
    expect(HTML).toContain('apple-mobile-web-app-status-bar-style');
  });

  it('links an icon that exists', () => {
    expect(HTML).toContain('href="/icon.svg"');
    expect(ICON).toContain('<svg');
  });
});

describe('row 2 — the manifest is complete and consistent', () => {
  const m = JSON.parse(MANIFEST) as Record<string, unknown>;

  it('parses', () => {
    expect(typeof m).toBe('object');
  });

  it.each(['name', 'short_name', 'description', 'start_url', 'scope', 'display'])(
    'declares %s',
    (key) => {
      expect(m[key]).toBeTruthy();
    },
  );

  it('launches without browser chrome', () => {
    expect(m.display).toBe('standalone');
  });

  it('agrees with the theme-color meta and with --bg', () => {
    expect(m.theme_color).toBe(BG);
    expect(m.background_color).toBe(BG);
  });

  it('covers the platform sizes each store actually reads', () => {
    const icons = m.icons as Array<{ src: string; sizes: string; purpose?: string }>;
    const sizes = icons.map((i) => i.sizes);
    // Chrome's install prompt wants 192 and 512; Android's launcher crops to a
    // platform shape and needs a maskable variant to survive it.
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(icons.some((i) => i.purpose === 'maskable')).toBe(true);
    // iOS never reads the manifest icons — only this link.
    expect(HTML).toContain('rel="apple-touch-icon"');
    expect(() => read('../public/apple-touch-icon.png')).not.toThrow();
  });

  it('ships at least one icon, and every icon it lists resolves', () => {
    const icons = m.icons as Array<{ src: string; type: string; sizes: string }>;
    expect(icons.length).toBeGreaterThan(0);
    for (const i of icons) {
      expect(i.src).toBeTruthy();
      expect(i.type).toBeTruthy();
      expect(i.sizes).toBeTruthy();
      // MB-1 ships the SVG only; MB-14 adds the PNG raster set. Whatever is
      // listed here must be on disk — a manifest that 404s fails to install
      // with no error the user can see.
      expect(() => read(`../public${i.src}`)).not.toThrow();
    }
  });
});

describe('row 3 — the app shells size to the visible viewport, not the tall one', () => {
  const shells: Array<[string, string]> = [
    ['AppLayout', './components/AppLayout.tsx'],
    ['TradingAssistantPage', './pages/TradingAssistantPage.tsx'],
    ['SearchPage', './pages/SearchPage.tsx'],
  ];

  it.each(shells)('%s has no h-screen / min-h-screen root', (_name, path) => {
    const src = read(path);
    expect(src).not.toMatch(/\bh-screen\b/);
    expect(src).not.toMatch(/\bmin-h-screen\b/);
  });

  it.each(shells)('%s has no raw 100vh in an arbitrary value', (_name, path) => {
    expect(read(path)).not.toContain('100vh');
  });

  it('AppLayout sizes both the frame and the outlet dynamically', () => {
    const src = read('./components/AppLayout.tsx');
    expect(src.match(/min-h-dvh/g)?.length).toBe(2);
  });

  it('the trading terminal fills exactly the visible viewport', () => {
    expect(read('./pages/TradingAssistantPage.tsx')).toContain('h-dvh');
  });

  it('search keeps both of its header offsets while going dynamic', () => {
    // Two shells net the 64px chrome (qa + research), two net 48px (grid +
    // company). The offsets are load-bearing and differ on purpose — only the
    // unit changed. These four were invisible to an `h-screen` grep, which is
    // why the row scans for the raw unit instead.
    const src = read('./pages/SearchPage.tsx');
    expect(src.match(/h-\[calc\(100dvh-64px\)\]/g)?.length).toBe(2);
    expect(src.match(/min-h-\[calc\(100dvh-48px\)\]/g)?.length).toBe(2);
  });
});

describe('row 3 — the safe-area insets exist and are inert by default', () => {
  it.each(['--safe-t', '--safe-r', '--safe-b', '--safe-l'])('defines %s', (v) => {
    expect(CSS).toContain(v);
  });

  it('falls back to 0px everywhere there is no notch to report', () => {
    expect(CSS.match(/env\(safe-area-inset-\w+, 0px\)/g)?.length).toBe(4);
  });

  it('clears the landscape notch for normal-flow content', () => {
    expect(CSS).toContain('padding-left: var(--safe-l)');
    expect(CSS).toContain('padding-right: var(--safe-r)');
  });
});
