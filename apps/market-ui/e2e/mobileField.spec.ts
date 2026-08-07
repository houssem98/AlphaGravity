import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { collectPaintBoxes, overpaintPairs } from '../src/lib/overpaint';
import { visiblePairs } from '../src/lib/legibility';

// MF-1 · row R5 of docs/MOBILE_FIELD_ROADMAP.md — a named gate per fault G1–G16.
//
// Every gate in this file is expected to FAIL when it lands. That is the point:
// six of these faults survived 109 green checks in mobileSweep.spec.ts, and a
// fix you cannot fail is a fix you cannot verify. The failure list this file
// produces is the fault map MF-2 onward works through.
//
// Two faults do not appear here and are logged in §8 instead:
//   G3  PdfPreview mounts only from ResearchReport, after a completed
//       deep-research run. Its mechanism gate is src/mobileField.test.ts.
//   G14 env(safe-area-inset-*) is 0 in headless Chromium — there is no notch to
//       emulate — so the unpainted gutter cannot be photographed here. The gate
//       below asserts the paint rule that would cover it and is marked
//       UNVERIFIED-ON-DEVICE.

const CLASS: Record<string, string> = {
    'mobile-320': 'XS',
    'mobile-360': 'N',
    'mobile-390': 'S',
    'mobile-430': 'M',
    'mobile-landscape': 'LS',
    'mobile-landscape-740': 'LX',
    'tablet-768': 'T',
    'desktop-baseline': 'D',
};

const cls = (info: TestInfo) => CLASS[info.project.name] || '?';

const ROUTES = [
    '/', '/auth', '/search', '/trading', '/companies',
    '/history', '/dashboard', '/documents', '/settings', '/billing',
] as const;

async function settle(page: Page, path: string) {
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(2_500);
}

const boxes = (page: Page, sel = 'body') => page.evaluate(collectPaintBoxes, sel);

// MP-4 · what `visiblePairs` needs: for every element with own text, its rect
// keyed the way overpaint's `desc()` rounds it, and the rect of the nearest
// ancestor that clips. Elements nothing clips are absent, and a pair over one
// of those is always kept.
const clipsOf = (page: Page) =>
    page.evaluate(() => {
        const out: [string, [number, number, number, number]][] = [];
        for (const el of Array.from(document.querySelectorAll('*'))) {
            const own = Array.from(el.childNodes)
                .filter((n) => n.nodeType === 3).map((n) => n.textContent || '').join('').trim();
            if (!own) continue;
            let r = el.getBoundingClientRect();
            const rg = document.createRange();
            rg.selectNodeContents(el);
            const rr = rg.getBoundingClientRect();
            if (rr.width > 0 && rr.height > 0) r = rr;
            if (r.width <= 0 || r.height <= 0) continue;
            let p = el.parentElement;
            let c: DOMRect | null = null;
            while (p) {
                const s = getComputedStyle(p);
                if (s.overflowX !== 'visible' || s.overflowY !== 'visible') { c = p.getBoundingClientRect(); break; }
                p = p.parentElement;
            }
            if (!c) continue;
            out.push([
                `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`,
                [c.left, c.top, c.right, c.bottom],
            ]);
        }
        return out;
    });

// /trading opens the hub — "Markets at a Glance", a card per market — not a
// table. The crypto table G1 and G5 live in is one tap further, behind
// MarketHub.tsx:135 "See all Crypto". The first run of this spec asserted a
// `<table>` on /trading and timed out for 30s on a page that never had one:
// that is the ledger's own warning about inferring structure from someone
// else's DOM, and this is the corrected reading.
async function openCryptoMarkets(page: Page) {
    await settle(page, '/trading');
    await page.getByText(/See all Crypto/i).first().click({ timeout: 30_000 });
    await page.waitForTimeout(3_000);
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 30_000 });
    // The collector culls anything outside the viewport, and the table sits
    // below two cards of gainers and losers: measured at N the first row landed
    // past y=780 and every gate on it reported zero faults on a surface it had
    // never seen. Scroll it into view first — the phone's user did.
    await page.locator('tbody tr').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
}

// The asset view is two taps in from the hub — same path mobileSweep row 14
// uses, kept here rather than shared so a change to one suite cannot silently
// move the other.
async function openAsset(page: Page) {
    await settle(page, '/trading');
    const card = page.locator('div').filter({ hasText: /^Tunisian Market/ }).first();
    const stock = card.getByRole('button').nth(1);
    await expect(stock).toBeVisible({ timeout: 30_000 });
    await stock.click();
    await page.waitForTimeout(3_500);
}

// ───────────────────────────── truth ─────────────────────────────

test.describe('G1 — the market table must not print a price the server did not send', () => {
    test('R7 + R8: no opaque cell covers a price glyph at any scroll offset', async ({ page }, info) => {
        test.skip(!['N', 'LS'].includes(cls(info)), 'row R7 is specified at N and LS');

        // What the server said, captured off the wire rather than inferred.
        const wire = new Map<string, number>();
        page.on('response', async (r) => {
            if (!/\/api\/crypto\/markets/.test(r.url())) return;
            const rows = await r.json().catch(() => null);
            if (!Array.isArray(rows)) return;
            for (const row of rows) {
                const px = Number(row?.last ?? row?.priceUsd);
                if (row?.symbol && isFinite(px) && px > 0) wire.set(String(row.symbol), px);
            }
        });

        await openCryptoMarkets(page);

        const faults: string[] = [];
        for (const offset of [0, 150, 400]) {
            await page.evaluate((x) => {
                for (const el of Array.from(document.querySelectorAll('div'))) {
                    if (el.scrollWidth > el.clientWidth + 4 && getComputedStyle(el).overflowX === 'auto') {
                        el.scrollLeft = x;
                    }
                }
            }, offset);
            await page.waitForTimeout(400);

            const pairs = overpaintPairs(await boxes(page, 'table'), { numeralsOnly: true });
            for (const p of pairs) faults.push(`scrollLeft ${offset}: ${p.over} covers ${p.overlapX}px of "${p.covered}" in ${p.under}`);
        }

        // The DOM text is the server's number; only the pixels are wrong. Prove
        // both halves, or a future "fix" that mangles the text passes R7.
        // Read the price off the element that says it is the price, and only
        // the one actually rendered at this width — MF-2 moved it inside the
        // pinned identity cell below md and left the column in place above it.
        const shown = await page.evaluate(() =>
            Array.from(document.querySelectorAll('tbody tr')).slice(0, 8).map((tr) => {
                const sym = tr.querySelector('[data-testid="symbol"]')?.textContent?.trim() || '';
                const price = Array.from(tr.querySelectorAll('[data-testid="price"]'))
                    .find((e) => e.getClientRects().length > 0);
                return { sym, text: (price?.textContent || '').trim() };
            }),
        );
        expect(shown.filter((r) => r.text).length, 'no rendered price cell found').toBeGreaterThan(0);
        for (const row of shown) {
            const served = wire.get(row.sym);
            if (served === undefined || !row.text) continue;
            const got = Number(row.text.replace(/[$,]/g, ''));
            const drift = Math.abs(got / served - 1);
            expect(drift, `${row.sym}: DOM text ${row.text} vs payload ${served}`).toBeLessThanOrEqual(0.005);
        }

        expect(faults, `${faults.length} price glyph(s) painted over`).toEqual([]);
    });

    // R8 proper: the whole route, not just the table. A numeral a user cannot
    // read is the same fault wherever it is painted over.
    test('R8: no numeral is painted over on /trading or /search', async ({ page }, info) => {
        test.skip(!['N', 'LS'].includes(cls(info)), 'row R8 is specified at N and LS');
        const faults: string[] = [];
        for (const path of ['/trading', '/search']) {
            await settle(page, path);
            for (const p of overpaintPairs(await boxes(page), { numeralsOnly: true })) {
                faults.push(`${path}: ${p.over} covers ${p.overlapX}x${p.overlapY}px of "${p.covered}"`);
            }
        }
        expect(faults, `${faults.length} covered numeral(s)`).toEqual([]);
    });
});

// ───────────────────────── reachability ─────────────────────────

test.describe('G2 + G4 — floating buttons must not sit on the navigation', () => {
    test('R9: every MobileNav tab hit-tests to its own link', async ({ page }, info) => {
        test.skip(!['N', 'LS'].includes(cls(info)), 'row R9 is specified at N and LS');
        const blocked: string[] = [];
        // The last entry is the asset view, not a route: PortfolioPanel's
        // `fixed bottom-6 left-6` FAB (PortfolioPanel.tsx:132) only mounts
        // there, so testing the hub tests a page the fault is not on.
        for (const path of ['/', '/search', '/trading', '/companies', '/history', 'ASSET']) {
            if (path === 'ASSET') await openAsset(page);
            else await settle(page, path);
            const bad = await page.evaluate(() => {
                const bar = document.querySelector('[data-testid="mobile-nav"]');
                if (!bar) return [];
                // md:hidden on the AppLayout routes: above the hinge the rail is
                // the navigation and the bar is correctly not rendered.
                if (bar.getBoundingClientRect().height === 0) return [];
                const out: string[] = [];
                for (const tab of Array.from(bar.querySelectorAll('a, button'))) {
                    const r = tab.getBoundingClientRect();
                    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                    if (!hit || !(tab.contains(hit) || hit === tab)) {
                        const label = (tab.textContent || '').trim();
                        const on = hit ? `${hit.tagName.toLowerCase()}.${(hit.getAttribute('class') || '').slice(0, 60)}` : 'nothing';
                        out.push(`${label} blocked by ${on}`);
                    }
                }
                return out;
            });
            for (const b of bad) blocked.push(`${path}: ${b}`);
        }
        expect(blocked, `${blocked.length} unreachable tab(s)`).toEqual([]);
    });

    // R9 asks for the tab CENTRE, and the centre is clear: measured on prod at
    // N the FAB is [24,700,80,756] and the SEARCH tab is [0,735,72,780], so
    // elementFromPoint(36, 757) misses the FAB's bottom edge by 1.5px while
    // 48x21px of the tab is covered. G2 is a rectangle fault, and R11 is the
    // row that measures rectangles.
    test('R11: no fixed or sticky element overlaps MobileNav', async ({ page }, info) => {
        test.skip(!['XS', 'N', 'LS'].includes(cls(info)), 'row R11 device set');
        await openAsset(page);
        const hits = await page.evaluate(() => {
            const nav = document.querySelector('[data-testid="mobile-nav"]');
            if (!nav) return ['mobile-nav absent'];
            const nr = nav.getBoundingClientRect();
            if (nr.height === 0) return [];
            const out: string[] = [];
            for (const el of Array.from(document.querySelectorAll('*'))) {
                if (nav.contains(el) || el.contains(nav)) continue;
                const s = getComputedStyle(el);
                if (s.position !== 'fixed' && s.position !== 'sticky') continue;
                const r = el.getBoundingClientRect();
                const ox = Math.min(r.right, nr.right) - Math.max(r.left, nr.left);
                const oy = Math.min(r.bottom, nr.bottom) - Math.max(r.top, nr.top);
                if (ox > 2 && oy > 2) {
                    out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') || '').slice(0, 50)} ` +
                        `[${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}] ` +
                        `covers ${Math.round(ox)}x${Math.round(oy)}px of the nav`);
                }
            }
            return out;
        });
        expect(hits, `${hits.length} element(s) on the nav`).toEqual([]);
    });

    test('R11: the assistant FAB clears the INFO/SOCIAL strip', async ({ page }, info) => {
        test.skip(!['N', 'LS'].includes(cls(info)), 'row R11 is specified at N and LS');
        await openAsset(page);
        const hits = await page.evaluate(() => {
            const fab = document.querySelector('[aria-label="Open assistant"], [aria-label="Close assistant"]');
            if (!fab) return ['assistant FAB absent'];
            const fr = fab.getBoundingClientRect();
            const out: string[] = [];
            for (const el of Array.from(document.querySelectorAll('button, a'))) {
                if (el === fab || el.contains(fab)) continue;
                const t = (el.textContent || '').trim();
                if (!/^(INFO|SOCIAL)$/i.test(t)) continue;
                const r = el.getBoundingClientRect();
                const ox = Math.min(fr.right, r.right) - Math.max(fr.left, r.left);
                const oy = Math.min(fr.bottom, r.bottom) - Math.max(fr.top, r.top);
                if (ox > 2 && oy > 2) out.push(`FAB covers ${Math.round(ox)}x${Math.round(oy)}px of ${t}`);
            }
            return out;
        });
        expect(hits, 'assistant FAB overlaps the strip').toEqual([]);
    });
});

test.describe('G5 — sticky chrome must not print on the content beneath', () => {
    test('R8: the column chooser does not paint on the tab labels', async ({ page }, info) => {
        test.skip(!['N', 'LS'].includes(cls(info)), 'specified at N and LS');
        await openCryptoMarkets(page);
        const chooser = page.getByRole('button', { name: /Columns/ });
        await expect(chooser).toBeVisible({ timeout: 30_000 });
        await chooser.scrollIntoViewIfNeeded();
        await page.waitForTimeout(600);
        // requireOpaque:false — the chooser has NO background, which is the
        // fault: it prints glyphs straight onto Categories and Portfolio.
        //
        // MP-4 · `visiblePairs` re-checks each pair against the covered
        // element's rect clamped to the ancestor that clips it. After MP-4's fix
        // the tab strip is `overflow-x: auto flex-1 min-w-0`, so `categories`
        // scrolls out of its own box: its rect still overlaps the chooser, and
        // nothing of it is painted there. This test failed on exactly that pair
        // while its own failure screenshot showed a clean tab row. The
        // assertion below is unchanged; only the false positive is removed, and
        // src/lib/legibility.test.ts fixes what the filter may not drop.
        const pairs = visiblePairs(
            overpaintPairs(await boxes(page), { requireOpaque: false }).filter(
                (p) => /Columns/.test(p.overText) || /Columns/.test(p.covered),
            ),
            await clipsOf(page),
        );
        expect(pairs.map((p) => `"${p.overText}" over "${p.covered}"`), 'chooser overpaints').toEqual([]);
    });
});

// ─────────────────────────── overflow ───────────────────────────

test.describe('G6 + G7 — the document must not slide sideways', () => {
    for (const path of ROUTES) {
        test(`R12: ${path} gains no horizontal scroll after content renders`, async ({ page }, info) => {
            test.skip(!['XS', 'N', 'S', 'M', 'LS', 'LX'].includes(cls(info)), 'row R12 device set');
            await settle(page, path);
            // Readiness is per route: R12 requires the primary content, not
            // domcontentloaded. Everything below the hinge renders MobileNav
            // last, so its presence is the shell's own readiness signal; /auth
            // has no nav and settles on its form.
            await page
                .locator(path === '/auth' ? 'form, input' : '[data-testid="mobile-nav"]')
                .first()
                .waitFor({ state: 'attached', timeout: 30_000 })
                .catch(() => {});
            const m = await page.evaluate(() => {
                const de = document.documentElement;
                return { over: de.scrollWidth - de.clientWidth, w: de.clientWidth, sw: de.scrollWidth };
            });
            expect(m.over, `${path}: scrollWidth ${m.sw} vs clientWidth ${m.w}`).toBeLessThanOrEqual(0);
        });
    }

    test('R12: the asset About panel stays inside both edges', async ({ page }, info) => {
        test.skip(!['N', 'LS'].includes(cls(info)), 'specified at N and LS');
        await openAsset(page);
        // Below the hinge the About panel is behind the INFO tab, not docked.
        const infoTab = page.getByRole('button', { name: /^INFO$/ });
        if (await infoTab.count()) await infoTab.first().click().catch(() => {});
        await page.waitForTimeout(1_500);
        const m = await page.evaluate(() => {
            const heads = Array.from(document.querySelectorAll('*')).filter(
                (e) => /^(Market cap|Market Cap)$/.test((e.textContent || '').trim()) && e.children.length === 0,
            );
            if (!heads.length) return null;
            const r = heads[0].getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(heads[0]);
            const g = range.getBoundingClientRect();
            return { left: Math.round(g.left), right: Math.round(g.right), w: document.documentElement.clientWidth, box: Math.round(r.width) };
        });
        // A missing panel is a gate that cannot see the fault, not a passing
        // app. It is reported as a skip with the reason, per §3.
        test.skip(m === null, 'no About panel rendered on the asset view at this class');
        expect(m!.left, 'label clipped on the left').toBeGreaterThanOrEqual(0);
        expect(m!.right, `label right ${m!.right} on a ${m!.w}px screen`).toBeLessThanOrEqual(m!.w);
    });
});

// ──────────────────────────── density ────────────────────────────

test.describe('G8 + G9 + G10 + G11 — density faults', () => {
    test('R8: Research Grid headers stay on at most two lines', async ({ page }, info) => {
        test.skip(cls(info) !== 'N', 'G8 is photographed at the real portrait width');
        await settle(page, '/search');
        const m = await page.evaluate(() => {
            const th = Array.from(document.querySelectorAll('th'));
            const out: string[] = [];
            for (const h of th) {
                const t = (h.textContent || '').trim();
                if (!t) continue;
                const range = document.createRange();
                range.selectNodeContents(h);
                const g = range.getBoundingClientRect();
                const lh = parseFloat(getComputedStyle(h).lineHeight) || 16;
                const lines = Math.round(g.height / lh);
                if (lines > 2) out.push(`"${t}" wraps to ${lines} lines`);
            }
            return { out, headers: th.length };
        });
        test.skip(m.headers === 0, 'no grid rendered on /search for this account');
        expect(m.out, 'shattered headers').toEqual([]);
    });

    test('R12: company financials keep a gutter between values', async ({ page }, info) => {
        test.skip(!['N', 'LS'].includes(cls(info)), 'specified at N and LS');
        await settle(page, '/companies/AAPL');
        const fin = page.getByRole('button', { name: /^Financials$/i });
        if (await fin.count()) await fin.first().click().catch(() => {});
        await page.waitForTimeout(2_000);
        const m = await page.evaluate(() => {
            const out: string[] = [];
            let seen = 0;
            for (const tr of Array.from(document.querySelectorAll('tr'))) {
                const cells = Array.from(tr.querySelectorAll('td')).filter((td) => (td.textContent || '').trim());
                const rects = cells.map((td) => {
                    const r = document.createRange();
                    r.selectNodeContents(td);
                    return { g: r.getBoundingClientRect(), t: (td.textContent || '').trim() };
                });
                for (let i = 1; i < rects.length; i++) {
                    seen++;
                    const gap = rects[i].g.left - rects[i - 1].g.right;
                    if (gap < 4) out.push(`"${rects[i - 1].t}" | "${rects[i].t}" gap ${Math.round(gap)}px`);
                }
            }
            return { out, seen };
        });
        test.skip(m.seen === 0, 'no financials table rendered on /companies/AAPL at this class');
        expect(m.out.slice(0, 8), `${m.out.length} of ${m.seen} value pair(s) with no gutter`).toEqual([]);
    });

    test('R13: the asset tab strip keeps its last tab uncovered', async ({ page }, info) => {
        test.skip(!['XS', 'N'].includes(cls(info)), 'row R13 is a below-md rule');
        await openAsset(page);
        const m = await page.evaluate(() => {
            const buy = Array.from(document.querySelectorAll('button')).find((b) => /^BUY /.test((b.textContent || '').trim()));
            if (!buy) return null;
            const strip = buy.parentElement?.previousElementSibling as HTMLElement | null;
            if (!strip) return null;
            const tabs = Array.from(strip.querySelectorAll('button'));
            const last = tabs[tabs.length - 1];
            if (!last) return null;
            const lr = last.getBoundingClientRect();
            const hit = document.elementFromPoint(lr.left + lr.width / 2, lr.top + lr.height / 2);
            const s = getComputedStyle(strip);
            return {
                covered: !(hit && (last.contains(hit) || hit === last)),
                tabs: tabs.map((t) => (t.textContent || '').trim()).join('|'),
                label: (last.textContent || '').trim(),
                scrollable: strip.scrollWidth > strip.clientWidth + 4,
                affordance: s.maskImage !== 'none' || s.overflowX === 'scroll' || !!strip.querySelector('[data-scroll-affordance]'),
            };
        });
        expect(m, 'tab strip not found').not.toBeNull();
        expect(m!.covered, `last tab "${m!.label}" of [${m!.tabs}] is covered`).toBe(false);
        if (m!.scrollable) expect(m!.affordance, 'scrolling strip shows no affordance').toBe(true);
    });

    test('R11: the ask-bar does not float over the chart', async ({ page }, info) => {
        test.skip(!['N', 'LS'].includes(cls(info)), 'specified at N and LS');
        await openAsset(page);
        const m = await page.evaluate(() => {
            const bar = Array.from(document.querySelectorAll('input, textarea')).find((e) =>
                /ask ai about this chart/i.test((e as HTMLInputElement).placeholder || ''),
            );
            const canvas = document.querySelector('canvas');
            if (!bar || !canvas) return null;
            const b = bar.getBoundingClientRect();
            const c = canvas.getBoundingClientRect();
            const ox = Math.min(b.right, c.right) - Math.max(b.left, c.left);
            const oy = Math.min(b.bottom, c.bottom) - Math.max(b.top, c.top);
            return { ox: Math.round(ox), oy: Math.round(oy), pos: getComputedStyle(bar).position };
        });
        test.skip(m === null, 'no chart or no ask-bar on this asset');
        expect(m!.oy <= 2 || m!.ox <= 2, `ask-bar covers ${m!.ox}x${m!.oy}px of the chart (position: ${m!.pos})`).toBe(true);
    });
});

// ────────────────────────── landscape ──────────────────────────

test.describe('G12–G16 — landscape is a device class, not a width', () => {
    test('R14: the shell renders the mobile layout at a short viewport', async ({ page }, info) => {
        test.skip(!['LS', 'LX'].includes(cls(info)), 'landscape only');
        // Measured at 788x360 on prod: /trading renders its own shell (aside
        // width 0, no <header>), while /search and /companies render
        // AppLayout's — rail 56px wide and a fixed 48px header. G12 is the
        // AppLayout shell, so that is what this row asks about.
        const found: string[] = [];
        for (const path of ['/search', '/companies']) {
            await settle(page, path);
            const m = await page.evaluate(() => {
                const rail = document.querySelector('aside');
                const nav = document.querySelector('[data-testid="mobile-nav"]');
                return {
                    w: document.documentElement.clientWidth,
                    h: document.documentElement.clientHeight,
                    rail: rail ? Math.round(rail.getBoundingClientRect().width) : 0,
                    nav: nav ? Math.round(nav.getBoundingClientRect().height) : 0,
                };
            });
            if (m.rail > 0) found.push(`${path}: desktop rail ${m.rail}px wide at ${m.w}x${m.h}`);
            if (m.nav === 0) found.push(`${path}: MobileNav not rendered at ${m.w}x${m.h}`);
        }
        expect(found, 'landscape got the desktop shell').toEqual([]);
    });

    test('R15: nothing sits under the fixed header on load', async ({ page }, info) => {
        test.skip(!['LS', 'LX'].includes(cls(info)), 'landscape only');
        await settle(page, '/search');
        const m = await page.evaluate(() => {
            const header = document.querySelector('header');
            if (!header) return null;
            const hr = header.getBoundingClientRect();
            if (getComputedStyle(header).position !== 'fixed') return { skip: true, top: 0, bottom: 0, what: '' };
            let worst: { top: number; what: string } | null = null;
            for (const el of Array.from(document.querySelectorAll('button, a, input'))) {
                if (header.contains(el)) continue;
                const r = el.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) continue;
                if (r.top >= hr.bottom - 0.5) continue;
                if (r.bottom <= hr.top) continue;
                if (!worst || r.top < worst.top) {
                    worst = { top: Math.round(r.top), what: `${el.tagName.toLowerCase()}.${(el.getAttribute('class') || '').slice(0, 50)}` };
                }
            }
            return { skip: false, top: worst ? worst.top : 9999, bottom: Math.round(hr.bottom), what: worst ? worst.what : '' };
        });
        expect(m, 'no header').not.toBeNull();
        if (m!.skip) return;
        expect(await page.evaluate(() => document.documentElement.scrollTop)).toBe(0);
        expect(m!.top, `${m!.what} at ${m!.top} is under a header ending at ${m!.bottom}`).toBeGreaterThanOrEqual(m!.bottom);
    });

    test('R16: the root element paints --bg behind the safe-area insets', async ({ page }, info) => {
        test.skip(!['LS', 'LX'].includes(cls(info)), 'landscape only');
        // UNVERIFIED-ON-DEVICE. Headless Chromium has no notch, so
        // env(safe-area-inset-left) is 0 and the black bar the phone
        // photographed cannot be produced here. What is checkable is the rule
        // that would have prevented it: the element behind body's padding is
        // <html>, and it must carry the background token, not the UA default.
        await settle(page, '/trading');
        const m = await page.evaluate(() => {
            const de = getComputedStyle(document.documentElement);
            const body = getComputedStyle(document.body);
            return {
                html: de.backgroundColor,
                bg: de.getPropertyValue('--bg').trim(),
                padLeft: body.paddingLeft,
            };
        });
        expect(m.html, `html paints ${m.html}; --bg is ${m.bg}`).not.toBe('rgba(0, 0, 0, 0)');
    });

    test('R11: the market list clears MobileNav', async ({ page }, info) => {
        test.skip(!['LS', 'LX'].includes(cls(info)), 'landscape only');
        await openCryptoMarkets(page);
        const m = await page.evaluate(() => {
            const nav = document.querySelector('[data-testid="mobile-nav"]');
            const rows = Array.from(document.querySelectorAll('tbody tr'));
            if (!nav || !rows.length) return null;
            const nr = nav.getBoundingClientRect();
            const vh = document.documentElement.clientHeight;
            let covered = 0;
            for (const r of rows) {
                const rr = r.getBoundingClientRect();
                if (rr.top > vh || rr.bottom < 0) continue;
                const oy = Math.min(rr.bottom, nr.bottom) - Math.max(rr.top, nr.top);
                if (oy > 2) covered++;
            }
            return { covered, navTop: Math.round(nr.top), vh };
        });
        test.skip(m === null, 'no table rendered');
        expect(m!.covered, `${m!.covered} row(s) under the nav (nav top ${m!.navTop} of ${m!.vh})`).toBe(0);
    });

    test('R17: a 200px keyboard inset leaves the input and its submit visible', async ({ page }, info) => {
        test.skip(!['LS', 'LX'].includes(cls(info)), 'landscape only');
        await settle(page, '/search');
        const size = page.viewportSize()!;
        // A soft keyboard shrinks the visual viewport. Emulating it by
        // shrinking the frame is the closest headless can get and is stated as
        // such: it reproduces the height, not the visualViewport API events.
        await page.setViewportSize({ width: size.width, height: Math.max(size.height - 200, 120) });
        await page.waitForTimeout(800);
        const input = page.locator('textarea, input:not([type="hidden"])').first();
        await input.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
        const m = await page.evaluate(() => {
            const el = document.querySelector('textarea, input:not([type="hidden"])') as HTMLElement | null;
            if (!el) return null;
            el.focus();
            const r = el.getBoundingClientRect();
            const form = el.closest('form') || el.parentElement;
            const submit = form?.querySelector('button[type="submit"], button');
            const s = submit?.getBoundingClientRect();
            const vh = document.documentElement.clientHeight;
            return {
                vh,
                inputOk: r.top >= 0 && r.bottom <= vh + 1,
                submitOk: !s || (s.top >= 0 && s.bottom <= vh + 1),
                inputBottom: Math.round(r.bottom),
                submitBottom: s ? Math.round(s.bottom) : null,
            };
        });
        await page.setViewportSize(size);
        test.skip(m === null, 'no composer on /search');
        expect(m!.inputOk, `input bottom ${m!.inputBottom} of ${m!.vh}`).toBe(true);
        expect(m!.submitOk, `submit bottom ${m!.submitBottom} of ${m!.vh}`).toBe(true);
    });
});
