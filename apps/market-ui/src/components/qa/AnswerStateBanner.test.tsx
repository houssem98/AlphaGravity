import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AnswerStateBanner from './AnswerStateBanner';
import { ANSWER_STATE_COPY, copyForState, flaggedCount, showsVerifiedBadge } from '../../lib/answerState';
import type { AnswerState, GravityCitation } from '../../hooks/useGravitySearch';

// Quick Answer roadmap, Phases 4 and 9.4: insufficient evidence, conflicting
// evidence, cancellation and system error must each be a distinct visible
// state. Before this component the backend decided all of them and the UI
// discarded the decision — `answer_state` appeared nowhere in the frontend.

const cite = (verification_status?: string): GravityCitation => ({
    citation_number: 1, chunk_id: 'c1', text: 't', document_title: 'd',
    ticker: 'NVDA', section: 's',
    is_verified: verification_status === 'verified',
    verification_status: verification_status as GravityCitation['verification_status'],
});

const render = (state: AnswerState | null, citations: GravityCitation[] = []) =>
    renderToStaticMarkup(<AnswerStateBanner state={state} citations={citations} />);

describe('every abstention state is distinct and visible', () => {
    it.each([
        ['UNSUPPORTED', 'No supporting evidence found'],
        ['SOURCE_UNAVAILABLE', 'Primary source could not be consulted'],
        ['CONFLICTING_EVIDENCE', 'Sources disagree'],
        ['CANCELLED', 'Cancelled'],
        ['SYSTEM_ERROR', 'The search did not complete'],
    ])('%s renders its own message', (state, title) => {
        expect(render(state as AnswerState)).toContain(title);
    });

    it('the five states have five distinct titles', () => {
        const titles = Object.values(ANSWER_STATE_COPY).map(c => c.title);
        expect(new Set(titles).size).toBe(titles.length);
    });

    it('renders nothing for a normally answered question', () => {
        expect(render('ANSWERED')).toBe('');
        expect(render(null)).toBe('');
    });
});

describe('flagged citations surface even when the gate was satisfied', () => {
    it('warns when a citation failed verification on an answered question', () => {
        const html = render('ANSWERED', [cite('verified'), cite('conflicting')]);
        expect(html).toContain('1 citation did not check out');
    });

    it('counts unsupported and conflicting, not partially_supported', () => {
        expect(flaggedCount([
            cite('verified'), cite('partially_supported'), cite('not_verifiable'),
        ])).toBe(0);
        expect(flaggedCount([cite('unsupported'), cite('conflicting')])).toBe(2);
    });

    it('adds the flagged count to an abstention banner rather than replacing it', () => {
        const html = render('UNSUPPORTED', [cite('unsupported')]);
        expect(html).toContain('No supporting evidence found');
        expect(html).toContain('also failed verification');
    });

    it('says nothing when every citation checked out', () => {
        expect(render('ANSWERED', [cite('verified'), cite('verified')])).toBe('');
    });
});

describe('copyForState', () => {
    it('returns nothing for a state it does not know', () => {
        expect(copyForState('SOMETHING_NEW' as AnswerState)).toBeUndefined();
        expect(copyForState(null)).toBeUndefined();
    });

    it('marks the two states that mean the answer is not sourced as bad', () => {
        expect(ANSWER_STATE_COPY.UNSUPPORTED.tone).toBe('bad');
        expect(ANSWER_STATE_COPY.SYSTEM_ERROR.tone).toBe('bad');
        expect(ANSWER_STATE_COPY.SOURCE_UNAVAILABLE.tone).toBe('warn');
    });
});

// ── Phase 9.3: the green badge means the verdict, and only the verdict ────
describe('showsVerifiedBadge', () => {
    it('shows the badge only for a verified verdict', () => {
        expect(showsVerifiedBadge(cite('verified'))).toBe(true);
        for (const v of ['partially_supported', 'unsupported', 'conflicting', 'not_verifiable']) {
            expect(showsVerifiedBadge(cite(v)), v).toBe(false);
        }
    });

    it('refuses a legacy turn that carries is_verified with no verdict', () => {
        // A turn persisted before verdicts existed: `is_verified` was whatever
        // the model reported as entailed. Replaying it out of history must not
        // reproduce the badge this work removed.
        expect(showsVerifiedBadge({ is_verified: true, verification_status: undefined })).toBe(false);
    });
});
