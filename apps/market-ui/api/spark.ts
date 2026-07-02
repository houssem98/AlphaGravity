// Batch 7-day sparklines via Yahoo's spark endpoint — one request for a whole
// page of symbols. Returns { [symbol]: number[] }.
export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
  const { symbols, range = '7d', interval = '1d' } = req.query;
  if (!symbols) return res.status(400).json({ error: 'symbols required' });
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(String(symbols))}&range=${range}&interval=${interval}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const d = await r.json();
    const out: Record<string, number[]> = {};
    for (const item of d?.spark?.result || []) {
      const closes = item?.response?.[0]?.indicators?.quote?.[0]?.close;
      if (Array.isArray(closes)) out[item.symbol] = closes.filter((n: any) => typeof n === 'number');
    }
    res.json(out);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
