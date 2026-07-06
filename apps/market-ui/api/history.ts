import { sinaDailyBars } from './_sina.js';

// Trading-day counts to approximate a Yahoo `range` when slicing sina's
// full (40y) daily history. Falls back to ~1y for unknown ranges.
const RANGE_DAYS: Record<string, number> = {
  '1mo': 22, '3mo': 63, '6mo': 126, '1y': 252, '2y': 504, '5y': 1260, '10y': 2520,
};

async function fallbackHistory(symbol: string, range: string) {
  const bars = await sinaDailyBars(symbol);
  if (!bars) return null;
  const slice = bars.slice(-(RANGE_DAYS[range] || 252));
  return {
    chart: {
      result: [{
        timestamp: slice.map((b) => Math.floor(new Date(`${b.d}T00:00:00Z`).getTime() / 1000)),
        indicators: { quote: [{
          open: slice.map((b) => parseFloat(b.o)),
          high: slice.map((b) => parseFloat(b.h)),
          low: slice.map((b) => parseFloat(b.l)),
          close: slice.map((b) => parseFloat(b.c)),
          volume: slice.map((b) => parseFloat(b.v)),
        }] },
      }],
    },
    source: 'sina',
  };
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { symbol, interval = '1d', range = '2y' } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const data = await r.json();
    const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    if (Array.isArray(closes) && closes.length) return res.json({ ...data, source: 'yahoo' });
    throw new Error('empty yahoo history');
  } catch {
    // sina's daily-K feed has no intraday granularity (EOD only, same gap
    // stooq had) so only daily requests can fall back.
    const fallback = interval === '1d' ? await fallbackHistory(String(symbol), String(range)) : null;
    if (fallback) return res.json(fallback);
    res.status(500).json({ error: 'history unavailable' });
  }
}
