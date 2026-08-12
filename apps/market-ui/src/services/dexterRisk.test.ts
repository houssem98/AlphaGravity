// DX-10 regression tests — docs/AI_TRADING_AGENT_ROADMAP.md Section 6 rows 15 and 22.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    runRisk, parsePlan, renderPlan, riskPrompt, managerPrompt, clampRiskRounds,
    minStopDistance, RISK_ORDER, DISCLOSURE, DEFAULT_RISK_ROUNDS, MAX_RISK_ROUNDS,
    MIN_STOP_ATR,
    type RiskDeps,
} from './dexterRisk';
import type { AnalystReport } from './dexterGraph';
import type { DebateResult } from './dexterDebate';
import type { AssetContext } from './dexterTools';
import type { ChatMessage } from './dexterLlm';

const CTX: AssetContext = { symbol: 'BTC', isTN: false, isCrypto: true, name: 'Bitcoin' };
const TN: AssetContext = { symbol: 'SAH', isTN: true, isCrypto: false };

const REPORTS: AnalystReport[] = [
    { id: 'market', title: 'Market', ok: true, text: 'Trend down, close 63,080 [1].', citations: [], steps: [], ms: 1 },
];

const DEBATE: DebateResult = {
    turns: [{ side: 'bull', round: 1, text: 'up' }, { side: 'bear', round: 1, text: 'down' }],
    verdict: 'STANCE: BEARISH\nCONFIDENCE: 65\nBear won.',
    stance: 'BEARISH', confidence: 65, rounds: 1, steps: [],
};

const GOOD_PLAN = 'ACTION: BUY\nENTRY: 63080\nSTOP: 62211\nTARGET: 65655\nSIZE: 3\n\nBecause [1].';

function deps(managerReply = GOOD_PLAN): RiskDeps & { seen: ChatMessage[][] } {
    const seen: ChatMessage[][] = [];
    return {
        seen,
        now: (() => { let t = 0; return () => (t += 10); })(),
        callLLM: async (messages: ChatMessage[]) => {
            seen.push(messages);
            const isManager = String(messages[0].content).includes('portfolio manager');
            return { text: isManager ? managerReply : `risk view ${seen.length}` };
        },
    };
}

describe('row 15 — the risk block is validated, not trusted', () => {
    it('accepts a coherent plan and computes the ratio itself', () => {
        const { plan, problems } = parsePlan(GOOD_PLAN);
        expect(problems).toEqual([]);
        // |65655-63080| / |63080-62211| = 2575 / 869 = 2.96
        expect(plan).toEqual({ action: 'BUY', entry: 63080, stop: 62211, target: 65655, sizePct: 3, rr: 2.96 });
    });

    it('ignores a risk/reward the model asserts and uses the levels', () => {
        const lying = 'ACTION: BUY\nENTRY: 100\nSTOP: 90\nTARGET: 104\nSIZE: 5\nRR: 9:1 amazing';
        expect(parsePlan(lying).plan!.rr).toBe(0.4);
    });

    it('downgrades a BUY that is missing any leg of the block', () => {
        for (const missing of ['ENTRY', 'STOP', 'TARGET', 'SIZE']) {
            const text = GOOD_PLAN.split('\n').filter(l => !l.startsWith(missing)).join('\n');
            const { plan, problems } = parsePlan(text);
            expect(plan).toBeNull();
            expect(problems[0].toLowerCase()).toContain(missing.toLowerCase());
        }
    });

    it('rejects an incoherent plan, which is worse than a missing one', () => {
        const upsideDown = 'ACTION: BUY\nENTRY: 63080\nSTOP: 65000\nTARGET: 62000\nSIZE: 3';
        expect(parsePlan(upsideDown).plan).toBeNull();
        expect(parsePlan(upsideDown).problems[0]).toContain('a BUY needs stop < entry < target');

        const badSell = 'ACTION: SELL\nENTRY: 100\nSTOP: 90\nTARGET: 110\nSIZE: 2';
        expect(parsePlan(badSell).problems[0]).toContain('a SELL needs target < entry < stop');
    });

    it('accepts a well-formed SELL', () => {
        const sell = 'ACTION: SELL\nENTRY: 100\nSTOP: 110\nTARGET: 80\nSIZE: 2';
        expect(parsePlan(sell).plan).toMatchObject({ action: 'SELL', rr: 2 });
    });

    it('rejects a stop sitting on the entry — that is not a defined risk', () => {
        expect(parsePlan('ACTION: BUY\nENTRY: 100\nSTOP: 100\nTARGET: 120\nSIZE: 1').plan).toBeNull();
    });

    it('treats HOLD as a real answer needing no position numbers', () => {
        const { plan, action, problems } = parsePlan('ACTION: HOLD\nENTRY: 0\nSTOP: 0\nTARGET: 0\nSIZE: 0\nSitting out [1].');
        expect(action).toBe('HOLD');
        expect(plan).toBeNull();
        expect(problems).toEqual([]);
    });

    it('rejects a reply with no ACTION line at all', () => {
        expect(parsePlan('I think you should probably buy some.').problems).toEqual(['no ACTION line']);
    });

    it('tolerates currency symbols and thousands separators', () => {
        const messy = 'ACTION: BUY\nENTRY: $63,080.50\nSTOP: $62,211.00\nTARGET: $65,655.25\nSIZE: 3.5';
        expect(parsePlan(messy).plan).toMatchObject({ entry: 63080.5, stop: 62211, sizePct: 3.5 });
    });
});

describe('row 15 — a failed block becomes commentary, not a trade', () => {
    it('marks an unvalidated BUY as commentary with the real reason', async () => {
        const out = await runRisk(CTX, REPORTS, DEBATE, deps('ACTION: BUY\nENTRY: 63080\nSIZE: 3'), 1);
        expect(out.plan).toBeNull();
        expect(out.commentary).toBe(true);
        expect(out.rejectReason).toContain('stop');
    });

    it('does not call a HOLD commentary', async () => {
        const out = await runRisk(CTX, REPORTS, DEBATE, deps('ACTION: HOLD\nEvidence is thin [1].'), 1);
        expect(out.commentary).toBe(false);
        expect(out.plan).toBeNull();
    });

    it('keeps the manager\'s raw reply either way', async () => {
        const out = await runRisk(CTX, REPORTS, DEBATE, deps('ACTION: BUY\nENTRY: 1'), 1);
        expect(out.text).toContain('ACTION: BUY');
    });
});

describe('row 15 — three risk views, in the TradingAgents rotation', () => {
    it('runs aggressive, then conservative, then neutral', async () => {
        const out = await runRisk(CTX, REPORTS, DEBATE, deps(), 1);
        expect(out.turns.map(t => t.side)).toEqual([...RISK_ORDER]);
        expect(out.turns.map(t => t.side)).toEqual(['aggressive', 'conservative', 'neutral']);
    });

    it('spends 3N risk calls plus one manager call', async () => {
        for (const n of [1, 2]) {
            const d = deps();
            const out = await runRisk(CTX, REPORTS, DEBATE, d, n);
            expect(out.turns).toHaveLength(3 * n);
            expect(d.seen).toHaveLength(3 * n + 1);
        }
    });

    it('caps the rounds', () => {
        expect(clampRiskRounds(undefined)).toBe(DEFAULT_RISK_ROUNDS);
        expect(clampRiskRounds(99)).toBe(MAX_RISK_ROUNDS);
        expect(clampRiskRounds(0)).toBe(1);
    });

    it('lets each speaker hear the ones before it', async () => {
        const d = deps();
        await runRisk(CTX, REPORTS, DEBATE, d, 1);
        expect(String(d.seen[0][1].content)).toContain('(nothing yet)');
        expect(String(d.seen[2][1].content)).toContain('aggressive (round 1)');
        expect(String(d.seen[2][1].content)).toContain('conservative (round 1)');
    });

    it('carries the debate verdict into the risk discussion', async () => {
        const d = deps();
        await runRisk(CTX, REPORTS, DEBATE, d, 1);
        expect(String(d.seen[0][1].content)).toContain('ruled BEARISH at 65% confidence');
    });

    it('runs without a debate too', async () => {
        const d = deps();
        const out = await runRisk(CTX, REPORTS, null, d, 1);
        expect(String(d.seen[0][1].content)).toContain('(no debate was run)');
        expect(out.turns).toHaveLength(3);
    });

    it('traces every speaker and the manager', async () => {
        const out = await runRisk(CTX, REPORTS, DEBATE, deps(), 1);
        expect(out.steps.map(s => s.tool)).toEqual(['aggressive', 'conservative', 'neutral', 'portfolio']);
    });
});

describe('row 15 — the rendered block comes from the validated numbers', () => {
    it('renders what passed validation, including the computed ratio', () => {
        const { plan } = parsePlan(GOOD_PLAN);
        const rendered = renderPlan(plan!, CTX);
        expect(rendered).toContain('**BUY** · entry 63080 · stop 62211 · target 65655');
        expect(rendered).toContain('Size 3% of portfolio · risk/reward 2.96:1 (computed from these levels)');
    });

    it('labels a Tunisian listing in dinar', () => {
        const { plan } = parsePlan('ACTION: BUY\nENTRY: 13.4\nSTOP: 13.1\nTARGET: 14.05\nSIZE: 2');
        expect(renderPlan(plan!, TN)).toContain('entry 13.4 TND');
    });
});

describe('row 15 — the manager is told the rule up front', () => {
    it('states that an incomplete block is not a decision', () => {
        const [system] = managerPrompt(CTX, REPORTS, DEBATE, []);
        expect(system.content).toContain('will be relabelled as commentary');
        expect(system.content).toContain('stop sits BELOW the entry');
    });

    it('makes HOLD a legitimate answer rather than a failure', () => {
        const [system] = managerPrompt(CTX, REPORTS, DEBATE, []);
        expect(system.content).toContain('that is a real answer, not a failure');
    });

    it('asks each risk analyst for a size and a level, not a mood', () => {
        for (const side of RISK_ORDER) {
            const [system] = riskPrompt(side, CTX, REPORTS, DEBATE, []);
            expect(system.content).toContain('percentage of the portfolio');
            expect(system.content).toContain('[N] marker');
        }
    });
});

// ── DX-17: the stop floor ───────────────────────────────────────────────────
// DX-15 replayed four trades and every one stopped out with its stop inside a
// single ATR (0.48 / 0.67 / 0.25 / 0.93). The floor is stated on the definition
// of ATR, not fitted to that sample.

describe('DX-17 — a stop inside the noise is rejected', () => {
    it('derives the floor from the ATR', () => {
        expect(MIN_STOP_ATR).toBe(1.5);
        expect(minStopDistance(2000)).toBe(3000);
        expect(minStopDistance(null)).toBeNull();
    });

    it('rejects each of the four stops DX-15 actually placed', () => {
        // date, entry, stop, ATR at that decision
        const observed: Array<[string, number, number, number]> = [
            ['2026-04-01', 68113.92, 69400, 2664.78],
            ['2026-05-05', 80905.52, 79450, 2164.94],
            ['2026-05-22', 75539.5, 76030, 2000.55],
            ['2026-06-08', 63085.99, 65416.088, 2510.27],
        ];
        for (const [date, entry, stop, atr] of observed) {
            const side = stop < entry ? 'BUY' : 'SELL';
            const target = side === 'BUY' ? entry + atr * 3 : entry - atr * 3;
            const text = `ACTION: ${side}\nENTRY: ${entry}\nSTOP: ${stop}\nTARGET: ${target}\nSIZE: 3`;
            const { plan, problems } = parsePlan(text, minStopDistance(atr));
            expect(plan, `${date} should have been rejected`).toBeNull();
            expect(problems[0]).toContain('inside one day\'s ordinary range');
        }
    });

    it('accepts a stop with room to breathe', () => {
        const text = 'ACTION: BUY\nENTRY: 63000\nSTOP: 59000\nTARGET: 71000\nSIZE: 3';
        expect(parsePlan(text, minStopDistance(2000)).plan).toMatchObject({ action: 'BUY', rr: 2 });
    });

    it('applies no floor when the history is too short for an ATR', () => {
        const tight = 'ACTION: BUY\nENTRY: 100\nSTOP: 99.9\nTARGET: 120\nSIZE: 3';
        expect(parsePlan(tight, null).plan).not.toBeNull();
        expect(parsePlan(tight, minStopDistance(10)).plan).toBeNull();
    });

    it('still checks geometry before distance, so the message names the real fault', () => {
        const upsideDown = 'ACTION: BUY\nENTRY: 100\nSTOP: 130\nTARGET: 90\nSIZE: 3';
        expect(parsePlan(upsideDown, minStopDistance(1)).problems[0]).toContain('a BUY needs stop < entry < target');
    });

    it('tells the manager the number and what to do when the trade lacks room', () => {
        const [system] = managerPrompt(CTX, REPORTS, DEBATE, [], 3000);
        expect(system.content).toContain('at least 3000 away from your entry');
        expect(system.content).toContain('1.5x the current ATR');
        expect(system.content).toContain('the trade does not have room — answer HOLD');
    });

    it('falls back to plain guidance when there is no ATR to quote', () => {
        const [system] = managerPrompt(CTX, REPORTS, DEBATE, [], null);
        expect(system.content).toContain('where the idea is actually wrong');
        expect(system.content).not.toContain('1.5x the current ATR');
    });

    it('threads the floor through the whole risk stage', async () => {
        const tight = 'ACTION: BUY\nENTRY: 63000\nSTOP: 62900\nTARGET: 66000\nSIZE: 3';
        const d = deps(tight);
        const out = await runRisk(CTX, REPORTS, DEBATE, { ...d, minStop: 3000 }, 1);
        expect(out.plan).toBeNull();
        expect(out.commentary).toBe(true);
        expect(out.rejectReason).toContain('must be at least 3000');
    });
});

describe('row 22 — the disclosure', () => {
    it('says what it is and what it does not know', () => {
        expect(DISCLOSURE).toContain('Not financial advice');
        expect(DISCLOSURE).toContain('it can be wrong');
        expect(DISCLOSURE).toContain('does not know your circumstances');
    });
});

describe('rows 15 and 22 — wired into the handler', () => {
    const handler = readFileSync(join(__dirname, '../../api/agent/[fn].ts'), 'utf8');

    it('runs the risk stage only on a decision', () => {
        expect(handler).toMatch(/risk = await trace\.step\('Risk trio \+ portfolio manager'/);
    });

    it('forbids presenting an unvalidated block as a trade', () => {
        expect(handler).toContain('You may NOT present');
        expect(handler).toContain('executable plan was produced');
        expect(handler).toContain('Present it as commentary');
    });

    it('renders the block from the validated plan, not from the prose', () => {
        expect(handler).toMatch(/if \(risk\?\.plan\) answer = `\$\{renderPlan\(risk\.plan, ctx\)\}/);
    });

    it('appends the disclosure itself rather than asking for it', () => {
        expect(handler).toMatch(/if \(effectiveMode === 'decide'\) answer = .*DISCLOSURE/);
    });
});
