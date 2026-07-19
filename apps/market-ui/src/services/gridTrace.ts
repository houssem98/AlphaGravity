// Grid Trace — AC-1 foundation (docs/GRID_AGENT_CELL_ROADMAP.md Section 5).
// Pure step recorder for agentic cells. The trace is a RECORD, never a
// performance: a step exists iff its call executed; timings come from one
// injectable clock; failures keep their real error and re-throw so callers'
// error handling is untouched. No imports — gridResearch imports the type
// from here, never the reverse (no cycle).

export interface CellStep {
    label: string;              // user-facing verb, e.g. "Searching SEC filings"
    tool: string;               // registry key, e.g. "rag", "marketQuote", "llm"
    ms: number;
    status: 'ok' | 'failed' | 'empty';   // empty = ran fine, returned nothing useful
    error?: string;
    meta?: string;              // short human note, truncated
}

export const TRACE_MAX_STEPS = 12;
export const TRACE_META_MAX = 500;

export interface StepOptions<T> {
    isEmpty?: (value: T) => boolean;
    meta?: (value: T) => string;
}

export interface Trace {
    step<T>(label: string, tool: string, fn: () => Promise<T>, opts?: StepOptions<T>): Promise<T>;
    done(): CellStep[];
}

export function newTrace(now: () => number = Date.now): Trace {
    const steps: CellStep[] = [];
    return {
        async step(label, tool, fn, opts) {
            const t0 = now();
            try {
                const value = await fn();
                const step: CellStep = {
                    label, tool,
                    ms: Math.round(now() - t0),
                    status: opts?.isEmpty?.(value) ? 'empty' : 'ok',
                };
                const meta = opts?.meta?.(value);
                if (meta) step.meta = meta.slice(0, TRACE_META_MAX);
                steps.push(step);
                return value;
            } catch (e: any) {
                steps.push({
                    label, tool,
                    ms: Math.round(now() - t0),
                    status: 'failed',
                    error: e?.message ?? String(e),
                });
                throw e;
            }
        },
        done: () => steps.slice(0, TRACE_MAX_STEPS),
    };
}

export interface TraceSummary {
    tools: number;      // steps recorded
    ok: number;         // ok + empty (the call itself worked)
    failed: number;
    totalMs: number;
}

export function traceSummary(steps: CellStep[]): TraceSummary {
    return {
        tools: steps.length,
        ok: steps.filter(s => s.status !== 'failed').length,
        failed: steps.filter(s => s.status === 'failed').length,
        totalMs: steps.reduce((sum, s) => sum + s.ms, 0),
    };
}
