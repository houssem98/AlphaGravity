import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { StageChecklist } from './Assistant';
import {
  applyStageEvent,
  plannedStages,
  stagesDone,
  toStageStates,
  type StageEvent,
  type StageState,
} from '../../services/dexterStages';

// DD-10 · row 14. The checklist states the pipeline the router chose BEFORE it
// runs, then ticks each stage as its NDJSON event lands. The hard rule: one
// event moves exactly one stage, and nothing is marked done ahead of the event
// that finished it.
const DECIDE = plannedStages('decide', { hasMemory: true });
const DEEP = plannedStages('deep', { hasMemory: true });

const stage = (label: string, tool: string): StageEvent => ({ type: 'stage', label, tool });
const step = (label: string, tool: string, ms: number, status: 'ok' | 'failed' | 'empty' = 'ok'): StageEvent =>
  ({ type: 'step', label, tool, ms, status });

describe('row 14 — the plan is the routed intent, stated up front', () => {
  it('lists every stage a decide run will execute', () => {
    expect(DECIDE.map((s) => s.tool)).toEqual(['memory', 'analysts', 'debate', 'risk', 'llm']);
  });

  it('drops the debate and risk stages on a deep run', () => {
    expect(DEEP.map((s) => s.tool)).toEqual(['memory', 'analysts', 'llm']);
  });

  it('drops the memory stage when the journal is not configured', () => {
    expect(plannedStages('deep', { hasMemory: false }).map((s) => s.tool)).toEqual([
      'analysts',
      'llm',
    ]);
  });

  it('promises nothing on the tool-loop path, where the model picks its own calls', () => {
    expect(plannedStages('quick', { hasMemory: true })).toEqual([]);
    expect(plannedStages('chat', { hasMemory: true })).toEqual([]);
  });

  it('starts every stage pending — none is done before its event', () => {
    const states = toStageStates(DECIDE);
    expect(states.every((s) => s.status === 'pending')).toBe(true);
    expect(stagesDone(states)).toBe(0);
    const html = renderToStaticMarkup(<StageChecklist stages={states} />);
    expect(html).toContain('data-stage-checklist');
    expect(html).not.toMatch(/\d+ms/);
  });
});

describe('row 14 — events move exactly one stage', () => {
  it('a stage event starts exactly one stage and finishes none', () => {
    const next = applyStageEvent(toStageStates(DEEP), stage('Running analysts', 'analysts'));
    expect(next.map((s) => s.status)).toEqual(['pending', 'running', 'pending']);
    expect(stagesDone(next)).toBe(0);
  });

  it('a step event finishes exactly one stage, with its real duration', () => {
    let s = toStageStates(DEEP);
    s = applyStageEvent(s, stage('Running analysts', 'analysts'));
    s = applyStageEvent(s, step('Running analysts', 'analysts', 16638));
    expect(s.map((x) => x.status)).toEqual(['pending', 'ok', 'pending']);
    expect(s[1].ms).toBe(16638);
    expect(stagesDone(s)).toBe(1);
  });

  it('never marks a later stage done because an earlier one finished', () => {
    let s = toStageStates(DEEP);
    for (const ev of [
      stage('Recalling past calls', 'memory'),
      step('Recalling past calls', 'memory', 849),
    ]) s = applyStageEvent(s, ev);
    expect(s.map((x) => x.status)).toEqual(['ok', 'pending', 'pending']);
  });

  it('replays a whole run to exactly the stages that ran', () => {
    const events: StageEvent[] = [
      stage('Recalling past calls', 'memory'), step('Recalling past calls', 'memory', 849),
      stage('Running analysts', 'analysts'), step('Running analysts', 'analysts', 16638),
      stage('Answering from the analyst reports', 'llm'),
      step('Answering from the analyst reports', 'llm', 22679),
    ];
    const s = events.reduce(applyStageEvent, toStageStates(DEEP));
    expect(s.map((x) => x.status)).toEqual(['ok', 'ok', 'ok']);
    expect(stagesDone(s)).toBe(3);
    expect(s.reduce((a, x) => a + (x.ms ?? 0), 0)).toBe(40166);
  });

  it('keeps a failed stage failed, with the error it reported', () => {
    let s = toStageStates(DEEP);
    s = applyStageEvent(s, stage('Running analysts', 'analysts'));
    s = applyStageEvent(s, {
      ...step('Running analysts', 'analysts', 4200, 'failed'),
      error: 'social feed unavailable: HTTP 502',
    });
    expect(s[1].status).toBe('failed');
    expect(s[1].detail).toBe('social feed unavailable: HTTP 502');
    const html = renderToStaticMarkup(<StageChecklist stages={s} />);
    expect(html).toContain('--down');
  });

  it('appends a stage the plan never promised rather than dropping it', () => {
    const s = applyStageEvent(toStageStates(DEEP), stage('Verifying the answer', 'llm-verify'));
    expect(s).toHaveLength(DEEP.length + 1);
    expect(s[s.length - 1]).toMatchObject({ tool: 'llm-verify', status: 'running' });
  });

  it('renders nothing when the server promised no stages', () => {
    expect(renderToStaticMarkup(<StageChecklist stages={[]} />)).toBe('');
  });
});

describe('row 14 — the checklist renders what the state says', () => {
  const mid: StageState[] = [
    { label: 'Recalling past calls', tool: 'memory', status: 'ok', ms: 849 },
    { label: 'Running analysts', tool: 'analysts', status: 'running' },
    { label: 'Answering from the analyst reports', tool: 'llm', status: 'pending' },
  ];

  it('shows a duration only on the stage that reported one', () => {
    const html = renderToStaticMarkup(<StageChecklist stages={mid} />);
    expect(html.match(/\d+ms/g)).toEqual(['849ms']);
  });

  it('tones done, running and pending apart', () => {
    const html = renderToStaticMarkup(<StageChecklist stages={mid} />);
    expect(html).toContain('--up');
    expect(html).toContain('--accent');
    expect(html).toContain('--text-4');
  });
});

// Captured verbatim off the wire from a live streaming prod probe on
// 2026-08-01: the plan event followed by three stage/step pairs.
describe('row 14 against the stream prod actually sent', () => {
  const wire = JSON.parse(
    readFileSync(new URL('./__fixtures__/dexter-prod-stream.json', import.meta.url), 'utf8'),
  ) as Array<StageEvent & { type: 'plan' | 'stage' | 'step'; intent?: string; stages?: { label: string; tool: string }[] }>;

  it('opens with a plan that names the routed intent and its stages', () => {
    expect(wire[0].type).toBe('plan');
    expect(wire[0].intent).toBe('deep');
    expect(wire[0].stages?.map((s) => s.tool)).toEqual(['memory', 'analysts', 'llm']);
  });

  it('replays the real stream to a fully ticked checklist', () => {
    const [plan, ...events] = wire;
    const final = events.reduce(
      (s, ev) => applyStageEvent(s, ev as StageEvent),
      toStageStates(plan.stages!),
    );
    expect(final.map((s) => s.status)).toEqual(['ok', 'ok', 'ok']);
    expect(final.map((s) => s.ms)).toEqual([357, 27729, 37261]);
    expect(stagesDone(final)).toBe(3);
  });

  it('never shows a stage done before the step event that finished it', () => {
    const [plan, ...events] = wire;
    let s = toStageStates(plan.stages!);
    let doneSoFar = 0;
    for (const ev of events) {
      s = applyStageEvent(s, ev as StageEvent);
      if (ev.type === 'step') doneSoFar++;
      // done count tracks step events exactly — never runs ahead of them
      expect(stagesDone(s)).toBe(doneSoFar);
    }
  });

  it('renders the finished run with each stage its measured duration', () => {
    const [plan, ...events] = wire;
    const final = events.reduce(
      (s, ev) => applyStageEvent(s, ev as StageEvent),
      toStageStates(plan.stages!),
    );
    const html = renderToStaticMarkup(<StageChecklist stages={final} />);
    expect(html.match(/\d+ms/g)).toEqual(['357ms', '27729ms', '37261ms']);
  });
});

describe('row 14 — the server sends the plan it will actually run', () => {
  const handler = readFileSync(
    new URL('../../../api/agent/[fn].ts', import.meta.url),
    'utf8',
  );

  it('emits a plan event before any stage event', () => {
    expect(handler).toContain("type: 'plan'");
    expect(handler).toContain('plannedStages(effectiveMode');
    expect(handler.indexOf("type: 'plan'")).toBeLessThan(handler.indexOf("trace.step('Recalling past calls'"));
  });

  it('gates the memory stage on the journal actually being configured', () => {
    expect(handler).toMatch(/hasMemory: Boolean\(process\.env\.SUPABASE_URL/);
  });
});
