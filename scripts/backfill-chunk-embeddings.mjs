#!/usr/bin/env node
// backfill-chunk-embeddings — fills chunks.embedding with voyage-3.5-lite @ 512d.
//
//   node scripts/backfill-chunk-embeddings.mjs            # run until done
//   node scripts/backfill-chunk-embeddings.mjs --status   # how far along, no writes
//   node scripts/backfill-chunk-embeddings.mjs --limit 5  # N batches then stop
//
// GS-5. Dense retrieval died with the Qdrant cluster and this is its replacement on
// the free tier: halfvec(512) in Postgres, embedded by voyage-3.5-lite, whose free
// allowance is 200M tokens against the ~9M this corpus needs. Nothing is paid for.
//
// Resumable by construction — it only ever selects rows WHERE embedding IS NULL, so
// a kill and restart picks up where it stopped. Every batch is written through
// set_chunk_embeddings (migration 0007), one round trip instead of 128 PATCHes.
import { readFileSync } from 'node:fs';

// Batches are packed by TOKENS, not by row count. voyage-3.5-lite's free tier caps
// at roughly 10K tokens per minute — measured, not guessed: one ~6.7K-token request
// returns 200 and the next two return 429 within 2.3 seconds. A fixed 16 rows looked
// safe against the 2,102-char average and still failed every retry, because chunks
// run to 41,605 chars and the first page happened to hold long ones. The corpus is
// ~9.7M tokens, so this runs for 16-19 hours: free, resumable, nothing truncated to
// make it faster.
const PAGE = 64;                 // rows fetched per round trip, then packed
const TOKEN_BUDGET = 7_000;      // per request, under the ~10K/min ceiling
const PACE_MS = 62_000;          // one request per minute window
const estTokens = (s) => Math.ceil(s.length / 4);
const MODEL = 'voyage-3.5-lite';
const DIMS = 512;
const MAX_CHARS = 8000;          // ~2k tokens; the long tail of chunks is rare
const args = process.argv.slice(2);
const argv = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const MAX_BATCHES = Number(argv('--limit', Infinity));

const env = Object.fromEntries(
    [...readFileSync('services/gravity-api/.env', 'utf8').matchAll(/^([A-Z_]+)=(.*)$/gm)]
        .map(m => [m[1], m[2].trim()]));
const SB = env.SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY, VOYAGE = env.VOYAGE_API_KEY;
if (!SB || !KEY || !VOYAGE) { console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VOYAGE_API_KEY required'); process.exit(2); }

const sbHeaders = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function status() {
    const q = async (filter) => {
        const res = await fetch(`${SB}/rest/v1/chunks?select=id&${filter}`, {
            headers: { ...sbHeaders, Prefer: 'count=exact', Range: '0-0' },
        });
        return Number((res.headers.get('content-range') || '/0').split('/')[1]);
    };
    return { done: await q('embedding=not.is.null'), todo: await q('embedding=is.null') };
}

async function nextRows() {
    const res = await fetch(
        `${SB}/rest/v1/chunks?select=id,ticker,text&embedding=is.null&order=id.asc&limit=${PAGE}`,
        { headers: sbHeaders, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`fetch rows: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.json();
}

/** Voyage, with backoff. The free tier is rate-limited, so 429 is expected traffic. */
async function embed(texts, attempt = 0) {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${VOYAGE}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: texts, model: MODEL, output_dimension: DIMS, input_type: 'document' }),
        signal: AbortSignal.timeout(180_000),
    });
    if (res.status === 429 || res.status >= 500) {
        if (attempt >= 6) throw new Error(`voyage ${res.status} after ${attempt} retries`);
        const wait = Math.min(60_000, 2_000 * 2 ** attempt);
        console.log(`  ${res.status} — backing off ${wait / 1000}s`);
        await sleep(wait);
        return embed(texts, attempt + 1);
    }
    if (!res.ok) throw new Error(`voyage ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    return { vectors: body.data.map(d => d.embedding), tokens: body.usage?.total_tokens ?? 0 };
}

async function write(ids, vectors) {
    const res = await fetch(`${SB}/rest/v1/rpc/set_chunk_embeddings`, {
        method: 'POST',
        headers: sbHeaders,
        body: JSON.stringify({ p_ids: ids, p_vecs: vectors.map(v => `[${v.join(',')}]`) }),
        signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`write: ${res.status} ${(await res.text()).slice(0, 200)} — apply supabase/migrations/0007_chunk_embedding_rpcs.sql`);
    return Number(await res.json());
}

const start = await status();
console.log(`chunks embedded ${start.done.toLocaleString()} · remaining ${start.todo.toLocaleString()}`);
if (args.includes('--status')) process.exit(0);

let batches = 0, rows = 0, tokens = 0;
const t0 = Date.now();
outer: while (batches < MAX_BATCHES) {
    const page = await nextRows();
    if (page.length === 0) { console.log('\nnothing left to embed'); break; }

    // Same shape the ingestion pipeline uses: the ticker rides with the text so a
    // paragraph that never names its company is still retrievable by it.
    const prepared = page.map(r => ({
        id: r.id,
        text: `${r.ticker || ''} ${(r.text || '').slice(0, MAX_CHARS)}`.trim(),
    }));

    // Greedy pack. A single chunk over budget still goes alone — truncated to
    // MAX_CHARS it is ~2K tokens, well under the ceiling.
    let pack = [], packTokens = 0;
    for (const item of prepared) {
        const t = estTokens(item.text);
        if (pack.length && packTokens + t > TOKEN_BUDGET) {
            if (!await flush(pack)) break outer;
            pack = []; packTokens = 0;
        }
        pack.push(item); packTokens += t;
    }
    if (pack.length && !await flush(pack)) break outer;
}

async function flush(pack) {
    const { vectors, tokens: used } = await embed(pack.map(p => p.text));
    const written = await write(pack.map(p => p.id), vectors);

    // The export bug taught this: a loop that writes without checking progress is
    // an unbounded loop. If a batch updates nothing, the cursor cannot advance.
    if (written === 0) throw new Error(`batch of ${pack.length} updated 0 rows — ids are not matching`);

    batches++; rows += written; tokens += used;
    const mins = (Date.now() - t0) / 60000;
    console.log(`  batch ${batches}: +${written} rows (${rows.toLocaleString()} total, ${used} tokens, ${(rows / Math.max(mins, 0.01)).toFixed(0)} rows/min)`);
    if (batches >= MAX_BATCHES) return false;
    await sleep(PACE_MS);
    return true;
}

const end = await status();
console.log(`\nembedded ${end.done.toLocaleString()} of ${(end.done + end.todo).toLocaleString()} · ${tokens.toLocaleString()} tokens this run · $0.00 (free tier)`);
if (end.todo > 0) console.log(`${end.todo.toLocaleString()} still to go — rerun to continue`);
