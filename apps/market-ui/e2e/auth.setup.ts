import { test as setup, expect } from '@playwright/test';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// MB-2 · one login, reused by every viewport.
//
// Seven of the ten routes in row 9 sit behind ProtectedRoute (AppRouter.tsx:178).
// Logging in per test would mean 4 viewports x 7 routes = 28 round trips through
// Supabase against production. This runs once and hands the session to the
// sweep projects as storageState.
//
// Creds come from env, matching the convention the existing specs already use
// (tradingToSearch.spec.ts:11) so the repo carries no password.
const EMAIL = process.env.E2E_EMAIL || 'investor.demo+test@example.com';
const PASSWORD = process.env.E2E_PASSWORD || 'DemoPass2026!';

export const STATE = join(dirname(fileURLToPath(import.meta.url)), '.auth', 'user.json');

setup('authenticate', async ({ page }) => {
  await page.goto('/auth');
  await page.getByPlaceholder('you@example.com').fill(EMAIL);
  await page.getByPlaceholder('Enter password').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/search', { timeout: 60_000 });

  // Prove the session is real before persisting it — a storageState captured
  // from a half-finished login fails every downstream route with a redirect
  // that looks like a layout bug.
  await expect(page).toHaveURL(/\/search/);
  await page.context().storageState({ path: STATE });
});
