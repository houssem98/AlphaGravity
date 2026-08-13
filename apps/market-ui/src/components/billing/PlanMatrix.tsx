// The four-column capability matrix (docs/PLANS_WORLD_CLASS_ROADMAP.md §4, PL-10).
//
// What makes this different from the three plan cards it sits beside: every row is
// the same question asked of every tier, so the columns are comparable, and an
// unavailable row is RENDERED STRUCK-THROUGH rather than omitted. Omitting it is
// what the bullet lists did, and it hides the ceiling the buyer is under.
//
// Everything here comes from `/v1/billing/config` — `capabilities`, `matrix` and
// `tier_order` are generated from the server's `capabilities.py`, which is the same
// module the enforcer reads. The table cannot drift from what is enforced because
// there is no second copy of the numbers.
//
// Two honesty rules the design carries visibly:
//
//   1. **Prices that are not configured are not invented.** §4 proposes $39 / $99 /
//      $399 but those are unconfirmed (§10 E-P), and production only has plans for
//      free / pro / team. A tier with no configured plan shows "Not yet priced" and
//      its button is disabled. No placeholder number is ever rendered as if real.
//   2. **A ceiling the browser owns says so.** 14 of 25 rows are enforced client-side
//      (§8, PL-5). Those carry a marker, because presenting them identically to a
//      server-enforced limit would claim an enforcement the product does not have.
import { useMemo } from 'react';

export interface CapabilityMeta {
    key: string;
    label: string;
    group: string;
    enforcement: 'server' | 'client';
}

export type CapValue = number | boolean | string;

export interface PlanMatrixProps {
    capabilities: CapabilityMeta[];
    matrix: Record<string, Record<string, CapValue>>;
    tierOrder: string[];
    /** Plan config keyed by the tier id it maps to. Missing = not priced. */
    priceFor: (tierId: string) => { label: string; priced: boolean };
    currentTier?: string;
    onSelect?: (tierId: string) => void;
}

const TIER_LABEL: Record<string, string> = {
    free: 'Free',
    analyst: 'Analyst',
    professional: 'Professional',
    institutional: 'Institutional',
};

const GROUP_LABEL: Record<string, string> = {
    research: 'Research — the search surface',
    terminal: 'Terminal — the trading surface',
};

/** How one cell reads. `available: false` is what gets struck through. */
export function cellText(v: CapValue): { text: string; available: boolean } {
    if (typeof v === 'boolean') return { text: v ? '✓' : '✗', available: v };
    if (v === 'unlimited') return { text: 'Unlimited', available: true };
    if (typeof v === 'number') {
        return { text: v === 0 ? '✗' : v.toLocaleString('en-US'), available: v > 0 };
    }
    return { text: v, available: true };
}

export default function PlanMatrix({
    capabilities, matrix, tierOrder, priceFor, currentTier, onSelect,
}: PlanMatrixProps) {
    const groups = useMemo(() => {
        const out = new Map<string, CapabilityMeta[]>();
        for (const c of capabilities) {
            if (!out.has(c.group)) out.set(c.group, []);
            out.get(c.group)!.push(c);
        }
        return [...out.entries()];
    }, [capabilities]);

    const clientRows = capabilities.filter(c => c.enforcement === 'client').length;

    return (
        <section className="mt-10" data-testid="plan-matrix">
            <h2 className="text-lg font-semibold mb-1">Compare every feature</h2>
            <p className="text-sm text-zinc-400 mb-4">
                Every row below is defined for all {tierOrder.length} tiers — a feature your
                plan does not include is shown struck through rather than hidden.
            </p>

            <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm border-collapse">
                    <thead>
                        <tr className="border-b border-zinc-700">
                            <th className="text-left py-3 pr-4 font-medium text-zinc-400 w-1/3">
                                Feature
                            </th>
                            {tierOrder.map(t => {
                                const price = priceFor(t);
                                return (
                                    <th key={t} className="text-left py-3 px-3 align-top">
                                        <div className="font-semibold text-zinc-100">
                                            {TIER_LABEL[t] ?? t}
                                        </div>
                                        <div
                                            className={`text-xs mt-0.5 ${price.priced ? 'text-zinc-300' : 'text-zinc-500 italic'}`}
                                            data-testid={`price-${t}`}
                                        >
                                            {price.label}
                                        </div>
                                        <button
                                            type="button"
                                            disabled={!price.priced || t === currentTier}
                                            onClick={() => onSelect?.(t)}
                                            data-testid={`start-${t}`}
                                            className="mt-2 w-full px-2 py-1 rounded text-xs font-medium border border-zinc-600 text-zinc-200 hover:border-zinc-400 disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            {t === currentTier ? 'Current plan' : 'Start now'}
                                        </button>
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>

                    {groups.map(([group, rows]) => (
                        <tbody key={group}>
                            <tr>
                                <td
                                    colSpan={tierOrder.length + 1}
                                    className="pt-6 pb-2 text-xs uppercase tracking-wide text-zinc-500"
                                >
                                    {GROUP_LABEL[group] ?? group}
                                </td>
                            </tr>
                            {rows.map(cap => (
                                <tr key={cap.key} className="border-t border-zinc-800">
                                    <td className="py-2 pr-4 text-zinc-300">
                                        {cap.label}
                                        {cap.enforcement === 'client' && (
                                            <span
                                                title="Enforced in the browser, not on the server"
                                                data-testid={`client-${cap.key}`}
                                                className="ml-1.5 text-[10px] align-middle text-zinc-500 border border-zinc-700 rounded px-1"
                                            >
                                                client
                                            </span>
                                        )}
                                    </td>
                                    {tierOrder.map(t => {
                                        const { text, available } = cellText(matrix[t]?.[cap.key]);
                                        return (
                                            <td
                                                key={t}
                                                data-testid={`cell-${cap.key}-${t}`}
                                                data-available={available ? 'yes' : 'no'}
                                                className={`py-2 px-3 ${available
                                                    ? 'text-zinc-200'
                                                    : 'text-zinc-600 line-through'}`}
                                            >
                                                {text}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    ))}
                </table>
            </div>

            <p className="mt-4 text-xs text-zinc-500" data-testid="matrix-footnote">
                {clientRows} of {capabilities.length} limits are currently enforced in the
                browser rather than on the server, and are marked <em>client</em> above.
            </p>
        </section>
    );
}
