// App Layout - Persistent sidebar and topbar for app pages

import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { Sparkles, Activity, LogOut } from 'lucide-react';
import { signOut } from '../services/supabase';
import { NAV_ITEMS as NAV } from '../lib/navItems';
import { preloadRoute } from '../lib/preloadRoute';
import MobileNav from './MobileNav';

export default function AppLayout() {
    const location = useLocation();
    const navigate = useNavigate();

    const isActive = (path: string) => {
        if (path === '/companies') return location.pathname.startsWith('/companies');
        if (path === '/admin/billing') return location.pathname.startsWith('/admin');
        return location.pathname === path;
    };

    const handleSignOut = async () => {
        await signOut();
        navigate('/auth');
    };

    const itemIdle = "text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface-2)]";
    const itemActive = "text-[color:var(--accent)] bg-[color:color-mix(in_oklch,var(--accent)_12%,transparent)]";

    return (
        <div className="min-h-dvh flex bg-[color:var(--bg)] text-[color:var(--text-2)]">
            {/* Sidebar */}
            <aside className="w-14 bg-[color:var(--surface)] border-r border-[color:var(--line)] hidden md:flex flex-col items-center py-3 fixed h-full z-50">
                <Link
                    to="/search"
                    className="w-8 h-8 rounded-sm flex items-center justify-center mb-4 bg-[color:color-mix(in_oklch,var(--accent)_12%,transparent)]"
                    title="AlphaGravity"
                >
                    <Sparkles className="w-4 h-4 text-[color:var(--accent)]" />
                </Link>

                <nav className="flex flex-col gap-1 flex-1 stagger">
                    {NAV.map(({ to, icon: Icon, label }) => (
                        <Link
                            key={to}
                            to={to}
                            title={label}
                            onPointerEnter={() => preloadRoute(to)}
                            onPointerDown={() => preloadRoute(to)}
                            onFocus={() => preloadRoute(to)}
                            className={`w-8 h-8 rounded-sm flex items-center justify-center transition-colors ${isActive(to) ? itemActive : itemIdle}`}
                        >
                            <Icon className="w-4 h-4" />
                        </Link>
                    ))}
                </nav>

                <button
                    onClick={handleSignOut}
                    title="Sign Out"
                    className="w-8 h-8 rounded-sm flex items-center justify-center text-[color:var(--text-3)] hover:text-[color:var(--down)] hover:bg-[color:var(--surface-2)] transition-colors"
                >
                    <LogOut className="w-4 h-4" />
                </button>
            </aside>

            {/* Main content */}
            {/* min-w-0 lets the column shrink below its content's intrinsic
                width, so a wide page overflows inside its own scroll container
                instead of pushing the whole shell sideways. Without it `flex-1`
                keeps min-width:auto and the rail's 56px rides along on top. */}
            {/* Below md this column is exactly one visible viewport tall and
                scrolls internally, so the nav bar at its end lands on the real
                bottom of the screen instead of the layout viewport's. At md it
                reverts to a plain block and the page scrolls as it always did. */}
            <div className="flex-1 min-w-0 md:ml-14 h-dvh md:h-auto pt-12 md:pt-0 flex flex-col md:block">
                <header className="h-12 bg-[color:var(--surface)] border-b border-[color:var(--line)] flex items-center justify-between px-3 fixed top-0 right-0 left-0 md:left-14 z-40 fade-in">
                    <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-sm flex items-center justify-center bg-[color:var(--accent)] glint chrome">
                            <Sparkles className="w-3.5 h-3.5 text-[color:var(--accent-ink)]" />
                        </div>
                        <span className="font-display font-semibold text-h4 text-[color:var(--text)] tracking-tight">AlphaGravity</span>
                        {/* Brand plus the live dot is all a 390px header can
                            carry; the strapline and the avatar slot return at md. */}
                        <span className="label ml-1 hidden md:inline">MARKET INTELLIGENCE</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5 label">
                            <Activity className="w-3 h-3 text-[color:var(--accent)]" />
                            <span className="text-[color:var(--up)] pulse-dot">●</span>
                            <span>LIVE</span>
                        </div>
                        <div className="w-6 h-6 rounded-sm bg-[color:var(--surface-2)] border border-[color:var(--line)] hidden md:block" />
                    </div>
                </header>

                {/* The scroll container below md — the nav is its sibling, not
                    an overlay, so no bottom padding is owed to it. */}
                {/* The header is fixed, so its 48px offset must live on the COLUMN, not
                    on the scrolling child. While `main` carried `pt-12` the padding
                    scrolled away with the content: measured on prod, main sat at
                    scrollTop 30 on load and the mode tabs rendered at y=31 behind a
                    48px header. Desktop keeps the original arrangement exactly. */}
                <main className="flex-1 overflow-y-auto md:overflow-visible md:pt-12 md:min-h-dvh bg-[color:var(--bg)]">
                    <Outlet />
                </main>

                <MobileNav />
            </div>
        </div>
    );
}
