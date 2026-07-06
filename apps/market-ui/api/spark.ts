import { sinaDailyBars } from './_sina.js';

// Batch 7-day sparklines via Yahoo's spark endpoint — one request for a whole
// page of symbols. Returns { [symbol]: number[] }, plus a `_source` sibling
// key (never a real ticker, so safe next to symbol keys) recording which
// symbols came from sina's daily-K fallback (V1.3; stooq is dead, see V1.1).
export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
  const { symbols, range = '7d', interval = '1d' } = req.query;
  if (!symbols) return res.status(400).json({ error: 'symbols required' });
  const symbolList = String(symbols).split(',').map((s) => s.trim());
  const out: Record<string, number[]> = {};
  const source: Record<string, string> = {};
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(String(symbols))}&range=${range}&interval=${interval}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const d = await r.json();
    for (const item of d?.spark?.result || []) {
      const closes = item?.response?.[0]?.indicators?.quote?.[0]?.close;
      if (Array.isArray(closes) && closes.length) {
        out[item.symbol] = closes.filter((n: any) => typeof n === 'number');
        source[item.symbol] = 'yahoo';
      }
    }
  } catch {
    // whole yahoo batch failed - every symbol below falls to sina
  }
  await Promise.all(
    symbolList.filter((s) => !out[s]).map(async (s) => {
      const bars = await sinaDailyBars(s);
      if (!bars) return;
      out[s] = bars.slice(-7).map((b) => parseFloat(b.c));
      source[s] = 'sina';
    })
  );
  res.json({ ...out, _source: source });
}
