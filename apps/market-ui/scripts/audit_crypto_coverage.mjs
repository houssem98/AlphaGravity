#!/usr/bin/env node

/**
 * Crypto Screener V3 Ground-Truth Audit
 * Pulls prod /api/crypto/markets (100 coins) and audits each view (spot/technicals/derivatives/meta)
 * Detects: OK (data present) / NULL (all fields null) / MISMATCH (price inconsistencies)
 * Outputs: docs/CRYPTO_COVERAGE_AUDIT.md
 */

import fs from 'fs';
import path from 'path';

const PROD_URL = process.env.MARKET_SERVER_URL || 'http://localhost:3002'; // local dev
const BATCH_SIZE = 25;

// Price mismatch threshold: 3% for regular coins, 1% for stables
const PRICE_MISMATCH_PCT = 3;
const STABLES = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'USDP', 'FRAX']);

async function fetchCoins() {
  try {
    const res = await fetch(`${PROD_URL}/api/crypto/markets`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const coins = await res.json();
    return Array.isArray(coins) ? coins.slice(0, 100) : coins.slice(0, 100);
  } catch (err) {
    console.error('Failed to fetch base coins:', err.message);
    process.exit(1);
  }
}

function isStable(symbol) {
  return STABLES.has(symbol.toUpperCase());
}

function priceMatch(sourcePrice, cgPrice, symbol) {
  if (!sourcePrice || !cgPrice) return null; // missing prices
  const srcNum = parseFloat(sourcePrice);
  const cgNum = parseFloat(cgPrice);
  if (isNaN(srcNum) || isNaN(cgNum)) return null;
  const pct = Math.abs((srcNum - cgNum) / cgNum) * 100;
  const threshold = isStable(symbol) ? 1 : PRICE_MISMATCH_PCT;
  return pct <= threshold ? 'OK' : 'MISMATCH';
}

async function fetchView(coinId, symbol, cgPrice, view) {
  const viewFields = {
    spot: ['open', 'high', 'low', 'close', 'lastPrice', 'volume'],
    technicals: ['ema20', 'ema50', 'rsi', 'macd', 'ema200'],
    derivatives: ['openInterest', 'fundingRate', 'longShortRatio', 'oiChange'],
    meta: ['categories', 'trending', 'tvl', 'percentChange14d', 'percentChange30d'],
  };

  try {
    const params = new URLSearchParams({ view });
    const res = await fetch(`${PROD_URL}/api/crypto/markets?${params}`, {
      timeout: 5000,
    });
    if (!res.ok) {
      if (res.status === 404) return { status: 'NULL', reason: 'not-found' };
      return { status: 'NULL', reason: `http-${res.status}` };
    }
    const data = await res.json();
    const coinData = Array.isArray(data) ? data.find(c => c.id === coinId || c.symbol === symbol) : data?.[coinId];
    if (!coinData) return { status: 'NULL', reason: 'coin-not-in-response' };

    // Check for view-specific fields
    const expectedFields = viewFields[view] || [];
    const hasViewFields = expectedFields.some(f => coinData[f] !== null && coinData[f] !== '' && coinData[f] !== undefined);

    if (!hasViewFields) {
      return { status: 'NULL', reason: `missing-${view}-fields` };
    }

    // For spot/technicals/derivatives: check price consistency
    if (['spot', 'technicals', 'derivatives'].includes(view)) {
      const sourcePrice = coinData.lastPrice || coinData.price || coinData.priceUsd;
      if (sourcePrice) {
        const match = priceMatch(sourcePrice, cgPrice, symbol);
        if (match === 'MISMATCH') {
          return { status: 'MISMATCH', reason: 'price-out-of-range', sourcePrice, cgPrice };
        }
      }
    }

    return { status: 'OK', data: coinData };
  } catch (err) {
    return { status: 'NULL', reason: err.message };
  }
}

async function auditCoin(coin, index) {
  const { id, symbol, priceUsd } = coin;
  const results = { OK: 0, NULL: 0, MISMATCH: 0, details: {} };

  for (const view of ['spot', 'technicals', 'derivatives', 'meta']) {
    const result = await fetchView(id, symbol, priceUsd, view);
    results[result.status]++;
    results.details[view] = result;
  }

  if ((index + 1) % 10 === 0) console.log(`  Progress: ${index + 1}/100`);
  return { coin: `${symbol} (${id})`, ...results };
}

async function main() {
  console.log('🔍 Crypto Screener V3 Ground-Truth Audit');
  console.log(`📍 Target: ${PROD_URL}`);
  console.log('Fetching 100 coins...\n');

  const coins = await fetchCoins();
  console.log(`✓ Got ${coins.length} coins`);
  console.log('Auditing each coin × 4 views (batched ≤25)...\n');

  const auditResults = [];
  for (let i = 0; i < coins.length; i++) {
    const result = await auditCoin(coins[i], i);
    auditResults.push(result);

    // Batch limit: pause after batches to avoid overwhelming the server
    if ((i + 1) % BATCH_SIZE === 0) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // Aggregate stats
  let totals = { OK: 0, NULL: 0, MISMATCH: 0 };
  const byView = {
    spot: { OK: 0, NULL: 0, MISMATCH: 0 },
    technicals: { OK: 0, NULL: 0, MISMATCH: 0 },
    derivatives: { OK: 0, NULL: 0, MISMATCH: 0 },
    meta: { OK: 0, NULL: 0, MISMATCH: 0 },
  };

  auditResults.forEach(({ OK, NULL, MISMATCH, details }) => {
    totals.OK += OK;
    totals.NULL += NULL;
    totals.MISMATCH += MISMATCH;
    Object.entries(details).forEach(([view, result]) => {
      byView[view][result.status]++;
    });
  });

  // Generate markdown report
  const now = new Date().toISOString();
  let md = `# Crypto Screener V3 Coverage Audit\n\n`;
  md += `**Generated**: ${now}\n`;
  md += `**Coins audited**: ${coins.length}\n`;
  md += `**Target**: ${PROD_URL}\n\n`;

  md += `## Summary\n\n`;
  md += `| Status | Count | %age |\n`;
  md += `|--------|-------|-----|\n`;
  md += `| OK | ${totals.OK} | ${((totals.OK / (coins.length * 4)) * 100).toFixed(1)}% |\n`;
  md += `| NULL | ${totals.NULL} | ${((totals.NULL / (coins.length * 4)) * 100).toFixed(1)}% |\n`;
  md += `| MISMATCH | ${totals.MISMATCH} | ${((totals.MISMATCH / (coins.length * 4)) * 100).toFixed(1)}% |\n\n`;

  md += `## By View\n\n`;
  Object.entries(byView).forEach(([view, counts]) => {
    md += `### ${view}\n\n`;
    md += `| Status | Count |\n`;
    md += `|--------|-------|\n`;
    md += `| OK | ${counts.OK}/100 |\n`;
    md += `| NULL | ${counts.NULL}/100 |\n`;
    md += `| MISMATCH | ${counts.MISMATCH}/100 |\n\n`;
  });

  md += `## Coin Details\n\n`;
  md += `| Coin | OK | NULL | MISMATCH |\n`;
  md += `|------|----|----|----------|\n`;
  auditResults.forEach(({ coin, OK, NULL, MISMATCH }) => {
    md += `| ${coin} | ${OK} | ${NULL} | ${MISMATCH} |\n`;
  });

  // Write report
  const reportPath = path.join(process.cwd(), 'docs', 'CRYPTO_COVERAGE_AUDIT.md');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, md);

  console.log(`\n✅ Audit complete. Report written to ${reportPath}\n`);
  console.log('## Summary\n');
  console.log(`Total: ${totals.OK} OK, ${totals.NULL} NULL, ${totals.MISMATCH} MISMATCH`);
  console.log(`By view:`);
  Object.entries(byView).forEach(([view, counts]) => {
    console.log(`  ${view}: ${counts.OK}/100 OK, ${counts.NULL}/100 NULL, ${counts.MISMATCH}/100 MISMATCH`);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
