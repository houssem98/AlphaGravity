// Dexter Replay — running the decision graph against the past, honestly.
// docs/AI_TRADING_AGENT_ROADMAP.md DX-15, regression row 19.
//
// The whole value of a backtest is that it cannot cheat, so the no-look-ahead
// rule is enforced by the plumbing rather than by good intentions: the replay
// deps physically cannot hand a tool a bar dated after the decision, and they
// throw if asked to. A convention that "we only pass old bars" is worth nothing;
// a guard that fails loudly is worth something.
//
// WHAT CANNOT BE REPLAYED, stated up front because it bounds every number this
// file produces: the news and social analysts read live feeds. There is no
// archive of what Google News showed on a past date, so replaying them would
// serve TODAY's headlines as if they had been available then — look-ahead of the
// worst kind, because it is invisible in the output. `REPLAYABLE_ANALYSTS`
// therefore excludes them, and any replayed decision is made on price structure
// and fundamentals alone. That is a WEAKER agent than the live one, so these
// results are a floor, not an estimate of live performance.

import type { Bar } from './taLevels.js';
import type { AnalystId } from './dexterGraph.js';
import type { ToolDeps } from './dexterTools.js';
import { gradeEntry, type Verdict } from './dexterOutcome.js';
import { buildEntry, type JournalEntry } from './dexterJournal.js';
import { isContamination, type Contamination } from './hindsightProbe.js';
import { applyCosts, resolveCosts, describeCosts, type CostModel } from './dexterCosts.js';

export const REPLAYABLE_ANALYSTS: readonly AnalystId[] = ['market', 'fundamentals'];
export const UNREPLAYABLE_REASON =
    'news and social read live feeds with no historical archive; replaying them would serve ' +
    "today's information as if it had been available on the replay date";

export function isReplayable(id: AnalystId): boolean {
    return REPLAYABLE_ANALYSTS.includes(id);
}

export function barTime(b: Bar): number {
    const t = Date.parse(b.date);
    return Number.isFinite(t) ? t : 0;
}

/** Bars the agent could legitimately have seen at `asOf`, inclusive of that day's close. */
export function asOfBars(bars: Bar[], asOf: number): Bar[] {
    return bars.filter(b => barTime(b) <= asOf);
}

/** Bars that only exist after the decision — the ones grading is allowed to use. */
export function futureBars(bars: Bar[], asOf: number): Bar[] {
    return bars.filter(b => barTime(b) > asOf);
}

export class LookAheadError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'LookAheadError';
    }
}

// Any bar array leaving the replay deps passes through here. A leak throws
// rather than quietly inflating the result.
export function assertNoLookAhead(bars: Bar[], asOf: number, source: string): Bar[] {
    const leaked = bars.filter(b => barTime(b) > asOf);
    if (leaked.length > 0) {
        throw new LookAheadError(
            `${source} returned ${leaked.length} bar(s) dated after the decision ` +
            `(${leaked.map(b => b.date).slice(0, 3).join(', ')}); replay aborted`,
        );
    }
    return bars;
}

export interface ReplayDepsOptions {
    /** Every bar the symbol has, past and future. The guard slices it. */
    allBars: Bar[];
    asOf: number;
    /** Non-bar endpoints the replay is allowed to answer, e.g. fundamentals. */
    getJson?: (url: string) => Promise<any>;
}

// Deps that behave like the live tool belt but cannot see the future. Any route
// that would need live data the replay cannot date is refused outright, so a
// replayed decision can never quietly include something it should not have had.
export function makeReplayDeps(opts: ReplayDepsOptions): ToolDeps {
    const visible = asOfBars(opts.allBars, opts.asOf);
    return {
        getJson: async (url: string) => {
            if (/\/api\/news|\/api\/social/.test(url)) {
                throw new LookAheadError(`${url} is not replayable: ${UNREPLAYABLE_REASON}`);
            }
            if (/binance|\/api\/history|\/api\/tn\/(history|intraday)/.test(url)) {
                return assertNoLookAhead(visible, opts.asOf, url)
                    .map(b => [barTime(b), b.open, b.high, b.low, b.close, b.volume ?? 0]);
            }
            if (opts.getJson) return opts.getJson(url);
            throw new LookAheadError(`${url} has no replayable source`);
        },
        getBars: async () => assertNoLookAhead(visible, opts.asOf, 'getBars'),
    };
}

export interface ReplayTrade {
    asOf: string;
    entry: JournalEntry;
    verdict: Verdict;
}

export interface ReplaySummary {
    dates: number;
    trades: number;
    holds: number;
    wins: number;
    losses: number;
    open: number;
    hitRate: number | null;
    avgR: number | null;
    totalR: number;
    /** DI-2: the same trades net of fee, spread and slippage. Never above gross. */
    avgNetR: number | null;
    totalNetR: number;
    /** Round-trip friction charged across the resolved trades, in R. */
    totalCostR: number;
    /** Winners after costs — a +0.1R gross scratch is a loser once charged. */
    winsNet: number;
    hitRateNet: number | null;
    /** Resolved trades that had no price to charge costs against. */
    uncosted: number;
    costs: CostModel;
    /** Simple buy-and-hold over the same window, in percent. Different units to R. */
    buyHoldPct: number | null;
    /** DI-1: what the hindsight probe found for this window and model. Never defaulted. */
    contamination: Contamination;
    notes: string[];
}

// The label is a required argument rather than an optional field because a
// number without it is the thing this ledger exists to stop being quoted.
export function summariseReplay(
    trades: ReplayTrade[],
    bars: Bar[],
    firstAsOf: number,
    contamination: Contamination,
    costsIn?: CostModel,
): ReplaySummary {
    if (!isContamination(contamination)) {
        throw new Error(
            'summariseReplay needs a contamination label from the DI-1 hindsight probe ' +
            "('clean' | 'suspect' | 'contaminated'); an unlabelled replay number is not quotable",
        );
    }
    // Costs default to the real model — a gross-only run has to ask for ZERO_COSTS.
    const costs = resolveCosts(costsIn);
    const positions = trades.filter(t => t.entry.action !== 'HOLD');
    const resolved = positions.filter(t => t.verdict.outcome !== 'open');
    const rs = resolved.map(t => t.verdict.rMultiple ?? 0);
    const wins = rs.filter(r => r > 0).length;

    const costed = resolved.map(t => applyCosts(costs, {
        entryPx: t.entry.entry,
        stopPx: t.entry.stop,
        exitPx: t.verdict.price,
        grossR: t.verdict.rMultiple,
    }));
    const netRs = costed.map(c => c.netR).filter((r): r is number => r !== null);
    const totalCostR = costed.reduce((a, c) => a + (c.costR ?? 0), 0);
    const winsNet = netRs.filter(r => r > 0).length;

    const window = futureBars(bars, firstAsOf);
    const first = window[0]?.close ?? null;
    const last = window.at(-1)?.close ?? null;

    return {
        dates: trades.length,
        trades: positions.length,
        holds: trades.length - positions.length,
        wins,
        losses: rs.filter(r => r < 0).length,
        open: positions.length - resolved.length,
        hitRate: resolved.length === 0 ? null : Number((wins / resolved.length).toFixed(2)),
        avgR: resolved.length === 0 ? null : Number((rs.reduce((a, b) => a + b, 0) / resolved.length).toFixed(2)),
        totalR: Number(rs.reduce((a, b) => a + b, 0).toFixed(2)),
        avgNetR: netRs.length === 0 ? null : Number((netRs.reduce((a, b) => a + b, 0) / netRs.length).toFixed(2)),
        totalNetR: Number(netRs.reduce((a, b) => a + b, 0).toFixed(2)),
        totalCostR: Number(totalCostR.toFixed(2)),
        winsNet,
        hitRateNet: netRs.length === 0 ? null : Number((winsNet / netRs.length).toFixed(2)),
        uncosted: costed.filter(c => c.netR === null).length,
        costs,
        buyHoldPct: first && last ? Number((((last - first) / first) * 100).toFixed(2)) : null,
        contamination,
        notes: [
            `analysts replayed: ${REPLAYABLE_ANALYSTS.join(', ')} only — ${UNREPLAYABLE_REASON}`,
            `hindsight: this window is labelled ${contamination} by the DI-1 probe; every R below carries that label`,
            describeCosts(costs),
            ...costs.assumptions,
            'R-multiples and buy-and-hold percent are different units; the comparison shows direction, not a like-for-like return',
        ],
    };
}

export interface ReplayDecision {
    action: 'BUY' | 'SELL' | 'HOLD';
    entry: number;
    stop: number;
    target: number;
    sizePct: number;
    rr: number;
}

// One replay step: decide with only past bars, then grade with only future ones.
// The two halves never share a bar array, which is what makes the separation
// structural rather than a promise.
export async function replayAt(
    symbol: string,
    allBars: Bar[],
    asOf: number,
    decide: (deps: ToolDeps, visible: Bar[]) => Promise<ReplayDecision | null>,
    now = Date.now(),
): Promise<ReplayTrade> {
    const deps = makeReplayDeps({ allBars, asOf });
    const visible = asOfBars(allBars, asOf);
    const decision = await decide(deps, visible);

    const entry = buildEntry({
        symbol, isTN: false, isCrypto: true,
        priceAtCall: visible.at(-1)?.close ?? null,
        plan: decision && decision.action !== 'HOLD' ? { ...decision, action: decision.action } : null,
        action: decision?.action ?? 'HOLD',
        grade: 'replay', score: 0, thesis: 'replay', calls: 0,
        now: asOf,
    });

    return {
        asOf: new Date(asOf).toISOString().split('T')[0],
        entry,
        verdict: gradeEntry(entry, futureBars(allBars, asOf), now),
    };
}
