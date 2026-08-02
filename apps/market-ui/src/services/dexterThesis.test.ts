// DI-12 regression tests — docs/DEXTER_INSTITUTIONAL_ROADMAP.md Section 6 row 16.
import { describe, it, expect } from 'vitest';
import {
    linkThesis, priorFor, renderThesisLink, evidenceKeysOf, DAY_MS, type ThesisRecord,
} from './dexterThesis';

const march = Date.parse('2026-03-01T00:00:00Z');
const june = Date.parse('2026-06-01T00:00:00Z');

const rec = (over: Partial<ThesisRecord> = {}): ThesisRecord => ({
    symbol: 'BTC',
    ts: june,
    stance: 'BULLISH',
    thesis: 'Support holds and the trend has turned',
    evidenceKeys: ['level:61400', 'regime:trending-up'],
    ...over,
});

describe('row 16 — a new call is linked to the prior thesis on the same symbol', () => {
    it('finds the most recent prior, not the first one', () => {
        const history = [
            rec({ ts: march, thesis: 'oldest' }),
            rec({ ts: march + 30 * DAY_MS, thesis: 'middle' }),
            rec({ ts: march + 60 * DAY_MS, thesis: 'newest prior' }),
        ];
        expect(priorFor(rec(), history)?.thesis).toBe('newest prior');
    });

    it('ignores other symbols entirely', () => {
        const history = [rec({ symbol: 'ETH', ts: march, thesis: 'eth thesis' })];
        const link = linkThesis(rec(), history);
        expect(link.prior).toBeNull();
        expect(link.notes[0]).toContain('no prior thesis on BTC');
    });

    it('never links to a thesis written after the current one', () => {
        const future = [rec({ ts: june + DAY_MS, thesis: 'from the future' })];
        expect(priorFor(rec(), future)).toBeNull();
    });

    it('reports the age and the prior stance in the note', () => {
        const link = linkThesis(rec(), [rec({ ts: march, stance: 'BEARISH', thesis: 'Trend is down' })]);
        expect(link.ageDays).toBe(92);
        expect(link.notes[0]).toContain('prior thesis on BTC was BEARISH 92 days ago: "Trend is down"');
    });

    it('separates new evidence from dropped evidence', () => {
        const link = linkThesis(
            rec({ evidenceKeys: ['level:61400', 'news:etf-approval'] }),
            [rec({ ts: march, evidenceKeys: ['level:61400', 'regime:trending-down'] })],
        );
        expect(link.newEvidence).toEqual(['news:etf-approval']);
        expect(link.droppedEvidence).toEqual(['regime:trending-down']);
    });
});

describe('row 16 — an unexplained stance flip is flagged', () => {
    const priorBear = [rec({ ts: march, stance: 'BEARISH', thesis: 'Trend is down and resistance held' })];

    it('flags a reversal made on exactly the same evidence', () => {
        const link = linkThesis(rec({ stance: 'BULLISH' }), priorBear);
        expect(link.flipped).toBe(true);
        expect(link.contradiction).toContain('stance flipped BEARISH → BULLISH');
        expect(link.contradiction).toContain('NO new evidence');
        expect(link.contradiction).toContain('Trend is down and resistance held');
        expect(link.contradiction).toContain('coin toss wearing a thesis');
        expect(renderThesisLink(link).startsWith("⚠")).toBe(true);
    });

    it('does not flag a reversal that has something new behind it', () => {
        const link = linkThesis(
            rec({ stance: 'BULLISH', evidenceKeys: ['level:61400', 'regime:trending-up', 'news:etf-approval'] }),
            priorBear,
        );
        expect(link.flipped).toBe(true);
        expect(link.contradiction).toBeNull();
        expect(link.notes.at(-1)).toContain('justified by: news:etf-approval');
    });

    it('does not flag holding the same view on the same evidence', () => {
        const link = linkThesis(rec({ stance: 'BEARISH' }), priorBear);
        expect(link.flipped).toBe(false);
        expect(link.contradiction).toBeNull();
    });

    it('treats a move through NEUTRAL as a change of degree, not a reversal', () => {
        expect(linkThesis(rec({ stance: 'NEUTRAL' }), priorBear).flipped).toBe(false);
        expect(linkThesis(rec({ stance: 'BULLISH' }), [rec({ ts: march, stance: 'NEUTRAL' })]).flipped).toBe(false);
    });

    it('flags the flip in both directions', () => {
        const link = linkThesis(
            rec({ stance: 'BEARISH', evidenceKeys: ['level:61400'] }),
            [rec({ ts: march, stance: 'BULLISH', evidenceKeys: ['level:61400'] })],
        );
        expect(link.contradiction).toContain('BULLISH → BEARISH');
    });

    it('says plainly when there was no new evidence even without a flip', () => {
        const link = linkThesis(rec({ stance: 'BULLISH' }), [rec({ ts: march, stance: 'BULLISH' })]);
        expect(link.notes[1]).toBe('no new evidence since the prior thesis');
        expect(link.contradiction).toBeNull();
    });
});

describe('row 16 — evidence keys are stable across wordings', () => {
    it('keys on the source and the levels, not the prose', () => {
        const a = evidenceKeysOf({
            citations: [{ source: 'taLevels', title: 'BTC price structure' }],
            levels: [61_400],
            regime: 'trending-up',
        });
        const b = evidenceKeysOf({
            levels: [61_400],
            regime: 'trending-up',
            citations: [{ source: 'taLevels', title: 'BTC price structure' }],
        });
        expect(a).toEqual(b);
        expect(a).toContain('level:61400');
        expect(a).toContain('regime:trending-up');
    });

    it('drops an empty citation rather than keying on nothing', () => {
        expect(evidenceKeysOf({ citations: [{}] })).toEqual([]);
    });

    it('makes two theses on identical facts compare equal', () => {
        const facts = { citations: [{ source: 'news', title: 'ETF approved' }], levels: [61_400] };
        const first = rec({ ts: march, stance: 'BEARISH', evidenceKeys: evidenceKeysOf(facts) });
        const second = rec({ stance: 'BULLISH', evidenceKeys: evidenceKeysOf(facts) });
        expect(linkThesis(second, [first]).contradiction).not.toBeNull();
    });
});
