// DX-17 re-measurement. Same harness as DX-15, with the ATR stop floor active.
// DI-2 re-score, both arms, n=30, BTC 2025-08-27 → 2026-06-13:
//   CONTAMINATION=suspect REPLAY_N=30 npx tsx replay.mts            (floor ON)
//   CONTAMINATION=suspect REPLAY_N=30 NO_FLOOR=1 npx tsx replay.mts (floor OFF)
import { writeFileSync } from 'node:fs';
import { runAnalysts } from './src/services/dexterGraph.js';
import { runDebate } from './src/services/dexterDebate.js';
import { runRisk, minStopDistance } from './src/services/dexterRisk.js';
import { chatWithFallback, type ChatMessage } from './src/services/dexterLlm.js';
import { taLevels } from './src/services/taLevels.js';
import { asOfBars, replayAt, summariseReplay, type ReplayTrade, type ReplayDecision } from './src/services/dexterReplay.js';
import { isContamination, type Contamination } from './src/services/hindsightProbe.js';
import type { Bar } from './src/services/taLevels.js';

const KEY = process.env.DEEPSEEK_API_KEY!;
const keys = { deepseek: KEY };
const FLOOR = process.env.NO_FLOOR !== '1';
const CONTAMINATION = process.env.CONTAMINATION as Contamination;
if (!isContamination(CONTAMINATION)) {
  throw new Error('CONTAMINATION=clean|suspect|contaminated is required — run scripts/hindsight-probe.mts for this window first');
}

let calls = 0;
// DI-3: temperature 0 so a re-run is as reproducible as the API allows.
const TEMPERATURE = Number(process.env.TEMPERATURE ?? 0);
const callLLM = async (msgs: ChatMessage[]) => { calls++; return chatWithFallback(msgs, [], { keys, temperature: TEMPERATURE }); };

const SYMBOL = 'BTC';
const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}USDT&interval=1d&limit=400`);
const raw: any[] = await r.json();
const bars: Bar[] = raw.map(d => ({
  date: new Date(d[0]).toISOString().split('T')[0],
  open: +d[1], high: +d[2], low: +d[3], close: +d[4], volume: +d[5],
}));

const N = Number(process.env.REPLAY_N ?? 10);
const OUT = process.env.REPLAY_OUT ?? `replay-${FLOOR ? 'floor-on' : 'floor-off'}.json`;
const first = 60;
const last = bars.length - 35;
const step = Math.floor((last - first) / N);
const dates = Array.from({ length: N }, (_, i) => bars[first + i * step]);

console.log(`replay ${SYMBOL} · stop floor ${FLOOR ? 'ON (1.5x ATR)' : 'OFF'} · ${N} decisions ${dates[0].date} → ${dates.at(-1)!.date}\n`);

const trades: ReplayTrade[] = [];
for (const day of dates) {
  const asOf = Date.parse(day.date + 'T00:00:00Z');
  const trade = await replayAt(SYMBOL, bars, asOf, async (deps): Promise<ReplayDecision | null> => {
    const ctx = { symbol: SYMBOL, isTN: false, isCrypto: true, name: 'Bitcoin' };
    const visible = asOfBars(bars, asOf);
    const minStop = FLOOR ? minStopDistance(taLevels(visible).atr) : null;
    const reports = await runAnalysts(ctx, { tools: deps, callLLM }, ['market']);
    const debate = await runDebate(ctx, reports, { callLLM }, 1);
    const risk = await runRisk(ctx, reports, debate, { callLLM, minStop }, 1);
    if (!risk.plan) return risk.commentary ? null : { action: 'HOLD', entry: 0, stop: 0, target: 0, sizePct: 0, rr: 0 };
    return risk.plan;
  });
  trades.push(trade);
  // DI-2: persist every trade as it lands. The n=30 A/B could not be re-scored
  // net of costs without re-running 480 LLM calls, purely because the per-trade
  // rows were printed and thrown away. Never again.
  writeFileSync(OUT, JSON.stringify({
    symbol: SYMBOL, floor: FLOOR, contamination: CONTAMINATION, n: N,
    window: `${dates[0].date} → ${dates.at(-1)!.date}`,
    trades: trades.map(t => ({
      asOf: t.asOf, action: t.entry.action, priceAtCall: t.entry.priceAtCall,
      entry: t.entry.entry, stop: t.entry.stop, target: t.entry.target,
      outcome: t.verdict.outcome, exit: t.verdict.price, rMultiple: t.verdict.rMultiple,
    })),
  }, null, 2));
  const v = trade.verdict;
  const e = trade.entry;
  const atr = taLevels(asOfBars(bars, asOf)).atr ?? 0;
  const mult = e.entry && e.stop ? (Math.abs(e.entry - e.stop) / atr).toFixed(2) : '-';
  console.log(`${trade.asOf} @ ${e.priceAtCall}  ${e.action.padEnd(4)}` +
    `${e.entry ? ` stop ${mult} ATR` : ''}`.padEnd(16) +
    ` -> ${v.outcome}${v.rMultiple === null ? '' : ` ${v.rMultiple > 0 ? '+' : ''}${v.rMultiple}R`}  (${calls} calls)`);
}

// DI-1: the label comes from scripts/hindsight-probe.mts for this exact window.
const s = summariseReplay(trades, bars, Date.parse(dates[0].date + 'T00:00:00Z'), CONTAMINATION);
console.log(`\n=== stop floor ${FLOOR ? 'ON' : 'OFF'} ===`);
console.log(`dates ${s.dates} · positions ${s.trades} · holds ${s.holds} · still open ${s.open}`);
console.log(`wins ${s.wins} · losses ${s.losses} · hit rate ${s.hitRate ?? 'n/a'}`);
console.log(`GROSS avg ${s.avgR ?? 'n/a'}R · total ${s.totalR}R · buy-and-hold ${s.buyHoldPct}%`);
console.log(`NET   avg ${s.avgNetR ?? 'n/a'}R · total ${s.totalNetR}R · friction ${s.totalCostR}R · wins net ${s.winsNet} · hit rate net ${s.hitRateNet ?? 'n/a'}`);
console.log(`contamination ${s.contamination} · uncosted ${s.uncosted}`);
for (const note of s.notes) console.log(`  · ${note}`);
console.log(`llm calls ${calls} · per-trade rows written to ${OUT}`);
