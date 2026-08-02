// Dexter Portfolio — DI-6, docs/DEXTER_INSTITUTIONAL_ROADMAP.md row 10.
//
// G4: every decision was standalone. Ten "BUY BTC" calls in a row were ten
// independent full-size positions, and nothing anywhere knew that ETH and SOL
// are the same trade wearing different tickers. That alone disqualifies the
// output at a multi-manager, which is why this gate is code and not prose.
//
// Three limits, applied in order, each of which can only shrink a position:
//   1. correlation — a candidate that moves with an open position is not a new
//      trade, it is more of the one already on. Same direction: its risk is
//      charged against the correlated cluster's budget. Opposite direction on a
//      highly correlated pair: refused outright, because holding both sides pays
//      two lots of costs to own approximately nothing.
//   2. portfolio heat — total risk across open positions may never exceed the
//      budget. A candidate that does not fit is resized to what is left, or
//      rejected when nothing is left.
//   3. gross exposure — the sum of position sizes, which binds before heat does
//      whenever stops are wide.
// Correlation is COMPUTED from returns (doctrine 2), never asserted by a model.

export type Direction = 'long' | 'short';

export interface OpenPosition {
    symbol: string;
    direction: Direction;
    /** Notional as a percent of equity. */
    sizePct: number;
    /** Percent of equity at risk if its stop is hit. */
    riskPct: number;
}

export interface Candidate {
    symbol: string;
    direction: Direction;
    sizePct: number;
    riskPct: number;
}

/** Total risk allowed across all open positions at once. */
export const MAX_PORTFOLIO_HEAT_PCT = 6;
/** Above this, two instruments are treated as one trade. */
export const MAX_CORRELATION = 0.7;
/** Sum of position sizes allowed at once. */
export const MAX_GROSS_EXPOSURE_PCT = 100;
/** Below this summed variance a return series has not moved; correlation is undefined. */
export const VARIANCE_EPSILON = 1e-12;

export type Admission = 'accepted' | 'resized' | 'rejected';

export interface AdmissionResult {
    admission: Admission;
    sizePct: number;
    riskPct: number;
    /** Which limits bound the decision, in the order applied. */
    binding: string[];
    reasons: string[];
    heatBefore: number;
    heatAfter: number;
}

export const portfolioHeat = (positions: OpenPosition[]): number =>
    Number(positions.reduce((a, p) => a + p.riskPct, 0).toFixed(4));

export const grossExposure = (positions: OpenPosition[]): number =>
    Number(positions.reduce((a, p) => a + Math.abs(p.sizePct), 0).toFixed(4));

/** Simple returns from a close series. Needs two closes to produce one return. */
export function returnsFrom(closes: number[]): number[] {
    const out: number[] = [];
    for (let i = 1; i < closes.length; i++) {
        if (!(closes[i - 1] > 0)) continue;
        out.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
    return out;
}

/**
 * Pearson correlation over the overlapping tail of two return series.
 * Returns null rather than a number when there is not enough overlap or when
 * either series is flat — an undefined correlation is not zero correlation.
 */
export function correlation(a: number[], b: number[], minPairs = 20): number | null {
    const n = Math.min(a.length, b.length);
    if (n < minPairs) return null;
    const x = a.slice(-n);
    const y = b.slice(-n);
    const mx = x.reduce((s, v) => s + v, 0) / n;
    const my = y.reduce((s, v) => s + v, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
        num += (x[i] - mx) * (y[i] - my);
        dx += (x[i] - mx) ** 2;
        dy += (y[i] - my) ** 2;
    }
    // Not `=== 0`: a constant series leaves float dust of order 1e-35 in the
    // sums, which sails past an exact-zero check and yields a confident +1 for
    // two series that never moved. Found by the flat-series test.
    if (!(dx > VARIANCE_EPSILON) || !(dy > VARIANCE_EPSILON)) return null;
    return Number((num / Math.sqrt(dx * dy)).toFixed(4));
}

export interface AdmitOptions {
    /** symbol → correlation with the candidate. A missing or null entry is treated as unknown. */
    correlations?: Record<string, number | null>;
    maxHeatPct?: number;
    maxCorrelation?: number;
    maxGrossPct?: number;
}

const round = (n: number): number => Number(n.toFixed(4));

export function admit(
    candidate: Candidate,
    positions: OpenPosition[],
    opts: AdmitOptions = {},
): AdmissionResult {
    const maxHeat = opts.maxHeatPct ?? MAX_PORTFOLIO_HEAT_PCT;
    const maxCorr = opts.maxCorrelation ?? MAX_CORRELATION;
    const maxGross = opts.maxGrossPct ?? MAX_GROSS_EXPOSURE_PCT;
    const correlations = opts.correlations ?? {};

    const heatBefore = portfolioHeat(positions);
    const binding: string[] = [];
    const reasons: string[] = [];

    const reject = (reason: string): AdmissionResult => ({
        admission: 'rejected',
        sizePct: 0,
        riskPct: 0,
        binding: [...binding, 'rejected'],
        reasons: [...reasons, reason],
        heatBefore,
        heatAfter: heatBefore,
    });

    if (!(candidate.riskPct > 0) || !(candidate.sizePct > 0)) {
        return reject('candidate has no size or no risk — nothing to admit');
    }

    // An existing position in the same symbol is the same trade by definition,
    // whatever the correlation series says.
    const sameSymbol = positions.filter(p => p.symbol === candidate.symbol);
    const correlated = positions.filter(p => {
        if (p.symbol === candidate.symbol) return true;
        const c = correlations[p.symbol];
        return c !== null && c !== undefined && Math.abs(c) >= maxCorr;
    });

    for (const p of correlated) {
        const c = p.symbol === candidate.symbol ? 1 : correlations[p.symbol]!;
        if (p.direction !== candidate.direction) {
            return reject(
                `${candidate.symbol} ${candidate.direction} is ${c} correlated with the open ` +
                `${p.symbol} ${p.direction}; holding both sides of one trade pays two lots of costs ` +
                'to own approximately nothing',
            );
        }
    }

    let riskPct = candidate.riskPct;
    let sizePct = candidate.sizePct;

    if (correlated.length > 0) {
        binding.push('correlation');
        const clusterRisk = portfolioHeat(correlated);
        reasons.push(
            `treated as an addition to an existing ${correlated.map(p => p.symbol).join('/')} exposure ` +
            `(${correlated.map(p => (p.symbol === candidate.symbol ? 'same symbol' : `r=${correlations[p.symbol]}`)).join(', ')}), ` +
            `cluster already risking ${clusterRisk}%`,
        );
        if (sameSymbol.length > 0) reasons.push(`${candidate.symbol} is already open — this is a top-up, not a new trade`);
    }

    // Heat: the hard one. Total risk across everything open may never exceed it.
    const room = round(maxHeat - heatBefore);
    if (room <= 0) {
        return reject(`portfolio heat is already ${heatBefore}% against a ${maxHeat}% budget — no room for any new risk`);
    }
    if (riskPct > room) {
        binding.push('heat');
        const scale = room / riskPct;
        reasons.push(
            `risk ${riskPct}% exceeds the ${round(room)}% of heat left under the ${maxHeat}% budget; ` +
            `scaled by ${round(scale)}`,
        );
        riskPct = room;
        sizePct = round(sizePct * scale);
    }

    // Gross exposure, which binds first whenever stops are wide.
    const grossBefore = grossExposure(positions);
    const grossRoom = round(maxGross - grossBefore);
    if (grossRoom <= 0) {
        return reject(`gross exposure is already ${grossBefore}% against a ${maxGross}% cap — no room for any new position`);
    }
    if (sizePct > grossRoom) {
        binding.push('gross-exposure');
        const scale = grossRoom / sizePct;
        reasons.push(
            `size ${sizePct}% exceeds the ${grossRoom}% of gross exposure left under the ${maxGross}% cap; ` +
            `scaled by ${round(scale)}`,
        );
        sizePct = grossRoom;
        riskPct = round(riskPct * scale);
    }

    const resized = round(sizePct) !== round(candidate.sizePct) || round(riskPct) !== round(candidate.riskPct);
    if (resized) reasons.push(`resized ${candidate.sizePct}% → ${round(sizePct)}% (risk ${candidate.riskPct}% → ${round(riskPct)}%)`);
    else reasons.push(`accepted at full size: heat ${heatBefore}% + ${riskPct}% fits the ${maxHeat}% budget`);

    return {
        admission: resized ? 'resized' : 'accepted',
        sizePct: round(sizePct),
        riskPct: round(riskPct),
        binding,
        reasons,
        heatBefore,
        heatAfter: round(heatBefore + riskPct),
    };
}

export function describeAdmission(r: AdmissionResult): string {
    return `${r.admission.toUpperCase()} · size ${r.sizePct}% · risk ${r.riskPct}% · ` +
        `heat ${r.heatBefore}% → ${r.heatAfter}% — ${r.reasons.join('; ')}`;
}
