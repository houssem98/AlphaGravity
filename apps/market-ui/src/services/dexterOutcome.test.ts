// DX-13 regression tests — docs/AI_TRADING_AGENT_ROADMAP.md Section 6 row 17.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    gradeEntry, gradeOpen, applyVerdict, reflectionFor, summarise, barsAfter,
    MAX_OPEN_DAYS, DAY_MS,
} from './dexterOutcome';
import { buildEntry, type JournalEntry } from './dexterJournal';
import type { Bar } from './taLevels';

const T0 = Date.parse('2026-01-10T00:00:00Z');

const bar = (date: string, high: number, low: number, close: number): Bar =>
    ({ date, open: close, high, low, close, volume: 1 });

const BUY = buildEntry({
    symbol: 'BTC', isTN: false, isCrypto: true, priceAtCall: 100,
    plan: { action: 'BUY', entry: 100, stop: 90, target: 120, sizePct: 3, rr: 2 },
    stance: 'BULLISH', confidence: 70, grade: 'B', score: 79,
    thesis: 't', calls: 11, now: T0,
});

const SELL = buildEntry({
    symbol: 'BTC', isTN: false, isCrypto: true, priceAtCall: 100,
    plan: { action: 'SELL', entry: 100, stop: 110, target: 80, sizePct: 3, rr: 2 },
    stance: 'BEARISH', confidence: 70, grade: 'B', score: 79,
    thesis: 't', calls: 11, now: T0,
});

describe('row 17 — target, stop and open on a fixture path', () => {
    it('marks a BUY that reached its target', () => {
        const v = gradeEntry(BUY, [bar('2026-01-11', 105, 98, 104), bar('2026-01-12', 125, 103, 122)]);
        expect(v).toMatchObject({ outcome: 'target', price: 120, rMultiple: 2 });
        expect(v.reason).toContain('target 120 reached on 2026-01-12');
    });

    it('marks a BUY that was stopped out', () => {
        const v = gradeEntry(BUY, [bar('2026-01-11', 102, 88, 89)]);
        expect(v).toMatchObject({ outcome: 'stop', price: 90, rMultiple: -1 });
    });

    it('marks a SELL by the mirrored levels', () => {
        expect(gradeEntry(SELL, [bar('2026-01-11', 104, 78, 80)]).outcome).toBe('target');
        expect(gradeEntry(SELL, [bar('2026-01-11', 115, 99, 112)]).outcome).toBe('stop');
    });

    it('leaves a position open when neither level was touched', () => {
        const v = gradeEntry(BUY, [bar('2026-01-11', 105, 95, 101)], T0 + 3 * DAY_MS);
        expect(v.outcome).toBe('open');
        expect(v.rMultiple).toBeNull();
        expect(v.reason).toContain('still open after 3d, 1 bars checked');
    });

    it('resolves on the FIRST bar that hits, not the last', () => {
        const v = gradeEntry(BUY, [
            bar('2026-01-11', 121, 99, 120),   // target here
            bar('2026-01-12', 100, 85, 88),    // stop later — must not win
        ]);
        expect(v).toMatchObject({ outcome: 'target', rMultiple: 2 });
    });
});

describe('row 17 — the ambiguous bar is resolved pessimistically', () => {
    it('assumes the stop when one bar touches both levels', () => {
        const v = gradeEntry(BUY, [bar('2026-01-11', 125, 85, 100)]);
        expect(v.outcome).toBe('stop');
        expect(v.rMultiple).toBe(-1);
        expect(v.reason).toContain('cannot say which came first, so the stop is assumed');
    });

    it('does the same for a SELL', () => {
        expect(gradeEntry(SELL, [bar('2026-01-11', 115, 75, 100)]).outcome).toBe('stop');
    });
});

describe('row 17 — only bars the agent could not have seen count', () => {
    it('ignores bars at or before the moment of the call', () => {
        const bars = [bar('2026-01-09', 130, 80, 100), bar('2026-01-10', 130, 80, 100), bar('2026-01-11', 105, 99, 104)];
        expect(barsAfter(BUY, bars).map(b => b.date)).toEqual(['2026-01-11']);
        expect(gradeEntry(BUY, bars, T0 + DAY_MS).outcome).toBe('open');
    });

    it('does not look ahead when the feed returns nothing', () => {
        expect(gradeEntry(BUY, [], T0 + DAY_MS).outcome).toBe('open');
    });
});

describe('row 17 — stale positions are marked to market, not left forever', () => {
    it('expires after the window and records the last close', () => {
        const v = gradeEntry(BUY, [bar('2026-02-20', 105, 95, 103)], T0 + (MAX_OPEN_DAYS + 1) * DAY_MS);
        expect(v).toMatchObject({ outcome: 'expired', price: 103 });
        expect(v.rMultiple).toBe(0.3);        // (103 - 100) / 10
        expect(v.reason).toContain('marked to 103');
    });

    it('signs an expired SELL the other way', () => {
        const v = gradeEntry(SELL, [bar('2026-02-20', 105, 95, 103)], T0 + (MAX_OPEN_DAYS + 1) * DAY_MS);
        expect(v.rMultiple).toBe(-0.3);       // (100 - 103) / 10
    });
});

describe('row 17 — nothing to grade', () => {
    it('skips a HOLD', () => {
        const hold = buildEntry({ ...BUY, plan: null, action: 'HOLD', grade: 'B', score: 1, thesis: 't', calls: 1, symbol: 'BTC', isTN: false, isCrypto: true });
        expect(gradeEntry(hold, [bar('2026-01-11', 200, 1, 150)]).outcome).toBe('open');
        expect(gradeEntry(hold, []).reason).toBe('no position to grade');
    });
});

describe('row 17 — the reflection names the specific mistake', () => {
    it('flags a plan that traded against its own debate', () => {
        const against = { ...BUY, stance: 'BEARISH' };
        const text = reflectionFor(against, gradeEntry(against, [bar('2026-01-11', 102, 88, 89)]));
        expect(text).toContain('BUY BTC at 100 → stop (-1R)');
        expect(text).toContain('traded against its own research');
    });

    it('flags a position taken on a NEUTRAL verdict', () => {
        const neutral = { ...BUY, stance: 'NEUTRAL', confidence: 55 };
        expect(reflectionFor(neutral, gradeEntry(neutral, [bar('2026-01-11', 102, 88, 89)])))
            .toContain('ruled NEUTRAL at 55% and a position was taken anyway');
    });

    it('flags a thin risk/reward only when it actually lost', () => {
        const thin = { ...BUY, rr: 1 } as JournalEntry;
        expect(reflectionFor(thin, gradeEntry(thin, [bar('2026-01-11', 102, 88, 89)])))
            .toContain('risk/reward was only 1:1');
        expect(reflectionFor(thin, gradeEntry(thin, [bar('2026-01-11', 125, 99, 122)])))
            .not.toContain('risk/reward was only');
    });

    it('mentions a weak answer grade', () => {
        const weak = { ...BUY, grade: 'D' } as JournalEntry;
        expect(reflectionFor(weak, gradeEntry(weak, [bar('2026-01-11', 102, 88, 89)])))
            .toContain('only graded D');
    });

    it('says nothing about a position still open', () => {
        expect(reflectionFor(BUY, gradeEntry(BUY, [], T0 + DAY_MS))).toBe('');
    });

    it('has no note to add when an aligned, well-graded plan wins', () => {
        const text = reflectionFor(BUY, gradeEntry(BUY, [bar('2026-01-11', 125, 99, 122)]));
        expect(text).toBe('BUY BTC at 100 → target (+2R). target 120 reached on 2026-01-11.');
    });
});

describe('row 17 — the pass over the journal', () => {
    const rows: JournalEntry[] = [
        BUY,
        { ...SELL, id: 'BTC-2' },
        { ...BUY, id: 'BTC-3', outcome: 'target' },
    ];

    it('grades open positions and leaves resolved ones alone', async () => {
        const { rows: out, summary } = await gradeOpen(rows, async () => [bar('2026-01-11', 125, 99, 122)]);
        expect(summary.graded).toBe(2);
        expect(summary.target).toBe(1);       // the BUY hit 120
        expect(summary.stop).toBe(1);         // the SELL's stop is 110, high 125
        expect(out.find(r => r.id === 'BTC-3')!.outcome).toBe('target');
        expect(out.find(r => r.id === BUY.id)!.outcomePrice).toBe(120);
    });

    it('leaves a position open rather than guessing when its feed is down', async () => {
        const { rows: out, summary } = await gradeOpen(rows, async () => { throw new Error('HTTP 503'); });
        expect(summary.graded).toBe(0);
        expect(out.find(r => r.id === BUY.id)!.outcome).toBe('open');
    });

    it('sums R across everything resolved', () => {
        const s = summarise([
            { entry: BUY, verdict: gradeEntry(BUY, [bar('2026-01-11', 125, 99, 122)]) },
            { entry: BUY, verdict: gradeEntry(BUY, [bar('2026-01-11', 102, 88, 89)]) },
        ]);
        expect(s.totalR).toBe(1);            // +2R then -1R
        expect(s.lessons).toHaveLength(2);
    });

    it('does not rewrite an entry that is still open', () => {
        const v = gradeEntry(BUY, [], T0 + DAY_MS);
        expect(applyVerdict(BUY, v)).toBe(BUY);
    });
});

describe('row 17 — wired into the handler and the schedule', () => {
    const handler = readFileSync(join(__dirname, '../../api/agent/[fn].ts'), 'utf8');
    const vercel = JSON.parse(readFileSync(join(__dirname, '../../vercel.json'), 'utf8'));

    it('exposes the pass on the existing dispatcher, not a new function', () => {
        expect(handler).toMatch(/if \(fn === 'outcomes'\) return outcomesRoute\(req, res\)/);
    });

    it('spends no model call to grade arithmetic', () => {
        expect(handler).toContain('Zero model calls');
        const route = handler.slice(handler.indexOf('async function outcomesRoute'), handler.indexOf('export default'));
        expect(route).not.toContain('chatWithFallback');
        expect(route).not.toContain('countedChat');
    });

    it('only writes when something actually resolved', () => {
        expect(handler).toMatch(/if \(summary\.graded > 0\) await store\.put\(graded\)/);
    });

    it('runs daily on the cron alongside the existing one', () => {
        const paths = vercel.crons.map((c: any) => c.path);
        expect(paths).toContain('/api/agent/outcomes');
        expect(paths).toContain('/api/tn/snapshot');
    });
});
