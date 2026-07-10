// Single Vercel function for all BVMT/Tunisia endpoints (Hobby 12-function cap).
// Dispatches on the path segment: /api/tn/markets | intraday | history | snapshot.
const UA = { 'User-Agent': 'Mozilla/5.0' };
const GROUPS = 'https://www.bvmt.com.tn/rest_api/rest/market/groups/11,12,52,95,99';
const FILE = 'tn_daily.json';

// ── Supabase Storage (JSON blob, no table/DDL) ──────────────────────────────
function store(file: string = FILE) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const h = { apikey: key!, Authorization: `Bearer ${key}` };
  return {
    async get() {
      const r = await fetch(`${url}/storage/v1/object/market-data/${file}`, { headers: h });
      return r.ok ? r.json() : {};
    },
    async put(body: any) {
      const r = await fetch(`${url}/storage/v1/object/market-data/${file}`, {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'max-age=0' },
        body: JSON.stringify(body),
      });
      return r.status;
    },
  };
}

// ── App-level stale-while-revalidate (Supabase Storage blob) ────────────────
// Vercel's edge cache is per-region and purged on every deploy, so cache-miss
// requests used to run the BVMT fetch + Grafana full scans inline — the "TN
// freeze" (5-15s spinner). This layer serves the last-known-good blob instantly
// (one ~100ms storage GET) and refreshes it in the background: after the first
// ever request, no user ever waits on BVMT/Grafana again.
function waitUntil(p: Promise<any>) {
  // Same mechanism @vercel/functions' waitUntil uses, without the dependency.
  const ctx = (globalThis as any)[Symbol.for('@vercel/request-context')]?.get?.();
  const q = p.catch(() => {});
  if (ctx?.waitUntil) ctx.waitUntil(q);
}
async function cached<T>(file: string, ttlSec: number, compute: () => Promise<T>, usable: (d: T) => boolean): Promise<T> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return compute();
  const s = store(file);
  const refresh = async () => {
    const d = await compute();
    if (usable(d)) await s.put({ _t: Date.now(), d }); // never cache an empty/bad payload
    return d;
  };
  const blob: any = await s.get().catch(() => null);
  if (blob?._t && usable(blob.d)) {
    if (Date.now() - blob._t > ttlSec * 1000) waitUntil(refresh());
    return blob.d;
  }
  return refresh();
}

// BVMT's public REST board intermittently returns an empty markets[] even
// mid-session. When it does, rebuild the same shape from the exchange's Grafana
// datasource so every downstream route (markets/intraday/engine/fundamentals/
// snapshot, all of which call groups()) keeps working. Defined below near gquery.
async function groups() {
  try {
    const r = await fetch(GROUPS, { headers: UA, signal: AbortSignal.timeout(2500) });
    const d = await r.json();
    if (d?.markets?.length) return d;
  } catch { /* BVMT hung or unparseable → Grafana */ }
  return grafanaGroups();
}
async function resolveIsin(symbol: string, g?: any) {
  g = g || await groups();
  const row = (g?.markets || []).find((m: any) => m?.referentiel?.ticker?.toUpperCase() === symbol);
  return { isin: row?.isin || row?.referentiel?.isin || '', name: row?.referentiel?.stockName || symbol, row };
}
const round = (v: number) => Math.round(v * 1000) / 1000;
const hms = (t: string) => { const [h = '0', m = '0', s = '0'] = String(t).split(':'); return +h * 3600 + +m * 60 + +s; };

// OPEN QUESTION: which of BVMT's `limit.bid`/`limit.ask` is really the bid?
// Closed-session payloads are contradictory (TINV raw bid<ask = sane; BIAT/SFBT/AB
// crossed with one side == last = stale auction leftovers), so we do NOT map sides —
// we enforce the book invariant: bid = lower price, ask = higher, qty follows its
// price, a zero side is no quote (null). spread = ask − bid is ≥ 0 by construction.
// Re-verify true field semantics against a LIVE session payload (Mon–Fri
// 09:00–14:00 Tunis) before ever "correcting" sides again.
function book(l: any) {
  const s1 = { price: l?.bid || 0, qty: l?.bidQty || 0 };
  const s2 = { price: l?.ask || 0, qty: l?.askQty || 0 };
  const [lo, hi] = s1.price <= s2.price ? [s1, s2] : [s2, s1];
  return {
    bid: lo.price > 0 ? lo.price : null,
    bidQty: lo.price > 0 ? lo.qty : null,
    ask: hi.price > 0 ? hi.price : null,
    askQty: hi.price > 0 ? hi.qty : null,
  };
}

// ── Live quotes for the whole board ─────────────────────────────────────────
async function markets(_req: any, res: any) {
  const data = await cached('tn_markets.json', 120, async () => {
    const d = await groups();
    const rows = (d?.markets || [])
      .filter((m: any) => m?.referentiel?.ticker)
      .map((m: any) => ({
        symbol: m.referentiel.ticker,
        name: m.referentiel.stockName || m.referentiel.ticker,
        price: m.last || m.close || 0,
        changePct: m.change || 0,
        volume: m.volume || 0,
        isin: m.isin || m.referentiel.isin || null,
        seance: m.seance || null,
        open: m.open || 0,
        high: m.high || 0,
        low: m.low || 0,
        close: m.close || 0,
        turnover: m.caps || 0,
        ...book(m.limit),
      }))
      .filter((x: any) => x.price > 0);
    return { rows, updated: rows[0]?.seance || null };
  }, (x) => x.rows.length > 0);
  // Never edge-cache an empty board — a single bad moment must not freeze the
  // market for the full TTL. Short TTL when populated so live quotes stay fresh.
  res.setHeader('Cache-Control', data.rows.length ? 's-maxage=120, stale-while-revalidate=600' : 'no-store');
  res.json(data);
}

// ── Intraday tick series → points + OHLC candles ────────────────────────────
async function intraday(req: any, res: any) {
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=600');
  const symbol = String(req.query.symbol || '').toUpperCase();
  let isin = String(req.query.isin || ''), name = symbol;
  if (!symbol && !isin) return res.status(400).json({ error: 'symbol or isin required' });
  // Session bounds = min/max last-update time across the whole board (data-derived,
  // never hardcoded exchange hours). Only available when we fetch groups anyway.
  let session: [number, number] | null = null;
  if (!isin) {
    const g = await groups();
    const r = await resolveIsin(symbol, g);
    if (!r.isin) return res.status(404).json({ error: `unknown ticker ${symbol}` });
    isin = r.isin; name = r.name;
    const secs = (g?.markets || []).map((m: any) => hms(m?.time || '')).filter((s: number) => s > 0);
    if (secs.length) session = [Math.min(...secs), Math.max(...secs)];
  }

  const d = await (await fetch(`https://www.bvmt.com.tn/rest_api/rest/intraday/${isin}`, { headers: UA, signal: AbortSignal.timeout(6000) })).json();
  const raw = (d?.intradays || []).filter((p: any) => p?.last > 0 && p?.time);
  const base = raw.find((p: any) => p.time === '00:00:00');
  const prevClose = base?.last ?? raw[0]?.last ?? 0;

  const dayStart = Math.floor(Date.now() / 86400_000) * 86400;
  const bySec = new Map<number, { time: number; value: number; volume: number }>();
  for (const p of raw) {
    if (p.time === '00:00:00') continue;
    const time = dayStart + hms(p.time);
    const prev = bySec.get(time);
    bySec.set(time, { time, value: p.last, volume: (prev?.volume || 0) + (p.volume || 0) });
  }
  const points = [...bySec.values()].sort((a, b) => a.time - b.time);
  const last = points.length ? points[points.length - 1].value : prevClose;

  const iv = Math.max(1, Math.min(60, +req.query.interval || 5)), step = iv * 60;
  const buckets = new Map<number, any>();
  for (const p of points) {
    const t = Math.floor(p.time / step) * step;
    const b = buckets.get(t);
    if (!b) buckets.set(t, { time: t, open: p.value, high: p.value, low: p.value, close: p.value, volume: p.volume });
    else { b.high = Math.max(b.high, p.value); b.low = Math.min(b.low, p.value); b.close = p.value; b.volume += p.volume; }
  }
  const candles = [...buckets.values()].sort((a, b) => a.time - b.time);
  res.json({
    symbol, name, isin, prevClose, last, interval: iv,
    changePct: prevClose ? ((last - prevClose) / prevClose) * 100 : 0,
    seance: d?.intradays?.[0]?.seance || null, points, candles,
    sessionStart: session ? dayStart + session[0] : null,
    sessionEnd: session ? dayStart + session[1] : null,
  });
}

// ── Daily candles — real OHLC aggregated from the exchange's raw_market ──────
// (~5 months of intraday snapshots → one bar per session). Live, always current.
async function fetchDailyBars(isin: string) {
  const sql =
    `SELECT d, max(price) hi, min(price) lo, (array_agg(price ORDER BY t))[1] op, (array_agg(price ORDER BY t DESC))[1] cl, max(qty) vol FROM (` +
    `SELECT raw_data->>'dateSeance' d, raw_data->>'time' t, (raw_data->>'lastTradePrice')::float price, (raw_data->>'quantity')::float qty ` +
    `FROM raw_market WHERE raw_data->>'codeIsin'='${isin}' AND raw_data->>'lastTradePrice' IS NOT NULL) x GROUP BY d ORDER BY d`;
  const rows = await gqueryTable(sql);
  return rows
    .filter((r) => r.d && r.cl != null)
    .map((r) => ({ date: r.d as string, open: r.op, high: r.hi, low: r.lo, close: r.cl, volume: r.vol || 0 }));
}

async function history(req: any, res: any) {
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
  const symbol = String(req.query.symbol || '').toUpperCase();
  let isin = String(req.query.isin || '');
  if (!symbol && !isin) return res.status(400).json({ error: 'symbol or isin required' });
  if (!isin) { const r = await resolveIsin(symbol); if (!r.isin) return res.status(404).json({ error: `unknown ticker ${symbol}` }); isin = r.isin; }
  if (!/^[A-Z0-9]+$/.test(isin)) return res.status(400).json({ error: 'bad isin' });

  const candles = await cached(`tn_hist_${isin}.json`, 1800, async () => {
    const bars = await fetchDailyBars(isin);
    return bars.map((b) => ({ time: Math.floor(Date.parse(b.date) / 1000), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));
  }, (x) => x.length > 0);
  res.json({ symbol, isin, candles });
}

// ── V2 factor library (Vibe-Trading harvest) — pure functions over the daily
// bars fetchDailyBars() already builds. raw_market only spans ~5-6 months
// (see `highs()` above), so these are proxies at the horizons our data
// actually supports, not the papers' literal 12mo/52wk windows.
type Bar = { date: string; open: number; high: number; low: number; close: number; volume: number };

// Momentum — Carhart (1997) four-factor model's momentum factor: trailing
// return predicts continuation. Formal window is 12mo skip-1mo; we use
// 20d/60d trailing-return proxies (the horizons our ~5-6mo history supports).
// Hand-checked 2026-07-06: BIAT mom20d=5.33%, mom60d=19.25%, TINV
// mom20d=29.49%, mom60d=27.77% — each equals (close[t]/close[t-n]-1)*100
// verified by hand against the printed closes.
function momentum(bars: Bar[], days: number): number | null {
  if (bars.length <= days) return null;
  const now = bars[bars.length - 1].close, then = bars[bars.length - 1 - days].close;
  return then ? ((now / then) - 1) * 100 : null;
}

// Short-term reversal — Jegadeesh (1990): a high trailing return predicts a
// LOWER near-term return (opposite sign to momentum). Returns the raw 5d
// return; the score mapping (V2.2) inverts it. Hand-checked: BIAT
// rev5d=5.68%, TINV rev5d=6.18%.
function reversal5d(bars: Bar[]): number | null {
  return momentum(bars, 5);
}

// 52-week-high proximity — George & Hwang (2004): price near its period high
// predicts continuation. "Period" here is raw_market's ~5-6mo window (same
// documented gap as the `highs()` route), not a literal 52 weeks. Hand-
// checked: BIAT last/high=168.5/173=0.9740, TINV=53.09/53.82=0.9864.
function highProximity(bars: Bar[]): number | null {
  if (!bars.length) return null;
  const last = bars[bars.length - 1].close;
  const hi = Math.max(...bars.map((b) => b.high));
  return hi ? last / hi : null;
}

// Amihud (2002) illiquidity: mean(|daily return| / dollar volume). No
// currency-turnover field on this feed, so close*volume(shares) is the
// standard proxy dollar-volume. Hand-checked 2026-07-06: BIAT=2.47e-8 vs
// TINV=1.50e-5 — TINV ~600x less liquid, correctly flagging the thin name
// the paper targets (TINV's last session traded only 15 shares).
function amihud(bars: Bar[]): number | null {
  const ratios: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].close, cur = bars[i].close, vol = bars[i].volume;
    const dollarVol = cur * vol;
    if (prev && dollarVol > 0) ratios.push(Math.abs(cur / prev - 1) / dollarVol);
  }
  return ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null;
}

// ── Daily close snapshot (Vercel Cron) ──────────────────────────────────────
async function snapshot(req: any, res: any) {
  const secret = process.env.CRON_SECRET;
  const ok = !secret || req.headers.authorization === `Bearer ${secret}` || req.query.key === secret;
  if (!ok) return res.status(401).json({ error: 'unauthorized' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'supabase env missing' });

  const now = new Date(), dow = now.getUTCDay();
  if ((dow === 0 || dow === 6) && req.query.force !== '1') return res.json({ skipped: 'weekend', date: now.toISOString().slice(0, 10) });

  const g = await groups();
  const date = now.toISOString().slice(0, 10);
  const s = store();
  const blob = await s.get();
  let n = 0;
  for (const m of g?.markets || []) {
    const isin = m.isin || m.referentiel?.isin;
    const last = m.last || m.close || 0;
    if (!isin || last <= 0) continue;
    const prev = m.close || last, high = m.high || last, low = m.low || last;
    blob[isin] = blob[isin] || { s: m.referentiel?.ticker || isin, b: {} };
    blob[isin].b[date] = [round(prev), round(high), round(low), round(last), m.volume || 0];
    n++;
  }
  const code = await s.put(blob);
  res.json({ ok: code === 200, date, stocks: n, storage: code });
}

// ── Engine: deterministic multi-factor score (0–100) ────────────────────────
// Momentum (day change), Volume activity (turnover vs board), Liquidity
// (spread + book presence), News tone (FR/EN lexicon over Tunisian press).
// No LLM, no black box — every factor traceable to its inputs.
const POS = ['hausse', 'progress', 'bénéfice', 'benefice', 'croissance', 'record', 'gain', 'succès', 'succes', 'dividende', 'surperform', 'rachat', 'accord', 'partenariat', 'expansion', 'profit', 'surge', 'rise', 'beat', 'growth', 'upgrade', 'strong', 'jump'];
const NEG = ['baisse', 'perte', 'chute', 'recul', 'déficit', 'deficit', 'sanction', 'litige', 'dette', 'défaut', 'defaut', 'fraude', 'enquête', 'enquete', 'suspension', 'avertissement', 'downgrade', 'drop', 'fall', 'loss', 'weak', 'plunge', 'probe', 'warning'];
const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

// ── Firecrawl (optional): article body → clean markdown for full-text news tone ─
// Inert (null) without FIRECRAWL_API_KEY; bounded timeout so it never stalls the
// engine route; best-effort — any failure returns null and we fall back to titles.
const FIRECRAWL = process.env.FIRECRAWL_API_KEY;
async function firecrawlScrape(url: string): Promise<string | null> {
  if (!FIRECRAWL || !url) return null;
  try {
    const r = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${FIRECRAWL}` },
      body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true, timeout: 8000 }),
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return null;
    return (await r.json())?.data?.markdown || null;
  } catch { return null; }
}
// Firecrawl web search → real article URLs + snippets. [] without a key / on failure.
async function firecrawlSearch(query: string, limit = 6): Promise<Array<{ title: string; url: string; content: string }>> {
  if (!FIRECRAWL || !query) return [];
  try {
    const r = await fetch('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${FIRECRAWL}` },
      body: JSON.stringify({ query, limit }),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return [];
    return ((await r.json())?.data || [])
      .map((d: any) => ({ title: d.title || d.url, url: d.url, content: d.description || d.markdown || '' }))
      .filter((x: any) => x.url);
  } catch { return []; }
}
// Net lexicon tone of a text blob → +1 bull / -1 bear / 0 neutral.
function toneSign(text: string): number {
  const lo = text.toLowerCase();
  let s = 0;
  for (const w of POS) if (lo.includes(w)) s++;
  for (const w of NEG) if (lo.includes(w)) s--;
  return s > 0 ? 1 : s < 0 ? -1 : 0;
}

// One-shot LLM sentiment over scraped article text → {tone:-1..1, reason}. Null
// without DEEPSEEK_API_KEY or on failure — caller keeps the lexicon score.
const DEEPSEEK = process.env.DEEPSEEK_API_KEY;
async function deepseekTone(name: string, text: string): Promise<{ tone: number; reason: string } | null> {
  if (!DEEPSEEK || !text) return null;
  try {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK}` },
      body: JSON.stringify({
        model: 'deepseek-chat', temperature: 0.2, max_tokens: 60,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content:
          `Overall investor sentiment for ${name} (Tunis Stock Exchange) from these press excerpts. ` +
          `Reply JSON {"tone": number in -1..1, "reason": "<=8 words"}.\n\n` + text.slice(0, 6000) }],
      }),
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return null;
    const c = JSON.parse((await r.json())?.choices?.[0]?.message?.content || '{}');
    const tone = Math.max(-1, Math.min(1, Number(c.tone)));
    if (Number.isNaN(tone)) return null;
    return { tone, reason: String(c.reason || '').slice(0, 60) };
  } catch { return null; }
}

async function engine(req: any, res: any) {
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
  const symbol = String(req.query.symbol || '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  const g = await groups();
  const { isin, name, row } = await resolveIsin(symbol, g);
  if (!row) return res.status(404).json({ error: `unknown ticker ${symbol}` });

  const price = row.last || row.close || 0;
  const changePct = row.change || 0;
  const turnover = row.caps || 0;
  const { bid, ask } = book(row.limit);

  // Momentum: ±3% day move maps to 0..100 around 50.
  const momentumScore = clamp(50 + (changePct / 3) * 50);

  // V2.2 historical factors from the factor library above (daily bars out of
  // raw_market). Any factor with too little history stays neutral 50 and its
  // detail says so — deterministic, no renormalizing.
  let bars: Bar[] = [];
  try { bars = await fetchDailyBars(isin); } catch { /* neutral factors */ }
  const m20 = momentum(bars, 20), m60 = momentum(bars, 60);
  const rev = reversal5d(bars);
  const hp = highProximity(bars);
  const illiq = amihud(bars);
  const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

  // Trend (Carhart 1997): ±20% 20d / ±30% 60d trailing returns → 0..100, averaged.
  const t20 = m20 === null ? null : clamp(50 + (m20 / 20) * 50);
  const t60 = m60 === null ? null : clamp(50 + (m60 / 30) * 50);
  const tParts = [t20, t60].filter((v): v is number => v !== null);
  const trend = tParts.length ? clamp(tParts.reduce((a, b) => a + b) / tParts.length) : 50;

  // Reversal (Jegadeesh 1990): INVERTED — high trailing 5d return scores low. ±8% → 100..0.
  const reversal = rev === null ? 50 : clamp(50 - (rev / 8) * 50);

  // Near-high (George & Hwang 2004): 80% of period high → 0, at the high → 100.
  const nearHigh = hp === null ? 50 : clamp(((hp - 0.8) / 0.2) * 100);

  // Illiquidity (Amihud 2002): log-scale — 1e-8 (deep book) → 100, 1e-4 (thin) → 0.
  const illiquidity = illiq === null || illiq <= 0 ? 50 : clamp(((-Math.log10(illiq) - 4) / 4) * 100);

  // Volume activity: this stock's turnover percentile across today's board.
  const turnovers = (g?.markets || []).map((m: any) => m.caps || 0).filter((t: number) => t > 0).sort((a: number, b: number) => a - b);
  const rank = turnovers.length ? turnovers.filter((t: number) => t <= turnover).length / turnovers.length : 0;
  const volumeScore = clamp(rank * 100);

  // Liquidity: tight spread = liquid. 0% spread→100, ≥4%→0; no book→25.
  const spreadPct = bid && ask && price ? ((ask - bid) / price) * 100 : null;
  const liquidity = spreadPct === null ? 25 : clamp(100 - (spreadPct / 4) * 100);

  // News tone: last-7d Tunisian press. Headlines always; when Firecrawl is
  // configured, scrape the top few article bodies and score the full text (a much
  // stronger signal than title keywords). Falls back to titles on any failure.
  let newsScore = 50, bulls = 0, bears = 0, headlines = 0, enriched = 0, newsReason = '';
  try {
    if (FIRECRAWL) {
      // Firecrawl search → real article URLs (Google News RSS links are google.com
      // redirect stubs that don't scrape), then scrape the top few bodies for
      // full-text tone; DeepSeek judges overall tone when configured.
      const top = (await firecrawlSearch(`${name} Bourse Tunis actualité`, 6)).slice(0, 4);
      const bodies = await Promise.all(top.map((f) => firecrawlScrape(f.url)));
      top.forEach((f, i) => {
        if (bodies[i]) enriched++;
        const sign = toneSign(bodies[i] || f.content || f.title);
        if (sign > 0) bulls++; else if (sign < 0) bears++;
      });
      headlines = top.length;
      if (headlines) newsScore = clamp(50 + ((bulls - bears) / headlines) * 50);
      const llm = enriched ? await deepseekTone(name, bodies.filter(Boolean).join('\n\n')) : null;
      if (llm) { newsScore = clamp(50 + llm.tone * 50); newsReason = llm.reason; }
    } else {
      // No Firecrawl → Google News RSS headline tone (lexicon).
      const q = encodeURIComponent(`${name} Bourse Tunis`);
      const xml = await (await fetch(`https://news.google.com/rss/search?q=${q}&hl=fr&gl=TN&ceid=TN:fr`, { headers: UA })).text();
      const titles = (xml.match(/<item>[\s\S]*?<\/item>/g) || []).slice(0, 24)
        .map((b) => (b.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
      headlines = titles.length;
      for (const t of titles) { const s = toneSign(t); if (s > 0) bulls++; else if (s < 0) bears++; }
      if (headlines) newsScore = clamp(50 + ((bulls - bears) / headlines) * 50);
    }
  } catch { /* keep neutral 50 */ }

  // Composite (V2.2): 4 live + 4 historical factors. Trend carries the most
  // weight (Carhart momentum is the best-documented of the set); live day
  // factors shrink to make room but still sum to half the score.
  const W = { momentum: 0.15, volume: 0.1, news: 0.15, liquidity: 0.1, trend: 0.2, reversal: 0.1, nearHigh: 0.1, illiquidity: 0.1 };
  const score = clamp(
    momentumScore * W.momentum + volumeScore * W.volume + newsScore * W.news + liquidity * W.liquidity +
    trend * W.trend + reversal * W.reversal + nearHigh * W.nearHigh + illiquidity * W.illiquidity);
  res.json({
    symbol, name, isin, price, changePct, score,
    label: score >= 65 ? 'bullish' : score <= 35 ? 'bearish' : 'neutral',
    factors: {
      momentum:    { score: momentumScore, detail: `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}% today` },
      volume:      { score: volumeScore,   detail: `top ${Math.max(1, Math.round(100 - rank * 100))}% of board by turnover` },
      news:        { score: newsScore,     detail: `${bulls} bull / ${bears} bear of ${headlines} ${FIRECRAWL ? 'sources' : 'headlines'} (7d)${enriched ? `, ${enriched} full-text` : ''}${newsReason ? ` — ${newsReason}` : ''}` },
      liquidity:   { score: liquidity,     detail: spreadPct === null ? 'no live book' : `${spreadPct.toFixed(2)}% spread` },
      trend:       { score: trend,         detail: m20 === null && m60 === null ? 'insufficient history' : `${m20 === null ? '—' : pct(m20)} 20d / ${m60 === null ? '—' : pct(m60)} 60d` },
      reversal:    { score: reversal,      detail: rev === null ? 'insufficient history' : `${pct(rev)} 5d trailing (inverted)` },
      nearHigh:    { score: nearHigh,      detail: hp === null ? 'insufficient history' : `${(hp * 100).toFixed(1)}% of period high` },
      illiquidity: { score: illiquidity,   detail: illiq === null ? 'insufficient history' : `Amihud ${illiq.toExponential(2)}` },
    },
    weights: W,
  });
}

// ── Official BVMT indices (TUNINDEX + sectors) ──────────────────────────────
// Source: the exchange's own public dashboard datasource (tunis-stockexchange.com
// Grafana, anonymous read). Same numbers their site publishes — read-only, cached.
const GRAFANA = 'https://tunis-stockexchange.com/grafana/api/ds/query';
const DS_UID = 'ef4kunff033eoe';

// Read-only query against the exchange's public dashboard datasource. Returns the
// first column of the first frame (we store rows as one JSON blob per row).
async function gquery(rawSql: string): Promise<any[]> {
  try {
    const r = await fetch(GRAFANA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: 'https://tunis-stockexchange.com/grafana/', 'User-Agent': 'Mozilla/5.0' },
      body: JSON.stringify({ queries: [{ refId: 'A', datasource: { uid: DS_UID, type: 'grafana-postgresql-datasource' }, rawSql, format: 'table' }] }),
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json();
    const raw = j?.results?.A?.frames?.[0]?.data?.values?.[0] || [];
    return raw.map((s: any) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
  } catch { return []; } // Grafana hung/unreachable → empty, never freeze the caller.
}

async function tnIndices() {
  return gquery('SELECT raw_data FROM indice_live WHERE ingested_at=(SELECT max(ingested_at) FROM indice_live)');
}

// Grafana-backed rebuild of BVMT's groups() board (equity mother-lines only),
// used when the BVMT REST endpoint returns an empty markets[]. Latest row per
// stock for the latest session; not-yet-traded names fall back to reference
// price (last close) with zero change — same as BVMT's off-session board.
async function grafanaGroups() {
  const [boardR, refsR] = await Promise.allSettled([
    // Prefer a row that actually has a trade price, then the latest trade time —
    // the exchange re-publishes a null-price pre-open snapshot late in the feed,
    // so ingested_at DESC would wrongly pick that over the real last trade.
    gquery(
      `SELECT DISTINCT ON (raw_data->>'codeIsin') raw_data FROM raw_market ` +
      `WHERE raw_data->>'dateSeance'=(SELECT max(raw_data->>'dateSeance') FROM raw_market) ` +
      `ORDER BY raw_data->>'codeIsin', (raw_data->>'lastTradePrice' IS NOT NULL) DESC, raw_data->>'time' DESC`),
    gquery(`SELECT raw_data FROM raw_referentiels WHERE raw_data->>'grp_description' LIKE 'Ligne M%re'`),
  ]);
  const board = boardR.status === 'fulfilled' ? boardR.value : [];
  const refs = refsR.status === 'fulfilled' ? refsR.value : [];
  // If the equity-universe query blipped, don't freeze the board — keep every
  // priced ticker rather than filtering to an empty set.
  const equity = new Set(refs.map((o: any) => o?.mnemo).filter(Boolean));
  const num = (v: any) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  const markets = board
    .filter((r: any) => r?.mnemo && (equity.size === 0 || equity.has(r.mnemo)))
    .map((r: any) => ({
      isin: r.codeIsin,
      last: num(r.lastTradePrice) || num(r.referencePrice),
      close: num(r.referencePrice), open: num(r.openPrice),
      high: num(r.pHaut), low: num(r.pbas),
      change: num(r.varLastPrice), volume: num(r.quantity), caps: num(r.capit),
      seance: r.dateSeance, time: String(r.time || '').slice(11, 19),
      limit: { bid: num(r.bidPrice), bidQty: num(r.bidVol), ask: num(r.askPrice), askQty: num(r.askVol) },
      referentiel: { ticker: r.mnemo, stockName: r.fullInstrumentName || r.mnemo, isin: r.codeIsin },
    }));
  return { markets };
}

// Column-oriented query → array of row objects (for aggregations, not JSON blobs).
async function gqueryTable(rawSql: string): Promise<any[]> {
  try {
    const r = await fetch(GRAFANA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: 'https://tunis-stockexchange.com/grafana/', 'User-Agent': 'Mozilla/5.0' },
      body: JSON.stringify({ queries: [{ refId: 'A', datasource: { uid: DS_UID, type: 'grafana-postgresql-datasource' }, rawSql, format: 'table' }] }),
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json();
    const frame = j?.results?.A?.frames?.[0];
    const cols: string[] = (frame?.schema?.fields || []).map((f: any) => f.name);
    const vals: any[][] = frame?.data?.values || [];
    if (!cols.length || !vals.length) return [];
    return vals[0].map((_: any, i: number) => Object.fromEntries(cols.map((c, ci) => [c, vals[ci][i]])));
  } catch { return []; } // Grafana hung/unreachable → empty, never freeze the caller.
}

async function index(_req: any, res: any) {
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
  const data = await cached('tn_index.json', 120, async () => {
    const [rows, statRows] = await Promise.all([
      tnIndices(),
      gquery('SELECT raw_data FROM raw_market_statistics ORDER BY ingested_at DESC LIMIT 1'),
    ]);
    const indices = rows.map((o: any) => ({
      name: o.fullIndiceName,
      level: parseFloat(o.indexLevel),
      changePct: parseFloat(o.varLastPrice),
      yearPct: o.yearlyVariation ?? null,
      high: parseFloat(o.dailyHigh) || null,
      low: parseFloat(o.dailyLow) || null,
      prevClose: parseFloat(o.prevcDayClose) || null,
      isin: o.codeIsin || null,
      seance: o.dateSeance || null,
    }));
    const tunindex = indices.find((i: any) => i.name === 'TUNINDEX') || null;
    const s = statRows[0] || {};
    const stats = Object.keys(s).length ? {
      marketCap: parseFloat(s.capi) || null,
      advancers: s.hausses ?? null,
      decliners: s.baisses ?? null,
      turnover: s.capitaux ?? null,
      volume: s.quantite ?? null,
      trades: s.transactions ?? null,
      listed: s.nbSocieteCote ?? null,
      active: s.nbSocieteActives ?? null,
    } : null;
    return { tunindex, indices, stats };
  }, (x) => x.indices.length > 0);
  res.json(data);
}

// ── Daily Brief (written by the Hermes agent, see agents/hermes/scripts/
// tn_daily_brief.py; H4.1) — reads the rolling blob, serves latest or a
// requested date. Read-only here; the agent is the only writer.
async function brief(req: any, res: any) {
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
  const s = store('tn_brief.json');
  const blob = await s.get();
  const entries = blob.entries || {};
  const dates = Object.keys(entries).sort();
  if (!dates.length) return res.json({ brief: null });
  const date = String(req.query.date || '') || dates[dates.length - 1];
  res.json({ brief: entries[date] || null, available: dates });
}

// ── Reference data: sector + shares outstanding (→ market cap) ───────────────
// From the exchange's `raw_referentiels` (equity "mother line" per issuer).
// Ref data is near-static → cache a day. Keyed by ticker (mnemo).
async function ref(_req: any, res: any) {
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  const out = await cached('tn_ref.json', 86400, async () => {
    const [rows, comp] = await Promise.all([
      gquery("SELECT raw_data FROM raw_referentiels WHERE raw_data->>'grp_description' LIKE 'Ligne M%re'"),
      gquery('SELECT raw_data FROM raw_composition_indices'),
    ]);
    const byTicker: Record<string, any> = {};
    for (const c of comp) if (c?.mnemonic) byTicker[c.mnemonic] = c;
    const m: Record<string, any> = {};
    for (const o of rows) {
      if (!o?.mnemo) continue;
      const c = byTicker[o.mnemo];
      m[o.mnemo] = {
        sector: o.secteur || null,
        issuer: o.emetteur || null,
        isin: o.codeEmetteur || null,
        shares: parseInt(o.nb_titres_emis, 10) || null,
        nominal: parseFloat(o.nominal) || null,
        listingDate: o.date_de_cotation || null,
        market: o.marche_De_Negociation || o.marche || null,
        freeFloat: c?.flottantArrondiDixPourcent ?? null,   // fraction (0.3 = 30%)
        inTunindex: c ? !!c.tunIndex : null,
        inTunindex20: c ? !!c.tunIndex20 : null,
      };
    }
    return m;
  }, (x) => Object.keys(x).length > 0);
  res.json({ ref: out });
}

// ── Period high/low monitor (breakouts) from raw_market ─────────────────────
// Per stock over its ~5-month history: high, low, last, and how close to the
// high (ratio). Only stocks with ≥20 trading days count (thin names excluded).
async function highs(_req: any, res: any) {
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
  const out = await cached('tn_highs.json', 3600, async () => {
    const sql =
      `SELECT codeisin, max(price) hi, min(price) lo, (array_agg(price ORDER BY t DESC))[1] last, count(DISTINCT d) days FROM (` +
      `SELECT raw_data->>'codeIsin' codeisin, raw_data->>'time' t, raw_data->>'dateSeance' d, (raw_data->>'lastTradePrice')::float price ` +
      `FROM raw_market WHERE raw_data->>'lastTradePrice' IS NOT NULL) x GROUP BY codeisin HAVING count(DISTINCT d) >= 20`;
    const rows = await gqueryTable(sql);
    const m: Record<string, any> = {};
    for (const r of rows) {
      if (!r.codeisin || !r.hi || !r.last) continue;
      m[r.codeisin] = {
        high: r.hi, low: r.lo, last: r.last, days: r.days,
        highRatio: r.hi ? r.last / r.hi : 0,
        lowRatio: r.lo ? r.last / r.lo : 0,
      };
    }
    return m;
  }, (x) => Object.keys(x).length > 0);
  res.json({ byIsin: out });
}

// ── Fundamentals (PER/EPS/dividend/yield) from the extraction blob ───────────
// Populated offline by scripts/tn_fundamentals.py (PDF → LLM → ratios). Empty
// until that runs; PER/yield are recomputed here against the live price.
async function fundamentals(req: any, res: any) {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  const symbol = String(req.query.symbol || '').toUpperCase();
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(500).json({ error: 'supabase env missing' });
  const r = await fetch(`${url}/storage/v1/object/market-data/tn_fundamentals.json`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  const blob = r.ok ? await r.json() : {};
  if (symbol) {
    const f = blob[symbol] || null;
    if (f && f.eps) {
      // Refresh price-relative ratios against today's quote.
      const g = await groups();
      const row = (g?.markets || []).find((m: any) => m?.referentiel?.ticker?.toUpperCase() === symbol);
      const price = row?.last || row?.close || 0;
      if (price) { f.per = f.eps ? price / f.eps : null; if (f.dividend) f.yield = (f.dividend / price) * 100; }
      // Equity extraction is noisier than net income — drop implausible P/B.
      if (f.pb != null && (f.pb < 0.2 || f.pb > 12)) f.pb = null;
    }
    return res.json({ symbol, fundamentals: f });
  }
  res.json({ fundamentals: blob });
}

// One bulk query for every stock's last ~10 sessions (grouped by isin+date), instead
// of one round-trip per stock — same full-scan pattern as highs() above, proven to
// come back fast. Returns isin -> closes (oldest→newest, capped to the last 7).
async function fetchRecentCloses(): Promise<Record<string, number[]>> {
  const sql =
    `SELECT codeisin, d, (array_agg(price ORDER BY t DESC))[1] cl FROM (` +
    `SELECT raw_data->>'codeIsin' codeisin, raw_data->>'dateSeance' d, raw_data->>'time' t, (raw_data->>'lastTradePrice')::float price ` +
    `FROM raw_market WHERE raw_data->>'lastTradePrice' IS NOT NULL) x GROUP BY codeisin, d ORDER BY codeisin, d`;
  const rows = await gqueryTable(sql);
  const byIsin = new Map<string, { d: string; cl: number }[]>();
  for (const r of rows) {
    if (!r.codeisin || r.cl == null) continue;
    (byIsin.get(r.codeisin) || byIsin.set(r.codeisin, []).get(r.codeisin)!).push({ d: r.d, cl: r.cl });
  }
  const out: Record<string, number[]> = {};
  for (const [isin, days] of byIsin) out[isin] = days.sort((a, b) => a.d.localeCompare(b.d)).slice(-7).map((x) => x.cl);
  return out;
}

// Ticker -> shares outstanding, for real market cap (price × shares). `m.caps` on
// the live board is today's turnover (trading value), NOT shares — using it for
// market cap would be nonsense.
async function fetchShares(): Promise<Record<string, number>> {
  const rows = await gquery("SELECT raw_data FROM raw_referentiels WHERE raw_data->>'grp_description' LIKE 'Ligne M%re'");
  const out: Record<string, number> = {};
  for (const o of rows) { const n = parseInt(o?.nb_titres_emis, 10); if (o?.mnemo && n) out[o.mnemo] = n; }
  return out;
}

// ── Board table: all 77 stocks + 7D closes (crypto-style rich table) ─────────
async function board(_req: any, res: any) {
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
  const out = await cached('tn_board.json', 180, async () => {
    const [d, closesByIsin, sharesByTicker] = await Promise.all([
      groups(),
      fetchRecentCloses().catch(() => ({} as Record<string, number[]>)),
      fetchShares().catch(() => ({} as Record<string, number>)),
    ]);
    const rows = (d?.markets || []).filter((m: any) => m?.referentiel?.ticker && m.last);
    return rows.map((m: any) => {
      const closes = closesByIsin[m.isin] || [];
      const change7d = closes.length > 1 ? ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100 : 0;
      const shares = sharesByTicker[m.referentiel.ticker] || 0;
      return {
        symbol: m.referentiel.ticker, name: m.referentiel.stockName || m.referentiel.ticker,
        price: m.last || 0, changePct: m.change || 0, change7d,
        marketCap: shares ? (m.last || 0) * shares : 0, volume: m.volume || 0,
        turnover: m.caps || 0, shares, isin: m.isin,
        closes,
      };
    }).sort((a: any, b: any) => (b.marketCap || 0) - (a.marketCap || 0));
  }, (x) => x.length > 0);
  res.json({ board: out });
}

// ── Firecrawl web search (deep-research web sourcing) ───────────────────────
// Key-safe server proxy; lives in this dispatcher because it's the only Vercel
// function excluded from the Fly rewrite. Inert ({results:[]}) without a key.
async function websearch(req: any, res: any) {
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=1800');
  const q = String(req.query.q || '');
  const limit = Math.min(10, Math.max(1, +req.query.limit || 6));
  const results = (await firecrawlSearch(q, limit)).map((d) => ({ ...d, score: 0.6 }));
  res.json({ results });
}

const ROUTES: Record<string, (req: any, res: any) => Promise<any>> = { markets, intraday, history, snapshot, engine, index, ref, highs, fundamentals, brief, websearch, board };

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const fn = String(req.query.fn || '');
  const route = ROUTES[fn];
  if (!route) return res.status(404).json({ error: `unknown tn endpoint: ${fn}` });
  try { await route(req, res); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
}
