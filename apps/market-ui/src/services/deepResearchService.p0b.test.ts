import { describe, it, expect } from 'vitest';
import { shouldExtendSearch, BASE_SEARCH_ROUNDS, MIN_EXTENSION_SOURCES } from './deepResearchService';

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
