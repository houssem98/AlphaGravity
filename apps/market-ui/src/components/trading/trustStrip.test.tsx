import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { TrustStrip, Turn, type Message } from './Assistant';
import { chipPropsFor, scoreAnswerTrust, type AnswerTrust } from '../../services/dexterTrust';

// DD-7 · row 7. The grade is the headline of a verified-answer product. It was
// a 10px chip whose reasons could only be reached by hovering it. Grade, score,
// rounds and EVERY reason now render as visible text, toned by chipPropsFor so
// the strip can never dress a C as an A.
const TRUST: AnswerTrust = {
  grade: 'C',
  score: 68,
  rounds: 2,
  reasons: ['17/29 figures sit in a cited sentence', '3 tools returned data', 'no fabricated cites'],
};

describe('row 7 — the trust strip states the verdict and its reasons', () => {
  const html = renderToStaticMarkup(<TrustStrip trust={TRUST} />);

  it('renders the grade, the score it came from and the round count', () => {
    expect(html).toContain('>C<');
    expect(html).toContain('68/100');
    expect(html).toContain('2 rounds');
  });

  it('renders every reason as visible text, not as a hover title', () => {
    for (const r of TRUST.reasons) expect(html).toContain(r);
    expect(html.match(/<li\b/g)?.length).toBe(TRUST.reasons.length);
    // the reasons are no longer hidden behind a tooltip
    expect(html).not.toContain(`title="${chipPropsFor(TRUST).title}"`);
  });

  it('takes its tone from chipPropsFor, never from its own judgement', () => {
    expect(chipPropsFor(TRUST).tone).toBe('amber');
    expect(html).toContain('amber-400');
    const good = renderToStaticMarkup(
      <TrustStrip trust={{ ...TRUST, grade: 'A', reasons: ['clean'] }} />,
    );
    expect(good).toContain('--up');
    expect(good).not.toContain('amber-400');
  });

  it('never cosmetically upgrades a failing grade', () => {
    const fail: AnswerTrust = { grade: 'F', score: 0, rounds: 1, reasons: ['no answer produced'] };
    const bad = renderToStaticMarkup(<TrustStrip trust={fail} />);
    expect(bad).toContain('--down');
    expect(bad).toContain('>F<');
    expect(bad).toContain('0/100');
    expect(bad).toContain('no answer produced');
  });

  it('styles honest-empty as honesty, not as failure', () => {
    const honest: AnswerTrust = {
      grade: 'C', score: 50, rounds: 1, honest: true,
      reasons: ['said plainly that the data was unavailable'],
    };
    expect(chipPropsFor(honest).tone).toBe('honest');
    const html2 = renderToStaticMarkup(<TrustStrip trust={honest} />);
    expect(html2).toContain('C·honest');
    expect(html2).toContain('--accent');
  });

  it('carries the uncited count so the warning survives in the verdict', () => {
    const withCount = renderToStaticMarkup(<TrustStrip trust={TRUST} uncitedCount={12} />);
    expect(withCount).toContain('12 uncited');
    expect(html).not.toContain('uncited');
  });

  it('renders no strip at all when the reply carried no trust', () => {
    const bare = renderToStaticMarkup(
      <Turn msg={{ id: 'm1', role: 'assistant', content: 'No data available.' }} />,
    );
    expect(bare).not.toContain('data-trust-grade');
  });
});

describe('row 7 against the reply prod actually returned', () => {
  const live = JSON.parse(
    readFileSync(new URL('./__fixtures__/dexter-prod-uncited.json', import.meta.url), 'utf8'),
  ) as { text: string; citations: []; uncitedFigures: string[]; trust: AnswerTrust };

  it('shows the grade prod earned with the reasons it earned it', () => {
    const msg: Message = {
      id: 'live',
      role: 'assistant',
      content: live.text,
      citations: live.citations,
      uncitedFigures: live.uncitedFigures,
      trust: live.trust,
    };
    const html = renderToStaticMarkup(<Turn msg={msg} />);
    expect(live.trust.grade).toBe('B');
    expect(html).toContain(`data-trust-grade="${live.trust.grade}"`);
    expect(html).toContain(`${live.trust.score}/100`);
    for (const r of live.trust.reasons) expect(html).toContain(r);
    expect(html).toContain(`${live.uncitedFigures.length} uncited`);
  });

  it('agrees with the score the server computed from the same answer', () => {
    const recomputed = scoreAnswerTrust({
      answer: live.text,
      citations: live.citations,
      steps: [],
    });
    // the grade is the server's to decide; the strip only reports it
    expect(recomputed.reasons.some((r) => /figures sit in a cited sentence/.test(r))).toBe(true);
  });
});
