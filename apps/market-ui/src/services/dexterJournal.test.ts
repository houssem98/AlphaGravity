// DX-12 regression tests — docs/AI_TRADING_AGENT_ROADMAP.md Section 6 row 16.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    buildEntry, appendEntry, recordDecision, entryId, openEntries, entriesFor,
    supabaseJournalStore, JOURNAL_CAP, JOURNAL_FILE, THESIS_MAX,
    type JournalEntry, type JournalStore,
} from './dexterJournal';

const PLAN = { action: 'BUY' as const, entry: 63080, stop: 62211, target: 65655, sizePct: 3, rr: 2.96 };

const INPUT = {
    symbol: 'btc', isTN: false, isCrypto: true,
    priceAtCall: 63083.63,
    plan: PLAN,
    stance: 'BEARISH', confidence: 65,
    grade: 'B', score: 79,
    thesis: 'Structure is down but support held.',
    calls: 11,
    now: 1785600000000,
};

function memoryStore(seed: JournalEntry[] = []): JournalStore & { rows: JournalEntry[] } {
    const state = { rows: [...seed] };
    return {
        get rows() { return state.rows; },
        async get() { return [...state.rows]; },
        async put(rows) { state.rows = [...rows]; },
    };
}

describe('row 16 — an entry records what was decided and at what price', () => {
    it('round-trips every field the grader will need', () => {
        const e = buildEntry(INPUT);
        expect(e).toEqual({
            id: 'BTC-1785600000000',
            ts: 1785600000000,
            symbol: 'BTC',
            isTN: false,
            isCrypto: true,
            action: 'BUY',
            priceAtCall: 63083.63,
            entry: 63080, stop: 62211, target: 65655, sizePct: 3, rr: 2.96,
            stance: 'BEARISH', confidence: 65,
            grade: 'B', score: 79,
            thesis: 'Structure is down but support held.',
            calls: 11,
            outcome: 'open',
        });
    });

    it('normalises the symbol so a later lookup cannot miss it', () => {
        expect(buildEntry(INPUT).symbol).toBe('BTC');
        expect(entryId('btc', 1)).toBe('BTC-1');
    });

    it('records a HOLD with no position numbers', () => {
        const e = buildEntry({ ...INPUT, plan: null, action: 'HOLD' });
        expect(e.action).toBe('HOLD');
        expect([e.entry, e.stop, e.target, e.sizePct, e.rr]).toEqual([null, null, null, null, null]);
        expect(e.priceAtCall).toBe(63083.63);
    });

    it('falls back to the plan entry when no live price was passed', () => {
        expect(buildEntry({ ...INPUT, priceAtCall: null }).priceAtCall).toBe(63080);
    });

    it('bounds the thesis rather than storing a whole essay', () => {
        const e = buildEntry({ ...INPUT, thesis: 'x'.repeat(2000) });
        expect(e.thesis).toHaveLength(THESIS_MAX);
    });

    it('starts every entry open — nothing is graded at write time', () => {
        expect(buildEntry(INPUT).outcome).toBe('open');
    });
});

describe('row 16 — the journal appends without losing today', () => {
    it('keeps newest last', () => {
        const a = buildEntry({ ...INPUT, now: 1 });
        const b = buildEntry({ ...INPUT, now: 2 });
        expect(appendEntry(appendEntry([], a), b).map(r => r.id)).toEqual(['BTC-1', 'BTC-2']);
    });

    it('replaces rather than doubles a retried write', () => {
        const a = buildEntry({ ...INPUT, now: 1 });
        const retry = buildEntry({ ...INPUT, now: 1, grade: 'C' });
        const rows = appendEntry(appendEntry([], a), retry);
        expect(rows).toHaveLength(1);
        expect(rows[0].grade).toBe('C');
    });

    it('drops the oldest rows at the cap, never the newest', () => {
        let rows: JournalEntry[] = [];
        for (let i = 1; i <= JOURNAL_CAP + 5; i++) rows = appendEntry(rows, buildEntry({ ...INPUT, now: i }));
        expect(rows).toHaveLength(JOURNAL_CAP);
        expect(rows[0].id).toBe('BTC-6');
        expect(rows.at(-1)!.id).toBe(`BTC-${JOURNAL_CAP + 5}`);
    });

    it('round-trips through a store', async () => {
        const store = memoryStore();
        const e = buildEntry(INPUT);
        await recordDecision(store, e);
        expect(await store.get()).toEqual([e]);
        expect((await store.get())[0].id).toBe('BTC-1785600000000');
    });
});

describe('row 16 — queries the outcome loop will need', () => {
    const rows = [
        buildEntry({ ...INPUT, now: 1 }),
        buildEntry({ ...INPUT, now: 2, plan: null, action: 'HOLD' }),
        { ...buildEntry({ ...INPUT, now: 3 }), outcome: 'target' as const },
        buildEntry({ ...INPUT, symbol: 'ETH', now: 4 }),
    ];

    it('finds only positions still awaiting an outcome', () => {
        expect(openEntries(rows).map(r => r.id)).toEqual(['BTC-1', 'ETH-4']);
    });

    it('excludes a HOLD — there is nothing to grade', () => {
        expect(openEntries(rows).some(r => r.action === 'HOLD')).toBe(false);
    });

    it('looks up a symbol\'s recent history for DX-14', () => {
        expect(entriesFor(rows, 'btc').map(r => r.id)).toEqual(['BTC-1', 'BTC-2', 'BTC-3']);
        expect(entriesFor(rows, 'BTC', 2).map(r => r.id)).toEqual(['BTC-2', 'BTC-3']);
        expect(entriesFor(rows, 'DOGE')).toEqual([]);
    });
});

describe('row 16 — the Supabase Storage adapter', () => {
    function fakeFetch(getStatus: number, body: unknown, seen: any = {}) {
        return (async (url: string, init?: any) => {
            seen.url = url;
            if (init?.method === 'POST') { seen.body = JSON.parse(init.body); seen.headers = init.headers; return { ok: true, status: 200 }; }
            return { ok: getStatus < 400, status: getStatus, json: async () => body };
        }) as unknown as typeof fetch;
    }

    it('treats an absent file as an empty journal, not an error', async () => {
        const store = supabaseJournalStore('https://x.supabase.co', 'k', fakeFetch(404, null));
        expect(await store.get()).toEqual([]);
    });

    it('reads the rows back out of the blob envelope', async () => {
        const e = buildEntry(INPUT);
        const store = supabaseJournalStore('https://x.supabase.co', 'k', fakeFetch(200, { _t: 1, rows: [e] }));
        expect(await store.get()).toEqual([e]);
    });

    it('tolerates a corrupted blob instead of throwing', async () => {
        const store = supabaseJournalStore('https://x.supabase.co', 'k', fakeFetch(200, { garbage: true }));
        expect(await store.get()).toEqual([]);
    });

    it('upserts to the market-data bucket with the service-role key', async () => {
        const seen: any = {};
        const store = supabaseJournalStore('https://x.supabase.co', 'k', fakeFetch(200, null, seen));
        await store.put([buildEntry(INPUT)]);
        expect(seen.url).toBe(`https://x.supabase.co/storage/v1/object/market-data/${JOURNAL_FILE}`);
        expect(seen.headers['x-upsert']).toBe('true');
        expect(seen.headers.apikey).toBe('k');
        expect(seen.body.rows).toHaveLength(1);
    });

    it('surfaces a failed write rather than pretending it saved', async () => {
        const failing = (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
        const store = supabaseJournalStore('https://x.supabase.co', 'k', failing);
        await expect(store.put([])).rejects.toThrow(/journal write failed: HTTP 500/);
    });
});

describe('row 16 — wired into the handler', () => {
    const handler = readFileSync(join(__dirname, '../../api/agent/[fn].ts'), 'utf8');

    it('journals decisions only, and only when credentials exist', () => {
        expect(handler).toMatch(/effectiveMode === 'decide' && process\.env\.SUPABASE_URL && process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
    });

    it('never lets a journal failure cost the user their answer', () => {
        expect(handler).toMatch(/waitUntil\(recordDecision\(store, entry\)\.catch/);
        expect(handler).toContain('a journal failure must not');
    });

    it('reports the id it wrote', () => {
        expect(handler).toMatch(/^\s*journalled,$/m);
    });
});
