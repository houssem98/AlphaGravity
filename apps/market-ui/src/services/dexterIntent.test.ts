// DX-11 regression tests — docs/AI_TRADING_AGENT_ROADMAP.md Section 6 row 12.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    classifyIntent, describeBudget, CallBudget,
    BUDGET, HARD_CALL_CAP, CONFIRM_INTENT, type Intent,
} from './dexterIntent';

// Table-driven, as row 12 asks. Each line is a question a user would actually
// type, not a keyword.
const CASES: Array<[string, Intent]> = [
    // quick — one pass over the tools
    ['what is BTC at', 'quick'],
    ['price?', 'quick'],
    ['how much is apple trading for', 'quick'],
    ['show me the last 30 days', 'quick'],
    ['draw support and resistance', 'quick'],
    ['what is the ATR', 'quick'],
    ['', 'quick'],

    // deep — needs more than one feed
    ['analyze the current chart', 'deep'],
    ['what is the setup on BTC right now', 'deep'],
    ['give me your thesis on this name', 'deep'],
    ['why is it down today', 'deep'],
    ['what is the sentiment like', 'deep'],
    ['make the bull case', 'deep'],
    ['do a deep dive', 'deep'],
    ['what is the outlook', 'deep'],

    // decide — asks to be told what to do with money
    ['should i buy BTC here', 'decide'],
    ['should I sell my position', 'decide'],
    ['should i long this', 'decide'],
    ['give me a trade plan', 'decide'],
    ['where would you put the stop loss', 'decide'],
    ['is it a buy', 'decide'],
    ['how much should i put in', 'decide'],
    ['worth buying at this level?', 'decide'],
    ['should i trade this', 'decide'],
];

describe('row 12 — the router', () => {
    it.each(CASES)('routes %j to %s', (message, expected) => {
        expect(classifyIntent(message).intent).toBe(expected);
    });

    it('prefers a decision over an analysis when the message asks for both', () => {
        expect(classifyIntent('analyze BTC and tell me if i should buy').intent).toBe('decide');
    });

    it('is case- and whitespace-insensitive', () => {
        expect(classifyIntent('   SHOULD I BUY BTC HERE?  ').intent).toBe('decide');
    });

    it('explains itself rather than routing silently', () => {
        expect(classifyIntent('should i buy BTC').reason).toContain('position decision');
        expect(classifyIntent('analyze BTC').reason).toContain('several sources');
        expect(classifyIntent('price?').reason).toContain('single pass');
    });

    it('spends no model call to decide how many model calls to spend', () => {
        // The classifier is a pure function; if it ever needed a provider it
        // would have to take one.
        expect(classifyIntent.length).toBe(1);
    });
});

describe('row 12 — the budget is the measured cost, not a guess', () => {
    it('quotes what each path actually cost in prod', () => {
        // Measured, not guessed: a tool-using quick turn costs two calls
        // (think, then read the results), which the roadmap's §5 estimate missed.
        expect(BUDGET.quick).toEqual({ calls: 2, seconds: 7 });
        expect(BUDGET.deep).toEqual({ calls: 5, seconds: 30 });
        expect(BUDGET.decide).toEqual({ calls: 11, seconds: 165 });
    });

    it('gets more expensive as it gets deeper', () => {
        expect(BUDGET.quick.calls).toBeLessThan(BUDGET.deep.calls);
        expect(BUDGET.deep.calls).toBeLessThan(BUDGET.decide.calls);
        expect(BUDGET.decide.seconds).toBeGreaterThan(BUDGET.deep.seconds * 5);
    });

    it('confirms only the path that costs minutes', () => {
        expect(CONFIRM_INTENT.has('decide')).toBe(true);
        expect(classifyIntent('should i buy BTC').needsConfirmation).toBe(true);
        expect(classifyIntent('analyze BTC').needsConfirmation).toBe(false);
        expect(classifyIntent('price?').needsConfirmation).toBe(false);
    });

    it('quotes the exact call count, an honest time range, and an escape route', () => {
        const text = describeBudget(classifyIntent('should i buy BTC'));
        expect(text).toContain('11 model calls');
        // Measured 103.9s and 158.7s on the same graph, so a single tidy number
        // would be false precision.
        expect(text).toContain('1-3 minutes');
        expect(text).toContain('varies a lot');
        expect(text).toContain('quick read instead');
    });
});

describe('row 12 — the cap is enforced, not decorative', () => {
    it('counts every call', () => {
        const b = new CallBudget(3);
        expect(b.spent).toBe(0);
        b.spend(); b.spend();
        expect(b.spent).toBe(2);
        expect(b.remaining).toBe(1);
    });

    it('stops the run rather than billing past the cap', () => {
        const b = new CallBudget(2);
        b.spend(); b.spend();
        expect(() => b.spend()).toThrow(/budget exhausted: 3 calls attempted against a cap of 2/);
        expect(() => b.spend()).toThrow(/stopped rather than billed further/);
    });

    it('counts calls made through a wrapped caller', async () => {
        const b = new CallBudget(2);
        const call = b.wrap(async (n: number) => n * 2);
        expect(await call(21)).toBe(42);
        expect(b.spent).toBe(1);
        await call(1);
        await expect(call(1)).rejects.toThrow(/budget exhausted/);
    });

    it('leaves headroom above the most expensive path', () => {
        expect(HARD_CALL_CAP).toBeGreaterThan(BUDGET.decide.calls);
    });

    it('never reports negative headroom', () => {
        const b = new CallBudget(1);
        b.spend();
        expect(() => b.spend()).toThrow();
        expect(b.remaining).toBe(0);
    });
});

describe('row 12 — wired into the handler', () => {
    const handler = readFileSync(join(__dirname, '../../api/agent/[fn].ts'), 'utf8');

    it('routes on the last user turn when no mode is pinned', () => {
        expect(handler).toMatch(/const routed = classifyIntent\(String\(lastUser\?\.content \?\? ''\)\)/);
        expect(handler).toMatch(/const effectiveMode: string = mode \?\? routed\.intent/);
    });

    it('quotes a decision before running it, spending nothing', () => {
        expect(handler).toMatch(/effectiveMode === 'decide' && confirmed !== true/);
        expect(handler).toContain('needsConfirmation: true');
        expect(handler).toContain('spends zero model calls');
    });

    it('puts every stage through the counter, not just the top-level call', () => {
        expect(handler).toMatch(/const countedChat: typeof chatWithFallback = budget\.wrap\(chatWithFallback\)/);
        expect(handler).toMatch(/const callLLM = \(msgs: ChatMessage\[\]\) => countedChat/);
        expect(handler).not.toMatch(/=> chatWithFallback\(/);
    });

    it('reports what it actually spent', () => {
        expect(handler).toMatch(/calls: budget\.spent/);
        expect(handler).toMatch(/intent: effectiveMode/);
    });
});
