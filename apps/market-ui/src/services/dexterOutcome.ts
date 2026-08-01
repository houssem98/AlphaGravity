// Dexter Outcome — marking the agent's own calls against what happened.
// docs/AI_TRADING_AGENT_ROADMAP.md DX-13, regression row 17.
//
// This is the only loop that can tell whether the agent is any good. Everything
// before it measures process — was the figure cited, did the tool run, did the
// debate happen. This measures result.
//
// One judgement call is unavoidable and is made pessimistically: a single daily
// bar that touches BOTH the stop and the target does not say which came first.
// Intraday order is unknowable from daily data, so the stop is assumed to have
// hit. Anything else would flatter the agent using information it does not have,
// which is the standard backtesting sin and exactly the doctrine this repo
// runs on.

import type { JournalEntry, JournalOutcome } from './dexterJournal.js';
import type { Bar } from './taLevels.js';

// A position left open forever is not a call, it is a shrug. After this many
// days it is marked to market and closed.
export const MAX_OPEN_DAYS = 30;
export const DAY_MS = 86_400_000;

export interface Verdict {
    outcome: JournalOutcome;
    at: number | null;        // epoch ms of the bar that resolved it
    price: number | null;     // the level it resolved at
    /** Profit in units of the risk taken: +rr on target, -1 on stop. */
    rMultiple: number | null;
    reason: string;
}

function iso(date: string): number {
    const t = Date.parse(date);
    return Number.isFinite(t) ? t : 0;
}

// Bars strictly after the call. A bar from the same day the call was made
// cannot be used: the agent did not see the rest of that session.
export function barsAfter(entry: JournalEntry, bars: Bar[]): Bar[] {
    return bars.filter(b => iso(b.date) > entry.ts);
}

export function gradeEntry(entry: JournalEntry, bars: Bar[], now = Date.now()): Verdict {
    if (entry.action === 'HOLD' || entry.entry === null || entry.stop === null || entry.target === null) {
        return { outcome: 'open', at: null, price: null, rMultiple: null, reason: 'no position to grade' };
    }

    const { entry: e, stop, target, action } = entry;
    const risk = Math.abs(e - stop);
    if (risk === 0) {
        return { outcome: 'expired', at: entry.ts, price: e, rMultiple: 0, reason: 'no risk defined' };
    }

    const forward = barsAfter(entry, bars);
    for (const bar of forward) {
        const hitStop = action === 'BUY' ? bar.low <= stop : bar.high >= stop;
        const hitTarget = action === 'BUY' ? bar.high >= target : bar.low <= target;

        // Pessimistic on purpose — see the header.
        if (hitStop) {
            return {
                outcome: 'stop', at: iso(bar.date), price: stop, rMultiple: -1,
                reason: hitTarget
                    ? `${bar.date} touched both stop and target; daily bars cannot say which came first, so the stop is assumed`
                    : `stopped out at ${stop} on ${bar.date}`,
            };
        }
        if (hitTarget) {
            return {
                outcome: 'target', at: iso(bar.date), price: target,
                rMultiple: Number((Math.abs(target - e) / risk).toFixed(2)),
                reason: `target ${target} reached on ${bar.date}`,
            };
        }
    }

    const ageDays = (now - entry.ts) / DAY_MS;
    if (ageDays >= MAX_OPEN_DAYS) {
        const last = forward.at(-1);
        const exit = last?.close ?? e;
        const signed = action === 'BUY' ? exit - e : e - exit;
        return {
            outcome: 'expired', at: last ? iso(last.date) : now, price: exit,
            rMultiple: Number((signed / risk).toFixed(2)),
            reason: `neither level reached in ${MAX_OPEN_DAYS} days; marked to ${exit}`,
        };
    }

    return {
        outcome: 'open', at: null, price: null, rMultiple: null,
        reason: `still open after ${Math.floor(ageDays)}d, ${forward.length} bars checked`,
    };
}

export function applyVerdict(entry: JournalEntry, v: Verdict): JournalEntry {
    if (v.outcome === 'open') return entry;
    return { ...entry, outcome: v.outcome, outcomeAt: v.at ?? undefined, outcomePrice: v.price ?? undefined };
}

// The reflection. TradingAgents stores a free-text lesson beside the decision
// (`memory.py: update_with_outcome`); the useful part here is the specific
// mismatch, not a moral. "The plan disagreed with the debate and lost" is
// something the next run can act on; "be more careful" is not.
export function reflectionFor(entry: JournalEntry, v: Verdict): string {
    if (v.outcome === 'open') return '';
    const rr = v.rMultiple === null ? '' : ` (${v.rMultiple > 0 ? '+' : ''}${v.rMultiple}R)`;
    const head = `${entry.action} ${entry.symbol} at ${entry.entry} → ${v.outcome}${rr}. ${v.reason}.`;

    const notes: string[] = [];
    if (entry.stance) {
        const aligned =
            (entry.action === 'BUY' && entry.stance === 'BULLISH') ||
            (entry.action === 'SELL' && entry.stance === 'BEARISH');
        if (!aligned && entry.stance !== 'NEUTRAL') {
            notes.push(`the plan was a ${entry.action} while the debate ruled ${entry.stance} — it traded against its own research`);
        } else if (entry.stance === 'NEUTRAL') {
            notes.push(`the debate ruled NEUTRAL${entry.confidence === null ? '' : ` at ${entry.confidence}%`} and a position was taken anyway`);
        }
    }
    if (entry.rr !== null && entry.rr < 1.5 && v.outcome === 'stop') {
        notes.push(`risk/reward was only ${entry.rr}:1, so one loss needs more than one win to recover`);
    }
    if (entry.grade === 'C' || entry.grade === 'D' || entry.grade === 'F') {
        notes.push(`the answer itself only graded ${entry.grade}`);
    }
    return notes.length === 0 ? head : `${head} Note: ${notes.join('; ')}.`;
}

export interface OutcomeSummary {
    graded: number;
    stillOpen: number;
    target: number;
    stop: number;
    expired: number;
    /** Sum of R across everything resolved — the only number that matters. */
    totalR: number;
    lessons: string[];
}

export function summarise(results: Array<{ entry: JournalEntry; verdict: Verdict }>): OutcomeSummary {
    const resolved = results.filter(r => r.verdict.outcome !== 'open');
    return {
        graded: resolved.length,
        stillOpen: results.length - resolved.length,
        target: resolved.filter(r => r.verdict.outcome === 'target').length,
        stop: resolved.filter(r => r.verdict.outcome === 'stop').length,
        expired: resolved.filter(r => r.verdict.outcome === 'expired').length,
        totalR: Number(resolved.reduce((s, r) => s + (r.verdict.rMultiple ?? 0), 0).toFixed(2)),
        lessons: resolved.map(r => reflectionFor(r.entry, r.verdict)).filter(Boolean),
    };
}

// Grades every open position against bars fetched per symbol. A symbol whose
// feed is down is left open rather than guessed at.
export async function gradeOpen(
    rows: JournalEntry[],
    barsFor: (entry: JournalEntry) => Promise<Bar[]>,
    now = Date.now(),
): Promise<{ rows: JournalEntry[]; summary: OutcomeSummary }> {
    const open = rows.filter(r => r.outcome === 'open' && r.action !== 'HOLD');
    const results: Array<{ entry: JournalEntry; verdict: Verdict }> = [];

    for (const entry of open) {
        let bars: Bar[] = [];
        try {
            bars = await barsFor(entry);
        } catch {
            continue;   // feed down: stays open, never guessed
        }
        results.push({ entry, verdict: gradeEntry(entry, bars, now) });
    }

    const byId = new Map(results.map(r => [r.entry.id, r.verdict]));
    return {
        rows: rows.map(r => {
            const v = byId.get(r.id);
            return v ? applyVerdict(r, v) : r;
        }),
        summary: summarise(results),
    };
}
