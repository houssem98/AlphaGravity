#!/usr/bin/env node

// Crypto Screener V3 ground-truth audit (CT-1, corrected in CT-2).
// Pulls prod /api/crypto/markets (100 coins), then each view for all 100
// (batched <=25, symbols= as the UI sends), and classifies per coin per group:
//   OK       - data present and price-scale sane
//   NULL     - all view fields null (honest miss)
//   MISMATCH - price-scale fields differ from the coin's base price by >3x or <1/3
//              => the row is another asset's data (symbol collision)
// px= hints are always sent (server ignores them pre-CT-2; post-CT-2 they arm
// the verified-pair gate, so the audit measures the gated pipeline).
// Writes <repo>/docs/CRYPTO_COVERAGE_AUDIT.md.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const BASE = process.env.AUDIT_URL || 'https://market-ui-self.vercel.app';
const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = path.join(REPO_ROOT, 'docs', 'CRYPTO_COVERAGE_AUDIT.md');
const BATCH = 25;
const VIEWS = ['spot', 'technicals', 'derivatives', 'meta'];

// Price-scale fields per view (roadmap CT-1: spot open..high..low bracket,
// technicals ema20-class fields). Ratio vs base price >3 or <1/3 = wrong asset.
const SCALE_FIELDS = {
  spot: ['open', 'high', 'low', 'prevClose'],
  technicals: ['ema20', 'sma20', 'bbUpper', 'pivP', 'ema50'],
  derivatives: [], // oiUsd/funding are not per-unit price-scaled
  meta: [],
};

const ratioBad = (v, base) => {
  if (typeof v !== 'number' || !isFinite(v) || v <= 0 || !(base > 0)) return false;
  const r = v / base;
  return r > 3 || r < 1 / 3;
};

function classify(view, row, basePrice) {
  if (!row) return 'NULL';
  const vals = Object.entries(row).filter(([k]) => k !== 'symbol').map(([, v]) => v);
  const present = vals.some((v) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0));
  if (!present) return 'NULL';
  for (const f of SCALE_FIELDS[view]) {
    if (ratioBad(row[f], basePrice)) return 'MISMATCH';
  }
  return 'OK';
}

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function main() {
  console.log(`audit target: ${BASE}`);
  const coins = (await getJson(`${BASE}/api/crypto/markets`)).slice(0, 100);
  if (!coins.length) throw new Error('empty base list');
  console.log(`base list: ${coins.length} coins, source=${coins[0].source || 'unknown'}`);

  // status[symbol][view]
  const status = {};
  for (const c of coins) status[c.symbol] = {};

  for (let i = 0; i < coins.length; i += BATCH) {
    const batch = coins.slice(i, i + BATCH);
    const syms = batch.map((c) => c.symbol).join(',');
    const px = batch.map((c) => `${c.symbol}:${c.priceUsd}`).join(',');
    const ids = batch.map((c) => c.id).join(','); // meta joins by CG id (CT-3)
    for (const view of VIEWS) {
      let rows = [];
      try {
        rows = await getJson(`${BASE}/api/crypto/markets?view=${view}&symbols=${syms}&px=${encodeURIComponent(px)}&ids=${encodeURIComponent(ids)}`);
      } catch (e) {
        console.error(`  ${view} batch ${i / BATCH + 1}: ${e.message}`);
      }
      const bySym = {};
      if (Array.isArray(rows)) for (const r of rows) bySym[r.symbol] = r;
      for (const c of batch) {
        status[c.symbol][view] = classify(view, bySym[c.symbol], parseFloat(c.priceUsd));
      }
    }
    console.log(`  batch ${i / BATCH + 1}/${Math.ceil(coins.length / BATCH)} done`);
  }

  const totals = {};
  for (const view of VIEWS) {
    totals[view] = { OK: 0, NULL: 0, MISMATCH: 0 };
    for (const c of coins) totals[view][status[c.symbol][view]]++;
  }

  let md = `# Crypto Screener V3 Coverage Audit\n\n`;
  md += `Generated: ${new Date().toISOString()} | Target: ${BASE} | Coins: ${coins.length}\n\n`;
  md += `## Totals\n\n| View | OK | NULL | MISMATCH |\n|------|----|------|----------|\n`;
  for (const view of VIEWS) {
    const t = totals[view];
    md += `| ${view} | ${t.OK}/${coins.length} | ${t.NULL} | ${t.MISMATCH} |\n`;
  }
  md += `\n## Per coin\n\n| # | Coin | spot | technicals | derivatives | meta |\n|---|------|------|-----------|-------------|------|\n`;
  coins.forEach((c, i) => {
    const s = status[c.symbol];
    const cell = (v) => (v === 'OK' ? 'OK' : v === 'MISMATCH' ? '**MISMATCH**' : '·');
    md += `| ${i + 1} | ${c.symbol} (${c.id}) | ${cell(s.spot)} | ${cell(s.technicals)} | ${cell(s.derivatives)} | ${cell(s.meta)} |\n`;
  });

  fs.writeFileSync(OUT, md);
  console.log(`\nwrote ${OUT}`);
  for (const view of VIEWS) {
    const t = totals[view];
    console.log(`${view}: ${t.OK}/${coins.length} OK, ${t.NULL} NULL, ${t.MISMATCH} MISMATCH`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
