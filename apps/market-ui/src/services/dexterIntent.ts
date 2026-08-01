// Dexter Intent — what this turn is worth spending.
// docs/AI_TRADING_AGENT_ROADMAP.md DX-11, regression row 12.
//
// Deterministic classification, no LLM. Spending a model call to decide whether
// to spend model calls is the one routing design that cannot pay for itself,
// and it would put a 2-second question behind a 2-second classifier.
//
// The budgets below are MEASURED, not estimated. DX-9 left the roadmap's §5
// guess of 14 calls for a decision in place; the real graph is 11, and it took
// 158.7 s in prod. Those are the numbers a user is shown before agreeing to it.

export type Intent = 'quick' | 'deep' | 'decide';

export interface Budget {
    calls: number;
    seconds: number;
}

// quick   — think, then read the tool results: 2 calls, measured 6.4 s e2e.
//           (The roadmap's §5 guess of 1 ignored the second pass; a tool-using
//           turn always costs two.)
// deep    — 3-4 analysts + 1 answer, measured 23.8 s (DX-8 probe)
// decide  — analysts + 2 debaters + manager + 3 risk + portfolio + answer,
//           measured 158.7 s (DX-10 probe). §5 guessed 14 calls; it is 11.
export const BUDGET: Record<Intent, Budget> = {
    quick: { calls: 2, seconds: 7 },
    deep: { calls: 5, seconds: 30 },
    decide: { calls: 11, seconds: 165 },
};

// Anything past this in a single request is a runaway, not a plan.
export const HARD_CALL_CAP = 16;

// A decision costs minutes and real money, so it is never entered silently.
export const CONFIRM_INTENT: ReadonlySet<Intent> = new Set(['decide']);

export interface IntentDecision {
    intent: Intent;
    reason: string;
    budget: Budget;
    needsConfirmation: boolean;
}

// Asking to be told what to do with money.
const DECIDE_RE = [
    // Both word orders occur in practice: "should i buy" and "tell me if i
    // should buy". Missing the second routed a decision to the analysis path.
    /\b(should i|i should|do i)\b.*\b(buy|sell|long|short|enter|exit|hold|add|trim)\b/,
    /\b(buy|sell|long|short)\b.*\?\s*$/,
    /\bgive me a (trade |trading )?plan\b/,
    /\b(entry|stop loss|stop-loss|position siz|how much should i)\b/,
    /\b(worth|good time to) (buying|selling|a buy|a short)\b/,
    /\btrade (this|it)\b/,
    /\b(is it a|make it a) (buy|sell)\b/,
];

// Asking for an opinion that needs more than one feed.
const DEEP_RE = [
    /\b(analyse|analyze|analysis|assessment)\b/,
    /\b(the )?(setup|outlook|thesis|case for|case against)\b/,
    /\bwhat('s| is) (going on|happening|the story)\b/,
    /\bwhy (is|did|has)\b/,
    /\b(sentiment|news flow|fundamentals|valuation)\b/,
    /\b(bull|bear) case\b/,
    /\bdeep dive\b/,
];

function matches(text: string, patterns: RegExp[]): RegExp | null {
    return patterns.find(re => re.test(text)) ?? null;
}

export function classifyIntent(message: string): IntentDecision {
    const text = (message ?? '').toLowerCase().trim();

    const decide = matches(text, DECIDE_RE);
    if (decide) {
        return {
            intent: 'decide',
            reason: `asks for a position decision (matched ${decide.source})`,
            budget: BUDGET.decide,
            needsConfirmation: true,
        };
    }

    const deep = matches(text, DEEP_RE);
    if (deep) {
        return {
            intent: 'deep',
            reason: `asks for analysis across several sources (matched ${deep.source})`,
            budget: BUDGET.deep,
            needsConfirmation: false,
        };
    }

    return {
        intent: 'quick',
        reason: 'answerable from the tools in a single pass',
        budget: BUDGET.quick,
        needsConfirmation: false,
    };
}

// What the user is shown before a decision runs. Plain numbers, no reassurance.
// The call count is exact — a confirmed decide run spent exactly 11. The time
// is not: the same graph measured 103.9 s and 158.7 s on consecutive days, and
// individual analyst calls have ranged from 6.0 s to 45.1 s. Quoting a single
// tidy number would be the kind of false precision this agent is built against.
export function describeBudget(d: IntentDecision): string {
    return `This runs the full decision graph: ${d.budget.calls} model calls, usually ` +
        `1-3 minutes but provider latency varies a lot. Ask for a quick read instead ` +
        `if you just want the levels.`;
}

// Enforcement, not decoration: the counter is passed through the whole run and
// throws the moment a stage would exceed the cap.
export class CallBudget {
    private used = 0;
    // Declared rather than a constructor parameter property: tsconfig.app.json
    // sets `erasableSyntaxOnly`, which forbids the shorthand.
    readonly cap: number;

    constructor(cap: number = HARD_CALL_CAP) {
        this.cap = cap;
    }

    get spent(): number { return this.used; }
    get remaining(): number { return Math.max(0, this.cap - this.used); }

    spend(): void {
        this.used += 1;
        if (this.used > this.cap) {
            throw new Error(
                `LLM call budget exhausted: ${this.used} calls attempted against a cap of ${this.cap}. ` +
                `The run was stopped rather than billed further.`,
            );
        }
    }

    /** Wraps a caller so every call it makes is counted. */
    wrap<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
        return async (...args: A) => {
            this.spend();
            return fn(...args);
        };
    }
}
