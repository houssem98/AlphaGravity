// Sina US-quote fallback (V1.1-proven, gb_ feed). Index tickers need the
// hand-mapped sina symbol; plain tickers translate as `gb_<lowercased, no . or ->`.
// gb_ feed has no working Russell 2000 symbol (probed, none of the guesses
// returned data) so ^RUT has no fallback — stays shadow-safe (falls through null).
const SINA_INDEX_MAP: Record<string, string> = {
  '^GSPC': 'gb_$inx',
  '^IXIC': 'gb_$ixic',
  '^DJI': 'gb_$dji',
};

function sinaSymbol(sym: string): string | null {
  if (sym.startsWith('^')) return SINA_INDEX_MAP[sym] || null;
  return `gb_${sym.toLowerCase().replace(/[.-]/g, '')}`;
}

async function fetchSina(sym: string) {
  const sSym = sinaSymbol(sym);
  if (!sSym) return null;
  const r = await fetch(`http://hq.sinajs.cn/list=${sSym}`, {
    headers: { Referer: 'https://finance.sina.com.cn' },
  });
  const text = await r.text();
  const m = text.match(/="([^"]*)"/);
  if (!m || !m[1]) return null;
  const f = m[1].split(',');
  const price = parseFloat(f[1]);
  // f[26] is the stable prevClose in both pre-market and regular session
  // (f[21] blanks to 0 once regular session starts - verified against two
  // live snapshots 12min apart before shipping this).
  const prevClose = parseFloat(f[26]);
  if (!price || !prevClose) return null;
  return {
    symbol: sym,
    regularMarketPrice: price,
    regularMarketChangePercent: ((price - prevClose) / prevClose) * 100,
    marketCap: parseFloat(f[12]) || 0,
    regularMarketVolume: parseFloat(f[11]) || 0,
    source: 'sina',
  };
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: 'symbols required' });
  try {
    const all = await Promise.all(
      String(symbols).split(',').map(async (sym) => {
        const s = sym.trim();
        try {
          const r = await fetch(
            `https://query1.finance.yahoo.com/v8/finance/chart/${s}?interval=1d&range=1d`,
            { headers: { 'User-Agent': 'Mozilla/5.0' } }
          );
          const d = await r.json();
          const q = d?.chart?.result?.[0]?.meta;
          if (!q) throw new Error('empty yahoo meta');
          return {
            symbol: s,
            regularMarketPrice: q.regularMarketPrice,
            regularMarketChangePercent: ((q.regularMarketPrice - q.chartPreviousClose) / q.chartPreviousClose) * 100,
            marketCap: q.marketCap || 0,
            regularMarketVolume: q.regularMarketVolume || 0,
            source: 'yahoo',
          };
        } catch {
          return fetchSina(s);
        }
      })
    );
    res.json({ quoteResponse: { result: all.filter(Boolean) } });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
