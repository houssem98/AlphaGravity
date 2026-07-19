import { defineConfig, devices } from '@playwright/test';

// E2E runs against a real deployment by default (prod alias), so a run needs no
// local server. Point it elsewhere with E2E_BASE_URL, e.g. http://localhost:5173.
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
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
