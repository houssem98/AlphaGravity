// Shared sina.com.cn helpers for the V1.3 EOD-history fallback (stooq is
// dead - blocked by a JS anti-bot challenge, see V1.1 in
// docs/VIBE_TRADING_ROADMAP.md). Underscore prefix keeps Vercel from
// treating this as its own route (Hobby 12-fn cap - no new fn files).
//
// Daily-K endpoint symbol format differs from the gb_ live-quote feed used
// in quote.ts: dashes become dots, no gb_ prefix (probed: brk-b -> brk.b
// works, brkb/brk_b don't). Index tickers (^GSPC etc.) return an empty
// array on this endpoint - no history/spark fallback for indices.
export function sinaHistSymbol(sym: string): string | null {
  if (sym.startsWith('^')) return null;
  return sym.toLowerCase().replace(/-/g, '.');
}

export interface SinaBar { d: string; o: string; h: string; l: string; c: string; v: string }

export async function sinaDailyBars(symbol: string): Promise<SinaBar[] | null> {
  const sSym = sinaHistSymbol(symbol);
  if (!sSym) return null;
  const r = await fetch(`http://stock.finance.sina.com.cn/usstock/api/json_v2.php/US_MinKService.getDailyK?symbol=${sSym}`);
  const bars = await r.json();
  return Array.isArray(bars) && bars.length ? bars : null;
}
