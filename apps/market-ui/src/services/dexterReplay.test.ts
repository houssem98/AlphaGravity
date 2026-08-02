// DX-15 regression tests — docs/AI_TRADING_AGENT_ROADMAP.md Section 6 row 19.
// The point of a backtest is that it cannot cheat. These assert on what the
// tools are actually handed, not on what the harness intends to hand them.
import { describe, it, expect } from 'vitest';
import {
    makeReplayDeps, asOfBars, futureBars, assertNoLookAhead, replayAt, summariseReplay,
    isReplayable, LookAheadError, REPLAYABLE_ANALYSTS, UNREPLAYABLE_REASON,
    type ReplayTrade,
} from './dexterReplay';
import type { Bar } from './taLevels';

const BARS: Bar[] = [
    { date: '2026-01-01', open: 100, high: 104, low: 98, close: 103, volume: 1 },
    { date: '2026-01-02', open: 103, high: 106, low: 99, close: 105, volume: 1 },
    { date: '2026-01-03', open: 105, high: 112, low: 100, close: 110, volume: 1 },  // decision day
    { date: '2026-01-04', open: 110, high: 130, low: 109, close: 128, volume: 1 },  // future
    { date: '2026-01-05', open: 128, high: 135, low: 90, close: 95, volume: 1 },    // future
];
const AS_OF = Date.parse('2026-01-03');

describe('row 19 — the tools cannot be handed a future bar', () => {
    it('slices inclusively at the decision date', () => {
        expect(asOfBars(BARS, AS_OF).map(b => b.date)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
        expect(futureBars(BARS, AS_OF).map(b => b.date)).toEqual(['2026-01-04', '2026-01-05']);
    });

    it('hands getBars only what existed at the time', async () => {
        const deps = makeReplayDeps({ allBars: BARS, asOf: AS_OF });
        const given = await deps.getBars!();
        expect(given.map(b => b.date)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
        expect(given.every(b => Date.parse(b.date) <= AS_OF)).toBe(true);
    });

    it('hands the price route only what existed at the time', async () => {
        const deps = makeReplayDeps({ allBars: BARS, asOf: AS_OF });
        for (const url of ['https://api.binance.com/api/v3/klines?symbol=BTCUSDT', '/api/history?symbol=AAPL', '/api/tn/history?symbol=SAH']) {
            const rows = await deps.getJson(url);
            expect(rows).toHaveLength(3);
            expect(rows.every((r: any[]) => r[0] <= AS_OF)).toBe(true);
        }
    });

    it('throws loudly rather than leaking a future bar', () => {
        expect(() => assertNoLookAhead(BARS, AS_OF, 'getBars')).toThrow(LookAheadError);
        expect(() => assertNoLookAhead(BARS, AS_OF, 'getBars'))
            .toThrow(/returned 2 bar\(s\) dated after the decision \(2026-01-04, 2026-01-05\); replay aborted/);
    });

    it('passes clean data through untouched', () => {
        const clean = asOfBars(BARS, AS_OF);
        expect(assertNoLookAhead(clean, AS_OF, 'getBars')).toBe(clean);
    });
});

describe('row 19 — unreplayable sources are refused, not faked', () => {
    it('refuses the news and social routes', async () => {
        const deps = makeReplayDeps({ allBars: BARS, asOf: AS_OF });
        await expect(deps.getJson('/api/news?q=Bitcoin')).rejects.toThrow(LookAheadError);
        await expect(deps.getJson('/api/social/influencers/BTC')).rejects.toThrow(/not replayable/);
        await expect(deps.getJson('/api/news?q=x')).rejects.toThrow(/no historical archive/);
    });

    it('excludes them from the replayable analyst set', () => {
        expect([...REPLAYABLE_ANALYSTS]).toEqual(['market', 'fundamentals']);
        expect(isReplayable('market')).toBe(true);
        expect(isReplayable('news')).toBe(false);
        expect(isReplayable('social')).toBe(false);
    });

    it('refuses an unknown route rather than inventing an answer', async () => {
        const deps = makeReplayDeps({ allBars: BARS, asOf: AS_OF });
        await expect(deps.getJson('/api/whatever')).rejects.toThrow(/no replayable source/);
    });

    it('allows an injected source for things the caller can date', async () => {
        const deps = makeReplayDeps({ allBars: BARS, asOf: AS_OF, getJson: async () => ({ trailingPE: 12 }) });
        expect(await deps.getJson('/api/fundamentals?symbol=X')).toEqual({ trailingPE: 12 });
    });
});

describe('row 19 — a full step decides on the past and is graded on the future', () => {
    it('never lets the decider see the bar that resolves it', async () => {
        let seen: Bar[] = [];
        const trade = await replayAt('BTC', BARS, AS_OF, async (_deps, visible) => {
            seen = visible;
            return { action: 'BUY', entry: 110, stop: 100, target: 130, sizePct: 3, rr: 2 };
        });
        expect(seen.map(b => b.date)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
        // 2026-01-04 high 130 hits the target — a bar the decider never saw.
        expect(trade.verdict).toMatchObject({ outcome: 'target', rMultiple: 2 });
        expect(trade.asOf).toBe('2026-01-03');
    });

    it('grades a losing replay just as readily', async () => {
        const trade = await replayAt('BTC', BARS, AS_OF, async () =>
            ({ action: 'SELL', entry: 110, stop: 120, target: 95, sizePct: 3, rr: 1.5 }));
        // 2026-01-04 high 130 takes out the 120 stop first.
        expect(trade.verdict).toMatchObject({ outcome: 'stop', rMultiple: -1 });
    });

    it('records a HOLD as a date with no position', async () => {
        const trade = await replayAt('BTC', BARS, AS_OF, async () => null);
        expect(trade.entry.action).toBe('HOLD');
        expect(trade.verdict.outcome).toBe('open');
        expect(trade.verdict.reason).toBe('no position to grade');
    });

    it('stamps the decision at the price the agent could see', async () => {
        const trade = await replayAt('BTC', BARS, AS_OF, async () =>
            ({ action: 'BUY', entry: 110, stop: 100, target: 130, sizePct: 3, rr: 2 }));
        expect(trade.entry.priceAtCall).toBe(110);   // 2026-01-03 close
    });

    it('aborts the step if the decider smuggles in future data', async () => {
        await expect(replayAt('BTC', BARS, AS_OF, async (deps) => {
            await deps.getJson('/api/news?q=Bitcoin');
            return null;
        })).rejects.toThrow(LookAheadError);
    });
});

describe('row 19 — the summary states its own limits', () => {
    const win: ReplayTrade = {
        asOf: '2026-01-03',
        entry: { action: 'BUY' } as any,
        verdict: { outcome: 'target', at: 1, price: 130, rMultiple: 2, reason: '' },
    };
    const loss: ReplayTrade = {
        asOf: '2026-01-03',
        entry: { action: 'BUY' } as any,
        verdict: { outcome: 'stop', at: 1, price: 100, rMultiple: -1, reason: '' },
    };
    const hold: ReplayTrade = {
        asOf: '2026-01-03',
        entry: { action: 'HOLD' } as any,
        verdict: { outcome: 'open', at: null, price: null, rMultiple: null, reason: '' },
    };

    it('counts trades, holds and R', () => {
        const s = summariseReplay([win, loss, win, hold], BARS, AS_OF, 'suspect');
        expect(s).toMatchObject({ dates: 4, trades: 3, holds: 1, wins: 2, losses: 1, hitRate: 0.67, avgR: 1, totalR: 3 });
    });

    it('computes buy-and-hold over the graded window', () => {
        // 2026-01-04 close 128 → 2026-01-05 close 95
        expect(summariseReplay([win], BARS, AS_OF, 'suspect').buyHoldPct).toBe(-25.78);
    });

    it('reports no rate at all rather than a fake zero', () => {
        const s = summariseReplay([hold], BARS, AS_OF, 'suspect');
        expect(s.hitRate).toBeNull();
        expect(s.avgR).toBeNull();
        expect(s.trades).toBe(0);
    });

    it('carries the caveats with the numbers, not in a footnote', () => {
        const s = summariseReplay([win], BARS, AS_OF, 'suspect');
        expect(s.notes[0]).toContain('market, fundamentals only');
        expect(s.notes[0]).toContain(UNREPLAYABLE_REASON);
        expect(s.notes.some(n => n.includes('different units'))).toBe(true);
    });
});

// DI-1, Section 6 row 2 — no replay number leaves this file unlabelled.
describe('row 2 — every summary carries a contamination label', () => {
    const win: ReplayTrade = {
        asOf: '2026-01-03',
        entry: { action: 'BUY' } as any,
        verdict: { outcome: 'target', at: 1, price: 130, rMultiple: 2, reason: '' },
    };

    it('reports the label the hindsight probe gave the window', () => {
        for (const label of ['clean', 'suspect', 'contaminated'] as const) {
            expect(summariseReplay([win], BARS, AS_OF, label).contamination).toBe(label);
        }
    });

    it('states the label alongside the R, not in a footnote', () => {
        const s = summariseReplay([win], BARS, AS_OF, 'contaminated');
        expect(s.notes.some(n => n.includes('labelled contaminated'))).toBe(true);
    });

    it('throws rather than summarising an unlabelled window', () => {
        expect(() => summariseReplay([win], BARS, AS_OF, undefined as any)).toThrow(/hindsight probe/);
        expect(() => summariseReplay([win], BARS, AS_OF, 'probably fine' as any)).toThrow(/not quotable/);
    });
});
