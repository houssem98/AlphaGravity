// The universal sentiment skill, as the Company page consumes it.
//
// The surface this replaces asked `GET /v1/analytics/sentiment/{ticker}` with a
// `document_id` it had to already hold, and that endpoint is a CACHE READ: it
// answered 404 for every company, always. There was no allowlist — there was no
// path. `GET /v1/skills/sentiment?company=` is the path, and it works for any
// mention that resolves to an SEC registrant.
//
// This module is the mapping and the refusal rule, kept out of the component so
// both can be asserted without a DOM. The rule that matters:
//
//     a result with an abstaining status carries NO score
//
// `insufficient_data`, `ambiguous_entity` and `error` all come back 200, because
// each is a correct answer that happens to be "no". Rendering the `0` that a
// missing `overall_score` coerces to would turn all three into "neutral
// sentiment", which is a fabricated reading of a company nobody measured.

export type SkillStatus =
    | 'success' | 'partial' | 'insufficient_data' | 'ambiguous_entity'
    | 'unsupported_operation' | 'conflicting_evidence' | 'error';

/** Statuses that must never render a number. */
export const ABSTAINING: ReadonlySet<SkillStatus> = new Set<SkillStatus>([
    'insufficient_data', 'ambiguous_entity', 'unsupported_operation', 'error',
]);

export interface SkillEvidence {
    text: string;
    label: 'positive' | 'negative' | 'neutral';
    score: number;
    source_class: string;
    citation: number;
    section?: string;
}

export interface SkillChannel {
    channel: string;
    state: 'success' | 'empty' | 'failed' | 'timeout' | 'unavailable';
    count?: number;
    error_type?: string;
}

export interface SentimentSkillResponse {
    skill?: string;
    status?: SkillStatus;
    entities?: { ticker?: string; display_name?: string; status?: string;
                 candidates?: { ticker: string; name: string }[] }[];
    period?: string;
    data?: {
        overall?: string;
        overall_score?: number;
        conflicting?: boolean;
        counts?: { positive: number; negative: number; neutral: number };
        scored_sentences?: number;
        positive_evidence?: SkillEvidence[];
        negative_evidence?: SkillEvidence[];
        neutral_evidence?: SkillEvidence[];
        source_mix?: Record<string, number>;
        window?: { start?: string; end?: string; basis?: string; filings?: string[] };
        trend?: number | null;
        trend_note?: string;
    };
    citations?: Record<string, unknown>[];
    limitations?: string[];
    channels?: SkillChannel[];
}

/** What the Sentiment tab renders. `score === null` means "show no number". */
export interface SentimentView {
    status: SkillStatus;
    /** null whenever the skill abstained. Never 0 standing in for absent. */
    score: number | null;
    label: string;
    period: string;
    counts: { positive: number; negative: number; neutral: number };
    scoredSentences: number;
    positive: SkillEvidence[];
    negative: SkillEvidence[];
    neutral: SkillEvidence[];
    sourceMix: Record<string, number>;
    window: { start: string; end: string; basis: string; filings: string[] };
    citations: Record<string, unknown>[];
    limitations: string[];
    /** Set when a provider failed, so the UI never calls an outage "no data". */
    failedChannels: SkillChannel[];
    conflicting: boolean;
    candidates: { ticker: string; name: string }[];
    trendNote: string;
}

const EMPTY_COUNTS = { positive: 0, negative: 0, neutral: 0 };

export function toView(body: SentimentSkillResponse | null | undefined): SentimentView | null {
    if (!body || !body.status) return null;
    const status = body.status;
    const d = body.data ?? {};
    const abstained = ABSTAINING.has(status);
    const raw = d.overall_score;

    return {
        status,
        // The whole point: an abstention has no number, and a result that
        // simply did not carry one does not get a zero either.
        score: abstained || typeof raw !== 'number' ? null : raw,
        label: abstained ? '' : (d.overall ?? ''),
        period: body.period ?? '',
        counts: d.counts ?? EMPTY_COUNTS,
        scoredSentences: d.scored_sentences ?? 0,
        positive: d.positive_evidence ?? [],
        negative: d.negative_evidence ?? [],
        neutral: d.neutral_evidence ?? [],
        sourceMix: d.source_mix ?? {},
        window: {
            start: d.window?.start ?? '',
            end: d.window?.end ?? '',
            basis: d.window?.basis ?? '',
            filings: d.window?.filings ?? [],
        },
        citations: body.citations ?? [],
        limitations: body.limitations ?? [],
        failedChannels: (body.channels ?? []).filter(
            c => c.state === 'failed' || c.state === 'timeout' || c.state === 'unavailable',
        ),
        conflicting: status === 'conflicting_evidence' || Boolean(d.conflicting),
        candidates: (body.entities?.[0]?.candidates ?? []).map(
            c => ({ ticker: c.ticker, name: c.name }),
        ),
        trendNote: d.trend_note ?? '',
    };
}

/**
 * The one line the tab shows above the detail, in the skill's own terms.
 *
 * A provider failure is stated as a retrieval failure, never as an absence of
 * disclosure — those are different claims about different things and only one
 * of them is about the company.
 */
export function headline(view: SentimentView, symbol: string): string {
    if (view.failedChannels.length) {
        return `Sentiment could not be measured for ${symbol}: the evidence provider did not answer.`;
    }
    switch (view.status) {
        case 'ambiguous_entity':
            return `"${symbol}" matches more than one SEC registrant. Name the ticker to choose.`;
        case 'insufficient_data':
            return `Not enough disclosure text was retrieved to characterise ${symbol}'s sentiment.`;
        case 'unsupported_operation':
            return `Sentiment is not available for this kind of request.`;
        case 'conflicting_evidence':
            return `${symbol}'s filing language is genuinely mixed — positive and negative in comparable measure.`;
        default:
            return `${symbol}'s filing language reads ${view.label || 'neutral'} over ${view.window.basis || 'the period read'}.`;
    }
}

export function sentimentSkillUrl(base: string, company: string, period = 'latest'): string {
    const qs = new URLSearchParams({ company, period });
    return `${base.replace(/\/$/, '')}/v1/skills/sentiment?${qs}`;
}
