// DI-3 walk-forward runner — docs/DEXTER_INSTITUTIONAL_ROADMAP.md row 5.
//
// Splits the persisted replay rows into non-overlapping test folds and scores
// each one gross and net. No LLM calls: the decisions were already made and
// recorded by replay.mts, so this is deterministic and re-runnable for free.
//
//   npx tsx scripts/walk-forward.mts replay-floor-on.json replay-floor-off.json
//   TRAIN=120 TEST=45 EMBARGO=7 npx tsx scripts/walk-forward.mts replay-floor-on.json
//
// Defaults: 90d train / 0d embargo / 60d test over the replayed window, universe
// taken from the file's own symbol. A fold with no decisions in it reports zero
// trades rather than being dropped — an empty fold is a result.
import { readFileSync } from 'node:fs';
import { DEFAULT_COSTS, ZERO_COSTS, applyCosts, describeCosts } from '../src/services/dexterCosts.js';
import { makeFolds, foldForTest, describeSpec, describeFold, fmt } from '../src/services/walkForward.js';

const costs = process.env.ZERO === '1' ? ZERO_COSTS : DEFAULT_COSTS;
const trainDays = Number(process.env.TRAIN ?? 90);
const testDays = Number(process.env.TEST ?? 60);
const embargoDays = Number(process.env.EMBARGO ?? 0);

const files = process.argv.slice(2);
if (files.length === 0) throw new Error('usage: npx tsx scripts/walk-forward.mts <replay-*.json> [...]');

console.log(describeCosts(costs));

for (const file of files) {
    const run = JSON.parse(readFileSync(file, 'utf8'));
    const dates = run.trades.map((t: any) => Date.parse(`${t.asOf}T00:00:00Z`)).sort((a: number, b: number) => a - b);
    const spec = {
        start: fmt(dates[0]),
        // Exclusive, and one day past the last decision so it is inside a fold.
        end: fmt(dates[dates.length - 1] + 86_400_000),
        trainDays, testDays, embargoDays,
        universe: [run.symbol],
    };

    const folds = makeFolds(spec);
    console.log(`\n=== ${file} · floor ${run.floor ? 'ON' : 'OFF'} · contamination ${run.contamination} ===`);
    console.log(describeSpec(spec, folds));

    let assigned = 0;
    const foldNets: number[] = [];

    for (const f of folds) {
        const inFold = run.trades.filter((t: any) => {
            const ts = Date.parse(`${t.asOf}T00:00:00Z`);
            return foldForTest([f], ts) !== null;
        });
        const resolved = inFold.filter((t: any) => t.action !== 'HOLD' && t.outcome !== 'open');
        assigned += inFold.length;

        const scored = resolved.map((t: any) =>
            applyCosts(costs, { entryPx: t.entry, stopPx: t.stop, exitPx: t.exit, grossR: t.rMultiple }));
        const nets = scored.map((s: any) => s.netR).filter((r: any) => r !== null) as number[];
        const gross = scored.map((s: any) => s.grossR).filter((r: any) => r !== null) as number[];
        const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

        if (nets.length > 0) foldNets.push(sum(nets));
        console.log(
            `  ${describeFold(f)} · decisions ${inFold.length} · trades ${resolved.length} · ` +
            `gross ${sum(gross).toFixed(2)}R · net ${sum(nets).toFixed(2)}R` +
            (resolved.length === 0 ? '  (empty fold — reported, not dropped)' : ''),
        );
    }

    // Fold-level spread is the honest read: one good fold out of five is noise.
    const mean = foldNets.length ? foldNets.reduce((a, b) => a + b, 0) / foldNets.length : NaN;
    const sd = foldNets.length > 1
        ? Math.sqrt(foldNets.reduce((a, b) => a + (b - mean) ** 2, 0) / (foldNets.length - 1))
        : NaN;
    const se = foldNets.length > 1 ? sd / Math.sqrt(foldNets.length) : NaN;

    console.log(`  folds with trades ${foldNets.length}/${folds.length} · positive folds ${foldNets.filter(r => r > 0).length}`);
    console.log(`  net per fold: mean ${mean.toFixed(3)}R · SD ${sd.toFixed(3)} · SE ${se.toFixed(3)} · mean/SE ${(mean / se).toFixed(2)}`);
    console.log(`  decisions assigned to a test fold: ${assigned}/${run.trades.length}`);
}
