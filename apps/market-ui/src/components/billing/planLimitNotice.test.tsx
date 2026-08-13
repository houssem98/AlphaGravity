// PL-11 — the upgrade moment, and the meter that does no arithmetic.
//
// Two defects these pin. First: DocumentsPage did `new Error(errorData.detail)` and
// a 402 detail is an object, so every plan denial rendered the literal string
// "[object Object]". Second: a meter that computes its own numbers drifts from the
// gate, so `used`/`limit`/`remaining` must be printed exactly as the server sent them.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import PlanLimitNotice, { limitMessage } from './PlanLimitNotice';
import QuotaMeter, { QuotaRow, meterable } from './QuotaMeter';
import { parsePlanLimit, tierDisplayName, type PlanLimit, type PlanUsageEntry } from '../../services/billing';

const DENIAL = {
    detail: {
        error: 'plan_limit_exceeded',
        capability: 'grid_runs_per_day',
        label: 'Research Grid runs / day',
        plan: 'Free',
        plan_id: 'free',
        limit: 2,
        used: 3,
        period: 'day',
        upgrade_to: 'analyst',
    },
};

const render = (l: PlanLimit) =>
    renderToStaticMarkup(<MemoryRouter><PlanLimitNotice limit={l} /></MemoryRouter>);

describe('parsePlanLimit', () => {
    it('parses the 402 body the enforcer sends', () => {
        const l = parsePlanLimit(DENIAL)!;
        expect(l.capability).toBe('grid_runs_per_day');
        expect(l.label).toBe('Research Grid runs / day');
        expect(l.limit).toBe(2);
        expect(l.used).toBe(3);
        expect(l.upgrade_to).toBe('analyst');
    });

    it('accepts the detail object on its own', () => {
        expect(parsePlanLimit(DENIAL.detail)?.capability).toBe('grid_runs_per_day');
    });

    it('returns null for every other kind of error', () => {
        // This is what keeps ordinary failures rendering as ordinary failures.
        expect(parsePlanLimit({ detail: 'Upload failed (500)' })).toBeNull();
        expect(parsePlanLimit({ detail: { error: 'rate_limited' } })).toBeNull();
        expect(parsePlanLimit(null)).toBeNull();
        expect(parsePlanLimit(undefined)).toBeNull();
        expect(parsePlanLimit('boom')).toBeNull();
    });

    it('never yields the string that used to be shown', () => {
        // The literal regression: String({}) === '[object Object]'.
        const l = parsePlanLimit(DENIAL)!;
        expect(JSON.stringify(l)).not.toContain('[object Object]');
        expect(limitMessage(l)).not.toContain('[object Object]');
    });
});

describe('PlanLimitNotice', () => {
    it('names the capability, the usage and the tier that lifts it', () => {
        const html = render(parsePlanLimit(DENIAL)!);
        expect(html).toContain('Research Grid runs / day'.toLowerCase());
        expect(html).toContain('3 of 2');
        expect(html).toContain('Upgrade to Analyst');
        expect(html).toContain('data-upgrade-to="analyst"');
    });

    it('links to billing so the CTA goes somewhere', () => {
        expect(render(parsePlanLimit(DENIAL)!)).toContain('href="/billing"');
    });

    it('says a row is not included when the tier has none of it', () => {
        const l = { ...parsePlanLimit(DENIAL)!, limit: 0, label: 'SSO (SAML)' };
        expect(limitMessage(l)).toBe('SSO (SAML) is not included in the Free plan.');
    });

    it('offers no upgrade when nothing above raises the ceiling', () => {
        // Sending an institutional user to /billing to buy institutional is a
        // dead end; say so instead.
        const l = { ...parsePlanLimit(DENIAL)!, plan: 'Institutional', upgrade_to: null };
        const html = render(l);
        expect(html).toContain('data-testid="plan-limit-no-upgrade"');
        expect(html).not.toContain('data-testid="plan-limit-cta"');
    });

    it('shows the tier display name, not the raw id', () => {
        expect(tierDisplayName('professional')).toBe('Professional');
        expect(tierDisplayName(null)).toBe('');
    });
});

const quota = (over: Partial<PlanUsageEntry> = {}): PlanUsageEntry => ({
    capability: 'grid_runs_per_day', label: 'Research Grid runs / day',
    group: 'research', enforcement: 'server', kind: 'quota',
    limit: 50, used: 12, remaining: 38, unlimited: false, ...over,
});

describe('QuotaMeter', () => {
    it('prints the server numbers verbatim and derives nothing', () => {
        const html = renderToStaticMarkup(<QuotaRow entry={quota()} />);
        expect(html).toContain('data-used="12"');
        expect(html).toContain('data-limit="50"');
        expect(html).toContain('data-remaining="38"');
        expect(html).toContain('12 / 50');
    });

    it('trusts the server even when its numbers disagree with local arithmetic', () => {
        // If the meter recomputed `remaining` as limit - used it would print 38.
        // It must print what the gate said, because the gate is what refuses.
        const html = renderToStaticMarkup(<QuotaRow entry={quota({ remaining: 7 })} />);
        expect(html).toContain('data-remaining="7"');
    });

    it('meters only countable rows', () => {
        expect(meterable(quota())).toBe(true);
        expect(meterable(quota({ unlimited: true, limit: null }))).toBe(false);
        expect(meterable({ ...quota(), kind: 'flag', allowed: true })).toBe(false);
        expect(meterable({ ...quota(), kind: 'categorical', value: '7 days' })).toBe(false);
    });

    it('renders nothing at all when there is nothing to meter', () => {
        const html = renderToStaticMarkup(
            <QuotaMeter entries={[quota({ unlimited: true, limit: null })]} tierName="Institutional" />);
        expect(html).toBe('');
    });

    it('marks an exhausted quota so it reads as spent', () => {
        const html = renderToStaticMarkup(<QuotaRow entry={quota({ used: 50, remaining: 0 })} />);
        expect(html).toContain('data-remaining="0"');
        expect(html).toContain('text-amber-400');
    });
});
