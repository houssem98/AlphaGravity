import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// CT-1 · the instrument for docs/COMMAND_TERMINAL_ROADMAP.md §6.
//
// Written BEFORE the tasks that satisfy it (LOOP_CONVENTIONS §1). Every
// assertion here states the TARGET, so on the unmodified tree this file is red
// by design and the numbers it prints are the red baseline recorded in §8.
//
// Row 7b is the deliberate inversion: it asserts the provenance count is ZERO.
// It passes today and must keep passing — it fires the moment anyone renders a
// source next to a figure `GravityMetric` cannot support (§3 rule 4).
//
// Command line: npx playwright test commandTerminal --project=desktop-baseline --project=mobile-360

const TICKERS = ['NVDA', 'AAPL', 'MSFT', 'JPM', 'XOM'] as const;

// Measurements go to disk, not stdout. A red row's number is the whole point of
// running it, and stdout is the first thing a truncated log loses.
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'baselines', 'command-terminal');
function record(row: string, data: Record<string, unknown>) {
    const project = test.info().project.name;
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `${row}.${project}.json`), JSON.stringify({ row, project, at: new Date().toISOString(), ...data }, null, 2));
    console.log(`${row} [${project}] ${JSON.stringify(data)}`);
}

// CT-5 · the census reads the annotation the figure carries, not the shape of
// its text. `data-period` / `data-unit` hold exactly the tokens the cell shows,
// so a figure is judged on what it states rather than on a regex guessing at
// whether "215.94" happens to look like it has a unit.
//
//   labelled — both parts stated
//   null     — annotated, but at least one part is the honest marker
//   bare     — NOT ANNOTATED AT ALL. This is row 7's forbidden third state.
//
// The pre-CT-5 tree annotates nothing, so every figure counts bare under this
// rule exactly as it did under the text rule it replaces: 400 of 400.
const NULL_MARK = '—';

type Census = { total: number; labelled: number; nulls: number; bare: number; traceable: number; bareSamples: string[] };

async function census(page: Page): Promise<Census> {
    return page.evaluate((mark) => {
        const out = { total: 0, labelled: 0, nulls: 0, bare: 0, traceable: 0, bareSamples: [] as string[] };

        // Every figure CompanyPage renders: the eight overview StatCards and the
        // metric table rows. Both are counted by the same rule.
        const figures = [
            ...document.querySelectorAll('p.text-xl.font-semibold'),
            ...document.querySelectorAll('table tbody tr td:nth-child(2)'),
        ];

        for (const el of figures) {
            out.total++;
            const period = el.getAttribute('data-period');
            const unit = el.getAttribute('data-unit');
            if (period === null || unit === null || period === '' || unit === '') {
                out.bare++;
                // Name the offender. A bare count with no address is a number you
                // cannot act on.
                const table = el.closest('table');
                const head = table?.previousElementSibling?.textContent
                    ?? table?.parentElement?.previousElementSibling?.textContent ?? '';
                out.bareSamples.push(`${(el.textContent ?? '').trim().slice(0, 24)} @ ${head.trim().slice(0, 60)}`);
                continue;
            }
            if (period === mark || unit === mark || period.includes(`FYE ${mark}`)) out.nulls++;
            else out.labelled++;
        }

        // Row 7b — a figure is traceable only if its own subtree names a source
        // document: an accession number or an EDGAR archive link.
        const src = /\d{10}-\d{2}-\d{6}|sec\.gov\/Archives/i;
        for (const el of figures) {
            const scope = el.closest('div, tr');
            if (scope && src.test(scope.textContent ?? '')) out.traceable++;
        }

        return out;
    }, NULL_MARK);
}

// Returns the TAP count, which is pointer commits only — typing a ticker is
// keystrokes, not taps, on either path.
async function openCompanyByToggle(page: Page, ticker: string): Promise<number> {
    let taps = 0;
    await page.goto('/search');
    await page.getByRole('button', { name: 'Company' }).first().click(); taps++;
    const field = page.getByPlaceholder('e.g. AAPL, NVDA, TSLA');
    await field.click(); taps++;
    await field.fill(ticker);
    await page.getByRole('button', { name: 'View' }).click(); taps++;
    await page.waitForTimeout(6000);
    return taps;
}

// Opens the Metrics tab and reports whether it actually opened. A swallowed
// click made R7c pass at 0 periods — an empty table satisfies "no bare periods".
async function openMetricsTab(page: Page): Promise<boolean> {
    const tab = page.getByRole('tab', { name: /^Metrics/ });
    const ok = await tab.click({ timeout: 8000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(1500);
    return ok;
}

// ─── G1 + G2 + Q3 · rows 3 and 4 ──────────────────────────────────────────────

test('R3 · the palette opens on / and filters as characters are typed', async ({ page }) => {
    await page.goto('/search');
    const input = page.getByPlaceholder(/Ask anything about any company|Ask a follow-up/);
    await input.click();
    await input.fill('/');
    const listbox = page.locator('[role="listbox"]');
    const opened = await listbox.count();
    await input.fill('/comp');
    const filtered = await page.locator('[role="option"]').count();
    record('R3', { listboxAfterSlash: opened, optionsAfterSlashComp: filtered });

    await input.fill('/');
    await expect(listbox).toBeVisible();
    await input.fill('/comp');
    await expect(page.locator('[role="option"]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(listbox).toBeHidden();

    // row 3 also names blur
    await input.fill('/');
    await expect(listbox).toBeVisible();
    await input.blur();
    await expect(listbox).toBeHidden();
});

test('R4 · seven keyboard assertions, each separate', async ({ page }) => {
    await page.goto('/search');
    const input = page.getByPlaceholder(/Ask anything about any company|Ask a follow-up/);
    await input.click();
    const options = page.locator('[role="option"]');
    const listbox = page.locator('[role="listbox"]');

    // Refilling the SAME value does not re-fire React's onChange (its value
    // tracker suppresses it), so a check that re-types '/' after the previous
    // one left '/' in the field would inherit that check's palette state.
    // Clear first — this is a reset, not a weaker assertion.
    const retype = async (v: string) => { await input.fill(''); await input.fill(v); };

    // Seven checks, run and reported individually so a red baseline records all
    // seven rather than only the first one to fail.
    const checks: [string, () => Promise<void>][] = [
        ['4.1 ArrowDown moves the active option', async () => {
            await retype('/');
            await page.keyboard.press('ArrowDown');
            await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true', { timeout: 4000 });
        }],
        ['4.2 ArrowUp wraps at the top', async () => {
            await retype('/');
            await page.keyboard.press('ArrowUp');
            await expect(options.last()).toHaveAttribute('aria-selected', 'true', { timeout: 4000 });
        }],
        ['4.3 Enter commits the active option', async () => {
            await retype('/');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Enter');
            await expect(input).toHaveValue(/^\/\S+ $/, { timeout: 4000 });
        }],
        ['4.4 Tab completes the common prefix', async () => {
            await retype('/se');
            await page.keyboard.press('Tab');
            await expect(input).toHaveValue(/^\/sentiment/, { timeout: 4000 });
        }],
        ['4.5 Escape closes and returns focus to the composer', async () => {
            await retype('/');
            await page.keyboard.press('Escape');
            await expect(listbox).toBeHidden({ timeout: 4000 });
            await expect(input).toBeFocused({ timeout: 4000 });
        }],
        ['4.6 listbox and option roles are exposed', async () => {
            await retype('/');
            await expect(listbox).toHaveCount(1, { timeout: 4000 });
            await expect(options.first()).toHaveAttribute('role', 'option', { timeout: 4000 });
        }],
        ['4.7 aria-activedescendant names the active option', async () => {
            await retype('/');
            await page.keyboard.press('ArrowDown');
            const active = await options.nth(1).getAttribute('id').catch(() => null);
            await expect(input).toHaveAttribute('aria-activedescendant', active ?? '__unset__', { timeout: 4000 });
        }],
    ];

    const failed: string[] = [];
    for (const [name, fn] of checks) {
        await fn().catch(() => failed.push(name));
    }
    record('R4', { checks: checks.length, failed: failed.length, failing: failed });
    expect(failed).toEqual([]);
});

// ─── G3 + G4 · rows 5 and 6 ───────────────────────────────────────────────────

test('R5 · a committed command mounts in the feed and opens the named tab', async ({ page }) => {
    await page.goto('/search');
    const input = page.getByPlaceholder(/Ask anything about any company|Ask a follow-up/);
    await input.click();
    await input.fill('What is NVDA revenue?');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
    const priorTurns = await page.locator('text=What is NVDA revenue?').count();

    await input.fill('/filings NVDA');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(8000);

    const filingsTab = page.getByRole('tab', { name: /^Filings/ });
    record('R5', {
        priorTurnsBefore: priorTurns,
        priorTurnsAfter: await page.locator('text=What is NVDA revenue?').count(),
        filingsTabCount: await filingsTab.count(),
        filingsTabAriaSelected: await filingsTab.first().getAttribute('aria-selected').catch(() => null),
    });

    // the prior conversation survives
    await expect(page.locator('text=What is NVDA revenue?')).toHaveCount(priorTurns);
    // the filings tab is already active — read, never clicked
    await expect(filingsTab).toHaveAttribute('aria-selected', 'true');
});

test('R5a · the Company tabs expose readable selection state (CT-3, the filings half of row 5)', async ({ page }) => {
    await page.goto('/companies/NVDA');
    const tabs = page.getByRole('tab');
    await expect(tabs.first()).toBeVisible();
    const names = await tabs.allTextContents();
    const selected = await Promise.all((await tabs.all()).map(t => t.getAttribute('aria-selected')));
    record('R5a', { tabs: names.length, names, ariaSelected: selected, tablists: await page.getByRole('tablist').count() });

    // Row 5 proves the active tab by READING it. That is only possible once the
    // tabs say which one is active — CT-1 measured aria-selected as null.
    await expect(page.getByRole('tablist')).toHaveCount(1);
    expect(selected.filter(v => v === 'true')).toHaveLength(1);
    // Not ^-anchored: the tab renders an icon before its label, so its text
    // content starts with a space.
    await expect(tabs.filter({ hasText: /Overview/ })).toHaveAttribute('aria-selected', 'true');
});

test('R6 · the command path performs no request the toggle path does not', async ({ page }) => {
    const seen: string[] = [];
    page.on('request', r => seen.push(r.url()));

    // Both paths get the SAME settle window. A longer window on one side counts
    // the other side's lazy panels as extra requests and reads as a regression.
    const SETTLE = 12_000;
    await openCompanyByToggle(page, 'NVDA');
    await page.waitForTimeout(SETTLE);
    const toggleSeen = [...seen];
    const toggleCount = toggleSeen.filter(u => /\/api\/|gravity|alphavantage/i.test(u)).length;

    seen.length = 0;
    await page.goto('/search');
    const input = page.getByPlaceholder(/Ask anything about any company|Ask a follow-up/);
    await input.click();
    await input.fill('/company NVDA');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(SETTLE);
    const commandCount = seen.filter(u => /\/api\/|gravity|alphavantage/i.test(u)).length;
    const mounted = await page.getByRole('tab', { name: /^Filings/ }).count();

    // What the command path asks for that the toggle path does not is the whole
    // question, so record the per-endpoint counts, not just the totals.
    const tally = (urls: string[]) => {
        const out: Record<string, number> = {};
        for (const u of urls.filter(x => /\/api\/|gravity|alphavantage/i.test(x))) {
            const key = new URL(u).pathname.replace(/\/[A-Z]{1,5}(\/|$)/, '/<T>$1');
            out[key] = (out[key] ?? 0) + 1;
        }
        return out;
    };
    record('R6', {
        toggleRequests: toggleCount, commandRequests: commandCount, surfaceMounted: mounted,
        toggleByEndpoint: tally(toggleSeen), commandByEndpoint: tally(seen),
    });

    // The count comparison is only meaningful once the command path renders the
    // SAME surface. Without this, "fewer requests" is satisfied by a command that
    // fetches nothing and mounts nothing — which is what the tree does today, and
    // is why this row passed before the assertion was added (§3 rule 9).
    expect(mounted).toBeGreaterThan(0);
    expect(commandCount).toBeLessThanOrEqual(toggleCount);
    expect(commandCount).toBeGreaterThan(0);
});

// ─── Q1 · rows 7, 7b, 7c ──────────────────────────────────────────────────────

test('R7 · every figure carries period and unit, or is a null — zero bare', async ({ page }) => {
    test.setTimeout(240_000);   // five live company loads, ~14s each
    const totals: Census = { total: 0, labelled: 0, nulls: 0, bare: 0, traceable: 0, bareSamples: [] };
    const perTicker: Record<string, Census> = {};
    for (const t of TICKERS) {
        await openCompanyByToggle(page, t);
        await openMetricsTab(page);
        const c = await census(page);
        perTicker[t] = c;
        for (const k of ['total', 'labelled', 'nulls', 'bare', 'traceable'] as const) totals[k] += c[k];
        totals.bareSamples.push(...c.bareSamples);
    }
    record('R7', { tickers: TICKERS, perTicker, totals });
    expect(totals.bare).toBe(0);
});

test('R7b · zero figures are traceable to a source document, and none may claim to be', async ({ page }) => {
    test.setTimeout(420_000);   // five live company loads plus a payload read
    let traceable = 0;
    let total = 0;

    // CT-6 · what the metric payload ACTUALLY carries, read off the wire in the
    // authenticated session. The gap is only actionable if it names real fields.
    let metricKeys: string[] = [];
    let metricSample: unknown = null;
    page.on('response', async r => {
        if (!/\/financials/.test(r.url()) || metricKeys.length) return;
        const body = await r.json().catch(() => null) as { rows?: Record<string, unknown>[] } | null;
        const row = body?.rows?.[0];
        if (row) { metricKeys = Object.keys(row); metricSample = row; }
    });
    for (const t of TICKERS) {
        await openCompanyByToggle(page, t);
        await openMetricsTab(page);
        const c = await census(page);
        traceable += c.traceable;
        total += c.total;
    }
    // GravityMetric is { metric, value, unit?, period?, ticker? } — no accession,
    // no source document id, no report date, no GAAP basis. Any non-zero here is
    // an inferred citation (§3 rule 4), not a fixed row.
    record('R7b', {
        traceable, figures: total, tickers: TICKERS.length,
        // Measured, not assumed: the keys the server actually sends per metric.
        metricPayloadKeys: metricKeys,
        metricPayloadSample: metricSample,
        fieldsStillMissing: ['document_id / accession', 'basis (GAAP | non-GAAP)'],
    });
    // "0 traceable" is trivially true of a page that rendered nothing. Require the
    // figures before believing the zero — the same trap R7c fell into.
    expect(total).toBeGreaterThan(0);
    expect(traceable).toBe(0);
});

test('R7c · a fiscal period never renders without its period-end', async ({ page }) => {
    await openCompanyByToggle(page, 'NVDA');   // FY2026 ended January 2026
    const clicked = await openMetricsTab(page);
    const periods = await page.locator('table tbody tr td:nth-child(3)').allTextContents();
    // A fiscal period must state its period-end or state that it does not know
    // it. What row 7c forbids is the bare, ambiguous "FY2026".
    const bareFiscal = periods.filter(p =>
        /FY\s?\d{4}/i.test(p) && !/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(p) && !/FYE\s*—/.test(p));
    record('R7c', { ticker: 'NVDA', metricsTabClicked: clicked, periods: periods.length, fiscalWithoutPeriodEnd: bareFiscal.length, sample: periods.slice(0, 8) });

    // "No bare fiscal periods" is trivially true when the table never rendered.
    // Require the evidence before judging it.
    expect(periods.length).toBeGreaterThan(0);
    expect(bareFiscal).toHaveLength(0);
});

// ─── Q2 + Q3 · rows 8 and 9 ───────────────────────────────────────────────────

test('R8 · loading is a skeleton with aria-busy, empty is the null marker', async ({ page }) => {
    await page.goto('/search');
    await page.getByRole('button', { name: 'Company' }).first().click();
    await page.getByPlaceholder('e.g. AAPL, NVDA, TSLA').fill('NVDA');
    await page.getByRole('button', { name: 'View' }).click();
    const busy = page.locator('[aria-busy="true"]');
    record('R8', { ariaBusyWhileLoading: await busy.count(), spinnerNodes: await page.locator('.animate-spin').count() });
    await expect(busy.first()).toBeVisible();
    await page.waitForTimeout(8000);
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
});

test('R9 · a failed overview names the surface that failed', async ({ page }) => {
    await page.route('**/api/overview**', r => r.fulfill({ status: 500, body: '{"error":"forced"}' }));
    await page.route('**/query**', r => r.fulfill({ status: 500, body: '{"error":"forced"}' }));
    await openCompanyByToggle(page, 'NVDA');
    const body = (await page.locator('body').textContent()) ?? '';
    record('R9', {
        errorStated: /could not load|failed to load|unavailable/i.test(body),
        nullMarkers: (body.match(/—/g) ?? []).length,
    });
    await expect(page.getByText(/could not load|failed to load|unavailable/i).first()).toBeVisible();
});

// ─── Row 10 · the two blocked commands ────────────────────────────────────────

test('R10 · /capex and /tariff-risk refuse, naming what is missing', async ({ page }) => {
    await page.goto('/search');
    const input = page.getByPlaceholder(/Ask anything about any company|Ask a follow-up/);
    const refused: Record<string, boolean> = {};
    for (const cmd of ['/capex NVDA', '/tariff-risk NVDA']) {
        await input.click();
        await input.fill(cmd);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(4000);
        refused[cmd] = await page.getByText(/no service|12 of 12/i).first().isVisible().catch(() => false);
    }
    record('R10', refused);
    for (const cmd of Object.keys(refused)) expect(refused[cmd], cmd).toBe(true);
});

// ─── Row 11 · parity ──────────────────────────────────────────────────────────

test('R11 · the command path reaches the surface in <= 3 taps and beats the toggle', async ({ page }) => {
    const toggleTaps = await openCompanyByToggle(page, 'NVDA');

    await page.goto('/search');
    const input = page.getByPlaceholder(/Ask anything about any company|Ask a follow-up/);
    let commandTaps = 0;
    await input.click(); commandTaps++;                // 1 · focus the composer
    await input.fill('/company NVDA');                 //     keystrokes, not taps
    await page.keyboard.press('Enter'); commandTaps++; // 2 · commit
    await page.waitForTimeout(8000);

    record('R11', {
        toggleTaps, commandTaps,
        surfaceReached: await page.getByRole('heading', { name: /NVIDIA|NVDA/i }).first().isVisible().catch(() => false),
    });
    expect(commandTaps).toBeLessThanOrEqual(3);
    expect(commandTaps).toBeLessThan(toggleTaps);
    await expect(page.getByRole('heading', { name: /NVIDIA|NVDA/i }).first()).toBeVisible();
});
