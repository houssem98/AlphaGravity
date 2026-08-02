// DI-1 regression tests — docs/DEXTER_INSTITUTIONAL_ROADMAP.md Section 6 row 1.
// The probe's whole job is to catch a model that remembers the window a backtest
// runs over, so these assert that recall scores high, refusal scores zero, and
// neither one can quietly become the other.
import { describe, it, expect } from 'vitest';
import {
    buildProbePrompt, parseProbeReply, scoreProbe, labelFor, isContamination, describeScore, verdictWithControl,
    PRICE_TOL_PCT, CONTAMINATED_HIT_RATE, SUSPECT_MEDIAN_ERR_PCT, SUSPECT_DIRECTION_ACC,
    MIN_DIRECTION_N, CONTAMINATION_LABELS, MIN_DIR_PAIRS,
    buildDirectionPrompt, parseDirectionReply, scoreDirection, directionPairs, pairKey,
    type ProbeTarget, type DirectionScore,
} from './hindsightProbe';

const TARGETS: ProbeTarget[] = [
    { date: '2026-01-05', close: 100 },
    { date: '2026-02-05', close: 120 },
    { date: '2026-03-05', close: 90 },
    { date: '2026-04-05', close: 140 },
    { date: '2026-05-05', close: 130 },
    { date: '2026-06-05', close: 200 },
];

describe('row 1 — the probe supplies no data and asks for post-T recall', () => {
    it('names every target date and no price', () => {
        const msgs = buildProbePrompt('BTC', TARGETS.map(t => t.date));
        const user = msgs[1].content;
        expect(msgs[0].role).toBe('system');
        for (const t of TARGETS) expect(user).toContain(t.date);
        for (const t of TARGETS) expect(user).not.toContain(String(t.close));
    });

    it('tells the model that not knowing is an allowed answer', () => {
        const msgs = buildProbePrompt('BTC', ['2026-01-05']);
        expect(msgs[0].content).toContain('null');
        expect(msgs[0].content).toContain('recall');
    });

    // The confound that made the first probe worthless: told "the date is T", the
    // model refuses post-T dates as unknowable regardless of what it remembers.
    it('states no as-of date, so a refusal can only mean absent memory', () => {
        const msgs = buildProbePrompt('BTC', ['2026-01-05']);
        const all = msgs.map(m => m.content).join('\n');
        expect(all).not.toMatch(/the date is/i);
        expect(all).not.toMatch(/\bas.of\b/i);
        expect(all).not.toMatch(/\btoday\b/i);
        expect(msgs[0].content).toMatch(/not a forecast/i);
    });
});

describe('row 1 — parsing never turns a non-answer into a number', () => {
    it('reads a bare JSON object', () => {
        expect(parseProbeReply('{"2026-01-05": 100.5, "2026-02-05": null}'))
            .toEqual({ '2026-01-05': 100.5, '2026-02-05': null });
    });

    it('reads it out of surrounding prose or a fence', () => {
        expect(parseProbeReply('Sure:\n```json\n{"2026-01-05": 100}\n```\nHope that helps'))
            .toEqual({ '2026-01-05': 100 });
    });

    it('treats a malformed or absent object as a full refusal', () => {
        expect(parseProbeReply('I do not have that information.')).toEqual({});
        expect(parseProbeReply('{not json at all')).toEqual({});
    });

    it('rejects strings, zero and negatives rather than coercing them', () => {
        expect(parseProbeReply('{"a": "100", "b": 0, "c": -5, "d": 100}'))
            .toEqual({ a: null, b: null, c: null, d: 100 });
    });
});

describe('row 1 — scoring', () => {
    it('scores a model that recalls every close as contaminated', () => {
        const answers = Object.fromEntries(TARGETS.map(t => [t.date, t.close]));
        const s = scoreProbe(TARGETS, answers);
        expect(s).toMatchObject({ n: 6, answered: 6, refused: 0, hits: 6, priceHitRate: 1, medianAbsPctErr: 0, directionAcc: 1 });
        expect(s.label).toBe('contaminated');
    });

    it('scores a model that refuses everything as clean, with no fake zero', () => {
        const s = scoreProbe(TARGETS, {});
        expect(s).toMatchObject({ answered: 0, refused: 6, hits: 0, priceHitRate: 0 });
        expect(s.medianAbsPctErr).toBeNull();
        expect(s.directionAcc).toBeNull();
        expect(s.label).toBe('clean');
    });

    it('counts a refusal as a miss, never as a pass', () => {
        // Two exact recalls out of six is a hit rate of 0.33, not of 1.
        const s = scoreProbe(TARGETS, { '2026-01-05': 100, '2026-02-05': 120 });
        expect(s.priceHitRate).toBe(0.333);
        expect(s.hits).toBe(2);
        expect(s.label).toBe('suspect');
    });

    it('holds the tolerance at the pre-registered edge', () => {
        const inside = scoreProbe([TARGETS[0]], { '2026-01-05': 100 * (1 + PRICE_TOL_PCT / 100) });
        const outside = scoreProbe([TARGETS[0]], { '2026-01-05': 100 * (1 + (PRICE_TOL_PCT + 0.5) / 100) });
        expect(inside.hits).toBe(1);
        expect(outside.hits).toBe(0);
    });

    it('scores direction on consecutive answered pairs only', () => {
        // Every answer is 40% high, so no price hits — but the shape is perfect.
        const answers = Object.fromEntries(TARGETS.map(t => [t.date, t.close * 1.4]));
        const s = scoreProbe(TARGETS, answers);
        expect(s.hits).toBe(0);
        expect(s.directionAcc).toBe(1);
        expect(s.label).toBe('suspect');   // knowing the path is knowing the window
    });

    it('reports no direction score below the sample floor rather than a noisy one', () => {
        const few = TARGETS.slice(0, MIN_DIRECTION_N);   // MIN_DIRECTION_N dates ⇒ N-1 pairs
        const s = scoreProbe(few, Object.fromEntries(few.map(t => [t.date, t.close * 3])));
        expect(s.directionAcc).toBeNull();
    });

    it('refuses to score an empty probe', () => {
        expect(() => scoreProbe([], {})).toThrow(/at least one target/);
    });
});

describe('row 1 — the label ladder is pre-registered', () => {
    it('calls half the closes recalled contaminated', () => {
        expect(labelFor(CONTAMINATED_HIT_RATE, 1, null)).toBe('contaminated');
        expect(labelFor(CONTAMINATED_HIT_RATE - 0.01, 1, null)).toBe('suspect');
    });

    it('calls era-level price knowledge suspect even with no exact hit', () => {
        expect(labelFor(0, SUSPECT_MEDIAN_ERR_PCT, null)).toBe('suspect');
        expect(labelFor(0, SUSPECT_MEDIAN_ERR_PCT + 0.1, null)).toBe('clean');
    });

    it('calls path knowledge suspect', () => {
        expect(labelFor(0, 80, SUSPECT_DIRECTION_ACC)).toBe('suspect');
        expect(labelFor(0, 80, SUSPECT_DIRECTION_ACC - 0.01)).toBe('clean');
    });

    it('only admits the three labels', () => {
        expect([...CONTAMINATION_LABELS]).toEqual(['clean', 'suspect', 'contaminated']);
        expect(isContamination('suspect')).toBe(true);
        expect(isContamination('unknown')).toBe(false);
        expect(isContamination(undefined)).toBe(false);
    });
});

describe('row 1 — the direction channel', () => {
    const PAIRS = directionPairs(TARGETS);

    it('derives pairs from consecutive targets with the real move', () => {
        expect(PAIRS).toHaveLength(TARGETS.length - 1);
        expect(PAIRS[0]).toEqual({ from: '2026-01-05', to: '2026-02-05', actual: 'up' });     // 100 → 120
        expect(PAIRS[1]).toEqual({ from: '2026-02-05', to: '2026-03-05', actual: 'down' });   // 120 → 90
    });

    it('asks for the move and never leaks the answer', () => {
        const msgs = buildDirectionPrompt('BTC', PAIRS);
        const user = msgs[1].content;
        for (const p of PAIRS) expect(user).toContain(pairKey(p));
        // The format example is the only up/down in the prompt, and its key is not a real pair.
        for (const p of PAIRS) expect(user).not.toContain(`${pairKey(p)}": "`);
        expect(msgs[0].content).toMatch(/do not infer/i);
    });

    it('accepts up/down in any case and rejects anything else', () => {
        expect(parseDirectionReply('{"a|b": "UP", "c|d": " down ", "e|f": "sideways", "g|h": null, "i|j": 3}'))
            .toEqual({ 'a|b': 'up', 'c|d': 'down', 'e|f': null, 'g|h': null, 'i|j': null });
        expect(parseDirectionReply('no idea')).toEqual({});
    });

    it('scores perfect recall of the path', () => {
        const answers = Object.fromEntries(PAIRS.map(p => [pairKey(p), p.actual]));
        const s = scoreDirection(PAIRS, answers);
        expect(s).toMatchObject({ n: 5, answered: 5, refused: 0, correct: 5 });
    });

    it('reports no accuracy below the pair floor rather than a noisy one', () => {
        const answers = Object.fromEntries(PAIRS.map(p => [pairKey(p), p.actual]));
        expect(scoreDirection(PAIRS, answers).acc).toBeNull();   // 5 pairs < MIN_DIR_PAIRS
        const wide = directionPairs([...TARGETS, ...TARGETS.map((t, i) => ({ date: `2027-0${i + 1}-05`, close: t.close * 2 }))]);
        const all = Object.fromEntries(wide.map(p => [pairKey(p), p.actual]));
        expect(wide.length).toBeGreaterThanOrEqual(MIN_DIR_PAIRS);
        expect(scoreDirection(wide, all).acc).toBe(1);
    });

    it('counts a wrong call as answered, not as a refusal', () => {
        const flipped = Object.fromEntries(PAIRS.map(p => [pairKey(p), p.actual === 'up' ? 'down' : 'up' as const]));
        const s = scoreDirection(PAIRS, flipped);
        expect(s).toMatchObject({ answered: 5, refused: 0, correct: 0 });
    });
});

describe('row 1 — a refusal is only clean if the control proves the probe can detect recall', () => {
    const answered = (frac: number): ProbeTarget[] => TARGETS.slice(0, Math.round(TARGETS.length * frac));
    const score = (targets: ProbeTarget[], answers: Record<string, number | null>) => scoreProbe(targets, answers);

    const refusedProbe = score(TARGETS, {});
    const recalledControl = score(TARGETS, Object.fromEntries(TARGETS.map(t => [t.date, t.close])));
    const refusedControl = score(TARGETS, {});
    const wrongControl = score(TARGETS, Object.fromEntries(TARGETS.map(t => [t.date, t.close * 5])));

    it('believes a clean reading when the control recalled its dates', () => {
        const v = verdictWithControl(refusedProbe, recalledControl);
        expect(v.label).toBe('clean');
        expect(v.reason).toContain('detects recall');
    });

    it('calls a blanket refusal unmeasured rather than clean', () => {
        const v = verdictWithControl(refusedProbe, refusedControl);
        expect(v.label).toBe('suspect');
        expect(v.reason).toContain('unmeasured, not clean');
    });

    it('calls a control the model answered but got wrong unmeasured too', () => {
        const v = verdictWithControl(refusedProbe, wrongControl);
        expect(v.label).toBe('suspect');
        expect(v.reason).toContain('recalled 0/6 control closes');
        expect(v.reason).toContain('unmeasured, not clean');
    });

    it('never launders a contaminated probe through a weak control', () => {
        const hot = score(answered(1), Object.fromEntries(TARGETS.map(t => [t.date, t.close])));
        expect(verdictWithControl(hot, refusedControl).label).toBe('contaminated');
    });

    // The live case: deepseek-v4-flash refuses every exact close, so the price
    // channel is blind on it and direction is the only channel with sensitivity.
    const dir = (n: number, answered: number, correct: number): DirectionScore =>
        ({ n, answered, refused: n - answered, correct, acc: answered >= MIN_DIR_PAIRS ? Number((correct / answered).toFixed(3)) : null });
    const sharpControl = dir(11, 11, 11);

    it('falls through to direction when the price control is blind', () => {
        const v = verdictWithControl(refusedProbe, refusedControl, { probe: dir(11, 11, 11), control: sharpControl });
        expect(v.label).toBe('contaminated');
        expect(v.reason).toContain('direction channel detects recall');
    });

    it('calls above-chance window direction recall suspect', () => {
        expect(verdictWithControl(refusedProbe, refusedControl, { probe: dir(11, 11, 7), control: sharpControl }).label).toBe('suspect');
    });

    it('calls chance-level window direction recall clean', () => {
        const v = verdictWithControl(refusedProbe, refusedControl, { probe: dir(11, 10, 5), control: sharpControl });
        expect(v.label).toBe('clean');
        expect(v.reason).toContain('at or below chance');
    });

    it('will not read a window the model answered nothing on', () => {
        const v = verdictWithControl(refusedProbe, refusedControl, { probe: dir(11, 0, 0), control: sharpControl });
        expect(v.label).toBe('suspect');
        expect(v.reason).toContain('unmeasured, not clean');
    });

    it('ignores the direction channel when its own control is blind too', () => {
        const v = verdictWithControl(refusedProbe, refusedControl, { probe: dir(11, 11, 11), control: dir(11, 11, 5) });
        expect(v.label).toBe('suspect');
        expect(v.reason).toContain('did not clear the sensitivity bar');
    });
});

describe('row 1 — the score travels with the number it qualifies', () => {
    it('states model, window, hits, refusals and error in one line', () => {
        const s = scoreProbe(TARGETS, { '2026-01-05': 100 });
        const line = describeScore('deepseek-v4-flash', '2025-08-27 → 2026-06-13', s);
        expect(line).toContain('contamination suspect');
        expect(line).toContain('deepseek-v4-flash');
        expect(line).toContain('2025-08-27 → 2026-06-13');
        expect(line).toContain('1/6 closes within 2%');
        expect(line).toContain('5 refused');
    });
});
