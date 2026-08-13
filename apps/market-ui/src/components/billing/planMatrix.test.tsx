// PL-10 — the matrix renders every row in every column, and absence is visible.
//
// The bug this guards is the one §1a describes: three bullet lists side by side,
// where a feature you do not get simply is not printed, so the buyer cannot see the
// ceiling they are under. A struck-through cell is the whole point of the redesign.
//
// Rendered with renderToStaticMarkup, matching the convention the other component
// tests in this tree use (see components/trading/trustStrip.test.tsx). Adding a
// testing-library dependency would be an escalation under LOOP_CONVENTIONS §4, and
// the assertions here do not need one.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PlanMatrix, { cellText, type CapabilityMeta } from './PlanMatrix';

const caps: CapabilityMeta[] = [
    { key: 'qa', label: 'QA searches / day', group: 'research', enforcement: 'server' },
    { key: 'sso', label: 'SSO (SAML)', group: 'research', enforcement: 'server' },
    { key: 'watch', label: 'Watchlist symbols', group: 'terminal', enforcement: 'client' },
];

const matrix = {
    free: { qa: 10, sso: false, watch: 10 },
    analyst: { qa: 500, sso: false, watch: 100 },
    professional: { qa: 2000, sso: false, watch: 500 },
    institutional: { qa: 'unlimited', sso: true, watch: 'unlimited' },
};

const tiers = ['free', 'analyst', 'professional', 'institutional'];

function markup(over: Partial<React.ComponentProps<typeof PlanMatrix>> = {}) {
    return renderToStaticMarkup(
        <PlanMatrix
            capabilities={caps}
            matrix={matrix}
            tierOrder={tiers}
            priceFor={() => ({ label: '$49 / mo', priced: true })}
            {...over}
        />,
    );
}

/** The one cell whose testid matches, as raw html. */
function cell(html: string, key: string, tier: string): string {
    const m = html.match(new RegExp(`<td[^>]*data-testid="cell-${key}-${tier}"[^>]*>.*?</td>`));
    if (!m) throw new Error(`no cell for ${key}/${tier}`);
    return m[0];
}

/** True when that button carries the disabled ATTRIBUTE, ignoring Tailwind's
 *  `disabled:` variant classes, which contain the same word. */
function isDisabled(html: string, testid: string): boolean {
    const tag = html.match(new RegExp(`<button[^>]*data-testid="${testid}"[^>]*>`))![0];
    return /\sdisabled(=""|\s|>)/.test(tag);
}

describe('cellText', () => {
    it('reads a flag as a tick or a cross', () => {
        expect(cellText(true)).toEqual({ text: '✓', available: true });
        expect(cellText(false)).toEqual({ text: '✗', available: false });
    });

    it('formats a quota and marks zero as unavailable', () => {
        expect(cellText(2000)).toEqual({ text: '2,000', available: true });
        expect(cellText(0)).toEqual({ text: '✗', available: false });
    });

    it('passes unlimited and categorical values through', () => {
        expect(cellText('unlimited')).toEqual({ text: 'Unlimited', available: true });
        expect(cellText('7 days')).toEqual({ text: '7 days', available: true });
    });
});

describe('PlanMatrix', () => {
    it('renders every row in every column — no omissions', () => {
        const html = markup();
        for (const c of caps) {
            for (const t of tiers) expect(html).toContain(`data-testid="cell-${c.key}-${t}"`);
        }
        // The count is the claim: rows × tiers, nothing skipped.
        expect((html.match(/data-testid="cell-/g) ?? []).length).toBe(caps.length * tiers.length);
    });

    it('renders an unavailable feature struck through rather than omitting it', () => {
        const html = markup();
        const c = cell(html, 'sso', 'free');
        expect(c).toContain('data-available="no"');
        expect(c).toContain('line-through');
        expect(c).toContain('✗');
    });

    it('does not strike through a feature the tier has', () => {
        const c = cell(markup(), 'sso', 'institutional');
        expect(c).toContain('data-available="yes"');
        expect(c).not.toContain('line-through');
    });

    it('treats a zero quota as unavailable, not as the number nought', () => {
        const html = markup({ matrix: { ...matrix, free: { qa: 0, sso: false, watch: 0 } } });
        expect(cell(html, 'qa', 'free')).toContain('data-available="no"');
    });

    it('marks limits the browser enforces so they are not read as a paywall', () => {
        const html = markup();
        expect(html).toContain('data-testid="client-watch"');
        expect(html).not.toContain('data-testid="client-qa"');
        expect(html).toContain('1 of 3 limits');
    });

    it('never renders a price for a tier that has none', () => {
        // §10 E-P: §4's proposed numbers are unconfirmed. An unpriced tier says so
        // and its button is dead, rather than quoting a figure we have not agreed to.
        const html = markup({
            priceFor: (t) => t === 'analyst'
                ? { label: 'Not yet priced', priced: false }
                : { label: '$49 / mo', priced: true },
        });
        expect(html).toContain('Not yet priced');
        // Match the ATTRIBUTE, not the substring: the className carries
        // `disabled:opacity-40`, so a naive toContain('disabled') passes on every
        // button and asserts nothing.
        expect(isDisabled(html, 'start-analyst')).toBe(true);
        expect(isDisabled(html, 'start-professional')).toBe(false);
    });

    it('offers one Start now per column and disables the current plan', () => {
        const html = markup({ currentTier: 'free' });
        for (const t of tiers) expect(html).toContain(`data-testid="start-${t}"`);
        expect(html).toContain('Current plan');
        expect(isDisabled(html, 'start-free')).toBe(true);
        expect(isDisabled(html, 'start-professional')).toBe(false);
    });

    it('groups the rows by surface so search and trading read separately', () => {
        const html = markup();
        expect(html).toContain('Research — the search surface');
        expect(html).toContain('Terminal — the trading surface');
    });
});
