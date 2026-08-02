// DI-2 re-scorer — docs/DEXTER_INSTITUTIONAL_ROADMAP.md rows 3-4.
//
// Reads the per-trade rows replay.mts persists and re-scores them gross and net
// under any cost model, with no LLM calls. The n=30 A/B originally cost 480 calls
// to re-score purely because its rows were printed and discarded; from here a
// re-score is free and deterministic.
//
//   npx tsx scripts/score-replay.mts replay-floor-on.json replay-floor-off.json
//   ZERO=1 npx tsx scripts/score-replay.mts replay-floor-on.json   (gross only)
import { readFileSync } from 'node:fs';
import { DEFAULT_COSTS, ZERO_COSTS, applyCosts, describeCosts } from '../src/services/dexterCosts.js';

const costs = process.env.ZERO === '1' ? ZERO_COSTS : DEFAULT_COSTS;
const files = process.argv.slice(2);
if (files.length === 0) throw new Error('usage: npx tsx scripts/score-replay.mts <replay-*.json> [...]');

console.log(describeCosts(costs));

for (const file of files) {
    const run = JSON.parse(readFileSync(file, 'utf8'));
    const resolved = run.trades.filter((t: any) => t.action !== 'HOLD' && t.outcome !== 'open');
    const rows = resolved.map((t: any) => ({
        ...t,
        ...applyCosts(costs, { entryPx: t.entry, stopPx: t.stop, exitPx: t.exit, grossR: t.rMultiple }),
    }));

    const nets = rows.map((r: any) => r.netR).filter((r: any) => r !== null) as number[];
    const gross = rows.map((r: any) => r.grossR).filter((r: any) => r !== null) as number[];
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : NaN);

    // Doctrine: compute the SE of the acceptance metric BEFORE claiming an effect.
    const m = mean(nets);
    const sd = nets.length > 1
        ? Math.sqrt(sum(nets.map(x => (x - m) ** 2)) / (nets.length - 1))
        : NaN;
    const se = nets.length > 1 ? sd / Math.sqrt(nets.length) : NaN;

    console.log(`\n=== ${file} · floor ${run.floor ? 'ON' : 'OFF'} · n=${run.n} · ${run.window} · contamination ${run.contamination} ===`);
    console.log(`decisions ${run.trades.length} · positions ${run.trades.filter((t: any) => t.action !== 'HOLD').length} · resolved ${resolved.length}`);
    console.log(`GROSS total ${sum(gross).toFixed(2)}R · avg ${mean(gross).toFixed(3)}R`);
    console.log(`NET   total ${sum(nets).toFixed(2)}R · avg ${m.toFixed(3)}R · friction ${sum(rows.map((r: any) => r.costR ?? 0)).toFixed(2)}R`);
    console.log(`net per-trade SD ${sd.toFixed(3)} · SE ${se.toFixed(3)} · mean/SE ${(m / se).toFixed(2)}`);
    console.log(`wins gross ${gross.filter(r => r > 0).length}/${gross.length} · wins net ${nets.filter(r => r > 0).length}/${nets.length}`);
    for (const r of rows) {
        console.log(`  ${r.asOf} ${String(r.action).padEnd(4)} entry ${r.entry} stop ${r.stop} exit ${r.exit} · ${r.outcome} · gross ${r.grossR}R net ${r.netR}R (cost ${r.costR}R)`);
    }
}
