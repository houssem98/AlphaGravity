import { describe, it, expect } from 'vitest';
import { parseCommand, matchCommands, findCommand, COMMANDS, CATEGORY_ORDER } from './commands';

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
    // CT-9 · probed and closed. GridView takes no query and screens nothing, so
    // /screening joins the blocked rows rather than mounting a surface that
    // cannot answer it.
    it('/screening does not resolve — blocked after probe', () => expect(resolves('screening')).toBeNull());

    it('/capex does not resolve — blocked', () => expect(resolves('capex')).toBeNull());
    it('/tariff-risk does not resolve — blocked', () => expect(resolves('tariff-risk')).toBeNull());

    it('a blocked name is still known, with the reason', () => {
        expect(findCommand('capex')?.status).toBe('blocked');
        expect(findCommand('capex')?.blocked).toContain('12 of 12');
        expect(findCommand('tariff-risk')?.blocked).toContain('12 of 12');
        expect(findCommand('screening')?.status).toBe('blocked');
        expect(findCommand('screening')?.blocked).toContain('not a screener');
    });

    it('the matrix carries the eight §4 rows plus the four analysis skills', () => {
        expect(COMMANDS).toHaveLength(12);
        expect(COMMANDS.filter(c => c.status === 'buildable')).toHaveLength(9);
        expect(COMMANDS.filter(c => c.status === 'blocked').map(c => c.name))
            .toEqual(['screening', 'capex', 'tariff-risk']);
        // The three that were still blocked stay blocked: the analysis skills
        // were added because a channel now answers them, not by relaxing the bar.
        expect(COMMANDS.filter(c => c.status === 'blocked')).toHaveLength(3);
    });

    it('a blocked name is never offered by the palette', () => {
        expect(matchCommands('').map(c => c.name)).toEqual(
            ['company', 'filings', 'sentiment', 'data', 'peer-compare',
             'earnings', 'risks', 'moat', 'research'],
        );
        expect(matchCommands('cap')).toEqual([]);
        expect(matchCommands('tariff')).toEqual([]);
        expect(matchCommands('scr')).toEqual([]);
    });
});

// CT2-9 · §5 P6. The palette groups by WHERE A COMMAND ROUTES (§4), so the
// grouping cannot drift from the routing without one of these failing.
describe('command categories', () => {
    it('every command declares a category, and it is one the palette renders', () => {
        for (const c of COMMANDS) {
            expect(CATEGORY_ORDER, `/${c.name} has an unrenderable category`).toContain(c.category);
        }
    });

    it('groups the buildable commands the way they route', () => {
        const byCat = (cat: string) => COMMANDS.filter(c => c.category === cat).map(c => c.name);
        // company/filings/data/sentiment all mount a CompanyPage tab.
        expect(byCat('Company')).toEqual(['company', 'filings', 'sentiment', 'data']);
        // peer-compare mounts GridView, which is a different surface.
        expect(byCat('Comparison')).toEqual(['peer-compare']);
        // The analysis skills mount nothing at all — they run the pipeline.
        expect(byCat('Analysis')).toEqual(['earnings', 'risks', 'moat', 'research']);
    });

    it('every blocked command is Unavailable, and nothing else is', () => {
        expect(COMMANDS.filter(c => c.category === 'Unavailable').map(c => c.name))
            .toEqual(['screening', 'capex', 'tariff-risk']);
        expect(COMMANDS.filter(c => c.category === 'Unavailable').every(c => c.status === 'blocked')).toBe(true);
        expect(COMMANDS.filter(c => c.status === 'blocked').every(c => c.category === 'Unavailable')).toBe(true);
    });

    it('grouping preserves the flat order the keyboard nav indexes by', () => {
        // paletteIndex addresses matchCommands() by position, so rendering the
        // groups in CATEGORY_ORDER must not reorder the options themselves.
        const flat = matchCommands('');
        const grouped = CATEGORY_ORDER.flatMap(cat => flat.filter(c => c.category === cat));
        expect(grouped.map(c => c.name)).toEqual(flat.map(c => c.name));
    });
});
