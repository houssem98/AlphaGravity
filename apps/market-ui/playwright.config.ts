import { defineConfig, devices } from '@playwright/test';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// E2E runs against a real deployment by default (prod alias), so a run needs no
// local server. Point it elsewhere with E2E_BASE_URL, e.g. http://localhost:5173.
const STATE = join(dirname(fileURLToPath(import.meta.url)), 'e2e', '.auth', 'user.json');

// MB-2 · the mobile measurement gate (docs/MOBILE_APP_ROADMAP.md §5).
// The pre-existing `chromium` project is deliberately untouched and simply
// ignores the new specs, so row 21 (existing e2e stay green) cannot regress
// from a config change alone. Everything mobile is additive.
const SWEEP = /mobileSweep\.spec\.ts/;
const BASELINE = /desktopBaseline\.spec\.ts/;
const SETUP = /auth\.setup\.ts/;
// MF-1 · row R1. The field gates run on the six mobile classes of
// docs/MOBILE_FIELD_ROADMAP.md §5 and skip themselves per row from the project
// name, so adding them to the four V1 projects costs those projects nothing
// they do not opt into.
const FIELD = /mobileField\.spec\.ts/;
// CT-1 · the command-terminal instrument (docs/COMMAND_TERMINAL_ROADMAP.md §6).
// Row 3 names desktop-baseline and mobile-360, so it runs on exactly those two.
const COMMAND = /commandTerminal\.spec\.ts/;

export default defineConfig({
    testDir: './e2e',
    timeout: 90_000,
    expect: { timeout: 20_000 },
    fullyParallel: true,
    retries: 0,
    reporter: [['list']],
    use: {
        baseURL: process.env.E2E_BASE_URL || 'https://market-ui-self.vercel.app',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        { name: 'setup', testMatch: SETUP },

        // Unchanged from ledger open, minus the new specs it must not pick up.
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
            testIgnore: [SWEEP, BASELINE, SETUP, FIELD, COMMAND],
        },

        // Row 18 — the desktop no-op guard.
        {
            name: 'desktop-baseline',
            testMatch: [BASELINE, COMMAND],
            dependencies: ['setup'],
            // One retry. These captures race a live deployment: under twelve
            // parallel workers a section can still be mid-render at capture
            // time, and its landmarks read as "gone" — /history and /billing
            // each did this once, then passed alone. A genuine layout
            // regression is deterministic and fails both attempts, so the
            // retry costs nothing it should not cost.
            retries: 1,
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 1440, height: 900 },
                storageState: STATE,
            },
        },

        // Rows 9 + 10 — the device matrix from §5.
        //
        // All four carry retries: 1, same reasoning as desktop-baseline: the
        // interaction tests navigate three or four steps against a live
        // deployment under four parallel projects, and a step caught mid-render
        // reads as a failure — row 14 flaked exactly this way and passed alone.
        // Geometry regressions are deterministic and fail both attempts.
        // `chromium` deliberately keeps retries: 0 so the pre-existing suite
        // cannot be masked.
        {
            name: 'mobile-320',
            testMatch: [SWEEP, FIELD],
            dependencies: ['setup'],
            retries: 1,
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 320, height: 568 },
                isMobile: true,
                hasTouch: true,
                deviceScaleFactor: 2,
                storageState: STATE,
            },
        },
        {
            name: 'mobile-390',
            testMatch: [SWEEP, FIELD],
            dependencies: ['setup'],
            retries: 1,
            use: { ...devices['iPhone 14'], browserName: 'chromium', storageState: STATE },
        },
        {
            name: 'mobile-430',
            testMatch: [SWEEP, FIELD],
            dependencies: ['setup'],
            retries: 1,
            use: { ...devices['iPhone 14 Pro Max'], browserName: 'chromium', storageState: STATE },
        },
        // MF-1 · rows R1 and R6 — the three classes §5 added.
        //
        // `mobile-360` is the real device in portrait: the screenshots render
        // MobileNav, which is `md:hidden`, so the CSS width is below 768, and
        // 720 device px at the DPR 2 the frames imply is 360.
        //
        // The two landscape projects are 788x360 and 740x360 — the same short
        // viewport either side of `md`. MF-8's fix for G12 is only about height
        // if BOTH pass; a moved width threshold passes one and fails the other.
        {
            name: 'mobile-360',
            testMatch: [FIELD, COMMAND],
            dependencies: ['setup'],
            retries: 1,
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 360, height: 780 },
                isMobile: true,
                hasTouch: true,
                deviceScaleFactor: 2,
                storageState: STATE,
            },
        },
        {
            name: 'mobile-landscape',
            testMatch: FIELD,
            dependencies: ['setup'],
            retries: 1,
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 788, height: 360 },
                isMobile: true,
                hasTouch: true,
                deviceScaleFactor: 2,
                storageState: STATE,
            },
        },
        {
            name: 'mobile-landscape-740',
            testMatch: FIELD,
            dependencies: ['setup'],
            retries: 1,
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 740, height: 360 },
                isMobile: true,
                hasTouch: true,
                deviceScaleFactor: 2,
                storageState: STATE,
            },
        },

        {
            name: 'tablet-768',
            testMatch: SWEEP,
            dependencies: ['setup'],
            retries: 1,
            use: { ...devices['iPad (gen 7)'], browserName: 'chromium', storageState: STATE },
        },
    ],
});
