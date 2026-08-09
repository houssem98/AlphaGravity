// CT-1 · the slash-command parser (docs/COMMAND_TERMINAL_ROADMAP.md §6 rows 1, 2).
//
// A command is only a command when it OPENS the input. `http://x/y` and `a/b`
// carry slashes that are text, and a parser that fires on those turns every
// pasted URL into a palette. The caret matters for the same reason: a `/` the
// caret has not reached yet is not being typed.
//
// Resolution lives here too, because the palette and the committer must agree
// on which eight names exist and which two cannot ship — §4 of the ledger.

export type CommandStatus = 'buildable' | 'blocked';

/**
 * CT2-9 · the group a command is listed under (§5 P6 — discoverability stopped
 * at the name). The grouping is by WHERE THE COMMAND ROUTES, taken from the §4
 * matrix, not by topic: `company` / `filings` / `data` / `sentiment` all mount a
 * CompanyPage tab, `peer-compare` mounts GridView. A category invented from what
 * a name sounds like would drift from the routing the moment either changed.
 */
export type CommandCategory = 'Company' | 'Comparison' | 'Unavailable';

export interface CommandSpec {
    name: string;
    /** Usage hint shown in the palette, e.g. `<ticker>`. */
    usage: string;
    status: CommandStatus;
    category: CommandCategory;
    /** What is missing. Set on `blocked` rows only — read by CT-8's refusal. */
    blocked?: string;
}

/** Render order for the palette's headings. Groups appear in this order. */
export const CATEGORY_ORDER: CommandCategory[] = ['Company', 'Comparison', 'Unavailable'];

// §4 command matrix. The two blocked rows are listed, not omitted: a name that
// exists and cannot ship must be distinguishable from a typo (row 10).
export const COMMANDS: CommandSpec[] = [
    { name: 'company', usage: '<ticker>', status: 'buildable', category: 'Company' },
    { name: 'filings', usage: '<ticker>', status: 'buildable', category: 'Company' },
    { name: 'sentiment', usage: '<ticker>', status: 'buildable', category: 'Company' },
    { name: 'data', usage: '<ticker>', status: 'buildable', category: 'Company' },
    { name: 'peer-compare', usage: '<t1> <t2>', status: 'buildable', category: 'Comparison' },
    {
        category: 'Unavailable',
        // CT-9 · probed, then closed. GridView runs authored prompts over a NAMED
        // ticker list; it takes no query, ranks nothing and filters no universe,
        // so a free-text screen has no target to reach. Wiring it would mean
        // reading the query as a ticker list, which is wrong, or inventing a
        // screening capability, which is worse.
        name: 'screening', usage: '<query>', status: 'blocked',
        blocked: 'the Research Grid runs prompts over a named ticker list — it is not a screener, and no service ranks or filters a universe',
    },
    {
        name: 'capex', usage: '<ticker>', status: 'blocked', category: 'Unavailable',
        blocked: 'no service supplies capex, and apps/market-ui/api holds 12 of 12 Vercel functions',
    },
    {
        name: 'tariff-risk', usage: '<ticker>', status: 'blocked', category: 'Unavailable',
        blocked: 'no service supplies tariff risk, and apps/market-ui/api holds 12 of 12 Vercel functions',
    },
];

export interface ParsedCommand {
    /** Lower-cased, may be `''` while the user has typed only `/`. */
    name: string;
    args: string[];
    /** The name is settled — the value ends in whitespace. */
    complete: boolean;
}

const buildable = () => COMMANDS.filter(c => c.status === 'buildable');

/** The buildable commands a partially typed name could still become. */
export function matchCommands(prefix: string): CommandSpec[] {
    const p = prefix.toLowerCase();
    return buildable().filter(c => c.name.startsWith(p));
}

export function findCommand(name: string): CommandSpec | undefined {
    return COMMANDS.find(c => c.name === name.toLowerCase());
}

/**
 * Parse the composer value at `caret`. Returns `null` for anything that is not
 * a buildable command or a live prefix of one — blocked names included, so the
 * palette never offers a command that cannot render.
 */
export function parseCommand(value: string, caret: number): ParsedCommand | null {
    if (caret < 1) return null;              // caret sits before the slash
    if (value[0] !== '/') return null;       // mid-word slashes and URLs are text

    const rest = value.slice(1);
    const name = (rest.match(/^\S*/)?.[0] ?? '').toLowerCase();
    const args = rest.slice(name.length).split(/\s+/).filter(Boolean);
    const complete = /\s$/.test(value);

    // `/` alone opens the palette; `/ anything` is prose that starts with a slash.
    if (!name) return complete || args.length > 0 ? null : { name, args: [], complete };

    // Settled name → must be a real buildable command. Still typing → any
    // buildable command it could still become keeps the palette open.
    return complete || args.length > 0
        ? (findCommand(name)?.status === 'buildable' ? { name, args, complete } : null)
        : (matchCommands(name).length > 0 ? { name, args, complete } : null);
}
