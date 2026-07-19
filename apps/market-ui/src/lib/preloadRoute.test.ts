import { describe, it, expect, vi } from 'vitest';
import { preloadRoute, preloadRouteWhenIdle } from './preloadRoute';
import { NAV_ITEMS } from './navItems';

// Stub every page the preloader can pull so the test never loads real chunks.
// Each factory runs at most once (ESM module cache), so `loaded` doubles as a
// record that the import was actually attempted — and that it happened once.
const loaded: string[] = [];
vi.mock('../pages/SearchPage', () => { loaded.push('/search'); return { default: () => null }; });
vi.mock('../pages/TradingAssistantPage', () => { loaded.push('/trading'); return { default: () => null }; });
vi.mock('../pages/HistoryPage', () => { loaded.push('/history'); return { default: () => null }; });
vi.mock('../pages/CompanyPage', () => { loaded.push('/companies'); return { default: () => null }; });
vi.mock('../pages/DashboardPage', () => { loaded.push('/dashboard'); return { default: () => null }; });
vi.mock('../pages/DocumentsPage', () => { loaded.push('/documents'); return { default: () => null }; });
vi.mock('../pages/BillingPage', () => { loaded.push('/billing'); return { default: () => null }; });
vi.mock('../pages/AdminBillingPage', () => { loaded.push('/admin/billing'); return { default: () => null }; });
vi.mock('../pages/SettingsPage', () => { loaded.push('/settings'); return { default: () => null }; });

describe('preloadRoute', () => {
    it('ignores an unknown path instead of throwing', () => {
        expect(() => preloadRoute('/nope')).not.toThrow();
        expect(loaded).not.toContain('/nope');
    });

    it('warms every nav destination, exactly once each', async () => {
        // A nav link with no loader entry is the silent-freeze bug this module
        // exists to prevent: react-router commits the URL while React keeps the
        // old page on screen until the chunk lands.
        for (const { to } of NAV_ITEMS) {
            preloadRoute(to);
            preloadRoute(to); // repeat calls (hover + pointerdown + focus) must dedupe
        }

        await vi.waitFor(() => {
            for (const { to } of NAV_ITEMS) expect(loaded).toContain(to);
        });

        expect(loaded).toHaveLength(new Set(loaded).size);
        expect(loaded).toHaveLength(NAV_ITEMS.length);
    });

    it('preloadRouteWhenIdle returns a cancel fn and does not throw', () => {
        const cancel = preloadRouteWhenIdle('/search');
        expect(typeof cancel).toBe('function');
        expect(() => cancel()).not.toThrow();
    });
});
