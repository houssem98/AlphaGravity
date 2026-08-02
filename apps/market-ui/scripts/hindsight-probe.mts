// DI-1 hindsight probe runner — docs/DEXTER_INSTITUTIONAL_ROADMAP.md rows 1-2.
//
// Committed rather than scratch (doctrine 9): the window, the target dates and
// the model are all arguments with stated defaults, and the same command line
// reproduces the same probe. There is no RNG — target dates are evenly spaced
// across the window by construction, so the sample is fixed by the window alone.
//
//   DEEPSEEK_API_KEY=... npx tsx scripts/hindsight-probe.mts
//   ... AS_OF=2026-03-15 END=2026-06-08 N=8 npx tsx scripts/hindsight-probe.mts
//
// Defaults probe the DX-17 replay window (2025-08-27 → 2026-06-13) on BTC.
import { chatWithFallback } from '../src/services/dexterLlm.js';
import {
    buildProbePrompt, parseProbeReply, scoreProbe, describeScore, verdictWithControl,
    buildDirectionPrompt, parseDirectionReply, scoreDirection, directionPairs, pairKey, worstLabel,
    type ProbeTarget, type ProbeVerdict,
} from '../src/services/hindsightProbe.js';

const SYMBOL = process.env.SYMBOL ?? 'BTC';
const AS_OF = process.env.AS_OF ?? '2025-08-27';
const END = process.env.END ?? '2026-06-13';
const N = Number(process.env.N ?? 12);

const keys = { deepseek: process.env.DEEPSEEK_API_KEY };
if (!keys.deepseek) throw new Error('DEEPSEEK_API_KEY is required — the probe measures a real model, not a mock');

// The control window sits well before the replay window and before any plausible
// training cutoff. If the model cannot recall these either, the probe has shown
// no sensitivity and a 'clean' reading on the real window means nothing.
const CTRL_AS_OF = process.env.CTRL_AS_OF ?? '2024-01-01';
const CTRL_END = process.env.CTRL_END ?? '2024-12-31';

async function targetsFor(from: string, to: string): Promise<ProbeTarget[]> {
    const url = `https://api.binance.com/api/v3/klines?symbol=${SYMBOL}USDT&interval=1d` +
        `&startTime=${Date.parse(`${from}T00:00:00Z`)}&endTime=${Date.parse(`${to}T00:00:00Z`)}&limit=1000`;
    const raw: any[] = await (await fetch(url)).json();
    if (!Array.isArray(raw) || raw.length === 0) throw new Error(`binance returned no bars for ${SYMBOL} ${from}..${to}`);
    const bars = raw.map(d => ({ date: new Date(d[0]).toISOString().split('T')[0], close: +d[4] }));
    // Evenly spaced, strictly after the as-of date — deterministic in the window.
    const step = Math.max(1, Math.floor((bars.length - 1) / N));
    const out: ProbeTarget[] = [];
    for (let i = step; i < bars.length && out.length < N; i += step) out.push(bars[i]);
    return out;
}

async function runArm(label: string, asOf: string, end: string) {
    const targets = await targetsFor(asOf, end);
    console.log(`\n${label} · ${SYMBOL} · as-of ${asOf} · ${targets.length} post-T dates to ${targets.at(-1)!.date}`);

    const reply = await chatWithFallback(buildProbePrompt(SYMBOL, targets.map(t => t.date)), [], { keys });
    const answers = parseProbeReply(reply.text);
    const score = scoreProbe(targets, answers);
    for (const t of targets) {
        const a = answers[t.date] ?? null;
        const err = a === null ? null : ((Math.abs(a - t.close) / t.close) * 100).toFixed(2);
        console.log(`  ${t.date}  actual ${t.close.toFixed(2).padStart(10)}  said ${(a === null ? 'null' : a.toFixed(2)).padStart(10)}  err ${err === null ? '  —' : `${err}%`}`);
    }
    console.log(`  price reply: ${reply.text.slice(0, 160).replace(/\s+/g, ' ')}`);
    console.log(`  ${describeScore(reply.model, `${asOf} → ${end}`, score)}`);

    const pairs = directionPairs(targets);
    const dirReply = await chatWithFallback(buildDirectionPrompt(SYMBOL, pairs), [], { keys });
    const dirAnswers = parseDirectionReply(dirReply.text);
    const dir = scoreDirection(pairs, dirAnswers);
    for (const p of pairs) {
        const a = dirAnswers[pairKey(p)] ?? null;
        console.log(`  ${p.from} → ${p.to}  actual ${p.actual.padEnd(4)}  said ${(a ?? 'null').padEnd(4)}  ${a === null ? '—' : a === p.actual ? 'hit' : 'miss'}`);
    }
    console.log(`  direction reply: ${dirReply.text.slice(0, 160).replace(/\s+/g, ' ')}`);
    console.log(`  direction ${dir.correct}/${dir.answered} answered of ${dir.n} pairs, acc ${dir.acc ?? 'below floor'}`);

    return { reply, score, dir };
}

// REPS because one run is not a measurement — the control arm was seen answering
// every direction pair on one run and refusing all of them on the next.
const REPS = Number(process.env.REPS ?? 5);
const reps: Array<{ rep: number; control: any; probe: any; verdict: ProbeVerdict }> = [];

for (let rep = 1; rep <= REPS; rep++) {
    console.log(`\n———— replicate ${rep}/${REPS} ————`);
    const control = await runArm('CONTROL arm (pre-window, recall must exist)', CTRL_AS_OF, CTRL_END);
    const probe = await runArm('PROBE arm (the replay window)', AS_OF, END);
    const verdict = verdictWithControl(probe.score, control.score, { probe: probe.dir, control: control.dir });
    console.log(`  → replicate ${rep} verdict: ${verdict.label} — ${verdict.reason}`);
    reps.push({
        rep,
        control: { price: control.score, direction: control.dir },
        probe: { price: probe.score, direction: probe.dir, provider: probe.reply.provider, model: probe.reply.model },
        verdict,
    });
}

const label = worstLabel(reps.map(r => r.verdict.label));
const ctrlSensitive = reps.filter(r => r.control.direction.acc !== null && r.control.direction.acc >= 0.75).length;
const windowAnswered = reps.reduce((a, r) => a + r.probe.direction.answered, 0);

console.log(`\n=== DI-1 verdict over ${REPS} replicates: ${label} ===`);
console.log(`control direction arm cleared the sensitivity bar in ${ctrlSensitive}/${REPS} replicates`);
console.log(`window direction pairs answered across all replicates: ${windowAnswered}/${reps.reduce((a, r) => a + r.probe.direction.n, 0)}`);
console.log(`window closes named within 2%: ${reps.reduce((a, r) => a + r.probe.price.hits, 0)}/${reps.reduce((a, r) => a + r.probe.price.n, 0)}`);
console.log(JSON.stringify({
    symbol: SYMBOL,
    model: reps[0].probe.model,
    controlWindow: `${CTRL_AS_OF} → ${CTRL_END}`,
    replayWindow: `${AS_OF} → ${END}`,
    reps: REPS,
    label,
    controlSensitiveReps: ctrlSensitive,
    detail: reps,
}, null, 2));
