// Real news via Google News RSS. Region-aware: TN listings query in French
// against the Tunisian edition; everything else defaults to English.
const UA = { 'User-Agent': 'Mozilla/5.0' };

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return '';
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
}

// CP-6: crypto source whitelist (?wl=crypto) — matched against the RSS source
// name, lowercased. Filtered-to-zero is an honest empty, not an error.
const CRYPTO_WL = [
  'coindesk', 'cointelegraph', 'the block', 'theblock', 'decrypt', 'bloomberg',
  'reuters', 'cnbc', 'forbes', 'wall street journal', 'wsj', 'financial times',
  'business insider', 'coingecko', 'binance',
];

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
  const q = String(req.query.q || '').trim();
  const region = String(req.query.region || 'us');
  const wl = String(req.query.wl || '');
  if (!q) return res.status(400).json({ error: 'q required' });
  const [hl, gl] = region === 'tn' ? ['fr', 'TN'] : ['en', 'US'];
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${gl}:${hl}`;
    const xml = await (await fetch(url, { headers: UA })).text();
    let items = (xml.match(/<item>[\s\S]*?<\/item>/g) || []).slice(0, 48).map((b) => {
      const rawTitle = tag(b, 'title');
      const source = tag(b, 'source');
      // Google appends " - Source" to titles; strip it when we already have the source.
      const title = source && rawTitle.endsWith(` - ${source}`)
        ? rawTitle.slice(0, -(source.length + 3)) : rawTitle;
      return { title, url: tag(b, 'link'), source: source || 'Google News', time: tag(b, 'pubDate') };
    }).filter((i) => i.title && i.url);
    if (wl === 'crypto') {
      items = items.filter((i) => {
        const s = i.source.toLowerCase();
        return CRYPTO_WL.some((w) => s.includes(w));
      });
    }
    res.json({ items: items.slice(0, 24) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
