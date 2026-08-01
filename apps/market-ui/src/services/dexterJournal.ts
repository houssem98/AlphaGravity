// Dexter Journal — the record of what this agent actually said to do.
// docs/AI_TRADING_AGENT_ROADMAP.md DX-12, regression row 16.
//
// Nothing in Phase A-C makes the agent accountable. A grade says the answer was
// well-sourced; it says nothing about whether the call was RIGHT. This file is
// where that starts: every decision is written down with the price at the time,
// so DX-13 can come back later and grade it against what the market did.
//
// STORAGE DEVIATION, stated plainly: the ledger specifies a Supabase TABLE
// (`dexter_decisions`, soft-ref, no FK). Creating one needs DDL through the
// Management API with a personal access token the user has to paste — i.e. a
// user-only blocker. This repo already persists JSON to Supabase STORAGE with
// the service-role key that is present in prod (`api/tn/[fn].ts`), so the
// journal uses that instead: no DDL, no new secret, nothing invented. The
// writer is one function; swapping it for a real table later is a small change.

export type JournalAction = 'BUY' | 'SELL' | 'HOLD';
export type JournalOutcome = 'open' | 'target' | 'stop' | 'expired';

export interface JournalEntry {
    id: string;
    ts: number;                 // when the call was made
    symbol: string;
    isTN: boolean;
    isCrypto: boolean;
    action: JournalAction;
    /** The price the call was made at — what any later grading is measured from. */
    priceAtCall: number | null;
    entry: number | null;
    stop: number | null;
    target: number | null;
    sizePct: number | null;
    rr: number | null;
    stance: string | null;      // research manager's verdict
    confidence: number | null;
    grade: string;              // trust grade of the answer
    score: number;
    thesis: string;
    calls: number;              // model calls spent
    outcome: JournalOutcome;    // DX-13 moves this off 'open'
    outcomeAt?: number;
    outcomePrice?: number;
}

export const JOURNAL_FILE = 'dexter_decisions.json';
export const JOURNAL_CAP = 500;
export const THESIS_MAX = 400;

export interface JournalStore {
    get(): Promise<JournalEntry[]>;
    put(rows: JournalEntry[]): Promise<void>;
}

export interface BuildEntryInput {
    symbol: string;
    isTN: boolean;
    isCrypto: boolean;
    priceAtCall?: number | null;
    plan: { action: JournalAction; entry: number; stop: number; target: number; sizePct: number; rr: number } | null;
    /** Present when the manager chose HOLD, or when a plan was downgraded. */
    action?: JournalAction | null;
    stance?: string | null;
    confidence?: number | null;
    grade: string;
    score: number;
    thesis: string;
    calls: number;
    now?: number;
}

// An id that is stable for a given call but cannot collide across symbols or
// seconds. No randomness, so the same inputs replay to the same row.
export function entryId(symbol: string, ts: number): string {
    return `${symbol.toUpperCase()}-${ts}`;
}

export function buildEntry(input: BuildEntryInput): JournalEntry {
    const ts = input.now ?? Date.now();
    const plan = input.plan;
    return {
        id: entryId(input.symbol, ts),
        ts,
        symbol: input.symbol.toUpperCase(),
        isTN: input.isTN,
        isCrypto: input.isCrypto,
        action: plan?.action ?? input.action ?? 'HOLD',
        priceAtCall: input.priceAtCall ?? plan?.entry ?? null,
        entry: plan?.entry ?? null,
        stop: plan?.stop ?? null,
        target: plan?.target ?? null,
        sizePct: plan?.sizePct ?? null,
        rr: plan?.rr ?? null,
        stance: input.stance ?? null,
        confidence: input.confidence ?? null,
        grade: input.grade,
        score: input.score,
        thesis: input.thesis.slice(0, THESIS_MAX),
        calls: input.calls,
        outcome: 'open',
    };
}

// Newest last, capped from the front. A journal that grows forever eventually
// fails to write at all, and losing the oldest rows is better than losing today's.
export function appendEntry(rows: JournalEntry[], entry: JournalEntry, cap = JOURNAL_CAP): JournalEntry[] {
    const deduped = rows.filter(r => r.id !== entry.id);
    const next = [...deduped, entry];
    return next.length <= cap ? next : next.slice(next.length - cap);
}

export function openEntries(rows: JournalEntry[]): JournalEntry[] {
    return rows.filter(r => r.outcome === 'open' && r.action !== 'HOLD' && r.entry !== null && r.stop !== null);
}

export function entriesFor(rows: JournalEntry[], symbol: string, limit = 5): JournalEntry[] {
    const s = symbol.toUpperCase();
    return rows.filter(r => r.symbol === s).slice(-limit);
}

// ── Supabase Storage adapter ────────────────────────────────────────────────
// Same shape api/tn/[fn].ts uses: a single JSON object per file, service-role
// key, upsert on write. No table, no DDL, no migration.

export function supabaseJournalStore(
    url: string,
    key: string,
    fetchImpl: typeof fetch = fetch,
    file: string = JOURNAL_FILE,
): JournalStore {
    const headers = { apikey: key, Authorization: `Bearer ${key}` };
    const endpoint = `${url}/storage/v1/object/market-data/${file}`;
    return {
        async get() {
            const r = await fetchImpl(endpoint, { headers });
            if (!r.ok) return [];                       // absent file = empty journal, not an error
            const body = await r.json().catch(() => null);
            return Array.isArray(body?.rows) ? body.rows as JournalEntry[] : [];
        },
        async put(rows: JournalEntry[]) {
            const r = await fetchImpl(endpoint, {
                method: 'POST',
                headers: {
                    ...headers,
                    'Content-Type': 'application/json',
                    'x-upsert': 'true',
                    'cache-control': 'max-age=0',
                },
                body: JSON.stringify({ _t: Date.now(), rows }),
            });
            if (!r.ok) throw new Error(`journal write failed: HTTP ${r.status}`);
        },
    };
}

// Read-modify-write. Two decisions landing in the same second would race, which
// for a single-user agent making one call per minutes-long run is not a real
// scenario — and the dedupe by id keeps a retry from doubling a row.
export async function recordDecision(store: JournalStore, entry: JournalEntry): Promise<JournalEntry[]> {
    const rows = await store.get();
    const next = appendEntry(rows, entry);
    await store.put(next);
    return next;
}
