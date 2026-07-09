import { describe, it, expect } from 'vitest';
import { shouldExtendSearch, BASE_SEARCH_ROUNDS, MIN_EXTENSION_SOURCES, tierPeer, isTerminalLLMError, ResearchCancelledError } from './deepResearchService';

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
