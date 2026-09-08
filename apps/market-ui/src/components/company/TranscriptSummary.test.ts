// CF-14 · converted from a bare assertion script to a vitest suite.
//
// The assertions below are unchanged. What changed is that something runs them:
// as a script with its own `check()` helper it was excluded from vitest, and the
// runner it was meant to use is referenced only from ci.yml.disabled — so these
// checks had never failed a build, because nothing ever executed them.
import { describe, it, expect } from 'vitest';
import { isTranscriptDisclaimer } from './TranscriptSummary';

describe('isTranscriptDisclaimer', () => {
    it('flags the prod financials-fallback disclaimer', () => {
        // The exact prod fallback observed for a thin/absent transcript.
        expect(isTranscriptDisclaimer(
            'The provided sources contain only historical revenue and net income figures. '
            + 'They do not include any earnings call transcript excerpts. Therefore, no outlook '
            + 'or summary of an earnings call can be extracted.',
        )).toBe(true);
    });

    it('flags "no earnings call"', () => {
        expect(isTranscriptDisclaimer('There is no earnings call content in the sources.')).toBe(true);
    });

    it('passes a real summary', () => {
        expect(isTranscriptDisclaimer(
            '**Highlights** Revenue grew 12% to $94B [1]. '
            + '**Outlook** Management guided to double-digit services growth [2].',
        )).toBe(false);
    });
});
