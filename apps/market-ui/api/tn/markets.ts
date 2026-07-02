// Live BVMT (Bourse de Tunis) quotes via the exchange's public REST API.
// Cached 15 min at the CDN — BVMT is low-frequency, this is plenty fresh.
export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
  try {
    const r = await fetch(
      'https://www.bvmt.com.tn/rest_api/rest/market/groups/11,12,52,95,99',
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const d = await r.json();
    const rows = (d?.markets || [])
      .filter((m: any) => m?.referentiel?.ticker)
      .map((m: any) => ({
        symbol: m.referentiel.ticker,
        name: m.referentiel.stockName || m.referentiel.ticker,
        price: m.last || m.close || 0,
        changePct: m.change || 0, // BVMT `change` is already a percentage
        volume: m.volume || 0,
        isin: m.isin || m.referentiel.isin || null,
        seance: m.seance || null,
        open: m.open || 0,
        high: m.high || 0,
        low: m.low || 0,
        close: m.close || 0,           // previous session close
        turnover: m.caps || 0,         // traded value (TND)
        bid: m.limit?.bid || 0,        // L1 best bid
        ask: m.limit?.ask || 0,        // L1 best ask
        bidQty: m.limit?.bidQty || 0,
        askQty: m.limit?.askQty || 0,
      }))
      .filter((x: any) => x.price > 0);
    res.json({ rows, updated: rows[0]?.seance || null });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
