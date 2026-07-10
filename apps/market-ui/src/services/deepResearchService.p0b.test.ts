import { describe, it, expect } from 'vitest';
import { shouldExtendSearch, BASE_SEARCH_ROUNDS, MIN_EXTENSION_SOURCES, tierPeer, isTerminalLLMError, ResearchCancelledError, rerankSourcesForReaders, smartTruncate, buildReaderPrompt } from './deepResearchService';
import type { ResearchBlueprint } from './deepResearchService';
import type { TavilySearchResult } from './tavilyService';

describe('shouldExtendSearch (P0b adaptive rounds)', () => {
    it('never extends when coverage is sufficient', () => {
        expect(shouldExtendSearch(1, true, ['gap'], 10)).toBe(false);
        expect(shouldExtendSearch(3, true, [], 0)).toBe(false);
    });

    it('always extends within the base rounds when insufficient', () => {
        expect(shouldExtendSearch(1, false, [], 0)).toBe(true);
        expect(BASE_SEARCH_ROUNDS).toBe(2);
    });

    it('extends past base only with concrete gaps AND a productive last round', () => {
        expect(shouldExtendSearch(2, false, ['missing Q4 margin'], MIN_EXTENSION_SOURCES)).toBe(true);
        expect(shouldExtendSearch(3, false, ['gap'], MIN_EXTENSION_SOURCES)).toBe(true);
    });

    it('does not let a parse-failed eval (empty gaps) buy extra rounds', () => {
        expect(shouldExtendSearch(2, false, [], 10)).toBe(false);
    });

    it('does not extend when the last round dried up', () => {
        expect(shouldExtendSearch(2, false, ['gap'], MIN_EXTENSION_SOURCES - 1)).toBe(false);
    });
});

describe('tierPeer (P0c tier-down)', () => {
    it('maps a premium model to its own provider peer at the requested tier', () => {
        expect(tierPeer('claude-opus-4-6', 'standard')).toBe('claude-sonnet-4-6');
        expect(tierPeer('claude-opus-4-6', 'lite')).toBe('claude-haiku-4-5-20251001');
        expect(tierPeer('gemini-2.5-pro', 'lite')).toBe('gemini-2.0-flash-lite');
        expect(tierPeer('deepseek-reasoner', 'standard')).toBe('deepseek-chat');
    });

    it('passes through undefined and unknown ids', () => {
        expect(tierPeer(undefined, 'standard')).toBeUndefined();
        expect(tierPeer('not-a-model' as never, 'standard')).toBeUndefined();
    });
});

describe('rerankSourcesForReaders (P2c relevance rerank)', () => {
    const blueprint: ResearchBlueprint = {
        intent: 'company_analysis',
        targetEntities: ['Nvidia'],
        tickers: ['NVDA'],
        keyMetrics: ['Revenue Growth'],
        subtopics: [],
        searchQueries: [],
        secTargets: [],
        timeframe: 'FY2025',
        investmentHorizon: '12 months',
        researchAngles: ['data center demand'],
    };
    const mk = (title: string, content: string, score: number): TavilySearchResult =>
        ({ title, url: `https://x.test/${title}`, content, score });

    it('ranks on-topic sources above off-topic high-score ones', () => {
        const onTopic = mk('Nvidia data center demand surges', 'Nvidia revenue growth accelerates', 0.3);
        const offTopic = mk('General market overview', 'Stocks were mixed today amid macro concerns', 0.95);
        const ranked = rerankSourcesForReaders([offTopic, onTopic], blueprint, 2);
        expect(ranked[0].title).toBe(onTopic.title);
    });

    it('respects the limit', () => {
        const many = Array.from({ length: 30 }, (_, i) => mk(`Nvidia source ${i}`, 'Nvidia revenue growth', 0.5));
        expect(rerankSourcesForReaders(many, blueprint, 20)).toHaveLength(20);
    });

    it('falls back to a plain slice when the blueprint has no keywords', () => {
        const empty: ResearchBlueprint = { ...blueprint, targetEntities: [], researchAngles: [], keyMetrics: [] };
        const sources = [mk('a', 'x', 0.1), mk('b', 'y', 0.2)];
        expect(rerankSourcesForReaders(sources, empty, 1)).toEqual([sources[0]]);
    });
});

describe('smartTruncate + reader full-content (W1b)', () => {
    it('passes short text through untouched', () => {
        expect(smartTruncate('short', 100)).toBe('short');
    });

    it('cuts at a paragraph boundary in the back 40% of the window', () => {
        const text = 'a'.repeat(80) + '\n\n' + 'b'.repeat(100);
        const out = smartTruncate(text, 100);
        expect(out).toBe('a'.repeat(80) + '…');
    });

    it('hard-cuts when the only boundary is too early', () => {
        const text = 'a'.repeat(10) + '\n\n' + 'b'.repeat(500);
        expect(smartTruncate(text, 100)).toHaveLength(101); // 100 + ellipsis
    });

    it('reader prompt prefers rawContent over the snippet', () => {
        const bp: ResearchBlueprint = {
            intent: 'company_analysis', targetEntities: ['X'], tickers: [], keyMetrics: [],
            subtopics: [], searchQueries: [], secTargets: [], timeframe: '', investmentHorizon: '', researchAngles: [],
        };
        const p = buildReaderPrompt(
            { title: 't', url: 'u', content: 'SNIPPET-ONLY', rawContent: 'FULL-PAGE-TEXT' }, 'q', bp);
        expect(p).toContain('FULL-PAGE-TEXT');
        expect(p).not.toContain('SNIPPET-ONLY');
    });
});

describe('isTerminalLLMError (P0d fallback cap)', () => {
    it('treats cancellation, abort, and budget exhaustion as terminal', () => {
        expect(isTerminalLLMError(new ResearchCancelledError())).toBe(true);
        expect(isTerminalLLMError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(true);
        expect(isTerminalLLMError(new Error('Budget exhausted: 100/100 LLM calls'))).toBe(true);
    });

    it('lets transient provider errors fall through to the next model', () => {
        expect(isTerminalLLMError(new Error('anthropic/claude 529: overloaded'))).toBe(false);
        expect(isTerminalLLMError(new Error('HTTP 502'))).toBe(false);
        expect(isTerminalLLMError(undefined)).toBe(false);
    });
});
