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
  // NT-1: days=N — strict horizon. Appends when:Nd at the fetch boundary AND
  // drops anything older (or with unverifiable pubDate) server-side, then
  // sorts newest-first (RSS order is approximate — curl-verified 2026-07-14).
  // Additive: legacy callers and the TN path never send days=.
  const days = parseInt(String(req.query.days || ''), 10) || 0;
  // NT-2: match= — strict per-coin matrix. Title must contain the coin NAME
  // (case-insensitive) or its SYMBOL as a standalone ALL-CAPS token (exact
  // case, len>=2 — "US Gas Prices" has "Gas" not "GAS", so common-word
  // symbols never leak). Generic market articles die here. Additive param.
  const match = String(req.query.match || '').trim();
  const matchSym = String(req.query.sym || '').trim().toUpperCase();
  if (!q) return res.status(400).json({ error: 'q required' });
  const [hl, gl] = region === 'tn' ? ['fr', 'TN'] : ['en', 'US'];
  try {
    const gq = days > 0 ? `${q} when:${days}d` : q;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(gq)}&hl=${hl}&gl=${gl}&ceid=${gl}:${hl}`;
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
    if (match || matchSym.length >= 2) {
      const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // "Gram (prev. Toncoin)" -> "Gram": match the clean display name only
      const cleanName = match.split('(')[0].trim();
      const nameRe = cleanName ? new RegExp(`\\b${esc(cleanName)}\\b`, 'i') : null;
      const symRe = matchSym.length >= 2 ? new RegExp(`\\b${esc(matchSym)}\\b`) : null;
      items = items.filter((i) => (nameRe && nameRe.test(i.title)) || (symRe && symRe.test(i.title)));
    }
    if (days > 0) {
      const cutoff = Date.now() - days * 86400_000;
      items = items
        .filter((i) => {
          const t = new Date(i.time).getTime();
          return !isNaN(t) && t >= cutoff; // unverifiable age = out
        })
        .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    }
    res.json({ items: items.slice(0, 24) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
