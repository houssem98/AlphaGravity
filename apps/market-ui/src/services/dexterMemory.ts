// Dexter Memory — what this agent already tried, and how it went.
// docs/AI_TRADING_AGENT_ROADMAP.md DX-14, regression row 18.
//
// TradingAgents' `memory.py: get_past_context(ticker, n_same=5, n_cross=3)`:
// a handful of prior calls on the same name, plus a few from other names,
// because the transferable lessons ("it traded against its own research") are
// not ticker-specific. Same split here, over the DX-12 journal.
//
// Two rules keep this from becoming a way to launder invention:
//   1. Only resolved outcomes carry a lesson. An open position is listed as
//      open — it has not taught anything yet.
//   2. When the journal is empty the block is empty. A model given "no prior
//      history" invents patterns; a model given nothing does not.

import { entriesFor, type JournalEntry } from './dexterJournal.js';
import { reflectionFor, gradeEntry } from './dexterOutcome.js';

export const SAME_TICKER_LIMIT = 5;
export const CROSS_TICKER_LIMIT = 3;

export interface PastContext {
    sameTicker: JournalEntry[];
    crossTicker: JournalEntry[];
    /** Ready to inject. Empty string when there is nothing honest to say. */
    text: string;
}

function isResolved(e: JournalEntry): boolean {
    return e.outcome !== 'open';
}

// The verdict is reconstructed from the stored outcome rather than re-graded:
// the bars that resolved it are long gone, and the journal already holds the
// answer.
function verdictFrom(e: JournalEntry) {
    if (e.entry === null || e.stop === null) {
        return { outcome: e.outcome, at: e.outcomeAt ?? null, price: e.outcomePrice ?? null, rMultiple: null, reason: 'recorded' };
    }
    const risk = Math.abs(e.entry - e.stop);
    let r: number | null = null;
    if (e.outcome === 'stop') r = -1;
    else if (e.outcome === 'target' && e.target !== null) r = Number((Math.abs(e.target - e.entry) / risk).toFixed(2));
    else if (e.outcome === 'expired' && e.outcomePrice != null) {
        const signed = e.action === 'BUY' ? e.outcomePrice - e.entry : e.entry - e.outcomePrice;
        r = Number((signed / risk).toFixed(2));
    }
    return {
        outcome: e.outcome,
        at: e.outcomeAt ?? null,
        price: e.outcomePrice ?? null,
        rMultiple: r,
        reason: `resolved ${e.outcome}${e.outcomePrice == null ? '' : ` at ${e.outcomePrice}`}`,
    };
}

export function lessonFor(e: JournalEntry): string {
    if (!isResolved(e)) {
        return `${e.action} ${e.symbol} at ${e.entry} — still open.`;
    }
    return reflectionFor(e, verdictFrom(e) as ReturnType<typeof gradeEntry>);
}

export function buildPastContext(
    rows: JournalEntry[],
    symbol: string,
    sameLimit = SAME_TICKER_LIMIT,
    crossLimit = CROSS_TICKER_LIMIT,
): PastContext {
    const s = symbol.toUpperCase();
    const sameTicker = entriesFor(rows, s, sameLimit);

    // Only resolved calls transfer — an open position on another name teaches
    // nothing and would just be noise in the prompt.
    const crossTicker = rows
        .filter(r => r.symbol !== s && isResolved(r))
        .slice(-crossLimit);

    return { sameTicker, crossTicker, text: renderPastContext(sameTicker, crossTicker, s) };
}

export function renderPastContext(
    sameTicker: JournalEntry[],
    crossTicker: JournalEntry[],
    symbol: string,
): string {
    if (sameTicker.length === 0 && crossTicker.length === 0) return '';

    const parts: string[] = [];
    if (sameTicker.length > 0) {
        parts.push(
            `Your previous calls on ${symbol.toUpperCase()}, oldest first:\n` +
            sameTicker.map(e => `- ${lessonFor(e)}`).join('\n'),
        );
    }
    if (crossTicker.length > 0) {
        parts.push(
            `Recent resolved calls on other names:\n` +
            crossTicker.map(e => `- ${lessonFor(e)}`).join('\n'),
        );
    }
    parts.push(
        'This is your own record, not market data — do not cite it as a source and do not ' +
        'let a past result become the reason for this one. Use it only to avoid repeating a ' +
        'mistake you have already made.',
    );
    return parts.join('\n\n');
}

// Aggregate self-knowledge: the hit rate the agent has actually earned. Shown
// to the model so a run that has been consistently wrong cannot present itself
// with the same confidence as one that has not.
export interface TrackRecord {
    resolved: number;
    wins: number;
    losses: number;
    totalR: number;
    hitRate: number | null;   // null until there is anything to divide
}

export function trackRecord(rows: JournalEntry[]): TrackRecord {
    const resolved = rows.filter(isResolved);
    const rs = resolved.map(e => verdictFrom(e).rMultiple ?? 0);
    const wins = rs.filter(r => r > 0).length;
    const losses = rs.filter(r => r < 0).length;
    return {
        resolved: resolved.length,
        wins,
        losses,
        totalR: Number(rs.reduce((a, b) => a + b, 0).toFixed(2)),
        hitRate: resolved.length === 0 ? null : Number((wins / resolved.length).toFixed(2)),
    };
}

export function renderTrackRecord(t: TrackRecord): string {
    if (t.resolved === 0) return '';
    return `Your record so far: ${t.wins} won, ${t.losses} lost of ${t.resolved} resolved ` +
        `(${Math.round((t.hitRate ?? 0) * 100)}% hit rate, ${t.totalR > 0 ? '+' : ''}${t.totalR}R total). ` +
        `State this honestly if the user asks how you have done.`;
}
