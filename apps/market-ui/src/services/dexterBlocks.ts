// DD-8 — the structured-answer contract (docs/DEXTER_DESIGN_ROADMAP.md).
//
// The one thing a trader must scan in under a second is the levels and the
// plan, and both arrived as undifferentiated prose. This module is the seam
// that turns them into components.
//
// The blocks are emitted by the SERVER from data that already validated —
// `taLevels()` is deterministic TA over real bars, `TradePlan` is the risk
// block that passed `parsePlan` — not by asking the model to write JSON. A
// ladder rendered from a model-authored number would make an invented level
// look authoritative, which is exactly the regression doctrine 2 forbids.
//
// The client's job is only to paint what the server already stood behind, and
// to fall back to a plain code block for anything it does not recognise.

export interface DexterLevel {
    price: number;
    touches: number;
}

export interface DexterLevelsBlock {
    lastClose: number | null;
    trend: 'up' | 'down' | 'range';
    atr: number | null;
    unit: string;
    support: DexterLevel[];
    resistance: DexterLevel[];
}

export interface DexterPlanBlock {
    action: string;
    entry: number;
    stop: number;
    target: number;
    sizePct: number;
    rr: number;
    unit: string;
}

export const LEVELS_LANG = 'dexter-levels';
export const PLAN_LANG = 'dexter-plan';

/** How many levels a side may contribute. The ladder is a glance, not a table. */
export const MAX_LEVELS_PER_SIDE = 4;

const fence = (lang: string, value: unknown) =>
    '```' + lang + '\n' + JSON.stringify(value) + '\n```';

export function renderLevelsBlock(block: DexterLevelsBlock): string {
    return fence(LEVELS_LANG, block);
}

export function renderPlanBlock(block: DexterPlanBlock): string {
    return fence(PLAN_LANG, block);
}

/** A plan is a card only if it carries all four numbers a trade needs. A
 *  partial card would read as an executable plan that is missing its stop. */
export function isCompletePlan(v: unknown): v is DexterPlanBlock {
    const p = v as Partial<DexterPlanBlock> | null;
    if (!p || typeof p !== 'object') return false;
    return (['entry', 'stop', 'target', 'rr'] as const).every(
        k => typeof p[k] === 'number' && Number.isFinite(p[k] as number),
    );
}

export function isLevelsBlock(v: unknown): v is DexterLevelsBlock {
    const b = v as Partial<DexterLevelsBlock> | null;
    if (!b || typeof b !== 'object') return false;
    return Array.isArray(b.support) && Array.isArray(b.resistance);
}

/** Parse a fenced block's body. Returns null on anything malformed — the caller
 *  then renders the raw text as a code block rather than throwing. */
export function parseBlock(body: string): unknown {
    try {
        return JSON.parse(body);
    } catch {
        return null;
    }
}

/** `language-dexter-plan` → `dexter-plan`. Any other className → null. */
export function dexterLang(className?: string): string | null {
    const m = /(?:^|\s)language-(dexter-[\w-]+)/.exec(className ?? '');
    return m ? m[1] : null;
}
