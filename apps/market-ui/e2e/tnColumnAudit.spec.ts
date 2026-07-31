import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';

// Measuring instrument for docs/TN_COLUMN_AUDIT_ROADMAP.md. Turns every TN
// column on, renders the whole board, and reports how many rows actually paint
// a value. Run it before and after each ledger task:
//
//   npx playwright test tnColumnAudit --config=playwright.config.ts
//
// It fails only on columns that are provably dead (0% fill) or on a factor that
// emits the same constant for every row — the two shapes this audit exists to
// catch. Sparse-but-honest columns (a stock that did not trade has no volume)
// are reported, not failed.
const TN_ONLY = ['sector', 'isin', 'turnover', 'open', 'high', 'low', 'per', 'eps', 'pb',
    'netIncome', 'equity', 'divYield', 'engScore', 'engLabel', 'fMomentum', 'fVolume', 'fNews', 'fLiqTrend'];

// Columns whose emptiness is a defect, not a market fact.
const MUST_HAVE_DATA = ['7d %', 'Sector', 'ISIN', 'Market Cap', 'Circulating', 'Price', '24h %'];

test('every Tunisian column paints real data', async ({ page }) => {
    test.setTimeout(400_000);
    await page.addInitScript((keys: string[]) => {
        localStorage.setItem('tn-cols-v2', JSON.stringify({ hidden: Object.fromEntries(keys.map((k) => [k, false])) }));
    }, TN_ONLY);

    await page.goto('/trading');
    await page.getByText('See all Tunisian Market').click();
    await page.waitForTimeout(14_000);
    await page.selectOption('select', '100').catch(() => {});
    await page.waitForTimeout(40_000);

    const rep = await page.evaluate(() => {
        const table = Array.from(document.querySelectorAll('table'))
            .find((t) => Array.from(t.querySelectorAll('th')).some((th) => (th.textContent || '').trim() === 'PER'));
        if (!table) return null;
        const heads = Array.from(table.querySelectorAll('thead th')).map((th) => (th.textContent || '').trim());
        const rows = Array.from(table.querySelectorAll('tbody tr')).filter((tr) => tr.querySelectorAll('td').length === heads.length);
        return {
            rows: rows.length,
            cols: heads.map((h, i) => {
                const vals = rows.map((tr) => (tr.querySelectorAll('td')[i].textContent || '').trim());
                // TNC-7: '·' means "known: this stock did not trade", '—' means
                // "no datum". Neither is a value, but they are not the same
                // answer, so the instrument counts them apart. A rendered 0 is a
                // real measurement and does count as filled.
                const filled = vals.filter((v) => v && v !== '·' && !/^[—\-–]+$/.test(v));
                const noTrade = vals.filter((v) => v === '·').length;
                const zeros = filled.filter((v) => /^0(\s|$)/.test(v)).length;
                return { head: h, n: vals.length, filled: filled.length, noTrade, zeros, distinct: new Set(filled).size, sample: filled.slice(0, 3) };
            }),
        };
    });

    expect(rep, 'TN table did not render').not.toBeNull();
    expect(rep!.rows).toBeGreaterThan(50);

    const line = (c: { head: string; filled: number; n: number; noTrade: number; zeros: number; distinct: number; sample: string[] }) =>
        `${c.head.padEnd(14)} ${String(c.filled).padStart(3)}/${c.n}  ${String(Math.round((100 * c.filled) / c.n)).padStart(3)}%  distinct=${String(c.distinct).padStart(3)}` +
        `  noTrade=${String(c.noTrade).padStart(2)} zeros=${String(c.zeros).padStart(2)}  ${JSON.stringify(c.sample).slice(0, 40)}`;
    const body = rep!.cols.filter((c) => c.head).map(line).join('\n');
    console.log(`\nTN COLUMN AUDIT — ${rep!.rows} rows\n` + body);

    // TNC-8: the table is also written to a committed file, so a change in any
    // column's fill or distinctness shows up as a git diff on the next run
    // instead of having to be spotted by eye in the console.
    writeFileSync(
        new URL('tn-column-baseline.txt', import.meta.url),
        `TN COLUMN AUDIT — ${rep!.rows} rows\n` +
        `column         filled     %  distinct  noTrade zeros\n${body}\n`,
    );

    const named = (h: string) => rep!.cols.find((c) => c.head === h);

    // A ready-to-paste §5 progress-log row, so each pass records the same shape.
    const cell = (h: string) => { const c = named(h); return c ? `${h} ${c.filled}/${c.n} d${c.distinct}` : `${h} —`; };
    console.log(
        `\n§5 ROW → | ${new Date().toISOString().slice(0, 10)} | <task> | ` +
        ['Price', '7d %', 'Volume', 'Open', 'High', 'Low', 'PER', 'P/B', 'Div Yield',
            'Score', 'Signal', 'Momentum', 'Vol Factor', 'News', 'Liq/Trend'].map(cell).join('; ') + '. |',
    );
    const dead = MUST_HAVE_DATA.filter((h) => (named(h)?.filled ?? 0) === 0);
    expect(dead, `columns rendering nothing for the whole board: ${dead.join(', ')}`).toEqual([]);

    // A factor that returns one constant for all 75 rows carries no information,
    // however confident it looks. That is the fabrication shape, not a data gap.
    const constants = ['Momentum', 'Vol Factor', 'News', 'Score']
        .filter((h) => { const c = named(h); return c && c.filled >= 50 && c.distinct === 1; })
        .map((h) => `${h}=${named(h)!.sample[0]}`);
    expect(constants, `factor columns emitting one constant for every row: ${constants.join(', ')}`).toEqual([]);
});
