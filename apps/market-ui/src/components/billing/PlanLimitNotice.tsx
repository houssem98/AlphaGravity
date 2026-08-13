// The upgrade moment (docs/PLANS_WORLD_CLASS_ROADMAP.md gap S4, PL-11).
//
// §1e found zero in-context upgrade prompts anywhere in the product. The reason was
// upstream: nothing ever returned "you are over your plan limit", so there was no
// moment to attach one to. PL-6 created that moment; this renders it.
//
// It shows three things, because a CTA missing any of them makes the user guess:
// WHAT they hit (the capability's own label, matching the §4 row), WHERE they are
// (used of limit), and WHAT FIXES IT (the named tier, not a generic "upgrade").
//
// Before this component a denial rendered as the literal string "[object Object]" —
// DocumentsPage did `new Error(errorData.detail)` and the 402 detail is a dict.
import { Link } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { tierDisplayName, type PlanLimit } from '../../services/billing';

export function limitMessage(l: PlanLimit): string {
    const scope = l.period ? ` this ${l.period}` : '';
    if (l.limit === null || l.limit === 0) {
        return `${l.label} is not included in the ${l.plan} plan.`;
    }
    return `You have used ${l.used} of ${l.limit} ${l.label.toLowerCase()}${scope} on the ${l.plan} plan.`;
}

export default function PlanLimitNotice({ limit }: { limit: PlanLimit }) {
    const upgrade = l_upgrade(limit);
    return (
        <div
            data-testid="plan-limit-notice"
            data-capability={limit.capability}
            role="alert"
            className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
        >
            <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 text-amber-400 shrink-0" />
                <div className="min-w-0">
                    <p className="text-amber-200" data-testid="plan-limit-message">
                        {limitMessage(limit)}
                    </p>
                    {upgrade ? (
                        <Link
                            to="/billing"
                            data-testid="plan-limit-cta"
                            data-upgrade-to={limit.upgrade_to ?? ''}
                            className="inline-block mt-2 px-3 py-1 rounded bg-amber-500 text-amber-950 font-medium hover:bg-amber-400"
                        >
                            Upgrade to {upgrade}
                        </Link>
                    ) : (
                        // Nothing above this tier raises the ceiling. Offering an
                        // upgrade anyway would send the user to a page that cannot
                        // help them.
                        <p className="mt-2 text-amber-300/80" data-testid="plan-limit-no-upgrade">
                            This is the highest plan for {limit.label.toLowerCase()}.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}

function l_upgrade(limit: PlanLimit): string {
    return limit.upgrade_to ? tierDisplayName(limit.upgrade_to) : '';
}
