// G13 capability probe — docs/DEXTER_INSTITUTIONAL_ROADMAP.md.
//
// Proves the macro layer is actually alive rather than assuming it. Checks the
// three things that were broken: the credential is read from the Node env, a
// live snapshot returns real observations, and ALFRED point-in-time vintages
// (`realtime_start`/`realtime_end`) return the value as it was KNOWN on a past
// date — which is the whole reason to want FRED for a backtest.
//
//   FRED_API_KEY=... npx tsx scripts/fred-probe.mts
//   VINTAGE=2026-03-01 npx tsx scripts/fred-probe.mts
import { hasFredKey, getMacroSnapshot, fetchFREDVintage, MACRO_SERIES } from '../src/services/fredService.js';

const vintage = process.env.VINTAGE ?? '2026-03-01';

console.log(`FRED key present: ${hasFredKey()}`);
if (!hasFredKey()) {
    console.log('No key — the snapshot below must report the credential, not an empty section.');
}

const snap = await getMacroSnapshot(['vix', 'yield_spread', 'fed_funds', 'treasury_10y', 'credit_spread_hy']);
console.log(`\nasOf ${snap.asOf} · series ${snap.series.length} · error ${snap.error ?? 'none'}`);
for (const s of snap.series) {
    console.log(`  ${s.label.padEnd(28)} ${String(s.latest?.value ?? 'n/a').padStart(10)} ${s.unit} @ ${s.latest?.date ?? '—'} (${s.observations.length} obs)`);
}

// The point-in-time check: the 10Y-2Y spread as it was PUBLISHED on `vintage`,
// not as it has since been revised. This is what makes macro usable in a replay.
console.log(`\nALFRED vintage ${vintage} — ${MACRO_SERIES.yield_spread.label}:`);
try {
    const rows = await fetchFREDVintage(MACRO_SERIES.yield_spread.id, vintage, 6);
    console.log(`  ${rows.length} observation(s); latest ${rows.at(-1)?.date} = ${rows.at(-1)?.value}`);
} catch (e) {
    console.log(`  FAILED: ${(e as Error).name}: ${(e as Error).message}`);
}
