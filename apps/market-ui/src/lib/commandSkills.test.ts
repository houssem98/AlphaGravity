// The analysis skills: commands that mount nothing and instead expand into an
// authored Quick Answer prompt (Anthropic's financial-services agent templates,
// research side). The framing is the whole feature, so the assertions here are
// about what the expansion actually asks for.
import { describe, it, expect } from 'vitest';
import { COMMANDS, expandCommand, findCommand, parseCommand } from './commands';

const ANALYSIS = ['earnings', 'risks', 'moat', 'research'] as const;

describe('analysis skills — shape', () => {
    it('every analysis row expands and no other row does', () => {
        for (const c of COMMANDS) {
            const shouldExpand = c.category === 'Analysis';
            expect(typeof c.expand === 'function', `/${c.name}`).toBe(shouldExpand);
        }
    });

    it('each skill is a buildable command the parser resolves', () => {
        for (const name of ANALYSIS) {
            expect(findCommand(name)?.status, `/${name}`).toBe('buildable');
            expect(parseCommand(`/${name} AMD `, name.length + 6)?.name).toBe(name);
        }
    });
});

describe('expandCommand', () => {
    it('expands a settled skill into a prompt naming the ticker', () => {
        const out = expandCommand('/risks amd');
        expect(out).toBeTruthy();
        // A ticker is a symbol; the filings spell it in capitals.
        expect(out).toContain('AMD');
        expect(out).not.toContain('amd ');
    });

    it('returns null for a skill with no ticker yet', () => {
        expect(expandCommand('/risks')).toBeNull();
        expect(expandCommand('/risks ')).toBeNull();
    });

    it('returns null for the commands that mount a surface instead', () => {
        expect(expandCommand('/company AMD')).toBeNull();
        expect(expandCommand('/peer-compare AMD NVDA')).toBeNull();
    });

    it('returns null for a blocked command, so it still reaches the refusal', () => {
        expect(expandCommand('/capex AMD')).toBeNull();
        expect(expandCommand('/tariff-risk AMD')).toBeNull();
    });

    it('returns null for prose, which must reach the model unaltered', () => {
        expect(expandCommand('what are AMD risks')).toBeNull();
        expect(expandCommand('https://example.com/risks AMD')).toBeNull();
    });

    it('carries the rest of the line into /research as the question', () => {
        const out = expandCommand('/research AMD datacenter GPU share');
        expect(out).toContain('AMD');
        expect(out).toContain('datacenter GPU share');
    });

    it('/research without a question still expands', () => {
        const out = expandCommand('/research AMD');
        expect(out).toContain('AMD');
        expect(out).not.toContain('specifically');
    });
});

describe('the prompts state the discipline the pipeline already enforces', () => {
    // A skill that asked for a confident summary would be a prompt arguing
    // against the verification layer underneath it.
    it('every skill asks for citations', () => {
        for (const name of ANALYSIS) {
            expect(expandCommand(`/${name} AMD`)!.toLowerCase(), `/${name}`)
                .toMatch(/cite/);
        }
    });

    it('every skill states what to do when the source is silent', () => {
        for (const name of ANALYSIS) {
            const p = expandCommand(`/${name} AMD`)!.toLowerCase();
            expect(p, `/${name} must not invite invention`)
                .toMatch(/does not|do not|silent|disagree/);
        }
    });

    it('no skill asks for a price target, a rating or a recommendation', () => {
        // Word boundaries, not substrings: "rating" is inside "operating", and
        // matching that would have banned the income statement.
        const forbidden = [
            /\bprice target\b/, /\bbuy or sell\b/, /\brecommend\w*\b/,
            /\brating\b/, /\bvaluation\b/, /\bfair value\b/,
        ];
        for (const name of ANALYSIS) {
            const p = expandCommand(`/${name} AMD`)!.toLowerCase();
            for (const pattern of forbidden) {
                expect(p, `/${name} asks for ${pattern}`).not.toMatch(pattern);
            }
        }
    });
});

describe('the prompts route to the filing that answers them', () => {
    it('/risks names Item 1A', () => {
        expect(expandCommand('/risks AMD')).toContain('Item 1A');
    });

    it('/moat names Item 1', () => {
        expect(expandCommand('/moat AMD')).toContain('Item 1');
    });

    it('/earnings names the quarterly report', () => {
        expect(expandCommand('/earnings AMD')).toContain('10-Q');
    });

    it('/research separates filing evidence from web evidence', () => {
        const p = expandCommand('/research AMD')!.toLowerCase();
        expect(p).toContain('filings');
        expect(p).toContain('web');
    });
});
