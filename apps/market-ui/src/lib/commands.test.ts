import { describe, it, expect } from 'vitest';
import { parseCommand, matchCommands, findCommand, COMMANDS } from './commands';

// docs/COMMAND_TERMINAL_ROADMAP.md §6 row 1 (the instrument) and row 2 (all
// eight §4 commands named individually).

describe('parseCommand — row 1', () => {
    it('bare / opens with an empty name', () => {
        expect(parseCommand('/', 1)).toEqual({ name: '', args: [], complete: false });
    });

    it('a / the caret has not reached is not a command', () => {
        expect(parseCommand('/', 0)).toBeNull();
    });

    it('/company resolves with no args', () => {
        expect(parseCommand('/company', 8)).toEqual({ name: 'company', args: [], complete: false });
    });

    it('/company NV is an unfinished argument', () => {
        expect(parseCommand('/company NV', 11)).toEqual({ name: 'company', args: ['NV'], complete: false });
    });

    it('/company NVDA + trailing space is complete', () => {
        expect(parseCommand('/company NVDA ', 14)).toEqual({ name: 'company', args: ['NVDA'], complete: true });
    });

    it('/unknown is not a command', () => {
        expect(parseCommand('/unknown', 8)).toBeNull();
    });

    it('a URL is not a command', () => {
        expect(parseCommand('http://x/y', 10)).toBeNull();
    });

    it('a mid-word slash is not a command', () => {
        expect(parseCommand('foo/company', 11)).toBeNull();
    });

    it('a slash followed by prose is not a command', () => {
        expect(parseCommand('/ company', 9)).toBeNull();
    });

    it('a prefix of a buildable command keeps the palette open', () => {
        expect(parseCommand('/comp', 5)).toEqual({ name: 'comp', args: [], complete: false });
    });

    it('a prefix that settled without matching is not a command', () => {
        expect(parseCommand('/comp NVDA', 10)).toBeNull();
    });

    it('the name is case-insensitive', () => {
        expect(parseCommand('/COMPANY NVDA ', 14)?.name).toBe('company');
    });
});

describe('parseCommand — row 2, each of the eight §4 commands', () => {
    const args: Record<string, string> = { 'peer-compare': 'NVDA AMD', screening: 'semis' };
    const resolves = (name: string) => parseCommand(`/${name} ${args[name] ?? 'NVDA'} `, 0 + `/${name} ${args[name] ?? 'NVDA'} `.length);

    it('/company resolves', () => expect(resolves('company')?.name).toBe('company'));
    it('/filings resolves', () => expect(resolves('filings')?.name).toBe('filings'));
    it('/sentiment resolves', () => expect(resolves('sentiment')?.name).toBe('sentiment'));
    it('/data resolves', () => expect(resolves('data')?.name).toBe('data'));
    it('/peer-compare resolves with two tickers', () =>
        expect(resolves('peer-compare')).toEqual({ name: 'peer-compare', args: ['NVDA', 'AMD'], complete: true }));
    it('/screening resolves', () => expect(resolves('screening')?.name).toBe('screening'));

    it('/capex does not resolve — blocked', () => expect(resolves('capex')).toBeNull());
    it('/tariff-risk does not resolve — blocked', () => expect(resolves('tariff-risk')).toBeNull());

    it('a blocked name is still known, with the reason', () => {
        expect(findCommand('capex')?.status).toBe('blocked');
        expect(findCommand('capex')?.blocked).toContain('12 of 12');
        expect(findCommand('tariff-risk')?.blocked).toContain('12 of 12');
    });

    it('the matrix carries exactly the eight §4 rows, six buildable', () => {
        expect(COMMANDS).toHaveLength(8);
        expect(COMMANDS.filter(c => c.status === 'buildable')).toHaveLength(6);
    });

    it('a blocked name is never offered by the palette', () => {
        expect(matchCommands('').map(c => c.name)).toEqual(
            ['company', 'filings', 'sentiment', 'data', 'peer-compare', 'screening'],
        );
        expect(matchCommands('cap')).toEqual([]);
        expect(matchCommands('tariff')).toEqual([]);
    });
});
