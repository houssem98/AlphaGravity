// DX-14 regression tests — docs/AI_TRADING_AGENT_ROADMAP.md Section 6 row 18.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    buildPastContext, renderPastContext, lessonFor, trackRecord, renderTrackRecord,
    SAME_TICKER_LIMIT, CROSS_TICKER_LIMIT,
} from './dexterMemory';
import { buildEntry, type JournalEntry } from './dexterJournal';

let clock = 1_000;
function entry(symbol: string, over: Partial<JournalEntry> = {}): JournalEntry {
    const base = buildEntry({
        symbol, isTN: false, isCrypto: true, priceAtCall: 100,
        plan: { action: 'BUY', entry: 100, stop: 90, target: 120, sizePct: 3, rr: 2 },
        stance: 'BULLISH', confidence: 70, grade: 'B', score: 79,
        thesis: 't', calls: 11, now: clock++,
    });
    return { ...base, ...over };
}

const WON = (s: string, o: Partial<JournalEntry> = {}) => entry(s, { outcome: 'target', outcomePrice: 120, ...o });
const LOST = (s: string, o: Partial<JournalEntry> = {}) => entry(s, { outcome: 'stop', outcomePrice: 90, ...o });

describe('row 18 — the ticker\'s own history reaches the next prompt', () => {
    it('includes past calls on the same symbol', () => {
        const rows = [WON('BTC'), LOST('BTC')];
        const ctx = buildPastContext(rows, 'BTC');
        expect(ctx.sameTicker).toHaveLength(2);
        expect(ctx.text).toContain('Your previous calls on BTC');
        expect(ctx.text).toContain('→ target (+2R)');
        expect(ctx.text).toContain('→ stop (-1R)');
    });

    it('matches the symbol case-insensitively', () => {
        expect(buildPastContext([WON('BTC')], 'btc').sameTicker).toHaveLength(1);
    });

    it('caps the same-ticker history', () => {
        const rows = Array.from({ length: 12 }, () => WON('BTC'));
        expect(buildPastContext(rows, 'BTC').sameTicker).toHaveLength(SAME_TICKER_LIMIT);
    });

    it('lists an open position as open rather than as a lesson', () => {
        const ctx = buildPastContext([entry('BTC')], 'BTC');
        expect(ctx.text).toContain('still open');
        expect(ctx.text).not.toContain('→ target');
    });
});

describe('row 18 — cross-ticker lessons are included but capped', () => {
    it('carries resolved calls from other names', () => {
        const ctx = buildPastContext([WON('BTC'), LOST('ETH'), WON('SOL')], 'BTC');
        expect(ctx.crossTicker.map(e => e.symbol)).toEqual(['ETH', 'SOL']);
        expect(ctx.text).toContain('Recent resolved calls on other names');
    });

    it('caps them', () => {
        const rows = [WON('BTC'), ...Array.from({ length: 9 }, () => LOST('ETH'))];
        expect(buildPastContext(rows, 'BTC').crossTicker).toHaveLength(CROSS_TICKER_LIMIT);
    });

    it('excludes open positions on other names — they have taught nothing', () => {
        const ctx = buildPastContext([WON('BTC'), entry('ETH')], 'BTC');
        expect(ctx.crossTicker).toEqual([]);
    });

    it('never leaks the current symbol into the cross-ticker list', () => {
        const ctx = buildPastContext([WON('BTC'), LOST('BTC')], 'BTC');
        expect(ctx.crossTicker).toEqual([]);
    });
});

describe('row 18 — an empty journal injects nothing', () => {
    it('returns an empty block rather than "no history"', () => {
        expect(buildPastContext([], 'BTC').text).toBe('');
        expect(renderPastContext([], [], 'BTC')).toBe('');
    });

    it('says nothing about a record that does not exist yet', () => {
        expect(renderTrackRecord(trackRecord([]))).toBe('');
        expect(trackRecord([]).hitRate).toBeNull();
    });
});

describe('row 18 — the block cannot be mistaken for evidence', () => {
    it('tells the model this is its own record, not a source', () => {
        const text = buildPastContext([WON('BTC')], 'BTC').text;
        expect(text).toContain('your own record, not market data');
        expect(text).toContain('do not cite it as a source');
        expect(text).toContain('do not let a past result become the reason for this one');
    });

    it('carries no [N] markers that the citation checker could resolve', () => {
        expect(buildPastContext([WON('BTC'), LOST('ETH')], 'BTC').text).not.toMatch(/\[\d+\]/);
    });
});

describe('row 18 — the lesson keeps the specific mistake', () => {
    it('reconstructs R from the stored outcome', () => {
        expect(lessonFor(WON('BTC'))).toContain('(+2R)');
        expect(lessonFor(LOST('BTC'))).toContain('(-1R)');
    });

    it('still names a plan that fought its own debate', () => {
        expect(lessonFor(LOST('BTC', { stance: 'BEARISH' }))).toContain('traded against its own research');
    });

    it('signs an expired call by direction', () => {
        expect(lessonFor(entry('BTC', { outcome: 'expired', outcomePrice: 105 }))).toContain('(+0.5R)');
        expect(lessonFor(entry('BTC', { action: 'SELL', outcome: 'expired', outcomePrice: 105 }))).toContain('(-0.5R)');
    });
});

describe('row 18 — the track record is the earned one', () => {
    it('counts wins, losses and total R', () => {
        expect(trackRecord([WON('BTC'), WON('ETH'), LOST('SOL')])).toEqual({
            resolved: 3, wins: 2, losses: 1, totalR: 3, hitRate: 0.67,
        });
    });

    it('ignores positions that are still open', () => {
        expect(trackRecord([WON('BTC'), entry('ETH')]).resolved).toBe(1);
    });

    it('states a losing record as plainly as a winning one', () => {
        const text = renderTrackRecord(trackRecord([LOST('BTC'), LOST('ETH'), WON('SOL')]));
        expect(text).toContain('1 won, 2 lost of 3 resolved');
        expect(text).toContain('33% hit rate');
        expect(text).toContain('0R total');           // +2 -1 -1
        expect(text).toContain('State this honestly');
    });
});

describe('row 18 — wired into the handler', () => {
    const handler = readFileSync(join(__dirname, '../../api/agent/[fn].ts'), 'utf8');

    it('recalls before the analysts answer, as a traced step', () => {
        expect(handler).toMatch(/trace\.step\('Recalling past calls', 'memory'/);
        expect(handler).toMatch(/const past = buildPastContext\(rows, ctx\.symbol\)/);
    });

    it('injects the block ahead of the analyst reports', () => {
        expect(handler).toMatch(/memoryBlock \? `\$\{memoryBlock\}\\n\\n---\\n\\n` : ''/);
    });

    it('never fails a run because memory was unavailable', () => {
        expect(handler).toContain('memory is a bonus; never fail a run over it');
    });

    it('spends no model call to remember', () => {
        const block = handler.slice(handler.indexOf('DX-14'), handler.indexOf('const reports'));
        expect(block).not.toContain('countedChat');
    });
});
