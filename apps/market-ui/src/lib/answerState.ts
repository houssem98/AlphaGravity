// Copy and counting for the answer's evidence state.
//
// Kept out of the component file so that file exports only a component (the
// react-refresh rule), and so these can be tested without rendering anything.

import type { AnswerState, GravityCitation } from '../hooks/useGravitySearch';

export interface AnswerStateCopy {
    title: string;
    body: string;
    tone: 'warn' | 'bad';
}

/** One entry per state the backend can put on an answer. A state with no entry
 *  here shows no banner — which is correct for `ANSWERED`, and is why the map
 *  is keyed rather than defaulted. */
export const ANSWER_STATE_COPY: Record<string, AnswerStateCopy> = {
    UNSUPPORTED: {
        title: 'No supporting evidence found',
        body: 'Retrieval returned nothing that supports an answer to this question. What follows is not a sourced answer.',
        tone: 'bad',
    },
    SOURCE_UNAVAILABLE: {
        title: 'Primary source could not be consulted',
        body: 'The filing channel was unavailable on this deployment, so SEC filings were not read directly for this question.',
        tone: 'warn',
    },
    CONFLICTING_EVIDENCE: {
        title: 'Sources disagree',
        body: 'The retrieved sources conflict on this question. Check the citations before relying on the figure.',
        tone: 'warn',
    },
    CANCELLED: {
        title: 'Cancelled',
        body: 'This search was stopped before it finished. Anything shown is partial.',
        tone: 'warn',
    },
    SYSTEM_ERROR: {
        title: 'The search did not complete',
        body: 'An error ended this search. Anything shown is partial.',
        tone: 'bad',
    },
};

export function copyForState(state: AnswerState | null): AnswerStateCopy | undefined {
    return state ? ANSWER_STATE_COPY[state] : undefined;
}

/** Citations whose verdict says they do not support what they were cited for. */
export function flaggedCount(citations: GravityCitation[]): number {
    return citations.filter(
        c => c.verification_status === 'unsupported' || c.verification_status === 'conflicting',
    ).length;
}

/**
 * Whether a citation may show the green verified badge.
 *
 * Strictly the verdict, never the legacy boolean. A turn persisted before
 * citation verdicts existed carries `is_verified: true` with no
 * `verification_status`, because that flag was whatever the model had reported
 * as `entailed` — the exact claim this work removed. Replaying such a turn out
 * of history must not reproduce the badge, so an absent verdict shows nothing
 * rather than being trusted.
 */
export function showsVerifiedBadge(c: Pick<GravityCitation, 'is_verified' | 'verification_status'>): boolean {
    return c.verification_status === 'verified';
}
