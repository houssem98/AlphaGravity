// DX-10 regression tests — docs/AI_TRADING_AGENT_ROADMAP.md Section 6 rows 15 and 22.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    runRisk, parsePlan, renderPlan, riskPrompt, managerPrompt, clampRiskRounds,
    RISK_ORDER, DISCLOSURE, DEFAULT_RISK_ROUNDS, MAX_RISK_ROUNDS,
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
