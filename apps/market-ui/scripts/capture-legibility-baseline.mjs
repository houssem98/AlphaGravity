// MP-1 · docs/MOBILE_PARITY_ROADMAP.md §6 — every acceptance row run against the
// UNMODIFIED tree, so each row has a recorded red before the task that turns it
// green. §3 rule 6: a gate that cannot fail on the current tree is not a gate.
//
//   node scripts/capture-legibility-baseline.mjs           (all rows)
//   node scripts/capture-legibility-baseline.mjs R2 R3     (some)
//
// Window: whatever is live at https://market-ui-self.vercel.app when it runs.
// Output: docs/mobile/parity/baseline.json + the table printed on stdout.
//
// Node strips the types out of ../src/lib/legibility.ts and ../src/lib/overpaint.ts
// on import; both are the same modules the specs use, never copies of them.
import { chromium, devices } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { clippedText, visiblePairs } from '../src/lib/legibility.ts';
import { collectPaintBoxes, overpaintPairs } from '../src/lib/overpaint.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, '..', '..', 'docs', 'mobile', 'parity');
mkdirSync(OUT, { recursive: true });
const BASE = process.env.E2E_BASE_URL || 'https://market-ui-self.vercel.app';
const STATE = JSON.parse(readFileSync(join(root, 'e2e', '.auth', 'user.json'), 'utf8'));

// §4 device matrix.
const CLASSES = {
    XS: { width: 320, height: 568 },
    N: { width: 360, height: 780 },
    S: { width: 390, height: 844 },
    M: { width: 430, height: 932 },
    LS: { width: 788, height: 360 },
    LX: { width: 740, height: 360 },
    T: { width: 768, height: 1024 },
};

const only = process.argv.slice(2);
const wanted = (row) => only.length === 0 || only.includes(row);
const rows = [];
const log = (row, cls, status, detail, extra) => {
    rows.push({ row, cls, status, detail, ...extra });
    console.log(`${row.padEnd(4)} ${cls.padEnd(22)} ${status.padEnd(10)} ${detail}`);
};

const browser = await chromium.launch();
const open = async (cls) => {
    const ctx = await browser.newContext({
        ...devices['Desktop Chrome'],
        viewport: CLASSES[cls],
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        storageState: STATE,
    });
    return [ctx, await ctx.newPage()];
};
const settle = async (page, path) => {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(2_500);
};
// The crypto table is one tap in from the hub — MarketHub.tsx "See all Crypto",
// the same path e2e/mobileField.spec.ts takes.
const openCrypto = async (page) => {
    await settle(page, '/trading');
    await page.getByText(/See all Crypto/i).first().click({ timeout: 30_000 });
    await page.waitForTimeout(3_000);
    await page.locator('tbody tr').first().scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(600);
};
// MP-4 · `overpaintPairs` compares raw rects, so it reports a cover over text
// that is not painted there at all: a tab scrolled out of its own
// `overflow-x: auto` strip still reports its rect, and the chooser sitting
// beside the strip "covers" it. That is the mirror of V3's premise — V2 cannot
// see clipping, in either direction. The instrument stays unchanged (R5 says
// "reuses V2's instrument"); the pairs it returns are re-checked here against
// the covered element's VISIBLE box, which is its rect clamped to the nearest
// ancestor that clips.
const clipMapOf = (page) =>
    page.evaluate(() => {
        const out = [];
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
            let p = el.parentElement, c = null;
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

const scrollTableTo = (page, x) =>
    page.evaluate((v) => {
        for (const el of Array.from(document.querySelectorAll('div'))) {
            if (el.scrollWidth > el.clientWidth + 4 && getComputedStyle(el).overflowX === 'auto') el.scrollLeft = v;
        }
    }, x);

// ─── R2 · clipped digits in the markets table at three scroll offsets ───
// ─── R3 · rendered price vs the /api/crypto/markets payload, plus its clip ───
for (const cls of ['XS', 'N', 'S', 'M', 'LS', 'LX', 'T']) {
    if (!wanted('R2') && !wanted('R3')) break;
    const [ctx, page] = await open(cls);
    const wire = new Map();
    page.on('response', async (r) => {
        if (!/\/api\/crypto\/markets/.test(r.url())) return;
        const body = await r.json().catch(() => null);
        for (const row of Array.isArray(body) ? body : []) {
            const px = Number(row?.last ?? row?.priceUsd);
            if (row?.symbol && isFinite(px) && px > 0) wire.set(String(row.symbol), px);
        }
    });
    await openCrypto(page);

    if (wanted('R2') && ['XS', 'N', 'S', 'M', 'LS'].includes(cls)) {
        const hits = [];
        // V2's instrument on the same DOM at the same instant. The ledger's
        // whole premise is that this number stays 0 while the one above it
        // climbs — measure it here rather than asserting it in prose.
        let pairs = 0;
        for (const offset of [0, 150, 400]) {
            await scrollTableTo(page, offset);
            await page.waitForTimeout(400);
            for (const c of (await page.evaluate(clippedText, 'table')).filter((c) => c.numeral)) {
                hits.push({ offset, ...c });
            }
            pairs += overpaintPairs(await page.evaluate(collectPaintBoxes, 'table'), { numeralsOnly: true }).length;
        }
        const worst = hits.sort((a, b) => b.clippedPx - a.clippedPx)[0];
        log('R2', cls, hits.length ? 'RED' : 'GREEN',
            `${hits.length} clipped numeric element(s) · overpaintPairs ${pairs}` +
            (worst ? ` · worst ${worst.clippedPx}px on <${worst.tag}> "${worst.text}" (${worst.reason}, scrollLeft ${worst.offset})` : ''),
            { clipped: hits.length, overpaint: pairs, worst: worst || null });
    }

    if (wanted('R3')) {
        await scrollTableTo(page, 0);
        await page.waitForTimeout(300);
        // MP-2 added the two testids e2e/mobileField.spec.ts already read and
        // MarketList.tsx did not emit. Fall back to the structural selectors for
        // a deployment that predates them: the symbol chip is the `font-mono`
        // span in the pinned identity cell (MarketList.tsx:414) and the price is
        // the first visible right-aligned `font-mono` <td> (MarketList.tsx:420).
        // The testid matters below md, where that <td> also holds the delta.
        const shown = await page.evaluate(() =>
            Array.from(document.querySelectorAll('tbody tr')).slice(0, 8).map((tr) => {
                const sym = (tr.querySelector('[data-testid="symbol"]') || tr.querySelector('td span.font-mono'))?.textContent?.trim() || '';
                const cell = Array.from(tr.querySelectorAll('[data-testid="price"], td.text-right.font-mono')).find((e) => e.getClientRects().length > 0);
                return {
                    sym,
                    text: (cell?.textContent || '').trim(),
                    clip: cell ? Math.max(0, cell.scrollWidth - cell.clientWidth) : -1,
                };
            }));
        // The clip half comes from the instrument itself, never a second copy
        // of its arithmetic.
        const clips = new Map((await page.evaluate(clippedText, 'table')).map((c) => [c.text, c.clippedPx]));
        for (const r of shown) r.clip = Math.max(r.clip, clips.get(r.text) ?? 0);
        // Three outcomes, never merged: a fault, a clean row, and a pair the
        // measurement could not form. Reporting the third as the first is how a
        // blind instrument reads green — the whole reason this ledger exists.
        const bad = [];
        const blind = [];
        for (const r of shown) {
            const served = wire.get(r.sym);
            if (served === undefined || !r.text) {
                blind.push(`sym "${r.sym}" text "${r.text}" clip ${r.clip}`);
                continue;
            }
            const drift = Math.abs(Number(r.text.replace(/[$,]/g, '')) / served - 1);
            if (drift > 0.005) bad.push(`${r.sym}: rendered ${r.text} vs payload ${served} (${(drift * 100).toFixed(2)}%)`);
            if (r.clip > 1) bad.push(`${r.sym}: price cell clips ${r.clip}px`);
        }
        const status = bad.length ? 'RED' : blind.length === shown.length ? 'UNMEASURED' : 'GREEN';
        log('R3', cls, status,
            `${shown.length} rows · payload symbols ${wire.size} · ${bad.length} fault(s) · ${blind.length} unpaired` +
            (bad[0] ? ` · ${bad[0]}` : blind[0] ? ` · first unpaired: ${blind[0]}` : ''),
            { faults: bad, shown, payload: shown.map((r) => wire.get(r.sym) ?? null) });
    }
    await ctx.close();
}

// ─── R4 · the document must not scroll sideways ───
if (wanted('R4')) {
    for (const cls of ['XS', 'N', 'S', 'M', 'LS', 'LX']) {
        const [ctx, page] = await open(cls);
        const over = [];
        const escaped = [];
        let client = '';
        for (const path of ['/', '/search', '/trading', '/companies', '/history']) {
            await settle(page, path);
            const m = await page.evaluate(() => {
                const de = document.documentElement;
                const vw = de.clientWidth;
                // MP-3 · the second half of R4. `body { overflow-x: hidden }`
                // (src/index.css:127) propagates to the viewport because html is
                // `overflow-x: visible`, so scrollWidth can never exceed
                // clientWidth and the first half cannot fail on this tree. What
                // F2 actually means is content the user cannot reach: an element
                // outside the viewport that no horizontal scroller owns is not
                // contained, it is hidden. Text-bearing only — a decorative box
                // bleeding off the canvas is a design, an unreachable string is
                // a fault.
                const esc = [];
                for (const el of Array.from(document.querySelectorAll('*'))) {
                    const r = el.getBoundingClientRect();
                    if (r.width === 0 || r.height === 0) continue;
                    if (r.right <= vw + 1 && r.left >= -1) continue;
                    const own = Array.from(el.childNodes)
                        .filter((n) => n.nodeType === 3).map((n) => n.textContent || '').join('').trim();
                    if (!own) continue;
                    let p = el.parentElement, owned = false;
                    while (p) {
                        const ox = getComputedStyle(p).overflowX;
                        if (ox === 'auto' || ox === 'scroll') { owned = true; break; }
                        if (p === document.body) break;
                        p = p.parentElement;
                    }
                    if (owned) continue;
                    esc.push(`<${el.tagName.toLowerCase()}> "${own.slice(0, 22)}" [${Math.round(r.left)}..${Math.round(r.right)}]`);
                }
                return { w: vw, h: de.clientHeight, over: de.scrollWidth - vw, esc };
            });
            client = `${m.w}x${m.h}`;
            if (m.over > 0) over.push(`${path} +${m.over}px`);
            for (const e of m.esc) escaped.push(`${path}: ${e}`);
        }
        // The verdict is R4 as the ledger writes it — document overflow. The
        // escape count rides along as evidence and is deliberately NOT part of
        // the pass mark: it fires on two decorative landing-page cards that sit
        // entirely off-canvas at LS, which is a consequence of 788 >= md
        // rendering the desktop hero (MP-5's root cause), not of F2. Promoting
        // it to a verdict here would mean choosing a pass criterion after
        // seeing which way it fell.
        log('R4', cls, over.length ? 'RED' : 'GREEN',
            `client ${client} · ` + (over.length ? over.join(', ') : '5 routes, 0px document overflow') +
            ` · ${escaped.length} unreachable text element(s)` + (escaped[0] ? ` · ${escaped[0]}` : ''),
            { client, escaped });
        await ctx.close();
    }
}

// ─── R5 · nothing paints over text on /trading or /search ───
if (wanted('R5')) {
    for (const cls of ['N', 'LS']) {
        const [ctx, page] = await open(cls);
        const faults = [];
        for (const path of ['/trading', '/search']) {
            await settle(page, path);
            // MP-4 · a cover is a fault when the text can never be read, not
            // when it happens to be under fixed chrome at one scroll position.
            // /search autofocuses its composer, so the thread pane loads at
            // scrollTop 448 of 448 and the marketing hero sits under the 48px
            // header; scrolled to the top instead, the last example card sits
            // under the composer. Both are what fixed chrome does. So collect at
            // BOTH ends of every scroller and keep only the pairs present in
            // both — the chooser over the tab strip was one of those, and a
            // header that covers content at every offset still is.
            const at = async (where) => {
                await page.evaluate((w) => {
                    document.activeElement?.blur?.();
                    for (const el of Array.from(document.querySelectorAll('*'))) {
                        if (el.scrollHeight > el.clientHeight) el.scrollTop = w === 'top' ? 0 : el.scrollHeight;
                    }
                }, where);
                await page.waitForTimeout(500);
                return visiblePairs(
                    overpaintPairs(await page.evaluate(collectPaintBoxes, 'body')),
                    await clipMapOf(page),
                );
            };
            const key = (p) => `${p.overText || p.over.split('@')[0]}|${p.covered}`;
            const bottom = new Set((await at('bottom')).map(key));
            for (const p of (await at('top')).filter((p) => bottom.has(key(p)))) {
                faults.push(`${path}: "${p.overText || p.over}" over "${p.covered}" ${p.overlapX}x${p.overlapY}px`);
            }
        }
        // MP-4 · F3's surface is one tap in from /trading, so R5 as written never
        // visits it (MP-1 §8 finding). The chooser prints glyphs with no
        // background of its own, which is the `requireOpaque: false` case — text
        // on text is text a user cannot read.
        await openCrypto(page);
        const chooser = visiblePairs(
            overpaintPairs(await page.evaluate(collectPaintBoxes, 'body'), { requireOpaque: false })
                .filter((p) => /Columns/.test(p.overText) || /Columns/.test(p.covered)),
            await clipMapOf(page),
        );
        for (const p of chooser) faults.push(`crypto table: "${p.overText}" over "${p.covered}" ${p.overlapX}x${p.overlapY}px`);
        log('R5', cls, faults.length ? 'RED' : 'GREEN',
            `${faults.length} pair(s), ${chooser.length} on the chooser` + (faults[0] ? ` · ${faults[0]}` : ''),
            { faults });
        await ctx.close();
    }
}

// ─── R6 · every top-chrome control fits the viewport ───
if (wanted('R6')) {
    for (const cls of ['LS', 'LX']) {
        const [ctx, page] = await open(cls);
        await settle(page, '/trading');
        const outside = await page.evaluate(() => {
            const vw = document.documentElement.clientWidth;
            const vh = document.documentElement.clientHeight;
            const out = [];
            for (const el of Array.from(document.querySelectorAll('header button, header a, nav button, nav a, button, a'))) {
                const t = (el.textContent || '').trim();
                if (!t || t.length > 24) continue;
                const r = el.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) continue;
                if (r.top > 120) continue; // top chrome only
                if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) {
                    out.push(`${t} [${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}] vw ${vw}`);
                }
            }
            return out;
        });
        log('R6', cls, outside.length ? 'RED' : 'GREEN', `${outside.length} control(s) outside` + (outside[0] ? ` · ${outside[0]}` : ''));
        await ctx.close();
    }
}

// ─── R7 · every modal has a dismiss control inside the viewport ───
if (wanted('R7')) {
    for (const cls of ['XS', 'N', 'LS']) {
        const [ctx, page] = await open(cls);
        await settle(page, '/search');
        const dialogs = await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length);
        log('R7', cls, 'UNMEASURED',
            `${dialogs} dialog(s) mounted on /search without interaction. F5's PdfPreview mounts only from ResearchReport after a completed deep-research run, so it does not reproduce headlessly on a cold route — MP-6 owns opening it.`);
        await ctx.close();
    }
}

// ─── R8 + R9 · the Research Grid at N ───
if (wanted('R8') || wanted('R9')) {
    const [ctx, page] = await open('N');
    await settle(page, '/search');
    const grid = await page.evaluate(() => {
        const heads = Array.from(document.querySelectorAll('th'));
        const cells = Array.from(document.querySelectorAll('tbody td'));
        const tall = heads
            .map((h) => {
                const s = getComputedStyle(h);
                const lh = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.2;
                return { text: (h.textContent || '').trim().slice(0, 24), h: h.getBoundingClientRect().height, lh: Math.round(lh) };
            })
            .filter((x) => x.h > 3 * x.lh);
        const thin = cells
            .map((c) => ({ text: (c.textContent || '').trim(), w: c.getBoundingClientRect().width }))
            .filter((c) => c.text.length >= 12 && c.w > 0 && c.w < 60);
        return { heads: heads.length, cells: cells.length, tall, thin: thin.length, thin0: thin[0] || null };
    });
    if (wanted('R8')) {
        log('R8', 'N /search', grid.heads === 0 ? 'UNMEASURED' : grid.tall.length ? 'RED' : 'GREEN',
            grid.heads === 0
                ? 'no <th> on a cold /search — the Research Grid of frame 121203 renders only after a run, so MP-7 must open it first'
                : `${grid.tall.length}/${grid.heads} header(s) taller than 3 line-heights` +
                  (grid.tall[0] ? ` · "${grid.tall[0].text}" ${Math.round(grid.tall[0].h)}px vs lh ${grid.tall[0].lh}` : ''));
    }
    if (wanted('R9')) {
        log('R9', 'N /search', grid.cells === 0 ? 'UNMEASURED' : grid.thin ? 'RED' : 'GREEN',
            grid.cells === 0
                ? 'no grid cells on a cold /search — same gate as R8'
                : `${grid.thin}/${grid.cells} cell(s) under 60px holding 12+ chars` + (grid.thin0 ? ` · "${grid.thin0.text.slice(0, 20)}" in ${Math.round(grid.thin0.w)}px` : ''));
    }
    await ctx.close();
}

// ─── R10 · landscape renders the mobile shell ───
if (wanted('R10')) {
    for (const cls of ['LS', 'LX']) {
        const [ctx, page] = await open(cls);
        await settle(page, '/trading');
        const m = await page.evaluate(() => {
            const nav = document.querySelector('[data-testid="mobile-nav"]');
            return {
                nav: !!nav && nav.getBoundingClientRect().height > 0,
                rail: Array.from(document.querySelectorAll('aside, nav')).filter((e) => {
                    const r = e.getBoundingClientRect();
                    return r.height > 200 && r.width > 0 && r.width < 120 && r.left < 120;
                }).length,
            };
        });
        log('R10', cls, m.nav && m.rail === 0 ? 'GREEN' : 'RED', `MobileNav ${m.nav ? 'present' : 'absent'}, desktop rail candidates ${m.rail}`);
        await ctx.close();
    }
}

// ─── R11 · Company tab prior-period gap and contrast ───
if (wanted('R11')) {
    const [ctx, page] = await open('N');
    await settle(page, '/search');
    const m = await page.evaluate(() => {
        const money = Array.from(document.querySelectorAll('*')).filter(
            (e) => Array.from(e.childNodes).some((n) => n.nodeType === 3) && /^\$[\d.,]+[BMK]?$/.test((e.textContent || '').trim()),
        );
        const pct = Array.from(document.querySelectorAll('*')).filter(
            (e) => Array.from(e.childNodes).some((n) => n.nodeType === 3) && /^[+-][\d.]+%$/.test((e.textContent || '').trim()),
        );
        const pairs = [];
        for (const a of money) {
            const ra = a.getBoundingClientRect();
            for (const b of pct) {
                const rb = b.getBoundingClientRect();
                if (Math.abs(ra.top - rb.top) > 6 || rb.left < ra.right - 1) continue;
                pairs.push({ prior: (a.textContent || '').trim(), delta: (b.textContent || '').trim(), gap: Math.round(rb.left - ra.right), color: getComputedStyle(a).color });
            }
        }
        return { money: money.length, pct: pct.length, pairs };
    });
    const tight = m.pairs.filter((p) => p.gap < 8);
    log('R11', 'N /search', m.pairs.length === 0 ? 'UNMEASURED' : tight.length ? 'RED' : 'GREEN',
        m.pairs.length === 0
            ? `no prior-period/delta pair on a cold /search (${m.money} money, ${m.pct} percent elements) — the Company tab of frame 121333 needs a company selected, MP-8 owns opening it`
            : `${tight.length}/${m.pairs.length} pair(s) under 8px` + (tight[0] ? ` · "${tight[0].prior}" → "${tight[0].delta}" ${tight[0].gap}px, color ${tight[0].color}` : ''));
    await ctx.close();
}

await browser.close();
writeFileSync(join(OUT, 'baseline.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), rows }, null, 2));
const red = rows.filter((r) => r.status === 'RED').length;
const un = rows.filter((r) => r.status === 'UNMEASURED').length;
console.log(`\n${rows.length} measurements · ${red} RED · ${un} UNMEASURED · ${rows.length - red - un} GREEN`);
console.log(`written ${join(OUT, 'baseline.json')}`);
