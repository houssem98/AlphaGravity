// Everything the company page loads for one ticker.
// Extracted verbatim from CompanyPage.tsx (CF-9) — no request, order or
// error-handling rule changed; the page now reads this instead of owning it.

import { useState, useEffect } from 'react';
import { lastSeen, markSeen } from '../../lib/newFilings';
import { apiGetOverview } from '../../services/api';
import { getAccessToken } from '../../services/supabase';
import { toView, type SentimentView } from '../../lib/sentimentSkill';
import {
    GRAVITY_BASE, authed, fetchSurface, surfaceFailure, surfaceData,
    withLoading, revenuePeriods,
} from './surfaces';
import type {
    GravityDocument, GravityMetric, LongitudinalPoint, MarketOverview,
    Quote, SentimentDelta, SentimentResult,
} from './types';

export interface SentimentRefusal {
    status: number;
    detail: string;
    documentId: string;
    filing: string;
}

export function useCompanyData(symbol: string) {
    const [overview, setOverview] = useState<MarketOverview | null>(null);
    const [quote, setQuote] = useState<Quote | null>(null);
    const [documents, setDocuments] = useState<GravityDocument[]>([]);
    const [metrics, setMetrics] = useState<GravityMetric[]>([]);
    const [sentiment, setSentiment] = useState<SentimentResult | null>(null);
    // CT2-5 · why there is no score, in the server's own words. Present exactly
    // when `sentiment` is null and the request actually ran.
    const [sentimentRefusal, setSentimentRefusal] = useState<SentimentRefusal | null>(null);
    const [sentimentDelta] = useState<SentimentDelta | null>(null);
    // The universal skill's full answer — evidence, window, source mix and
    // limitations — kept alongside the score so the tab can render the basis
    // rather than a bare number.
    const [sentimentView, setSentimentView] = useState<SentimentView | null>(null);
    const [longitudinal, setLongitudinal] = useState<LongitudinalPoint[]>([]);
    // CF-21 · which metric the series actually IS. A filer that reports no
    // revenue line still reports something, and the card must label what it
    // received rather than what was asked for.
    const [trendMetric, setTrendMetric] = useState<string | null>(null);
    const [trendReason, setTrendReason] = useState<string | null>(null);
    const [trendUnit, setTrendUnit] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    // CT-7 · row 9. A surface that failed is NAMED. A credential fault and a data
    // gap look identical when both render an empty card, and only one of them is
    // the user's problem.
    const [failedSurfaces, setFailedSurfaces] = useState<string[]>([]);
    // Watermark captured at page open (newest filing_date the user saw last
    // time); filings newer than this get a NEW badge. Captured before markSeen.
    const [watermark, setWatermark] = useState<string | null>(null);

    useEffect(() => {
        if (!symbol) return;
        setFailedSurfaces([]);
        setWatermark(lastSeen(symbol));

        withLoading(setLoading, async () => {
            const tok = await getAccessToken().catch(() => null);
            const [ov, qt, docs, met, lon] = await Promise.allSettled([
                // Alpha Vantage overview (opportunistic — 25 req/day free tier;
                // page renders '—' when absent)
                apiGetOverview(symbol),
                // Quote via the Yahoo→sina fallback stack (always up, no key)
                fetchSurface(`/api/quote?symbols=${encodeURIComponent(symbol)}`, authed(tok)),
                // Gravity indexed documents (Supabase-REST-backed; /v1/documents is
                // dead on prod — asyncpg get_db stub)
                fetchSurface(`${GRAVITY_BASE}/v1/company/${symbol}/filings?limit=15`, authed(tok)),
                // Exact XBRL financial facts (NL→SQL structured search is broken in
                // prod and inexact anyway — xbrl:* rows are the one exact population)
                fetchSurface(`${GRAVITY_BASE}/v1/company/${symbol}/financials?limit=80`, authed(tok)),
                // Revenue trend. It belongs in THIS batch: its periods come from the
                // calendar (see revenuePeriods), not from the financials response, so
                // there is nothing to wait for. It used to run in its own effect keyed
                // on `metrics`, which cost a second serial round trip — 4.08s to first
                // chart for AAPL against 2.19s issued in parallel.
                fetchSurface(
                    `${GRAVITY_BASE}/v1/company/${symbol}/trend?`
                    + new URLSearchParams({ metric: 'revenue', periods: revenuePeriods().join(',') }),
                    authed(tok),
                ),
                // CT2-5 · the sentiment score is NOT fetched here. It needs a
                // document_id, which only arrives with the filings payload in this
                // same batch, so it runs in its own effect below.
                //
                // /analytics/sentiment/{t}/delta is NOT called at all. Probed live
                // 2026-08-20 with two real document ids: 200 with overall_delta 0.0,
                // topic_deltas {} and an empty narrative, because the per-document
                // sentiment it differences was never computed (GET /sentiment/{t}
                // answers 404 "POST to compute it"). Rendering that reads as "no
                // change since last quarter" -- a measurement we never made.
            ]);

            const arr = (v: unknown): any[] => Array.isArray(v) ? v : [];

            // A rejected fetch, an HTTP error, or a body carrying an `error`, is a
            // FAILURE and is stated — with the reason, so a 401 reads as "sign in"
            // and not as an empty shelf. A well-formed body with no data is an
            // EMPTY and renders the null marker. The two must not look alike.
            const failures = [
                surfaceFailure('Company overview (Alpha Vantage)', ov),
                surfaceFailure('Quote', qt),
                surfaceFailure('Filings index', docs),
                surfaceFailure('XBRL financials', met),
                // V3-5 · the trend is in this same allSettled and was the one
                // surface not named here. A 503 on /trend produced `longitudinal:
                // []` and nothing else — an empty chart, which is what a company
                // that reported nothing also looks like. The whole point of this
                // list is that those two must not look alike.
                surfaceFailure('Revenue trend', lon),
            ].filter((f): f is string => f !== null);
            if (failures.length) setFailedSurfaces(failures);

            const ovData = surfaceData(ov);
            if (ovData?.Symbol) setOverview(ovData);

            const q = surfaceData(qt)?.quoteResponse?.result?.[0];
            setQuote(q?.regularMarketPrice ? {
                price: q.regularMarketPrice,
                changePct: q.regularMarketChangePercent ?? 0,
                volume: q.regularMarketVolume ?? 0,
                marketCap: q.marketCap ?? 0,
            } : null);

            const docsData = surfaceData(docs);
            if (docsData) {
                const list = arr(docsData.documents ?? docsData) as GravityDocument[];
                setDocuments(list);
                // Record the newest filing_date so next visit can flag anything newer.
                const newest = list.map(d => d.filing_date).filter(Boolean).sort().reverse()[0] ?? null;
                markSeen(symbol, newest);
            }
            const metData = surfaceData(met);
            if (metData) setMetrics(arr(metData.rows ?? metData.structured_data));

            // The series arrives as one long list ({data_points: [{period, value}]})
            // while the chart wants a wide row per period. Periods the server holds
            // no fact for come back null and drop out here.
            const lonData = surfaceData(lon);
            setTrendMetric(lonData?.metric_used ?? null);
            setTrendReason(lonData?.unavailable_reason ?? null);
            setTrendUnit(lonData?.unit ?? null);
            setLongitudinal(
                arr(lonData?.data_points)
                    .filter((d: { value?: number | null }) => typeof d.value === 'number')
                    .map((d: { period: string; value: number }) => ({
                        period: d.period,
                        // Keyed by the metric that came back. Writing every series
                        // to `revenue` is what would put net income under a
                        // "Revenue" heading.
                        [lonData?.metric_used ?? 'revenue']: d.value,
                    })),
            );
        }).then(err => {
            // The loading flag is already down — `withLoading` guarantees that.
            // What is left is to SAY what went wrong, rather than present a page
            // that silently lost half its content.
            if (err) setFailedSurfaces(f => [...f, `Company data — ${err.message}`]);
        });
    }, [symbol]);

    // CT2-5 · row R6. Probed live 2026-08-09: the endpoint requires BOTH
    // document_id AND period (the ledger's P2 named only the first), and it is a
    // CACHE READ — `_load_cache(document_id)` — so with a real filing id and both
    // params it answers 404 "Sentiment not found ... POST to compute it". Calling
    // it with no params at all, as this page used to, produced a 422 that was our
    // malformed request rather than the real gap.
    //
    // So: ask correctly, then state whatever comes back. Never synthesise a score.
    // The universal path. `/v1/skills/sentiment?company=` resolves the mention
    // against SEC's whole ticker file and reads the filing at query time, so it
    // answers for any registrant and needs no local document — which is why
    // this effect depends on `symbol` alone. The old cache-read endpoint is
    // still consulted, but only after this one has declined, and it can no
    // longer be the reason a company has no sentiment.
    useEffect(() => {
        if (!symbol) return;
        let alive = true;
        setSentimentRefusal(null);
        setSentimentView(null);
        (async () => {
            try {
                // CF-10 · via the company router, so every surface this page reads
                // sits behind the same auth dependency. It delegates to the same
                // skill /v1/skills/sentiment runs, and keeps its status mapping.
                const tok = await getAccessToken().catch(() => null);
                const res = await fetch(
                    `${GRAVITY_BASE}/v1/company/${encodeURIComponent(symbol)}/sentiment`,
                    { headers: authed(tok) },
                );
                const body = await res.json().catch(() => null);
                if (!alive) return;
                const view = toView(body);
                if (view) {
                    setSentimentView(view);
                    // A score is set ONLY when the skill produced one. An
                    // abstention leaves it null, so no number renders.
                    if (view.score !== null) {
                        setSentiment({
                            ticker: symbol,
                            overall_score: view.score,
                            label: view.label,
                            confidence: 0,
                            document_count: view.window.filings.length,
                            period: view.period,
                        });
                    }
                    return;
                }
                setSentimentRefusal({
                    status: res.status,
                    detail: typeof body?.detail === 'string'
                        ? body.detail : JSON.stringify(body?.detail ?? body),
                    documentId: '—',
                    filing: 'the latest filing the skill could read',
                });
            } catch (e) {
                if (alive) setSentimentRefusal({
                    status: 0, detail: String(e), documentId: '—',
                    filing: 'the latest filing the skill could read',
                });
            }
        })();
        return () => { alive = false; };
    }, [symbol]);

    return {
        overview, quote, documents, metrics, longitudinal, trendMetric, trendReason, trendUnit, loading,
        failedSurfaces, watermark,
        sentiment, sentimentView, sentimentRefusal, sentimentDelta,
    };
}
