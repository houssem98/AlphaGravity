// MB-3 · the phone's navigation.
//
// The desktop rail is nine 32px glyphs whose only labels are `title=` tooltips
// — an affordance a thumb cannot trigger. Below `md` that rail is hidden and
// this replaces it: the first four destinations as labelled tabs in the bottom
// third of the screen, the rest behind More in a bottom sheet.
//
// NAV_ITEMS is imported, never copied. A forked list is how the rail and the
// mobile nav drift apart, and lib/navItems.ts exists precisely to stop that.

import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { MoreHorizontal, LogOut } from 'lucide-react';
import { NAV_ITEMS } from '../lib/navItems';
import { preloadRoute } from '../lib/preloadRoute';
import { signOut } from '../services/supabase';
import {
    Drawer,
    DrawerContent,
    DrawerHeader,
    DrawerTitle,
    DrawerTrigger,
} from './ui/drawer';

// Four tabs plus More. Five 44px targets fit a 320px screen at 64px each; six
// would not.
const PRIMARY = NAV_ITEMS.slice(0, 4);
const SECONDARY = NAV_ITEMS.slice(4);

// Every target clears 44x44 (iOS HIG) with room over the 48dp Android floor.
const TAB = 'flex-1 min-h-[44px] flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 transition-colors';
const IDLE = 'text-[color:var(--text-3)]';
const ACTIVE = 'text-[color:var(--accent)] bg-[color:color-mix(in_oklch,var(--accent)_12%,transparent)]';

export function isActivePath(pathname: string, to: string): boolean {
    if (to === '/companies') return pathname.startsWith('/companies');
    if (to === '/admin/billing') return pathname.startsWith('/admin');
    return pathname === to;
}

export default function MobileNav() {
    const location = useLocation();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);

    const handleSignOut = async () => {
        setOpen(false);
        await signOut();
        navigate('/auth');
    };

    const moreIsActive = SECONDARY.some((i) => isActivePath(location.pathname, i.to));

    return (
        <nav
            aria-label="Primary"
            data-testid="mobile-nav"
            // Deliberately NOT `fixed bottom-0`. Fixed elements anchor to the
            // LAYOUT viewport, which on a mobile browser is the tall one that
            // assumes a collapsed toolbar: measured on prod at iPhone 14, that
            // put the bar's bottom edge at 743px against a 664px visible area —
            // 79px below the fold, unreachable, and unreachable by scrolling
            // too, since fixed does not move. It is fault F4 wearing a
            // different hat.
            //
            // Instead the bar is a normal flex child at the end of AppLayout's
            // h-dvh column, so it lands on the bottom of whatever is actually
            // visible. --safe-b then clears the home indicator.
            className="md:hidden shrink-0 flex bg-[color:var(--surface)] border-t border-[color:var(--line)]"
            style={{ paddingBottom: 'var(--safe-b)' }}
        >
            {PRIMARY.map(({ to, icon: Icon, label }) => {
                const active = isActivePath(location.pathname, to);
                return (
                    <Link
                        key={to}
                        to={to}
                        aria-current={active ? 'page' : undefined}
                        onPointerDown={() => preloadRoute(to)}
                        className={`${TAB} ${active ? ACTIVE : IDLE}`}
                    >
                        <Icon className="w-5 h-5" />
                        {/* The rail's tooltips do not exist on touch, so the
                            label ships as text. Trading's full name is too long
                            for a fifth of a 320px screen. */}
                        <span className="label leading-none text-[color:inherit]">
                            {to === '/trading' ? 'AI' : label}
                        </span>
                    </Link>
                );
            })}

            <Drawer open={open} onOpenChange={setOpen}>
                <DrawerTrigger asChild>
                    <button
                        type="button"
                        aria-label="More destinations"
                        className={`${TAB} ${moreIsActive ? ACTIVE : IDLE}`}
                    >
                        <MoreHorizontal className="w-5 h-5" />
                        <span className="label leading-none text-[color:inherit]">More</span>
                    </button>
                </DrawerTrigger>

                <DrawerContent
                    className="bg-[color:var(--surface)] border-[color:var(--line-strong)]"
                    style={{ paddingBottom: 'var(--safe-b)' }}
                >
                    <DrawerHeader className="pb-2">
                        <DrawerTitle className="label text-[color:var(--text-3)]">
                            More
                        </DrawerTitle>
                    </DrawerHeader>

                    <div className="flex flex-col px-2 pb-2">
                        {SECONDARY.map(({ to, icon: Icon, label }) => {
                            const active = isActivePath(location.pathname, to);
                            return (
                                <Link
                                    key={to}
                                    to={to}
                                    onClick={() => setOpen(false)}
                                    onPointerDown={() => preloadRoute(to)}
                                    aria-current={active ? 'page' : undefined}
                                    className={`min-h-[44px] flex items-center gap-3 px-3 rounded-sm text-body ${
                                        active ? ACTIVE : 'text-[color:var(--text-2)]'
                                    }`}
                                >
                                    <Icon className="w-4 h-4 shrink-0" />
                                    <span>{label}</span>
                                </Link>
                            );
                        })}

                        <button
                            type="button"
                            onClick={handleSignOut}
                            className="min-h-[44px] flex items-center gap-3 px-3 rounded-sm text-body text-[color:var(--text-3)]"
                        >
                            <LogOut className="w-4 h-4 shrink-0" />
                            <span>Sign Out</span>
                        </button>
                    </div>
                </DrawerContent>
            </Drawer>
        </nav>
    );
}
