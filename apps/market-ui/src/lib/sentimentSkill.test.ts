// The rule under test, in one line:
//
//     a result with an abstaining status carries NO score
//
// The skill answers 200 for `insufficient_data`, `ambiguous_entity` and
// `error`, because each is a correct answer that happens to be "no". A mapping
// that reads `data.overall_score` and lets `undefined` become `0` turns all
// three into "neutral sentiment" — a confident reading of a company nobody
// measured. That is the fabrication this module exists to make impossible.
import { describe, it, expect } from 'vitest';
import { headline, sentimentSkillUrl, toView, type SentimentSkillResponse } from './sentimentSkill';

const ok: SentimentSkillResponse = {
    skill: 'sentiment',
    status: 'success',
    entities: [{ ticker: 'CPRT', display_name: 'COPART INC', status: 'resolved' }],
    period: 'latest',
    data: {
        overall: 'positive',
        overall_score: 0.42,
        conflicting: false,
        counts: { positive: 30, negative: 6, neutral: 14 },
        scored_sentences: 50,
        positive_evidence: [{
            text: 'Revenue growth accelerated and margins improved.',
            label: 'positive', score: 0.6, source_class: 'sec_filing', citation: 0,
        }],
        negative_evidence: [],
        neutral_evidence: [],
        source_mix: { sec_filing: 50 },
        window: { start: '2024-12-31', end: '2024-12-31', basis: 'the filings listed',
                  filings: ['10-K 0000900075-25-000004'] },
        trend: null,
        trend_note: 'No prior-period comparison.',
    },
    citations: [{ accession: '0000900075-25-000004' }],
    limitations: ['Sentiment is measured on the language of the filings listed, not on price.'],
    channels: [{ channel: 'edgar_text', state: 'success', count: 3 }],
};

describe('toView — an abstention never carries a number', () => {
    it.each(['insufficient_data', 'ambiguous_entity', 'unsupported_operation', 'error'] as const)(
        '%s has a null score even when the payload carries one', (status) => {
            const view = toView({ ...ok, status, data: { ...ok.data, overall_score: 0.42 } });
            expect(view!.score).toBeNull();
            expect(view!.label).toBe('');
        });

    it('a missing overall_score becomes null, never zero', () => {
        const view = toView({ status: 'success', data: { overall: 'neutral' } });
        expect(view!.score).toBeNull();
    });

    it('a real zero score survives as zero, because it was measured', () => {
        const view = toView({ status: 'success', data: { overall_score: 0, overall: 'neutral' } });
        expect(view!.score).toBe(0);
    });

    it('a success carries its score', () => {
        expect(toView(ok)!.score).toBe(0.42);
    });

    it('nothing at all maps to null rather than an empty reading', () => {
        expect(toView(null)).toBeNull();
        expect(toView(undefined)).toBeNull();
        expect(toView({})).toBeNull();
    });
});

describe('toView — the basis travels with the reading', () => {
    it('carries the window, the source mix and the evidence', () => {
        const v = toView(ok)!;
        expect(v.window.filings).toEqual(['10-K 0000900075-25-000004']);
        expect(v.sourceMix).toEqual({ sec_filing: 50 });
        expect(v.positive).toHaveLength(1);
        expect(v.limitations[0]).toContain('not on price');
    });

    it('reports a failed channel separately from an empty one', () => {
        const failed = toView({ ...ok, status: 'error',
            channels: [{ channel: 'edgar_text', state: 'failed', error_type: 'RuntimeError' }] })!;
        expect(failed.failedChannels).toHaveLength(1);
        const empty = toView({ ...ok, channels: [{ channel: 'edgar_text', state: 'empty' }] })!;
        expect(empty.failedChannels).toHaveLength(0);
    });

    it('carries the candidates of an ambiguous mention', () => {
        const v = toView({
            status: 'ambiguous_entity',
            entities: [{ status: 'ambiguous', candidates: [
                { ticker: 'AAPL', name: 'Apple Inc.' },
                { ticker: 'APLE', name: 'Apple Hospitality REIT' },
            ] }],
        })!;
        expect(v.candidates.map(c => c.ticker)).toEqual(['AAPL', 'APLE']);
    });

    it('marks conflicting evidence as conflicting', () => {
        const v = toView({ ...ok, status: 'conflicting_evidence',
            data: { ...ok.data, conflicting: true, overall: 'mixed' } })!;
        expect(v.conflicting).toBe(true);
        expect(v.score).not.toBeNull();   // conflict is a reading, not an abstention
    });

    it('never invents a trend', () => {
        expect(toView(ok)!.trendNote).toContain('No prior-period');
    });
});

describe('headline', () => {
    it('states a provider failure as a retrieval failure, not as missing disclosure', () => {
        const v = toView({ ...ok, status: 'error',
            channels: [{ channel: 'edgar_text', state: 'failed' }] })!;
        const h = headline(v, 'CPRT');
        expect(h).toContain('provider did not answer');
        expect(h).not.toContain('no disclosure');
    });

    it('asks the user to choose when the mention is ambiguous', () => {
        const v = toView({ status: 'ambiguous_entity', entities: [{ candidates: [] }] })!;
        expect(headline(v, 'Apple')).toContain('more than one SEC registrant');
    });

    it('says not enough text rather than neutral when data is insufficient', () => {
        const v = toView({ status: 'insufficient_data' })!;
        const h = headline(v, 'EXPD');
        expect(h).toContain('Not enough');
        expect(h).not.toContain('neutral');
    });

    it('names the reading and the window on success', () => {
        expect(headline(toView(ok)!, 'CPRT')).toContain('positive');
    });

    it('calls a conflict a conflict', () => {
        const v = toView({ ...ok, status: 'conflicting_evidence' })!;
        expect(headline(v, 'AOS')).toContain('mixed');
    });
});

describe('sentimentSkillUrl', () => {
    it('is company-scoped by mention, not by ticker allowlist', () => {
        const url = sentimentSkillUrl('http://localhost:8000', 'Texas Pacific Land');
        expect(url).toContain('/v1/skills/sentiment?');
        expect(url).toContain('company=Texas+Pacific+Land');
        expect(url).toContain('period=latest');
    });

    it('tolerates a trailing slash on the base', () => {
        expect(sentimentSkillUrl('http://x/', 'CPRT')).toContain('http://x/v1/skills/sentiment');
    });
});
