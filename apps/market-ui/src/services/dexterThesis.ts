// Dexter Thesis — DI-12, docs/DEXTER_INSTITUTIONAL_ROADMAP.md row 16.
//
// G10: memory was a flat journal. Dexter could recall "I called BTC short in
// March" but could not say "and I am now calling it long, on the same evidence,
// without acknowledging it." That second sentence is the one a PM cares about,
// because an unexplained stance flip is either new information or a coin toss,
// and the difference is visible only if the evidence is compared, not the prose.
//
// The rule enforced here: a flip is fine, an UNEXPLAINED flip is not. Reversing
// a view on evidence the prior thesis already had is flagged as a contradiction
// with both sides quoted, so it surfaces instead of being smoothed over.

export type Stance = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface ThesisRecord {
    symbol: string;
    /** Epoch ms of the call. */
    ts: number;
    stance: Stance;
    thesis: string;
    /**
     * Stable identifiers for the evidence the thesis rests on — citation
     * sources, level prices, headline ids. What matters is that two theses
     * built from the same facts produce the same keys.
     */
    evidenceKeys: string[];
    confidence?: number | null;
}

export interface ThesisLink {
    prior: ThesisRecord | null;
    /** Days between the prior thesis and this one. */
    ageDays: number | null;
    flipped: boolean;
    /** Evidence in the new thesis the prior one did not have. */
    newEvidence: string[];
    /** Evidence the prior thesis had that this one dropped. */
    droppedEvidence: string[];
    /** Set when the stance reversed with nothing new to justify it. */
    contradiction: string | null;
    notes: string[];
}

export const DAY_MS = 86_400_000;

const opposed = (a: Stance, b: Stance): boolean =>
    (a === 'BULLISH' && b === 'BEARISH') || (a === 'BEARISH' && b === 'BULLISH');

/** Most recent prior thesis on the same symbol, strictly before `current.ts`. */
export function priorFor(current: ThesisRecord, history: ThesisRecord[]): ThesisRecord | null {
    return history
        .filter(h => h.symbol === current.symbol && h.ts < current.ts)
        .sort((a, b) => b.ts - a.ts)[0] ?? null;
}

export function linkThesis(current: ThesisRecord, history: ThesisRecord[]): ThesisLink {
    const prior = priorFor(current, history);
    if (!prior) {
        return {
            prior: null,
            ageDays: null,
            flipped: false,
            newEvidence: [...current.evidenceKeys],
            droppedEvidence: [],
            contradiction: null,
            notes: [`no prior thesis on ${current.symbol} — this is the first`],
        };
    }

    const priorKeys = new Set(prior.evidenceKeys);
    const currentKeys = new Set(current.evidenceKeys);
    const newEvidence = current.evidenceKeys.filter(k => !priorKeys.has(k));
    const droppedEvidence = prior.evidenceKeys.filter(k => !currentKeys.has(k));
    const flipped = opposed(prior.stance, current.stance);
    const ageDays = Number(((current.ts - prior.ts) / DAY_MS).toFixed(2));

    const notes = [
        `prior thesis on ${current.symbol} was ${prior.stance} ${ageDays} days ago: "${prior.thesis}"`,
        newEvidence.length > 0
            ? `${newEvidence.length} new piece(s) of evidence since: ${newEvidence.join(', ')}`
            : 'no new evidence since the prior thesis',
    ];

    let contradiction: string | null = null;
    if (flipped && newEvidence.length === 0) {
        contradiction =
            `stance flipped ${prior.stance} → ${current.stance} on ${current.symbol} after ${ageDays} days ` +
            `with NO new evidence. Prior: "${prior.thesis}". Now: "${current.thesis}". ` +
            'A reversal with nothing new behind it is a coin toss wearing a thesis.';
        notes.push('CONTRADICTION: unexplained stance flip');
    } else if (flipped) {
        notes.push(`stance flipped ${prior.stance} → ${current.stance}, justified by: ${newEvidence.join(', ')}`);
    }

    return { prior, ageDays, flipped, newEvidence, droppedEvidence, contradiction, notes };
}

/** The line the note carries so a reader sees the history without asking for it. */
export function renderThesisLink(link: ThesisLink): string {
    if (!link.prior) return link.notes[0];
    if (link.contradiction) return `⚠ ${link.contradiction}`;
    return link.notes.join(' · ');
}

/**
 * Evidence keys from the parts of a call that are stable across sessions:
 * citation sources and the levels the plan was built on. Deliberately not the
 * prose — two identical arguments worded differently must key the same.
 */
export function evidenceKeysOf(input: {
    citations?: Array<{ source?: string; title?: string }>;
    levels?: number[];
    regime?: string;
}): string[] {
    const keys = new Set<string>();
    for (const c of input.citations ?? []) {
        const k = `${c.source ?? 'unknown'}:${(c.title ?? '').slice(0, 60)}`.trim();
        if (k !== 'unknown:') keys.add(k);
    }
    for (const l of input.levels ?? []) keys.add(`level:${l}`);
    if (input.regime) keys.add(`regime:${input.regime}`);
    return [...keys].sort();
}
