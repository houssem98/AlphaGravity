// DX-9 regression tests — docs/AI_TRADING_AGENT_ROADMAP.md Section 6 row 14.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    runDebate, debatePrompt, managerPrompt, parseVerdict, clampRounds, renderTurns,
    DEFAULT_DEBATE_ROUNDS, MAX_DEBATE_ROUNDS,
    type DebateDeps, type DebateTurn,
} from './dexterDebate';
import type { AnalystReport } from './dexterGraph';
import type { AssetContext } from './dexterTools';
import type { ChatMessage } from './dexterLlm';

const CTX: AssetContext = { symbol: 'BTC', isTN: false, isCrypto: true, name: 'Bitcoin' };

const REPORTS: AnalystReport[] = [
    { id: 'market', title: 'Market', ok: true, text: 'Trend down, close 63,083.63 [1].', citations: [], steps: [], ms: 10 },
    { id: 'news', title: 'News', ok: false, error: 'HTTP 503', text: 'No news read available: HTTP 503', citations: [], steps: [], ms: 5 },
];

// Records every prompt the debate issues so the call pattern can be asserted.
function deps(reply = 'STANCE: BEARISH\nCONFIDENCE: 62\nThe bear won on structure.'): DebateDeps & { seen: ChatMessage[][] } {
    const seen: ChatMessage[][] = [];
    return {
        seen,
        now: (() => { let t = 0; return () => (t += 10); })(),
        callLLM: async (messages: ChatMessage[]) => {
            seen.push(messages);
            const isManager = String(messages[0].content).includes('research manager');
            return { text: isManager ? reply : `argument ${seen.length}` };
        },
    };
}

describe('row 14 — N rounds means exactly 2N debater calls', () => {
    it('spends 2 debater calls plus 1 manager call for one round', async () => {
        const d = deps();
        const out = await runDebate(CTX, REPORTS, d, 1);
        expect(d.seen).toHaveLength(3);
        expect(out.turns.map(t => t.side)).toEqual(['bull', 'bear']);
        expect(out.rounds).toBe(1);
    });

    it('scales to 2N for more rounds', async () => {
        for (const n of [1, 2, 3]) {
            const d = deps();
            const out = await runDebate(CTX, REPORTS, d, n);
            expect(out.turns).toHaveLength(2 * n);
            expect(d.seen).toHaveLength(2 * n + 1);
        }
    });

    it('alternates bull then bear inside every round', async () => {
        const out = await runDebate(CTX, REPORTS, deps(), 3);
        expect(out.turns.map(t => `${t.round}${t.side[0]}`)).toEqual(['1b', '1b', '2b', '2b', '3b', '3b']);
        expect(out.turns.map(t => t.side)).toEqual(['bull', 'bear', 'bull', 'bear', 'bull', 'bear']);
    });

    it('lets the bear answer an argument the bull has already made', async () => {
        const d = deps();
        await runDebate(CTX, REPORTS, d, 1);
        const bearPrompt = String(d.seen[1][1].content);
        expect(bearPrompt).toContain('Bull (round 1): argument 1');
    });

    it('shows the bull no argument on the opening turn', async () => {
        const d = deps();
        await runDebate(CTX, REPORTS, d, 1);
        expect(String(d.seen[0][1].content)).toContain('(no prior argument)');
    });
});

describe('row 14 — the round cap holds', () => {
    it('clamps to the documented bounds', () => {
        expect(clampRounds(undefined)).toBe(DEFAULT_DEBATE_ROUNDS);
        expect(clampRounds(0)).toBe(1);
        expect(clampRounds(-5)).toBe(1);
        expect(clampRounds(99)).toBe(MAX_DEBATE_ROUNDS);
        expect(clampRounds(2.7)).toBe(2);
        expect(clampRounds(NaN)).toBe(DEFAULT_DEBATE_ROUNDS);
    });

    it('never exceeds the cap however many rounds are requested', async () => {
        const d = deps();
        const out = await runDebate(CTX, REPORTS, d, 50);
        expect(out.rounds).toBe(MAX_DEBATE_ROUNDS);
        expect(d.seen).toHaveLength(2 * MAX_DEBATE_ROUNDS + 1);
    });
});

describe('row 14 — the verdict is parsed, not inferred', () => {
    it('reads the stance and confidence header', () => {
        expect(parseVerdict('STANCE: BULLISH\nCONFIDENCE: 74\nBecause...')).toEqual({ stance: 'BULLISH', confidence: 74 });
        expect(parseVerdict('stance: bearish\nconfidence: 5')).toEqual({ stance: 'BEARISH', confidence: 5 });
    });

    it('falls back to NEUTRAL with no confidence rather than inventing one', () => {
        expect(parseVerdict('I think it looks quite bullish honestly')).toEqual({ stance: 'NEUTRAL', confidence: null });
        expect(parseVerdict('')).toEqual({ stance: 'NEUTRAL', confidence: null });
    });

    it('clamps an out-of-range confidence', () => {
        expect(parseVerdict('STANCE: NEUTRAL\nCONFIDENCE: 999').confidence).toBe(100);
    });

    it('carries the parsed verdict out of the debate', async () => {
        const out = await runDebate(CTX, REPORTS, deps('STANCE: NEUTRAL\nCONFIDENCE: 20\nThin evidence.'), 1);
        expect(out.stance).toBe('NEUTRAL');
        expect(out.confidence).toBe(20);
        expect(out.verdict).toContain('Thin evidence');
    });
});

describe('row 14 — the debaters inherit the citation discipline', () => {
    it('tells both sides an uncited number is worthless', () => {
        for (const side of ['bull', 'bear'] as const) {
            const [system] = debatePrompt(side, CTX, REPORTS, []);
            expect(system.content).toContain('keeps the [N] marker');
            expect(system.content).toContain('a conceded point costs you less than an invented one');
        }
    });

    it('lets the manager rule NEUTRAL instead of manufacturing a direction', () => {
        const [system] = managerPrompt(CTX, REPORTS, []);
        expect(system.content).toContain('NEUTRAL with low confidence is a legitimate verdict');
        expect(system.content).toContain('STANCE: BULLISH|BEARISH|NEUTRAL');
    });

    it('shows both sides that an analyst was unavailable', () => {
        const [, user] = debatePrompt('bull', CTX, REPORTS, []);
        expect(user.content).toContain('### News analyst (unavailable)');
    });

    it('renders turns readably for the next speaker', () => {
        const turns: DebateTurn[] = [{ side: 'bull', round: 1, text: 'up' }, { side: 'bear', round: 1, text: 'down' }];
        expect(renderTurns(turns)).toBe('Bull (round 1): up\n\nBear (round 1): down');
        expect(renderTurns([])).toBe('(no prior argument)');
    });
});

describe('row 14 — traced like everything else', () => {
    it('records every debater turn and the manager', async () => {
        const out = await runDebate(CTX, REPORTS, deps(), 2);
        expect(out.steps.map(s => s.tool)).toEqual(['bull', 'bear', 'bull', 'bear', 'manager']);
        expect(out.steps[0].label).toBe('Bull argues (round 1)');
        expect(out.steps.at(-1)!.label).toBe('Research manager decides');
    });

    it('marks a silent debater as empty rather than pretending it spoke', async () => {
        const silent: DebateDeps = { now: () => 0, callLLM: async () => ({ text: '   ' }) };
        const out = await runDebate(CTX, REPORTS, silent, 1);
        expect(out.steps.every(s => s.status === 'empty')).toBe(true);
    });
});

describe('row 14 — wired into the handler', () => {
    const handler = readFileSync(join(__dirname, '../../api/agent/[fn].ts'), 'utf8');

    // DX-11 moved these gates onto the routed mode.
    it('runs the debate only on a decision-shaped request', () => {
        expect(handler).toMatch(/if \(effectiveMode === 'decide'\)/);
        expect(handler).toMatch(/\(effectiveMode === 'deep' \|\| effectiveMode === 'decide'\) && ctx/);
    });

    it('honours the caller\'s round count through the clamp', () => {
        expect(handler).toMatch(/runDebate\(ctx, reports, \{ callLLM \}, clampRounds\(rounds\)\)/);
    });

    it('hands the verdict to the final answer instead of re-deciding', () => {
        expect(handler).toContain('Lead with that verdict and the reason it won');
    });
});
