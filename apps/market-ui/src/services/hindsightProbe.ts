// Dexter Hindsight Probe — DI-1, docs/DEXTER_INSTITUTIONAL_ROADMAP.md rows 1-2.
//
// dexterReplay guards DATA leakage. Nothing guarded the model's TRAINING memory,
// so every number DX-15 and DX-17 produced could be recall rather than skill —
// both arms went overwhelmingly short into a market that fell, which is exactly
// what a model that remembers 2026 would do.
//
// The probe is the control: with no data supplied, ask the model for closes on
// dates AFTER the as-of date and score what comes back. A model that cannot
// recall them answers null and scores zero; a model that names them to within
// 2% is not forecasting.
//
// Thresholds below are PRE-REGISTERED (doctrine 5). They were fixed before the
// first probe ran and are not to be moved to make a window pass.

import type { ChatMessage } from './dexterLlm.js';

export type Contamination = 'clean' | 'suspect' | 'contaminated';

export const CONTAMINATION_LABELS: readonly Contamination[] = ['clean', 'suspect', 'contaminated'];

/** A daily close named to within this percent is recall, not inference. */
export const PRICE_TOL_PCT = 2;
export const CONTAMINATED_HIT_RATE = 0.5;
export const SUSPECT_DIRECTION_ACC = 0.75;
export const SUSPECT_MEDIAN_ERR_PCT = 10;
export const MIN_DIRECTION_N = 4;

export interface ProbeTarget {
    /** YYYY-MM-DD, strictly after the as-of date. */
    date: string;
    /** The real close, held back from the model and used only for scoring. */
    close: number;
}

export interface ProbeScore {
    n: number;
    answered: number;
    refused: number;
    hits: number;
    /** hits / n — a refusal counts as a miss, never as a free pass. */
    priceHitRate: number;
    /** Over answered dates only; null if the model refused everything. */
    medianAbsPctErr: number | null;
    /** Sign agreement on consecutive answered pairs; null below MIN_DIRECTION_N. */
    directionAcc: number | null;
    label: Contamination;
}

// NOTE ON FRAMING, learned the hard way and kept as a warning. The first version
// of this prompt opened with "The date is <asOf>", mirroring the replay's as-of
// convention. deepseek-v4-flash then refused every date, and its reasoning trace
// gave the reason: "these are in the future relative to the stated date, so we
// cannot know" — a refusal caused by the role-play, not by absent memory. That
// probe measured compliance and would have scored a contaminated window clean.
// The prompt therefore states no date at all: the only question is whether the
// training data holds these closes. The as-of belongs to the window bookkeeping
// in the runner, never to the question put to the model.
export function buildProbePrompt(symbol: string, dates: string[]): ChatMessage[] {
    return [
        {
            role: 'system',
            content:
                'You are being audited for what your training data contains. This is a recall ' +
                'test, not a forecast and not a reasoning task. State only figures you actually ' +
                'remember. If you do not remember one, answer null. Never estimate, interpolate ' +
                'or derive a value, and do not reason about whether you ought to know it.',
        },
        {
            role: 'user',
            content:
                `State ${symbol}'s daily closing price in USD on each date below.\n` +
                dates.map(d => `- ${d}`).join('\n') +
                '\n\nReply with a single JSON object and nothing else, mapping each date ' +
                'to a number or to null. Example: {"2019-01-02": 12345.6, "2019-01-09": null}',
        },
    ];
}

/** Pulls the JSON object out of a reply. A malformed blob is a full refusal, never a guess. */
export function parseProbeReply(text: string): Record<string, number | null> {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return {};
    let raw: unknown;
    try {
        raw = JSON.parse(text.slice(start, end + 1));
    } catch {
        return {};
    }
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        out[k] = typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
    }
    return out;
}

function median(xs: number[]): number {
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const round = (x: number): number => Number(x.toFixed(3));

export function scoreProbe(targets: ProbeTarget[], answers: Record<string, number | null>): ProbeScore {
    if (targets.length === 0) throw new Error('hindsight probe needs at least one target date');

    const errs: number[] = [];
    let answered = 0;
    let hits = 0;
    for (const t of targets) {
        const a = answers[t.date] ?? null;
        if (a === null) continue;
        answered++;
        const err = (Math.abs(a - t.close) / t.close) * 100;
        errs.push(err);
        if (err <= PRICE_TOL_PCT) hits++;
    }

    let dirPairs = 0;
    let dirHits = 0;
    for (let i = 1; i < targets.length; i++) {
        const prev = answers[targets[i - 1].date] ?? null;
        const cur = answers[targets[i].date] ?? null;
        if (prev === null || cur === null) continue;
        dirPairs++;
        if (Math.sign(cur - prev) === Math.sign(targets[i].close - targets[i - 1].close)) dirHits++;
    }

    const priceHitRate = round(hits / targets.length);
    const medianAbsPctErr = errs.length ? round(median(errs)) : null;
    const directionAcc = dirPairs >= MIN_DIRECTION_N ? round(dirHits / dirPairs) : null;

    return {
        n: targets.length,
        answered,
        refused: targets.length - answered,
        hits,
        priceHitRate,
        medianAbsPctErr,
        directionAcc,
        label: labelFor(priceHitRate, medianAbsPctErr, directionAcc),
    };
}

export function labelFor(
    priceHitRate: number,
    medianAbsPctErr: number | null,
    directionAcc: number | null,
): Contamination {
    if (priceHitRate >= CONTAMINATED_HIT_RATE) return 'contaminated';
    if (priceHitRate > 0) return 'suspect';
    if (medianAbsPctErr !== null && medianAbsPctErr <= SUSPECT_MEDIAN_ERR_PCT) return 'suspect';
    if (directionAcc !== null && directionAcc >= SUSPECT_DIRECTION_ACC) return 'suspect';
    return 'clean';
}

// SECOND CHANNEL. deepseek-v4-flash refuses every exact-close question, control
// window included, so the price channel measures nothing on it. Direction is the
// recall that matters anyway: G1's charge is that both replay arms went short
// into a fall, which needs only the shape of the window, not its levels. Chance
// is 0.5 here, so the bar is set well above it.
export type Direction = 'up' | 'down';

export const CONTAM_DIR_ACC = 0.75;
export const MIN_DIR_PAIRS = 8;

export interface DirectionPair {
    from: string;
    to: string;
    actual: Direction;
}

export interface DirectionScore {
    n: number;
    answered: number;
    refused: number;
    correct: number;
    /** correct / answered; null below MIN_DIR_PAIRS answered, never a noisy number. */
    acc: number | null;
}

export const pairKey = (p: { from: string; to: string }): string => `${p.from}|${p.to}`;

export function directionPairs(targets: ProbeTarget[]): DirectionPair[] {
    const out: DirectionPair[] = [];
    for (let i = 1; i < targets.length; i++) {
        out.push({
            from: targets[i - 1].date,
            to: targets[i].date,
            actual: targets[i].close >= targets[i - 1].close ? 'up' : 'down',
        });
    }
    return out;
}

export function buildDirectionPrompt(symbol: string, pairs: DirectionPair[]): ChatMessage[] {
    return [
        {
            role: 'system',
            content:
                'You are being audited for what your training data contains. This is a recall ' +
                'test, not a forecast and not a reasoning task. Answer only from what you ' +
                'remember of how the market actually moved. If you do not remember, answer null. ' +
                'Do not infer a direction from trends, halvings, cycles or any other model.',
        },
        {
            role: 'user',
            content:
                `For each pair of dates below, did ${symbol} close HIGHER or LOWER on the second date than on the first?\n` +
                pairs.map(p => `- ${pairKey(p)}`).join('\n') +
                '\n\nReply with a single JSON object and nothing else, mapping each pair exactly ' +
                'as written to "up", "down" or null. Example: {"2019-01-02|2019-01-09": "up"}',
        },
    ];
}

export function parseDirectionReply(text: string): Record<string, Direction | null> {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return {};
    let raw: unknown;
    try {
        raw = JSON.parse(text.slice(start, end + 1));
    } catch {
        return {};
    }
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, Direction | null> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
        out[k] = s === 'up' || s === 'down' ? s : null;
    }
    return out;
}

export function scoreDirection(pairs: DirectionPair[], answers: Record<string, Direction | null>): DirectionScore {
    if (pairs.length === 0) throw new Error('hindsight probe needs at least one direction pair');
    let answered = 0;
    let correct = 0;
    for (const p of pairs) {
        const a = answers[pairKey(p)] ?? null;
        if (a === null) continue;
        answered++;
        if (a === p.actual) correct++;
    }
    return {
        n: pairs.length,
        answered,
        refused: pairs.length - answered,
        correct,
        acc: answered >= MIN_DIR_PAIRS ? round(correct / answered) : null,
    };
}

export interface ProbeVerdict {
    label: Contamination;
    reason: string;
}

// A full refusal on the replay window scores 'clean' — but a model that refuses
// EVERY price question refuses the window for policy reasons, not for ignorance,
// and a probe that cannot detect recall where recall must exist has not
// demonstrated it can detect recall anywhere. The control arm asks for closes
// from well before the window; only if the model recalls those has the probe
// shown any sensitivity, and only then may a 'clean' reading be believed.
export interface DirectionArm {
    probe: DirectionScore;
    control: DirectionScore;
}

export function verdictWithControl(probe: ProbeScore, control: ProbeScore, dir?: DirectionArm): ProbeVerdict {
    if (probe.label !== 'clean') {
        return { label: probe.label, reason: `post-T recall ${probe.hits}/${probe.n} within ${PRICE_TOL_PCT}%` };
    }
    if (control.hits > 0) {
        return {
            label: 'clean',
            reason: `control recall ${control.hits}/${control.n} within ${PRICE_TOL_PCT}% shows the probe ` +
                `detects recall; post-T recall ${probe.hits}/${probe.n} with ${probe.refused} refusals`,
        };
    }

    // The price channel showed no sensitivity — it failed to detect recall on a
    // window the model must have seen — so its 'clean' reading is worthless.
    // Fall through to direction, which is only believable on the same terms.
    const priceBlind = control.answered === 0
        ? `the model refused all ${control.n} control dates as well`
        : `the model recalled 0/${control.n} control closes within ${PRICE_TOL_PCT}%`;

    if (dir && dir.control.acc !== null && dir.control.acc >= CONTAM_DIR_ACC) {
        const acc = dir.probe.acc;
        if (acc === null) {
            return {
                label: 'suspect',
                reason: `${priceBlind}; the model then answered only ${dir.probe.answered}/${dir.probe.n} ` +
                    `direction pairs on the window, below the ${MIN_DIR_PAIRS}-pair floor — unmeasured, not clean`,
            };
        }
        const shared = `${priceBlind}, but control direction recall ${dir.control.acc} shows the direction ` +
            `channel detects recall; window direction recall ${dir.probe.correct}/${dir.probe.answered} = ${acc}`;
        if (acc >= CONTAM_DIR_ACC) return { label: 'contaminated', reason: shared };
        if (acc > 0.5) return { label: 'suspect', reason: `${shared} — above chance` };
        return { label: 'clean', reason: `${shared} — at or below chance` };
    }

    return {
        label: 'suspect',
        reason: `${priceBlind}${dir ? ' and the direction control did not clear the sensitivity bar' : ''}, ` +
            'so the probe cannot tell ignorance of the window from a blanket refusal policy — unmeasured, not clean',
    };
}

// One run of this probe is not a measurement. Live replication found the control
// arm answering 11/11 direction pairs on one run and refusing all 11 on the next,
// at the same temperature — so a window's label is the WORST reading across
// replicates. A single rep that detects recall condemns the window; 'clean'
// requires every rep to agree.
export function worstLabel(labels: Contamination[]): Contamination {
    if (labels.length === 0) throw new Error('a contamination label needs at least one replicate');
    if (labels.includes('contaminated')) return 'contaminated';
    if (labels.includes('suspect')) return 'suspect';
    return 'clean';
}

export function isContamination(v: unknown): v is Contamination {
    return typeof v === 'string' && (CONTAMINATION_LABELS as readonly string[]).includes(v);
}

/** One line a ledger or a summary can carry with the number it qualifies. */
export function describeScore(model: string, window: string, s: ProbeScore): string {
    return `contamination ${s.label} — ${model} probed over ${window}: ` +
        `${s.hits}/${s.n} closes within ${PRICE_TOL_PCT}%, ${s.refused} refused, ` +
        `median error ${s.medianAbsPctErr === null ? 'n/a' : `${s.medianAbsPctErr}%`}, ` +
        `direction ${s.directionAcc === null ? 'n/a' : s.directionAcc}`;
}
