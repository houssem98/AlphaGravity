// Warm a route's lazy chunk before the click lands.
//
// react-router v7 navigates inside startTransition, so React keeps the CURRENT
// page on screen until the next route's chunk resolves — it does NOT show the
// Suspense fallback. On a cold chunk that reads as "clicking Search does
// nothing": the URL flips to /search while the old page stays frozen. Worst on
// /trading → /search, which is also a top-level → nested route transition.
//
// Preloading on hover/press means the chunk is already in flight (usually
// resolved) by the time the navigation commits.
const LOADERS: Record<string, () => Promise<unknown>> = {
    '/search': () => import('../pages/SearchPage'),
    '/trading': () => import('../pages/TradingAssistantPage'),
    '/history': () => import('../pages/HistoryPage'),
    '/companies': () => import('../pages/CompanyPage'),
    '/dashboard': () => import('../pages/DashboardPage'),
    '/documents': () => import('../pages/DocumentsPage'),
    '/billing': () => import('../pages/BillingPage'),
    '/admin/billing': () => import('../pages/AdminBillingPage'),
    '/settings': () => import('../pages/SettingsPage'),
};

const started = new Set<string>();

export function preloadRoute(path: string): void {
    if (started.has(path)) return;
    const load = LOADERS[path];
    if (!load) return;
    started.add(path);
    // Drop the marker on failure so a later hover can retry (offline blip,
    // stale chunk after a deploy — lazyWithReload handles the reload path).
    void load().catch(() => started.delete(path));
}

// Preload once the browser is idle. Used on mount so touch users — who never
// hover — still get a warm chunk without competing with first-paint fetches.
export function preloadRouteWhenIdle(path: string): () => void {
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
        .requestIdleCallback;
    if (ric) {
        const id = ric(() => preloadRoute(path), { timeout: 3000 });
        return () => (globalThis as unknown as { cancelIdleCallback: (h: number) => void }).cancelIdleCallback(id);
    }
    const t = setTimeout(() => preloadRoute(path), 1200);
    return () => clearTimeout(t);
}
