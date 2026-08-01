// DX-16 regression tests — docs/AI_TRADING_AGENT_ROADMAP.md Section 6 rows 20 and 21.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const handler = readFileSync(join(__dirname, '../../api/agent/[fn].ts'), 'utf8');
const client = readFileSync(join(__dirname, '../components/trading/Assistant.tsx'), 'utf8');

describe('row 21 — the server streams what it is doing', () => {
    it('opts into NDJSON rather than changing the default response', () => {
        expect(handler).toMatch(/const streaming = stream === true/);
        expect(handler).toContain('application/x-ndjson');
        expect(handler).toMatch(/if \(!streaming\) return res\.json\(payload\)/);
    });

    it('disables the proxy buffering that would defeat streaming', () => {
        expect(handler).toContain("'X-Accel-Buffering', 'no'");
        expect(handler).toContain('no-cache, no-transform');
    });

    it('announces a stage on start and the step on completion', () => {
        expect(handler).toMatch(/send\(\{ type: 'stage', label, tool \}\)/);
        expect(handler).toMatch(/send\(\{ type: 'step', \.\.\.s \}\)/);
    });

    it('emits each completed step exactly once', () => {
        expect(handler).toMatch(/done\.slice\(emitted\)/);
        expect(handler).toMatch(/emitted = done\.length/);
    });

    it('reports a step only after it ran, so the ticker is still a record', () => {
        expect(handler).toContain('never a spinner labelled with a stage');
        expect(handler).toMatch(/} finally {\s*\n\s*const done = rawTrace\.done\(\)/);
    });

    it('sends a failure down the same channel once the status is gone', () => {
        expect(handler).toMatch(/if \(streaming\) \{ send\(\{ type: 'error'/);
    });

    it('routes every terminal payload through finish, including the confirmation', () => {
        expect(handler).toMatch(/return finish\(\{\s*\n\s*needsConfirmation: true/);
        expect(handler).not.toMatch(/return res\.json\(\{\s*\n\s*needsConfirmation/);
    });

    it('streams steps rather than tokens, and says why', () => {
        expect(handler).toContain('Steps only, not tokens');
        expect(handler).toContain('WHICH STAGE is running');
    });
});

describe('row 21 — the client consumes the stream and can stop it', () => {
    it('reads NDJSON incrementally instead of awaiting the whole body', () => {
        expect(client).toMatch(/res\.body\.getReader\(\)/);
        expect(client).toMatch(/new TextDecoder\(\)/);
        expect(client).toMatch(/decoder\.decode\(value, \{ stream: true \}\)/);
    });

    it('keeps a partial trailing line until the rest arrives', () => {
        expect(client).toMatch(/buffer = lines\.pop\(\) \?\? ''/);
    });

    it('shows the stage the server actually reported', () => {
        expect(client).toMatch(/if \(ev\.type === 'stage'\) onStage\(ev\.label\)/);
        expect(client).toMatch(/\{stage \?\? 'Starting'\}/);
    });

    it('wires a real abort, not a hidden spinner', () => {
        expect(client).toMatch(/const controller = new AbortController\(\)/);
        expect(client).toMatch(/signal,/);
        expect(client).toMatch(/onClick=\{\(\) => abortRef\.current\?\.abort\(\)\}/);
    });

    it('says plainly that a cancelled run stopped', () => {
        expect(client).toContain('Cancelled — nothing further was run.');
        expect(client).toMatch(/error\?\.name === 'AbortError'/);
    });

    it('refuses to invent an answer when the stream ends without one', () => {
        expect(client).toContain('the run ended without producing an answer');
    });

    it('aborts an in-flight run when the asset changes', () => {
        expect(client).toMatch(/abortRef\.current\?\.abort\(\);\s*\n\s*setStage\(null\)/);
    });
});

describe('row 21 — one session per asset', () => {
    it('keys the session on market and symbol', () => {
        expect(client).toMatch(/const sessionKey = `dexter_session_\$\{market \?\? 'us'\}_\$\{currentAsset\}`/);
    });

    it('restores what was said about this asset before', () => {
        expect(client).toMatch(/localStorage\.getItem\(sessionKey\)/);
        expect(client).toMatch(/setMessages\(saved \? JSON\.parse\(saved\) : \[GREETING\]\)/);
    });

    it('bounds what it stores and survives a quota failure', () => {
        expect(client).toMatch(/messages\.slice\(-40\)/);
        expect(client).toMatch(/catch \{ \/\* quota \*\/ \}/);
    });

    it('does not persist a session that is only the greeting', () => {
        expect(client).toMatch(/if \(messages\.length <= 1\) return/);
    });
});

describe('row 20 — a Tunisian listing is quoted in dinar', () => {
    it('no longer prints a dollar sign on every asset', () => {
        expect(client).toMatch(/\{isTN \? '' : '\$'\}\{currentPrice < 1/);
        expect(client).toMatch(/\{isTN \? ' TND' : ''\}/);
    });

    it('carries the currency into the model context too', () => {
        expect(client).toMatch(/isTN \? currentPrice \+ ' TND' : '\$' \+ currentPrice/);
    });

    it('tells the analysts the listing currency', () => {
        const graph = readFileSync(join(__dirname, 'dexterGraph.ts'), 'utf8');
        expect(graph).toContain('quoted in TND');
    });

    it('renders a TN trade plan in dinar', () => {
        const risk = readFileSync(join(__dirname, 'dexterRisk.ts'), 'utf8');
        expect(risk).toMatch(/const unit = ctx\.isTN \? ' TND' : ''/);
    });
});
