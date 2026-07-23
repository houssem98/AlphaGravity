import { test, expect, type Page, type Locator } from '@playwright/test';

// Acceptance harness for docs/FEATURE_INDEPENDENCE_ROADMAP.md, parameterised
// over every lifted feature (FI-6). One case per feature, all the same shape:
//
//   start the run → detour to /trading → return via the indicator's own job
//   → the SAME run is still in flight, and there is still exactly one job for it
//
// A feature passes only if its run survived the unmount. Each feature's backend
// is held open so the run stays in-flight across the round trip; that controls
// timing only. What's under test is that the run's state lives in a module-level
// store, so the component can unmount and remount without dropping or
// duplicating it.
//
// Adding a lifted feature = adding a row to CASES.
const EMAIL = process.env.E2E_EMAIL || 'investor.demo+test@example.com';
const PASSWORD = process.env.E2E_PASSWORD || 'DemoPass2026!';
const QA_PROBE = 'QA continuity probe zulu-4471';

async function login(page: Page) {
    await page.goto('/auth');
    await page.getByPlaceholder('you@example.com').fill(EMAIL);
    await page.getByPlaceholder('Enter password').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('**/search', { timeout: 60_000 });
}

interface ContinuityCase {
    feature: string;
    route: string;                              // where the feature lives (and where its job returns to)
    job: string;                                // the label its bg job shows in the indicator
    start?: (page: Page) => Promise<void>;      // omitted when the run starts itself on mount
    inFlight: (page: Page) => Locator;          // proof the run is still going
    afterReturn?: (page: Page) => Promise<void>; // extra per-feature check, run before the panel reopens
}

const CASES: ContinuityCase[] = [
    {
        feature: 'Company AI Brief',
        route: '/companies/AAPL',
        job: 'AAPL Company Brief',
        start: async (page) => {
            const regen = page.getByRole('button', { name: /Regenerate|Stop/ }).first();
            await regen.scrollIntoViewIfNeeded().catch(() => {});
            await expect(regen).toBeVisible({ timeout: 30_000 });
            // It auto-runs on mount; only kick it off if it is idle.
            if (/Regenerate/.test((await regen.textContent()) || '')) await regen.click();
        },
        inFlight: (page) => page.getByRole('button', { name: /Stop/ }),
    },
    {
        feature: 'Quick Answer',
        route: '/search',
        job: QA_PROBE,
        start: async (page) => {
            if (await page.getByRole('button', { name: 'Cancel' }).isVisible()) return; // already asking
            const input = page.getByPlaceholder(/Ask anything about any company/);
            await input.fill(QA_PROBE);
            await input.press('Enter');
        },
        inFlight: (page) => page.getByRole('button', { name: 'Cancel' }),
        // The thread must hold exactly one copy of the question: no duplicate
        // turn, no lost thread. (Checked while the indicator panel is closed, so
        // the job label cannot be miscounted as a thread turn.)
        afterReturn: async (page) => {
            expect(await page.getByText(QA_PROBE).count()).toBe(1);
        },
    },
    {
        feature: "Devil's Advocate",
        route: '/companies/AAPL',
        job: "AAPL Devil's Advocate",
        start: async (page) => {
            if (await page.getByRole('button', { name: 'Challenging…' }).isVisible()) return; // already running
            const challenge = page.getByRole('button', { name: /Challenge the thesis|Re-challenge/ });
            await challenge.scrollIntoViewIfNeeded().catch(() => {});
            await challenge.click({ timeout: 10_000 });
        },
        inFlight: (page) => page.getByRole('button', { name: 'Challenging…' }),
    },
    {
        feature: 'Earnings Call Summary',
        route: '/companies/AAPL',
        job: 'AAPL Earnings Call Summary',
        // No start(): the read fires on mount.
        inFlight: (page) => page.getByText('Reading transcript…'),
    },
];

for (const c of CASES) {
    test(`${c.feature} resumes the same session after a trading detour`, async ({ page }) => {
        test.setTimeout(200_000);
        await page.route('**/v1/search', () => { /* hold open */ });
        await page.route('**/api/llm/chat', () => { /* hold open */ });
        await page.routeWebSocket(/\/v1\/search\/stream/, () => { /* hold open */ });

        await login(page);
        await page.goto(c.route);

        // Start the run, retried as a unit. A click can land after the element is
        // actionable but before React has attached its handler, which makes it a
        // silent no-op; under parallel load that is a real flake. Retrying the
        // start until the in-flight marker appears is safe for every case here:
        // each feature's trigger is disabled or guarded once its run is going, so
        // a retry cannot start a second run.
        await expect(async () => {
            if (c.start) await c.start(page);
            await expect(c.inFlight(page)).toBeVisible({ timeout: 5_000 });
        }).toPass({ timeout: 90_000 });

        await expect(page.getByText(/\d+ running/)).toBeVisible({ timeout: 20_000 });

        // Client-side nav to trading — the store and the indicator must persist.
        // (A full page.goto would wipe the in-memory store, which is expected.)
        await page.locator('a[href="/trading"]').first().click();
        await page.waitForURL('**/trading', { timeout: 20_000 });
        await expect(page.getByText(/\d+ running/)).toBeVisible({ timeout: 10_000 });

        // Back via this feature's own job in the indicator.
        await page.getByText(/\d+ running/).click();
        await expect(page.getByText('Running in background')).toBeVisible({ timeout: 10_000 });
        await page.locator('li button', { hasText: c.job }).first().click();
        await page.waitForURL(`**${c.route}`, { timeout: 15_000 });

        // The SAME run, still in flight.
        await expect(c.inFlight(page)).toBeVisible({ timeout: 15_000 });
        if (c.afterReturn) await c.afterReturn(page);

        // Still exactly one job for this feature → resumed, not duplicated. The
        // total job count is deliberately not asserted: other features on the
        // same page register their own jobs, so the total legitimately varies.
        await page.getByText(/\d+ running/).click();
        await expect(page.getByText('Running in background')).toBeVisible({ timeout: 10_000 });
        expect(await page.locator('li button', { hasText: c.job }).count()).toBe(1);
    });
}
