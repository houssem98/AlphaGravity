// The quota meter (docs/PLANS_WORLD_CLASS_ROADMAP.md R14, PL-11).
//
// It renders numbers straight from `GET /v1/plan/usage`, which PL-9 built to read
// the same Redis keys the enforcer increments. That chain is the whole point: any
// arithmetic done here — deriving `remaining` from a local count, caching a total,
// optimistically decrementing on click — reintroduces the drift the endpoint exists
// to prevent, and a meter that disagrees with the gate is worse than no meter.
//
// So this component does no arithmetic. `used`, `limit` and `remaining` are printed
// as the server sent them.
import type { PlanUsageEntry } from '../../services/billing';

/** Quota rows only: flags and categorical rows have nothing to meter. */
export const meterable = (e: PlanUsageEntry): boolean =>
    e.kind === 'quota' && !e.unlimited && typeof e.limit === 'number';

export function QuotaRow({ entry }: { entry: PlanUsageEntry }) {
    const limit = entry.limit as number;
    const used = entry.used ?? 0;
    const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
    const exhausted = (entry.remaining ?? 0) <= 0;

    return (
        <div
            className="py-2"
            data-testid={`meter-${entry.capability}`}
            data-used={used}
            data-limit={limit}
            data-remaining={entry.remaining ?? 0}
        >
            <div className="flex justify-between text-xs mb-1">
                <span className="text-zinc-300">{entry.label}</span>
                <span
                    className={exhausted ? 'text-amber-400' : 'text-zinc-400'}
                    data-testid={`meter-text-${entry.capability}`}
                >
                    {used} / {limit}
                </span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                <div
                    className={`h-full ${exhausted ? 'bg-amber-500' : 'bg-zinc-500'}`}
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    );
}

export default function QuotaMeter({
    entries, tierName,
}: { entries: PlanUsageEntry[]; tierName: string }) {
    const rows = entries.filter(meterable);
    if (rows.length === 0) return null;

    return (
        <section className="mt-8" data-testid="quota-meter">
            <h2 className="text-lg font-semibold mb-1">Your usage</h2>
            <p className="text-sm text-zinc-400 mb-3">
                Counted by the server on the {tierName} plan — the same counters that
                decide whether a request is allowed.
            </p>
            <div className="rounded-lg border border-zinc-800 px-4 py-2">
                {rows.map(e => <QuotaRow key={e.capability} entry={e} />)}
            </div>
        </section>
    );
}
