import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TracePanel } from './Assistant';
import { stepGlyph, traceSummary, type CellStep } from '../../services/gridTrace';

// DD-9 · row 9. The agentic pipeline is the product's differentiator and it
// collapsed to one grey line. Every step now keeps its glyph, its label, a bar
// proportional to the run, and its real meta or error string — untruncated,
// because on a failed step the error is the entire point.
const STEPS: CellStep[] = [
  { label: 'Recalling past calls', tool: 'memory', ms: 849, status: 'ok', meta: '1 journalled decision(s)' },
  { label: 'Running analysts', tool: 'analysts', ms: 16638, status: 'ok', meta: 'market:ok news:ok social:ok' },
  { label: 'Answering from the analyst reports', tool: 'llm', ms: 22679, status: 'ok', meta: 'deepseek/deepseek-v4-flash' },
];

const open = (steps: CellStep[]) =>
  renderToStaticMarkup(<TracePanel steps={steps} defaultOpen />);

describe('row 9 — the trace is a timeline, not a grey line', () => {
  const html = open(STEPS);

  it('lists one row per step, in order', () => {
    expect(html).toContain('data-trace-timeline');
    const labels = [...html.matchAll(/text-\[color:var\(--text-2\)\]">([^<]+)</g)].map((m) => m[1]);
    expect(labels).toEqual(STEPS.map((s) => s.label));
  });

  it('shows each step its real duration', () => {
    for (const s of STEPS) expect(html).toContain(`${s.ms}ms`);
  });

  it('draws a bar proportional to the slowest step', () => {
    const bars = [...html.matchAll(/data-step-bar="(\d+)"[^>]*style="width:\s*([\d.]+)%/g)];
    expect(bars.length).toBe(STEPS.length);
    // 22679ms is the slowest, so it is the full-width bar
    const widths = Object.fromEntries(bars.map((b) => [b[1], Number(b[2])]));
    expect(widths['22679']).toBe(100);
    expect(widths['16638']).toBe(73);
    expect(widths['849']).toBe(4);
  });

  it('renders the provider meta the step reported', () => {
    expect(html).toContain('deepseek/deepseek-v4-flash');
    expect(html).toContain('market:ok news:ok social:ok');
  });

  it('agrees with traceSummary on the step count', () => {
    const { tools, totalMs } = traceSummary(STEPS);
    expect(html).toContain(`${tools} steps`);
    expect(html).toContain(`${totalMs}ms`);
  });

  it('is collapsed by default, and says so honestly when collapsed', () => {
    const closed = renderToStaticMarkup(<TracePanel steps={STEPS} />);
    expect(closed).not.toContain('data-trace-timeline');
    expect(closed).toContain('3 steps');
    expect(closed).toContain('aria-expanded="false"');
  });
});

describe('row 9 — a failed step keeps its error', () => {
  const withFailure: CellStep[] = [
    ...STEPS,
    {
      label: 'Reading the social feed',
      tool: 'social',
      ms: 4200,
      status: 'failed',
      error: 'social feed unavailable: HTTP 502 from the upstream provider after 3 retries',
    },
    { label: 'Reading fundamentals', tool: 'fundamentals', ms: 120, status: 'empty', meta: 'no rows' },
  ];

  it('renders the error string in full, never truncated', () => {
    const html = open(withFailure);
    expect(html).toContain('social feed unavailable: HTTP 502 from the upstream provider after 3 retries');
    expect(html).not.toContain('truncate');
  });

  it('tones the failed and empty steps apart from the healthy ones', () => {
    const html = open(withFailure);
    expect(html).toContain(stepGlyph('failed'));
    expect(html).toContain(stepGlyph('empty'));
    expect(html).toContain('--down');
    expect(html).toContain('amber-400');
  });

  it('states the failure count in the collapsed summary', () => {
    const closed = renderToStaticMarkup(<TracePanel steps={withFailure} />);
    expect(closed).toContain('1 failed');
    expect(traceSummary(withFailure).failed).toBe(1);
  });

  it('renders nothing at all when no step ran', () => {
    expect(renderToStaticMarkup(<TracePanel steps={[]} defaultOpen />)).toBe('');
  });
});

describe('row 9 against the steps prod actually returned', () => {
  // STEPS above are the verbatim stage timings from the 2026-08-01 prod probe
  // (memory 849ms / analysts 16638ms / llm 22679ms).
  it('renders that real three-stage run with its measured shape', () => {
    const { tools, totalMs } = traceSummary(STEPS);
    expect(tools).toBe(3);
    expect(totalMs).toBe(40166);
    expect(open(STEPS)).toContain('Answering from the analyst reports');
  });
});
