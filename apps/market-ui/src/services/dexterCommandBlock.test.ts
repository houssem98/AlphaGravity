import { describe, it, expect } from 'vitest';
import { COMMAND_LANG, dexterLang, isCommandBlock, parseBlock, renderCommandBlock } from './dexterBlocks';

// CT-4 · the command block rides the fence mechanism that already exists, so the
// round trip a rendered turn actually performs is what these assert.

describe('renderCommandBlock round trip', () => {
    it('fences under a dexter-* language the existing parser recognises', () => {
        const md = renderCommandBlock({ name: 'filings', args: ['NVDA'] });
        expect(md.startsWith('```' + COMMAND_LANG + '\n')).toBe(true);
        expect(dexterLang(`language-${COMMAND_LANG}`)).toBe(COMMAND_LANG);
    });

    it('survives render → parse with its name and args intact', () => {
        const body = renderCommandBlock({ name: 'company', args: ['NVDA'] }).split('\n')[1];
        const parsed = parseBlock(body);
        expect(isCommandBlock(parsed)).toBe(true);
        expect(parsed).toEqual({ name: 'company', args: ['NVDA'] });
    });

    it('keeps every argument, so /peer-compare NVDA AMD is not truncated', () => {
        const body = renderCommandBlock({ name: 'peer-compare', args: ['NVDA', 'AMD'] }).split('\n')[1];
        expect(parseBlock(body)).toEqual({ name: 'peer-compare', args: ['NVDA', 'AMD'] });
    });
});

describe('isCommandBlock rejects what would mount the wrong surface', () => {
    it('rejects a malformed body rather than throwing', () => {
        expect(parseBlock('{not json')).toBeNull();
        expect(isCommandBlock(parseBlock('{not json'))).toBe(false);
    });

    it('rejects a missing or empty name', () => {
        expect(isCommandBlock({ args: ['NVDA'] })).toBe(false);
        expect(isCommandBlock({ name: '', args: ['NVDA'] })).toBe(false);
    });

    it('rejects args that are not an array', () => {
        expect(isCommandBlock({ name: 'company', args: 'NVDA' })).toBe(false);
        expect(isCommandBlock({ name: 'company' })).toBe(false);
    });

    it('rejects null and non-objects', () => {
        expect(isCommandBlock(null)).toBe(false);
        expect(isCommandBlock('company')).toBe(false);
    });

    it('does not claim a non-dexter fence', () => {
        expect(dexterLang('language-json')).toBeNull();
        expect(dexterLang(undefined)).toBeNull();
    });
});
