// TN column truth audit — hits PROD endpoints and reports, for every column the
// TN list/chooser can show, how many of the board's tickers have a REAL value.
// No sampling for bulk sources; engine/intraday audited per-symbol (all tickers).
const B = process.env.TN_BASE || 'https://market-ui-self.vercel.app';

const j = (u) => fetch(`${B}${u}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const isNum = (v) => typeof v === 'number' && isFinite(v);

const board = (await j('/api/tn/board'))?.board || [];
const ref = (await j('/api/tn/ref'))?.ref || {};
const fund = (await j(`/api/tn/fundamentals?b=${Date.now()}`))?.fundamentals || {};
const syms = board.map((r) => r.symbol);
console.log(`board rows: ${board.length}`);

// Per-symbol sources with small concurrency.
async function mapLimit(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}
const engines = Object.fromEntries((await mapLimit(syms, 6, async (s) => [s, await j(`/api/tn/engine?symbol=${s}`)])));
const intradays = Object.fromEntries((await mapLimit(syms, 6, async (s) => [s, await j(`/api/tn/intraday?symbol=${s}`)])));

const cols = {
  // key: [group, fn(sym) -> has real value?]
  price:      ['Market', (s, b) => isNum(b.price) && b.price > 0],
  changePct:  ['Market', (s, b) => isNum(b.changePct)],
  // change7d derives from closes; a bare 0 with no closes is fabricated — count closes only.
  sevenD:     ['Market', (s, b) => Array.isArray(b.closes) && b.closes.length > 1],
  spark:      ['Market', (s, b) => Array.isArray(b.closes) && b.closes.length > 1],
  volume:     ['Market', (s, b) => isNum(b.volume) && b.volume > 0],
  turnover:   ['Market', (s, b) => isNum(b.turnover) && b.turnover > 0],
  marketCap:  ['Market', (s, b) => isNum(b.marketCap) && b.marketCap > 0],
  // TNC-4: high/low ride the board row; only open still comes from intraday.
  open:       ['Market', (s) => (intradays[s]?.candles?.length || 0) > 0],
  high:       ['Market', (s, b) => isNum(b.high)],
  low:        ['Market', (s, b) => isNum(b.low)],
  sector:     ['Company', (s) => !!ref[s]?.sector],
  isin:       ['Company', (s, b) => !!(b.isin || ref[s]?.isin)],
  shares:     ['Company', (s, b) => isNum(b.shares) || isNum(ref[s]?.shares)],
  // TNC-3: the cell is price/eps off the row it sits in, not a served `per`.
  per:        ['Valuation', (s, b) => isNum(fund[s]?.eps) && fund[s].eps !== 0 && isNum(b.price) && b.price > 0],
  eps:        ['Valuation', (s) => isNum(fund[s]?.eps)],
  pb:         ['Valuation', (s) => isNum(fund[s]?.pb)],
  netIncome:  ['Valuation', (s) => isNum(fund[s]?.netIncome)],
  equity:     ['Valuation', (s) => isNum(fund[s]?.equity)],
  divYield:   ['Valuation', (s) => isNum(fund[s]?.yield)],
  engScore:   ['Signal', (s) => isNum(engines[s]?.score)],
  engLabel:   ['Signal', (s) => !!engines[s]?.label],
  fMomentum:  ['Signal', (s) => isNum(engines[s]?.factors?.momentum?.score)],
  fVolume:    ['Signal', (s) => isNum(engines[s]?.factors?.volume?.score)],
  fNews:      ['Signal', (s) => isNum(engines[s]?.factors?.news?.score)],
  fLiqTrend:  ['Signal', (s) => isNum(engines[s]?.factors?.liquidity?.score) || isNum(engines[s]?.factors?.trend?.score)],
};

console.log('\ncolumn coverage (real values / board rows):');
const rows = [];
for (const [k, [grp, has]] of Object.entries(cols)) {
  let n = 0;
  const missing = [];
  for (const b of board) { if (has(b.symbol, b)) n++; else missing.push(b.symbol); }
  rows.push({ col: k, grp, n, pct: Math.round((n / board.length) * 100), miss: missing.slice(0, 6).join(',') });
}
rows.sort((a, b) => a.n - b.n);
for (const r of rows) console.log(`  ${r.col.padEnd(11)} ${String(r.n).padStart(3)}/${board.length} (${String(r.pct).padStart(3)}%) [${r.grp}]${r.n < board.length ? `  miss: ${r.miss}${r.n < board.length - 6 ? ',…' : ''}` : ''}`);
