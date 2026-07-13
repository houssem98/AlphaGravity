#!/usr/bin/env node

// CW-1 universe audit (no app code changes). Pulls CG top 250 by mcap,
// Binance ticker/24hr + OKX SPOT tickers (same shapes as markets.ts), and
// price-gates every candidate (3%, stables 1% — verbatim V3 gate). Emits
// docs/CRYPTO_UNIVERSE.md: full ranked table, curated top-100 (highest-mcap
// with a gate-verified venue), exclusions with reasons, and the curated CG-id
// JSON array (copy-paste source for CW-2).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = path.join(REPO_ROOT, 'docs', 'CRYPTO_UNIVERSE.md');

// same set as markets.ts
const STABLE_SYMS = new Set(['USDT', 'USDC', 'DAI', 'FDUSD', 'USDE', 'TUSD', 'PYUSD', 'USDP', 'USDD', 'FRAX', 'BUSD', 'GUSD']);

const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url);
    if (r.status === 429) { console.log(`  429, backoff ${15 * (i + 1)}s`); await sleep(15000 * (i + 1)); continue; }
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
  }
  throw new Error(`still 429 after ${tries} tries: ${url}`);
}

const gateOk = (sym, cgPrice, srcPrice) =>
  srcPrice > 0 && cgPrice > 0 && Math.abs(srcPrice / cgPrice - 1) <= (STABLE_SYMS.has(sym) ? 0.01 : 0.03);

async function main() {
  // CG top 250, 3 sequential pages
  const cg = [];
  for (let page = 1; page <= 3; page++) {
    console.log(`CG page ${page}...`);
    cg.push(...await getJson(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=${page}&sparkline=false`));
    if (page < 3) await sleep(2500);
  }
  const seen = new Set();
  const candidates = cg.filter((c) => c.id && !seen.has(c.id) && seen.add(c.id)).slice(0, 250);
  console.log(`candidates: ${candidates.length}`);

  // venue maps — same shapes as markets.ts tickerMap()/okxSpotMap()
  const bn = {};
  for (const t of await getJson('https://api.binance.com/api/v3/ticker/24hr')) {
    if (typeof t.symbol === 'string' && t.symbol.endsWith('USDT')) bn[t.symbol.slice(0, -4)] = parseFloat(t.lastPrice);
  }
  const okx = {};
  for (const t of (await getJson('https://www.okx.com/api/v5/market/tickers?instType=SPOT')).data || []) {
    if (t.instId?.endsWith('-USDT')) okx[t.instId.slice(0, -5)] = parseFloat(t.last);
  }
  console.log(`binance USDT pairs: ${Object.keys(bn).length}, okx USDT pairs: ${Object.keys(okx).length}`);

  const rows = candidates.map((c, i) => {
    const sym = (c.symbol || '').toUpperCase();
    const cgPrice = c.current_price;
    let venue = 'NONE', gate = 'n/a', srcPrice = null;
    for (const [name, map] of [['binance', bn], ['okx', okx]]) {
      if (map[sym] === undefined) continue;
      if (gateOk(sym, cgPrice, map[sym])) { venue = name; gate = 'pass'; srcPrice = map[sym]; break; }
      if (venue === 'NONE') { venue = name; gate = 'fail'; srcPrice = map[sym]; }
    }
    return { pos: i + 1, rank: c.market_cap_rank ?? i + 1, id: c.id, symbol: sym, mcap: c.market_cap ?? 0, cgPrice, srcPrice, venue, gate };
  });

  const curated = rows.filter((r) => r.gate === 'pass').slice(0, 100);
  const curatedIds = new Set(curated.map((r) => r.id));
  const top100Ids = new Set(rows.slice(0, 100).map((r) => r.id));
  const dropped = rows.slice(0, 100).filter((r) => !curatedIds.has(r.id));
  const backfill = curated.filter((r) => !top100Ids.has(r.id));
  const exclusions = rows.filter((r) => r.gate !== 'pass');

  const fm = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : String(n));
  const reason = (r) => (r.venue === 'NONE'
    ? 'no venue (no Binance/OKX USDT spot pair)'
    : `gate-failed (${r.venue} last ${r.srcPrice} vs CG ${r.cgPrice})`);

  let md = `# Crypto Universe — CW-1 venue audit\n\n`;
  md += `Generated: ${new Date().toISOString()} | Candidates: CG top ${rows.length} by mcap | Gate: 3% (stables 1%), Binance preferred, OKX fallback\n\n`;
  md += `## Summary\n\n`;
  md += `- CG top-100 dropped: **${dropped.length}** (no venue: ${dropped.filter((r) => r.venue === 'NONE').length}, gate-failed: ${dropped.filter((r) => r.gate === 'fail').length})\n`;
  md += `- Backfilled from ranks 101–250: **${backfill.length}**\n`;
  md += `- Curated universe: **${curated.length}** coins (binance: ${curated.filter((r) => r.venue === 'binance').length}, okx: ${curated.filter((r) => r.venue === 'okx').length})\n`;
  if (dropped.some((r) => STABLE_SYMS.has(r.symbol))) {
    md += `\nNote: quote-asset stables (e.g. USDT) have no XXX-USDT pair by construction — objectively excluded by the venue test. CW-2 decision if that reads wrong on the board.\n`;
  }

  md += `\n## Curated top-100 (highest-mcap with gate-verified venue)\n\n| # | CG rank | Coin | Mcap | Venue |\n|---|---------|------|------|-------|\n`;
  curated.forEach((r, i) => { md += `| ${i + 1} | ${r.rank} | ${r.symbol} (${r.id}) | ${fm(r.mcap)} | ${r.venue} |\n`; });

  md += `\n## Curated CG ids (CW-2 copy-paste source)\n\n\`\`\`json\n${JSON.stringify(curated.map((r) => r.id))}\n\`\`\`\n`;

  md += `\n## Exclusions (gate != pass, CG top 250)\n\n| CG rank | Coin | Reason |\n|---------|------|--------|\n`;
  exclusions.forEach((r) => { md += `| ${r.rank} | ${r.symbol} (${r.id}) | ${reason(r)} |\n`; });

  md += `\n## Full ranked table (CG top 250)\n\n| CG rank | Coin | Mcap | Venue | Gate |\n|---------|------|------|-------|------|\n`;
  rows.forEach((r) => { md += `| ${r.rank} | ${r.symbol} (${r.id}) | ${fm(r.mcap)} | ${r.venue} | ${r.gate} |\n`; });

  fs.writeFileSync(OUT, md);
  console.log(`\nwrote ${OUT}`);
  console.log(`CG top-100 dropped: ${dropped.length} (${dropped.map((r) => r.symbol).join(', ')})`);
  console.log(`backfilled 101-250: ${backfill.length} (${backfill.map((r) => r.symbol).join(', ')})`);
  console.log(`curated: ${curated.length} (binance ${curated.filter((r) => r.venue === 'binance').length} / okx ${curated.filter((r) => r.venue === 'okx').length})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
