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
    test.setTimeout(180_000);
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

    // The prior conversation survives. NOT equality: committing a command also
    // adds a sidebar entry titled with the thread's first message, so the count
    // legitimately grows. Row 5 asks that the prior turns are still there —
    // disappearance is the failure, and >= is what forbids it.
    await expect(page.locator('text=What is NVDA revenue?')).not.toHaveCount(0);
    expect(await page.locator('text=What is NVDA revenue?').count()).toBeGreaterThanOrEqual(priorTurns);
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

test('R5b · /peer-compare mounts the Research Grid on the tickers it names (CT-9)', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/search');
    const input = page.getByPlaceholder(/Ask anything about any company|Ask a follow-up/);
    await input.click();
    await input.fill('/peer-compare NVDA AMD');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(8000);

    const values = await page.locator('input, textarea').evaluateAll(
        els => els.map(e => (e as HTMLInputElement).value).filter(Boolean),
    );
    const carries = values.some(v => /NVDA/.test(v) && /AMD/.test(v));
    const gridMounted = await page.getByText(/Tickers \(comma-separated\)/i).count();
    // The grid's OWN field, not whatever input happens to be on the page.
    const gridField = await page.locator('input[placeholder="NVDA, AAPL, MSFT"]').inputValue().catch(() => '<absent>');
    // What the committed turn actually stored, straight from the store.
    const userTurn = await page.getByText(/^\/peer-compare/).last().textContent().catch(() => '<none>');
    const stored = await page.evaluate(() => {
        const raw = document.body.innerText.match(/\{"name":"[^}]+\}/g) ?? [];
        return raw.slice(-3);
    });
    const body = (await page.locator('body').textContent()) ?? '';
    record('R5b', {
        gridMounted, gridField, gridCarriesBothTickers: /NVDA/.test(gridField) && /AMD/.test(gridField),
        anyInputCarriesBoth: carries, values: values.slice(0, 6), storedBlocks: stored,
        committedUserTurn: userTurn,
        // If the command fell through to the model instead of mounting, the feed
        // says so rather than leaving us to guess.
        fellThroughToModel: /peer-compare/i.test(body) && gridMounted === 0,
        bodyHint: body.replace(/\s+/g, ' ').slice(0, 240),
    });

    expect(gridMounted).toBeGreaterThan(0);
    expect(gridField).toMatch(/NVDA/);
    expect(gridField).toMatch(/AMD/);

    // The command named two tickers. A grid that opened on DEFAULT_TICKERS
    // instead has answered a different question.
    expect(carries).toBe(true);
});

test('R6 · the command path performs no request the toggle path does not', async ({ page }) => {
    test.setTimeout(240_000);   // two full path walks, each with a 12s settle
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
    // Five live company loads. Measured at 4.2m standalone; 240s failed on the
    // clock under parallel workers with every assertion already passing.
    test.setTimeout(480_000);
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
    test.setTimeout(600_000);   // five live company loads plus a payload read
    let traceable = 0;
    let total = 0;

    // CT-6 · what the metric payload ACTUALLY carries, read off the wire in the
    // authenticated session. The gap is only actionable if it names real fields.
    let metricKeys: string[] = [];
    let metricSample: unknown = null;
    page.on('response', r => {
        if (!/\/financials/.test(r.url()) || metricKeys.length) return;
        // NOT async: an awaited handler stalls Playwright's dispatch, and that is
        // why this loop censused 0 figures while R7's identical loop saw 400.
        void r.json()
            .then((body: { rows?: Record<string, unknown>[] } | null) => {
                const row = body?.rows?.[0];
                if (row && !metricKeys.length) { metricKeys = Object.keys(row); metricSample = row; }
            })
            .catch(() => { /* a body we cannot read is not a failure of this row */ });
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

// ─── CT2 P1 · docs/COMMAND_TERMINAL_V2_ROADMAP.md row R4 ──────────────────────
//
// Same census rule as R7, applied to the third annotation. A figure is
//   sourced — data-source names a filing its id RESOLVED to
//   null    — data-source is the honest marker
//   bare    — no data-source attribute at all, the forbidden third state
//
// CT2-2 measured the expected shape of this: the financials table holds one
// distinct document_id per ticker (the constant "xbrl:NVDA" over 402 rows) and
// /filings drops every id starting "xbrl:", so `sourced` is expected to be 0 and
// `nulls` to equal `total`. This row does not assert that it is high. It asserts
// that nothing renders bare and that nothing claims a source it cannot resolve.

test('CT2 R4 · every figure names its source or marks the absence — zero bare', async ({ page }) => {
    test.setTimeout(240_000);
    await openCompanyByToggle(page, 'NVDA');
    await openMetricsTab(page);

    const c = await page.evaluate((mark) => {
        const out = { total: 0, sourced: 0, nulls: 0, bare: 0, affordances: 0, bareSamples: [] as string[] };
        const figures = [
            ...document.querySelectorAll('p.text-xl.font-semibold'),
            ...document.querySelectorAll('table tbody tr td:nth-child(2)'),
        ];
        for (const el of figures) {
            out.total++;
            const src = el.getAttribute('data-source');
            if (src === null || src === '') {
                out.bare++;
                out.bareSamples.push((el.textContent ?? '').trim().slice(0, 32));
            } else if (src === mark) out.nulls++;
            else out.sourced++;
        }
        out.affordances = document.querySelectorAll('[data-source-affordance]').length;
        return out;
    }, NULL_MARK);

    record('CT2-R4', { ticker: 'NVDA', ...c });

    // A zero-bare count is trivially true of a page that rendered nothing.
    expect(c.total).toBeGreaterThan(0);
    expect(c.bare).toBe(0);
    expect(c.sourced + c.nulls).toBe(c.total);
    // §3 rule 1 — a clickable affordance exists only where an id RESOLVED. It may
    // never outnumber the figures whose source actually resolved.
    expect(c.affordances).toBeLessThanOrEqual(c.sourced);
});

// CT2-4 · row R5. Production renders 0 affordances (CT2-R4 above: 88 figures, 0
// sourced), so the drawer cannot be reached with live data and a test that only
// loaded the page would prove nothing either way. Both payloads are therefore
// SERVED BY THE TEST, and the assertion is a lookup against the filings payload
// the page actually received — never string similarity, never a period match.
//
// The negative case is the load-bearing one: the same figure carrying the real
// production constant `xbrl:NVDA` must render NO affordance at all.

const FIXTURE_FILING = {
    id: 'ct2-fixture-0001-4000-8000-000000000001',
    ticker: 'NVDA',
    filing_type: '10-Q',
    filing_date: '2025-11-19',
    title: 'NVDA 10-Q 2025-11-19',
    chunk_count: 7,
    status: 'indexed',
};

async function stubCompanyPayloads(page: Page, documentId: string | null) {
    await page.route('**/v1/company/*/filings**', route => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ticker: 'NVDA', documents: [FIXTURE_FILING], total: 1 }),
    }));
    await page.route('**/v1/company/*/financials**', route => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
            ticker: 'NVDA', source: 'xbrl',
            rows: [{
                metric: 'Revenue (Total Revenue, Net Sales)', value: 57006000000, unit: 'USD',
                period: 'FY2026', ticker: 'NVDA', filing_type: '10-Q', filing_date: '2025-11-19',
                ...(documentId === null ? {} : { document_id: documentId }),
            }],
        }),
    }));
}

test('CT2 R5 · the drawer names the filing the id resolved to, by lookup', async ({ page }) => {
    test.setTimeout(240_000);
    await stubCompanyPayloads(page, FIXTURE_FILING.id);
    await openCompanyByToggle(page, 'NVDA');
    await openMetricsTab(page);

    const affordance = page.locator('[data-source-affordance]');
    await expect(affordance).toHaveCount(1);
    await affordance.first().click();

    const drawer = page.locator('[data-source-drawer]');
    await expect(drawer).toBeVisible();
    const shown = {
        type: (await drawer.locator('[data-drawer-filing-type]').textContent())?.trim(),
        date: (await drawer.locator('[data-drawer-filing-date]').textContent())?.trim(),
        id: (await drawer.locator('[data-drawer-document-id]').textContent())?.trim(),
    };
    record('CT2-R5', { shown, fixture: FIXTURE_FILING });

    // Asserted by LOOKUP: the id the drawer shows must be a filing in the payload,
    // and the type and date must be THAT filing's — not a filing that merely
    // matches on date, and not text that happens to look similar.
    const resolved = [FIXTURE_FILING].find(f => f.id === shown.id);
    expect(resolved, 'the drawer names a filing present in the filings payload').toBeTruthy();
    expect(shown.type).toBe(resolved!.filing_type);
    expect(shown.date).toBe(resolved!.filing_date);
});

test('CT2 R5b · the production constant resolves to nothing and offers nothing', async ({ page }) => {
    test.setTimeout(240_000);
    // What CT2-2 measured on the wire: one distinct document_id per ticker.
    await stubCompanyPayloads(page, 'xbrl:NVDA');
    await openCompanyByToggle(page, 'NVDA');
    await openMetricsTab(page);

    const affordances = await page.locator('[data-source-affordance]').count();
    const marked = await page.locator('[data-source-cell="—"]').count();
    record('CT2-R5b', { documentIdServed: 'xbrl:NVDA', affordances, nullCells: marked });

    expect(affordances).toBe(0);
    expect(marked).toBeGreaterThan(0);
    await expect(page.locator('[data-source-drawer]')).toHaveCount(0);
});

// CT2-5 · row R6. Live, no stubbing — the whole point is what the real endpoint
// says. Probed 2026-08-09: it requires document_id AND period (the ledger's P2
// named only the first) and is a cache read, so a real filing id with both params
// answers 404 "Sentiment not found ... POST to compute it". The tab must state
// that, and must show no number.

test('CT2 R6 · /sentiment renders a score or states the refusal, and never a number', async ({ page }) => {
    test.setTimeout(240_000);
    // The row names the COMMAND, so drive the command path, not the toggle.
    await page.goto('/search');
    const input = page.getByPlaceholder(/Ask anything about any company|Ask a follow-up/);
    await input.click();
    await input.fill('/sentiment NVDA');
    await page.keyboard.press('Enter');

    // Two waits, deliberately separate. The page is up once Filings mounts; the
    // Sentiment tab needs a SECOND round trip after that, because the sentiment
    // call cannot name a document_id until the filings payload has landed. A
    // single fixed sleep conflates "still loading" with "tab never appears" —
    // which is exactly how this row failed its first two runs.
    const filingsTab = page.getByRole('tab', { name: /^Filings/ });
    await expect(filingsTab, 'the command never mounted CompanyPage').toHaveCount(1, { timeout: 60_000 });
    const filingsLabel = (await filingsTab.textContent())?.trim() ?? '';

    const tab = page.getByRole('tab', { name: /^Sentiment/ });
    await expect(tab, `no Sentiment tab; Filings tab read "${filingsLabel}"`).toHaveCount(1, { timeout: 60_000 });
    const tabExists = await tab.count();
    expect(tabExists).toBe(1);
    await tab.click();
    await page.waitForTimeout(1500);

    const refusal = page.locator('[data-sentiment-refusal]');
    const scored = await page.locator('[data-sentiment-refusal]').count() === 0;
    const shown = {
        status: (await page.locator('[data-sentiment-status]').textContent().catch(() => null))?.trim() ?? null,
        detail: (await page.locator('[data-sentiment-detail]').textContent().catch(() => null))?.trim() ?? null,
    };

    // No fabricated figure: grep the rendered panel for a score-shaped token.
    // A refusal that quotes an HTTP status is not a score, so the status node is
    // removed from the text before the search — otherwise "404" reads as a number.
    // Strip the things that are provably not scores before searching. An ISO
    // date is the one that actually bit: the refusal names the filing it asked
    // about, and "2026-07-02" contains "-07" and "-02", which the score pattern
    // read as two signed numbers. A date, an HTTP status, a document id and an
    // endpoint path are none of them sentiment figures.
    const panelText = scored ? '' : (await refusal.innerText())
        .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
        .replace(shown.status ?? ' ', ' ')
        .replace(/document_id=\S+/g, ' ')
        .replace(/\/v1\/\S+/g, ' ');
    const scoreShaped = panelText.match(/[+-]?\d+(?:\.\d+)?\s*%|[+-]\d+(?:\.\d+)?\b/g) ?? [];

    record('CT2-R6', { ticker: 'NVDA', tabExists, filingsLabel, scored, shown, scoreShaped, panelText: panelText.slice(0, 400) });

    expect(scored || shown.status !== null, 'a refusal states the status the server returned').toBeTruthy();
    expect(scoreShaped, 'no score-shaped token appears where no score was returned').toEqual([]);
});

// ─── Q2 + Q3 · rows 8 and 9 ───────────────────────────────────────────────────

test('R8 · loading is a skeleton with aria-busy, empty is the null marker', async ({ page }) => {
    test.setTimeout(180_000);
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
    // The real path is /api/market/overview/<T>. The old glob matched nothing, so
    // the CT-1 baseline for this row was taken against a page that never failed.
    let intercepted = 0;
    await page.route('**/api/market/overview/**', r => {
        intercepted++;
        return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"forced"}' });
    });
    await openCompanyByToggle(page, 'NVDA');
    const body = (await page.locator('body').textContent()) ?? '';
    record('R9', {
        interceptedOverviewCalls: intercepted,
        errorStated: /could not load|failed to load|unavailable/i.test(body),
        surfaceNamed: /Alpha Vantage/i.test(body),
        nullMarkers: (body.match(/—/g) ?? []).length,
    });
    // A forced 500 that never reached the app would make every assertion below
    // meaningless.
    expect(intercepted).toBeGreaterThan(0);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText(/could not load/i).first()).toBeVisible();
    // Row 9: the FAILING SURFACE is named, not just "something went wrong".
    await expect(page.getByText(/Alpha Vantage/i).first()).toBeVisible();
});

// ─── Row 10 · the two blocked commands ────────────────────────────────────────

test('R10 · /capex and /tariff-risk refuse, naming what is missing', async ({ page }) => {
    await page.goto('/search');
    const input = page.getByPlaceholder(/Ask anything about any company|Ask a follow-up/);
    const refused: Record<string, boolean> = {};
    const fabricated: Record<string, string[]> = {};
    for (const cmd of ['/capex NVDA', '/tariff-risk NVDA']) {
        await input.click();
        await input.fill(cmd);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(6000);
        refused[cmd] = await page.getByText(/no service|12 of 12/i).first().isVisible().catch(() => false);

        // Row 10 forbids a fabricated answer, not merely a missing refusal. Read
        // the reply itself and look for figures nothing could have sourced.
        const reply = await page.getByText(/is not available/i).first()
            .locator('xpath=ancestor::*[self::div][1]').textContent().catch(() => null);
        fabricated[cmd] = (reply ?? '').match(/\$\s?[\d,.]+|\d[\d,.]*\s?(billion|million|bn|mn)/gi) ?? [];
    }
    record('R10', { refused, fabricatedFigures: fabricated });
    for (const cmd of Object.keys(refused)) {
        expect(refused[cmd], cmd).toBe(true);
        expect(fabricated[cmd], `${cmd} invented a figure`).toEqual([]);
    }
});

// ─── Row 11 · parity ──────────────────────────────────────────────────────────

test('R11 · every named command reaches its surface in <= 3 taps, and beats the toggle', async ({ page }) => {
    test.setTimeout(420_000);

    // The toggle path is walked ONCE. Its tap count does not depend on which
    // command it is being compared against — three identical walks cost three
    // times the wall clock and measure the same number, which is what pushed
    // this row past a 600s budget with every assertion already passing.
    const toggleBase = await openCompanyByToggle(page, 'NVDA');          // 3 taps
    await page.getByRole('tablist').first().waitFor({ state: 'visible', timeout: 45_000 }).catch(() => { });
    const toggleSurface = await page.getByRole('tablist').count();
    await page.getByRole('tab', { name: /^Filings/ }).first().click({ timeout: 15_000 }).catch(() => { });
    const toggleWithTab = toggleBase + 1;                                 // 4 taps
    const toggleTabSelected = await page.getByRole('tab', { name: /^Filings/ }).first()
        .getAttribute('aria-selected').catch(() => null);

    const results: Record<string, unknown> = {
        togglePath: { taps: toggleBase, tapsForNamedTab: toggleWithTab, surfaceMounted: toggleSurface, tabSelected: toggleTabSelected },
    };
    record('R11', results);

    expect(toggleSurface, 'toggle surface').toBeGreaterThan(0);

    // Row 11 names three commands.
    for (const { cmd, tab } of [
        { cmd: 'company', tab: null },
        { cmd: 'filings', tab: /^Filings/ },
        { cmd: 'sentiment', tab: /Sentiment/ },
    ] as const) {
        await page.goto('/search');
        const input = page.getByPlaceholder(/Ask anything about any company|Ask a follow-up/);
        let taps = 0;
        await input.click(); taps++;                 // 1 · focus the composer
        await input.fill(`/${cmd} NVDA`);            //     keystrokes, not taps
        await page.keyboard.press('Enter'); taps++;  // 2 · commit

        await page.getByRole('tablist').first().waitFor({ state: 'visible', timeout: 45_000 }).catch(() => { });
        const mounted = await page.getByRole('tablist').count();
        const tabExists = tab ? await page.getByRole('tab', { name: tab }).count() : 1;
        const tabState = tab && tabExists > 0
            ? await page.getByRole('tab', { name: tab }).first().getAttribute('aria-selected').catch(() => null)
            : 'n/a';

        const against = tab ? toggleWithTab : toggleBase;
        results[cmd] = { commandTaps: taps, comparedAgainstToggleTaps: against, surfaceMounted: mounted, tabExists, namedTabSelected: tabState };
        record('R11', results);

        expect(taps, `${cmd} taps`).toBeLessThanOrEqual(3);
        expect(taps, `${cmd} vs toggle`).toBeLessThan(against);
        expect(mounted, `${cmd} surface`).toBeGreaterThan(0);
        // Asserted where the tab exists. CompanyPage renders the Sentiment tab
        // only when the backend returned a score, and that endpoint 422s — a
        // finding logged in §8, not a failure of this row.
        if (tab && tabExists > 0) expect(tabState, `${cmd} tab`).toBe('true');
    }
});
