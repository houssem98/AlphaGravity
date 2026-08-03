// Macro regime measurement — DI-7 stretch goal, docs/DEXTER_INSTITUTIONAL_ROADMAP.md.
//
// Pulls REAL history for the three series the macro read uses, places today's
// readings in their own distributions, and prints the resulting regime and the
// gate it would apply. No thresholds are chosen here — the percentiles are the
// thresholds, and they come from the data.
//
//   FRED_API_KEY=... npx tsx scripts/macro-regime.mts
//   YEARS=5 npx tsx scripts/macro-regime.mts
import { MACRO_SERIES, hasFredKey } from '../src/services/fredService.js';
import { classifyMacro, gateWithMacro, describeMacro, type MacroHistory } from '../src/services/dexterMacroRegime.js';
import type { Regime } from '../src/services/dexterRegime.js';

if (!hasFredKey()) throw new Error('FRED_API_KEY is required — this script measures, it does not mock');

const years = Number(process.env.YEARS ?? 10);
const start = new Date(Date.now() - years * 365 * 86_400_000).toISOString().split('T')[0];

// Long history straight from FRED. `limit` is deliberately high: a percentile
// over 60 observations is a different statistic to one over 2,500.
async function history(seriesId: string): Promise<number[]> {
    const url = new URL('https://api.stlouisfed.org/fred/series/observations');
    url.searchParams.set('series_id', seriesId);
    url.searchParams.set('api_key', process.env.FRED_API_KEY!);
    url.searchParams.set('file_type', 'json');
    url.searchParams.set('observation_start', start);
    url.searchParams.set('sort_order', 'asc');
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`${seriesId}: HTTP ${res.status}`);
    const json = await res.json() as { observations?: Array<{ value: string }> };
    return (json.observations ?? [])
        .map(o => Number(o.value))
        .filter(v => Number.isFinite(v));
}

const [vix, hy, curve] = await Promise.all([
    history(MACRO_SERIES.vix.id),
    history(MACRO_SERIES.credit_spread_hy.id),
    history(MACRO_SERIES.yield_spread.id),
]);

const hist: MacroHistory = { vix, hySpread: hy, yieldSpread: curve };
const latest = { vix: vix.at(-1)!, hySpread: hy.at(-1)!, yieldSpread: curve.at(-1)! };

console.log(`history since ${start} (${years}y): VIX ${vix.length} obs, HY ${hy.length} obs, 10Y-2Y ${curve.length} obs`);
console.log(`latest: VIX ${latest.vix}, HY ${latest.hySpread}, 10Y-2Y ${latest.yieldSpread}`);

const read = classifyMacro(latest, hist);
console.log(`\n${describeMacro(read)}`);
console.log(`percentiles: ${JSON.stringify(read.percentiles)}  curveInverted=${read.curveInverted}`);

console.log('\ngate applied to each bars-only regime:');
for (const regime of ['trending-up', 'trending-down', 'ranging', 'volatile', 'unknown'] as Regime[]) {
    const g = gateWithMacro(regime, read);
    console.log(`  ${regime.padEnd(15)} → [${g.allowed.join(', ') || 'none'}]${g.removed.length ? `  (removed ${g.removed.join(', ')})` : ''}`);
}
