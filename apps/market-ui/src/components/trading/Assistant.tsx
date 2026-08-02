import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, BarChart2, X, Sparkles } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage } from '../../services/dexterLlm';
import {
  figureSpans,
  uncitedFigures,
  type AgentReply,
  type ClientAction,
  type DexterCitation,
} from '../../services/dexterTools';
import {
  dexterLang,
  isCompletePlan,
  isLevelsBlock,
  parseBlock,
  LEVELS_LANG,
  PLAN_LANG,
  type DexterLevelsBlock,
  type DexterPlanBlock,
} from '../../services/dexterBlocks';
import { NOTE_LANG, isNoteBlock, type InstitutionalNote } from '../../services/institutionalNote';
import {
  applyStageEvent,
  stagesDone,
  toStageStates,
  type PlannedStage,
  type StageEvent,
  type StageState,
} from '../../services/dexterStages';
import { stepGlyph, traceSummary, type CellStep } from '../../services/gridTrace';
import { chipPropsFor, type AnswerTrust } from '../../services/dexterTrust';
import { isCryptoAsset } from '../../constants/tradingAssets';
import { motion, AnimatePresence } from 'motion/react';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** DD-11: what the reply actually drew. Replaces the derived `isDrawing`. */
  actions?: ClientAction[];
  steps?: CellStep[];
  citations?: DexterCitation[];
  fabricatedCites?: number[];
  uncitedFigures?: string[];
  trust?: AnswerTrust;
  // DD-1: the engine that produced this turn, as the server reported it.
  provider?: string;
  model?: string;
  ms?: number;
}

// DD-1: the newest turn that carries an engine identity. Old localStorage
// sessions predate these fields, so a session with none reports nothing rather
// than guessing a provider.
export interface EngineIdentity {
  provider: string;
  model: string;
  ms?: number;
}

export function lastAgentMeta(
  msgs: ReadonlyArray<{ provider?: string; model?: string; ms?: number }>,
): EngineIdentity | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.provider && m.model) return { provider: m.provider, model: m.model, ms: m.ms };
  }
  return null;
}

// DD-1 / F2: the footer used to hardcode a dead provider's name while the server
// answered with another one. A panel that misreports its own engine cannot ask
// to be trusted about a price, so the engine names itself from the reply.
export const EngineMeta: React.FC<{ meta: EngineIdentity | null }> = ({ meta }) => {
  if (!meta) return null;
  return (
    <span className="flex items-center gap-1 font-mono text-label text-[color:var(--text-3)]">
      <Sparkles className="w-3 h-3" />
      {meta.provider}/{meta.model}
      {typeof meta.ms === 'number' && (
        <span className="text-[color:var(--text-4)]">· {meta.ms}ms</span>
      )}
    </span>
  );
};

// DD-2 / F1: the answer body used to ask for `@tailwindcss/typography` classes
// that were never installed, so every heading, list and table rendered at raw
// browser defaults. There is no plugin to add — react-markdown takes an explicit
// component map, and each node here is styled from the terminal's own tokens.
//
// `##` is the section rule of a research answer, so it reads as a tracked
// Archivo Narrow label over a hairline, not as a big bold chat heading. Tables
// and code scroll inside their own container (row 16) so a wide level table can
// never push the panel body sideways.
const H_SECTION =
  'mt-4 mb-2 pb-1 border-b border-[color:var(--line)] font-display text-label font-semibold uppercase text-[color:var(--text-3)]';
const H_SUB = 'mt-3 mb-1 font-display text-data font-semibold text-[color:var(--text-2)]';

export const MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }) => <h2 className={H_SECTION}>{children}</h2>,
  h2: ({ children }) => <h2 className={H_SECTION}>{children}</h2>,
  h3: ({ children }) => <h3 className={H_SUB}>{children}</h3>,
  h4: ({ children }) => <h4 className={H_SUB}>{children}</h4>,
  h5: ({ children }) => <h5 className={H_SUB}>{children}</h5>,
  h6: ({ children }) => <h6 className={H_SUB}>{children}</h6>,
  p: ({ children }) => (
    <p className="my-2 text-body text-[color:var(--text)] break-words">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="my-2 space-y-1 pl-4 list-disc marker:text-[color:var(--text-4)]">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 space-y-1 pl-4 list-decimal marker:text-[color:var(--text-4)]">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="text-body text-[color:var(--text)] break-words">{children}</li>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-[color:var(--text)]">{children}</strong>
  ),
  em: ({ children }) => <em className="italic text-[color:var(--text-2)]">{children}</em>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-[color:var(--accent)] underline underline-offset-2 break-words hover:brightness-110"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-[color:var(--line-strong)] pl-3 text-body text-[color:var(--text-2)]">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-[color:var(--line)]" />,
  // A figure and a word must never share a typeface: anything the model fenced
  // or ticked is data, so it renders in Martian Mono.
  code: ({ className, children }) =>
    className?.includes('language-') ? (
      <code className={`font-mono text-data ${className}`}>{children}</code>
    ) : (
      <code className="rounded-sm bg-[color:var(--surface)] px-1 py-0.5 font-mono text-data text-[color:var(--text)]">
        {children}
      </code>
    ),
  // DD-8: a `dexter-*` fence is a structured block the server emitted from
  // validated numbers. Anything else — including a `dexter-*` name this build
  // does not know, or a body that will not parse — falls through to the plain
  // code block it always was.
  pre: ({ children }) => {
    const block = dexterBlock(children);
    if (block) return block;
    return (
      <pre className="my-2 overflow-x-auto rounded-sm border border-[color:var(--line)] bg-[color:var(--bg)] p-3 font-mono text-data text-[color:var(--text-2)]">
        {children}
      </pre>
    );
  },
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse font-mono text-data">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-[color:var(--line-strong)]">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="whitespace-nowrap px-2 py-1 text-left font-display text-label font-semibold uppercase text-[color:var(--text-3)]">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="whitespace-nowrap border-b border-[color:var(--line)] px-2 py-1 text-[color:var(--text)]">
      {children}
    </td>
  ),
};

// DD-8 / F10: the levels and the plan are the two things a trader scans in
// under a second, and they arrived as undifferentiated text. Both blocks are
// emitted by the SERVER from numbers that already validated, so the ladder
// cannot show a level the TA did not find.
// Grouped for reading, never rounded: a level is a price the TA actually found,
// and 63,987.22 is a different number from 63,987.215.
const fmt = (n: number, unit: string) =>
  `${n.toLocaleString('en-US', { maximumFractionDigits: 20 })}${unit}`;

export const LevelsCard: React.FC<{ block: DexterLevelsBlock }> = ({ block }) => {
  const rows = [
    ...[...block.resistance].reverse().map((l) => ({ ...l, kind: 'resistance' as const })),
    ...block.support.map((l) => ({ ...l, kind: 'support' as const })),
  ];
  return (
    <div
      data-dexter-block="levels"
      className="my-3 overflow-x-auto rounded-sm border border-[color:var(--line)] bg-[color:var(--surface)]"
    >
      <div className="flex items-baseline gap-2 border-b border-[color:var(--line)] px-3 py-1.5">
        <span className="font-display text-label font-semibold uppercase text-[color:var(--text-3)]">
          Levels
        </span>
        {block.lastClose !== null && (
          <span className="font-mono text-data text-[color:var(--text)]">
            {fmt(block.lastClose, block.unit)}
          </span>
        )}
        <span
          className={`font-mono text-label ${
            block.trend === 'up'
              ? 'text-[color:var(--up)]'
              : block.trend === 'down'
                ? 'text-[color:var(--down)]'
                : 'text-[color:var(--text-3)]'
          }`}
        >
          {block.trend}
        </span>
        {block.atr !== null && (
          <span className="ml-auto shrink-0 font-mono text-label text-[color:var(--text-4)]">
            ATR {fmt(block.atr, '')}
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="px-3 py-1.5 font-mono text-label text-[color:var(--text-3)]">
          no levels found in the bars
        </div>
      ) : (
        <div>
          {rows.map((l, i) => (
            <div
              key={i}
              className="flex items-baseline gap-3 border-b border-[color:var(--line)] px-3 py-1 last:border-b-0"
            >
              <span
                className={`w-16 shrink-0 font-mono text-label uppercase ${
                  l.kind === 'resistance' ? 'text-[color:var(--down)]' : 'text-[color:var(--up)]'
                }`}
              >
                {l.kind === 'resistance' ? 'res' : 'sup'}
              </span>
              <span className="font-mono text-data text-[color:var(--text)]">
                {fmt(l.price, block.unit)}
              </span>
              <span className="ml-auto shrink-0 font-mono text-label text-[color:var(--text-4)]">
                {l.touches} touch{l.touches === 1 ? '' : 'es'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const PlanCard: React.FC<{ block: DexterPlanBlock }> = ({ block }) => {
  const risk = Math.abs(block.entry - block.stop);
  const reward = Math.abs(block.target - block.entry);
  const rewardShare = risk + reward > 0 ? (reward / (risk + reward)) * 100 : 0;
  const long = block.target >= block.entry;
  return (
    <div
      data-dexter-block="plan"
      className="my-3 rounded-sm border border-[color:var(--line-strong)] bg-[color:var(--surface)]"
    >
      <div className="flex items-baseline gap-2 border-b border-[color:var(--line)] px-3 py-1.5">
        <span
          className={`font-mono text-body font-bold ${
            long ? 'text-[color:var(--up)]' : 'text-[color:var(--down)]'
          }`}
        >
          {block.action}
        </span>
        <span className="font-mono text-label text-[color:var(--text-3)]">
          {block.sizePct}% of portfolio
        </span>
        <span className="ml-auto shrink-0 font-mono text-label text-[color:var(--text-2)]">
          {block.rr}:1
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 px-3 py-2">
        {(
          [
            ['entry', block.entry, 'text-[color:var(--text)]'],
            ['stop', block.stop, 'text-[color:var(--down)]'],
            ['target', block.target, 'text-[color:var(--up)]'],
          ] as const
        ).map(([label, value, tone]) => (
          <div key={label}>
            <div className="font-display text-label uppercase text-[color:var(--text-4)]">
              {label}
            </div>
            <div className={`font-mono text-data ${tone}`}>{fmt(value, block.unit)}</div>
          </div>
        ))}
      </div>
      {/* The bar is the R:R made visible: red is what is risked to win green. */}
      <div className="flex h-1 overflow-hidden px-3 pb-2">
        <div className="flex h-1 w-full overflow-hidden rounded-sm">
          <div
            className="h-full bg-[color:var(--down)]"
            style={{ width: `${100 - rewardShare}%` }}
          />
          <div className="h-full bg-[color:var(--up)]" style={{ width: `${rewardShare}%` }} />
        </div>
      </div>
    </div>
  );
};

// A plan that lost a number is not a plan. Rendering three of its four fields
// as a card would read as executable while missing the stop.
export const IncompletePlan: React.FC<{ missing: string[] }> = ({ missing }) => (
  <div
    data-dexter-block="plan-incomplete"
    role="alert"
    className="my-3 rounded-sm border border-amber-400 bg-[color:var(--surface-2)] px-3 py-2 font-mono text-label text-amber-400"
  >
    ⚠ incomplete plan — no {missing.join(', ')}. Not shown as a trade.
  </div>
);

// DI-13: the institutional skeleton a PM scans for. A field the evidence could
// not support is painted as its gap sentence in the warning colour rather than
// dropped, because a note missing its price target must LOOK like a note missing
// its price target.
export const NoteCard: React.FC<{ note: InstitutionalNote }> = ({ note }) => (
  <div
    data-dexter-block="note"
    className="my-3 rounded-sm border border-[color:var(--line-strong)] bg-[color:var(--surface)]"
  >
    <div className="flex items-baseline gap-2 border-b border-[color:var(--line)] px-3 py-1.5">
      <span className="font-display text-label font-semibold uppercase text-[color:var(--text-3)]">
        Note
      </span>
      <span className="font-mono text-data text-[color:var(--text)]">{note.symbol}</span>
      {!note.complete && (
        <span className="ml-auto font-mono text-label text-amber-400">
          {note.gaps.length} gap{note.gaps.length === 1 ? '' : 's'}
        </span>
      )}
    </div>
    <dl className="divide-y divide-[color:var(--line)]">
      {note.fields.map((f) => (
        <div key={f.key} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:gap-3">
          <dt className="font-display text-label uppercase text-[color:var(--text-3)] sm:w-40 sm:shrink-0">
            {f.label}
          </dt>
          <dd
            className={`text-body ${f.value ? 'text-[color:var(--text)]' : 'font-mono text-label text-amber-400'}`}
          >
            {f.value ?? `— ${f.gap}`}
          </dd>
        </div>
      ))}
    </dl>
    {note.calibration && (
      <div className="border-t border-[color:var(--line)] px-3 py-1.5 font-mono text-label text-[color:var(--text-3)]">
        {note.calibration}
      </div>
    )}
  </div>
);

/** Turn a `<pre>`'s child `<code>` into a Dexter block, or null to keep the
 *  code block. Never throws: an unknown name or unparseable body returns null. */
function dexterBlock(children: React.ReactNode): React.ReactElement | null {
  const child = React.Children.toArray(children)[0];
  if (!React.isValidElement(child)) return null;
  const props = child.props as { className?: string; children?: React.ReactNode };
  const lang = dexterLang(props.className);
  if (!lang) return null;

  const body = React.Children.toArray(props.children).filter((c) => typeof c === 'string').join('');
  const parsed = parseBlock(body);
  if (parsed === null) return null;

  if (lang === LEVELS_LANG && isLevelsBlock(parsed)) return <LevelsCard block={parsed} />;
  if (lang === NOTE_LANG && isNoteBlock(parsed)) return <NoteCard note={parsed} />;
  if (lang === PLAN_LANG) {
    if (isCompletePlan(parsed)) return <PlanCard block={parsed} />;
    const p = parsed as Partial<DexterPlanBlock>;
    const missing = (['entry', 'stop', 'target', 'rr'] as const).filter(
      (k) => typeof p?.[k] !== 'number' || !Number.isFinite(p[k] as number),
    );
    return <IncompletePlan missing={missing.map((m) => (m === 'rr' ? 'R:R' : m))} />;
  }
  return null;
}

// DD-4 / F4: the verification work already ships on the reply — the UI's job is
// to make a claim's evidence reachable in one click. A `[N]` with a matching
// source becomes a chip that scrolls to and flashes source N; a `[N]` with no
// matching source is exactly what a fabricated citation looks like, so it
// renders in the down colour and never becomes a live chip. Anchors are scoped
// by message id — two answers both citing [1] must not collide.
export const citeAnchorId = (scope: string, n: number) => `dexter-cite-${scope}-${n}`;

export const CiteChip: React.FC<{ n: number; cite?: DexterCitation; scope: string }> = ({
  n,
  cite,
  scope,
}) => {
  if (!cite) {
    return (
      <span
        title="cites a source that does not exist"
        className="font-mono text-label font-bold text-[color:var(--down)]"
      >
        [{n}]
      </span>
    );
  }
  const target = citeAnchorId(scope, n);
  return (
    <button
      type="button"
      data-cite-target={target}
      title={`${cite.title} · ${cite.source}\n${cite.text}`}
      onClick={() => {
        const el = document.getElementById(target);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.animate(
          [
            { backgroundColor: 'color-mix(in oklab, var(--accent) 30%, transparent)' },
            { backgroundColor: 'transparent' },
          ],
          { duration: 1200 },
        );
      }}
      className="inline-flex items-center rounded-sm border border-[color:var(--line-strong)] bg-[color:var(--surface-2)] px-1 align-baseline font-mono text-label text-[color:var(--accent)] transition-colors hover:border-[color:var(--accent)]"
    >
      {n}
    </button>
  );
};

// DD-6 / F6: the reply says 12 of 29 figures are unsupported but not WHICH
// sentence holds them, so the warning reads as noise. The mark goes where the
// figure sits. A figure whose own sentence carries a marker is never flagged —
// that judgement is `figureSpans`, the same rule the trust score is built on,
// so the answer text and the grade can never disagree.
export const UncitedMark: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span
    data-uncited="true"
    title="no source in this sentence — this figure is unsupported"
    className="border-b border-dotted border-amber-400 text-amber-400"
  >
    {children}
  </span>
);

// U+2063 INVISIBLE SEPARATOR. A figure's sentence can span element boundaries —
// `**62,211.53**: … [1]` puts the figure in one node and its marker in another —
// so the decision is made ONCE on the raw answer text, where the whole sentence
// is visible, and carried into the tree as a pair of format characters. They are
// invisible, they are not whitespace, so `**bold**` still parses as bold, and
// the renderer only has to paint what was already decided.
const MARK = '⁣';

const CODE_RE = /```[\s\S]*?```|`[^`\n]*`/g;

/** Wrap every figure the server flagged, at its own position in the text. */
export function markUncited(text: string, uncited: string[]): string {
  if (!text || uncited.length === 0) return text;
  const want = new Set(uncited);
  const code: Array<[number, number]> = [];
  for (const m of text.matchAll(CODE_RE)) code.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);

  let out = text;
  // back to front, so an insertion never shifts a span still to be applied
  for (const s of figureSpans(text).reverse()) {
    if (!s.uncited || !want.has(s.norm)) continue;
    if (code.some(([a, b]) => s.start >= a && s.end <= b)) continue;
    out = out.slice(0, s.start) + MARK + s.raw + MARK + out.slice(s.end);
  }
  return out;
}

const MARKER_RE = /\[(\d+)\]/g;

// Split one string node into citation chips, uncited marks and plain text.
const renderTextNode = (
  s: string,
  cites: DexterCitation[],
  scope: string,
): React.ReactNode => {
  if (!s.includes(MARK) && !MARKER_RE.test(s)) return s;
  MARKER_RE.lastIndex = 0;

  const out: React.ReactNode[] = [];
  let key = 0;
  s.split(MARK).forEach((chunk, i) => {
    if (!chunk) return;
    if (i % 2 === 1) {
      out.push(<UncitedMark key={key++}>{chunk}</UncitedMark>);
      return;
    }
    for (const part of chunk.split(/(\[\d+\])/g)) {
      if (!part) continue;
      const marker = /^\[(\d+)\]$/.exec(part);
      if (!marker) {
        out.push(part);
        continue;
      }
      const n = Number(marker[1]);
      out.push(<CiteChip key={key++} n={n} cite={cites.find((c) => c.id === n)} scope={scope} />);
    }
  });
  return out;
};

// Elements pass through — their own component override transforms them — and
// code/pre are deliberately not wrapped: fenced content is data, not narrative.
const renderInline = (
  children: React.ReactNode,
  cites: DexterCitation[],
  scope: string,
): React.ReactNode =>
  React.Children.map(children, (child) =>
    typeof child === 'string' ? renderTextNode(child, cites, scope) : child,
  );

// Without citations (an old localStorage message) the base map renders [N] as
// the literal text it always was — no chips, no red, no guessing.
export function markdownComponents(cites?: DexterCitation[], scope = ''): Components {
  if (!cites) return MARKDOWN_COMPONENTS;
  const wrap = (key: 'p' | 'li' | 'td' | 'th' | 'strong' | 'em') => {
    const Base = MARKDOWN_COMPONENTS[key] as React.FC<{ children?: React.ReactNode }>;
    return ({ children }: { children?: React.ReactNode }) => (
      <Base>{renderInline(children, cites, scope)}</Base>
    );
  };
  return {
    ...MARKDOWN_COMPONENTS,
    p: wrap('p'),
    li: wrap('li'),
    td: wrap('td'),
    th: wrap('th'),
    strong: wrap('strong'),
    em: wrap('em'),
  };
}

export const AnswerBody: React.FC<{
  text: string;
  citations?: DexterCitation[];
  anchorScope?: string;
  /** The server's own list. Absent on an old message, so it is recomputed with
   *  the identical function rather than guessed at. */
  uncited?: string[];
}> = ({ text, citations, anchorScope = '', uncited }) => (
  <div className="min-w-0 text-body text-[color:var(--text)]">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents(citations, anchorScope)}>
      {citations ? markUncited(text, uncited ?? uncitedFigures(text)) : text}
    </ReactMarkdown>
  </div>
);

// DX-7: the grade the answer earned, with the reasons it earned it. Honest-empty
// gets its own tone — an answer that admits a gap is not a failed answer.
// DD-1: toned from the direction tokens the rest of the terminal uses. Amber has
// no token — it is the app's warning colour and stays on the palette scale.
const TRUST_TONE: Record<string, string> = {
  green: 'text-[color:var(--up)] border-[color:var(--up)]',
  amber: 'text-amber-400 border-amber-400',
  red: 'text-[color:var(--down)] border-[color:var(--down)]',
  honest: 'text-[color:var(--accent)] border-[color:var(--accent)]',
};

// DD-7 / F7: the grade is the headline of a verified-answer product, and it was
// the smallest thing on screen — a 10px chip whose reasons were reachable only
// by hovering it. The strip states the grade, the score it was computed from,
// how many rounds it took, and EVERY reason as visible text. `chipPropsFor` is
// still the single source of tone and label, so a C can never be dressed as an A.
export const TrustStrip: React.FC<{ trust: AnswerTrust; uncitedCount?: number }> = ({
  trust,
  uncitedCount = 0,
}) => {
  const { label, tone } = chipPropsFor(trust);
  return (
    <div
      data-trust-grade={trust.grade}
      className={`mt-3 rounded-sm border bg-[color:var(--surface-2)] px-3 py-2 ${TRUST_TONE[tone]}`}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-body font-bold">{label}</span>
        <span className="font-mono text-label text-[color:var(--text-2)]">{trust.score}/100</span>
        <span className="font-mono text-label text-[color:var(--text-3)]">
          {trust.rounds} round{trust.rounds === 1 ? '' : 's'}
        </span>
        {uncitedCount > 0 && (
          <span className="ml-auto font-mono text-label text-amber-400">
            {uncitedCount} uncited
          </span>
        )}
      </div>
      {trust.reasons.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {trust.reasons.map((r, i) => (
            <li key={i} className="font-mono text-label text-[color:var(--text-2)] break-words">
              · {r}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// DX-6: what the numbers rest on, and which ones rest on nothing. An answer
// whose figures cannot be traced is exactly the failure mode this agent exists
// to avoid, so it is stated rather than hidden.
// DD-5 / row 8: a fabricated citation is the loudest thing an answer can carry,
// so it is stated BEFORE the text it undermines, not in a footnote under it.
export const FabricatedBanner: React.FC<{ fabricated?: number[] }> = ({ fabricated = [] }) => {
  if (fabricated.length === 0) return null;
  return (
    <div
      role="alert"
      className="mb-3 flex items-start gap-2 rounded-sm border border-[color:var(--down)] bg-[color:var(--surface-2)] px-3 py-2 font-mono text-label text-[color:var(--down)]"
    >
      <span aria-hidden>✗</span>
      <span className="break-words">
        {fabricated.length} fabricated citation{fabricated.length === 1 ? '' : 's'}:{' '}
        {fabricated.map((n) => `[${n}]`).join(' ')} — no such source. Treat those figures as
        unsupported.
      </span>
    </div>
  );
};

// The reply times whole stages (`memory`, `analysts`, `llm`), not individual
// citations, so a latency renders only where a step's tool is literally the
// citation's source. No match, no number — doctrine 4.
export const citationMs = (source: string, steps?: CellStep[]): number | undefined =>
  steps?.find((s) => s.tool === source)?.ms;

// DD-5 / F5: the price-snap audit trail is the strongest proof the agent did not
// invent a level, and `truncate` was clipping it to about four words. One card
// per citation, full payload, anchored so a DD-4 chip can land on it.
const EvidencePanel: React.FC<{
  citations?: DexterCitation[];
  steps?: CellStep[];
  scope?: string;
}> = ({ citations = [], steps, scope = '' }) => {
  if (citations.length === 0) return null;
  return (
    <div className="mt-3 space-y-1">
      <div className="font-display text-label font-semibold uppercase text-[color:var(--text-3)]">
        Sources
      </div>
      {citations.map((c) => {
        const ms = citationMs(c.source, steps);
        return (
          <div
            key={c.id}
            id={citeAnchorId(scope, c.id)}
            className="rounded-sm border border-[color:var(--line)] bg-[color:var(--surface)] px-2 py-1.5"
          >
            <div className="flex items-baseline gap-2">
              <span className="shrink-0 font-mono text-label text-[color:var(--accent)]">
                [{c.id}]
              </span>
              <span className="font-mono text-label text-[color:var(--text-2)] break-words">
                {c.source}
              </span>
              {ms !== undefined && (
                <span className="ml-auto shrink-0 font-mono text-label text-[color:var(--text-4)]">
                  {ms}ms
                </span>
              )}
            </div>
            <div className="mt-0.5 text-data text-[color:var(--text-2)] break-words">{c.title}</div>
            <div className="mt-0.5 whitespace-pre-wrap break-words font-mono text-label text-[color:var(--text-3)]">
              {c.text}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// DX-3: what actually ran, under the answer. A step is here iff its call
// executed, so a failed feed shows its real error rather than disappearing.
// DD-9 / F8: analysts → debate → risk → verification is the product's
// differentiator and it collapsed to `▸ 6 steps · 32351ms` in grey. The
// timeline gives every step its glyph, its label, a bar proportional to the run
// it belongs to, and its real meta or error text — never truncated, because the
// error string is the whole point of showing a failed step. Collapsed by
// default, but the summary it collapses to states the failures.
const STATUS_TONE: Record<CellStep['status'], string> = {
  ok: 'text-[color:var(--up)]',
  empty: 'text-amber-400',
  failed: 'text-[color:var(--down)]',
};

const BAR_TONE: Record<CellStep['status'], string> = {
  ok: 'bg-[color:var(--accent)]',
  empty: 'bg-amber-400',
  failed: 'bg-[color:var(--down)]',
};

export const TracePanel: React.FC<{ steps: CellStep[]; defaultOpen?: boolean }> = ({
  steps,
  defaultOpen = false,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  if (steps.length === 0) return null;
  const { tools, failed, totalMs } = traceSummary(steps);
  // The bar is relative to the slowest step, so the shape of the run reads at a
  // glance. A zero-length run would divide by zero, so it floors at 1.
  const slowest = Math.max(1, ...steps.map((s) => s.ms));

  return (
    <div className="mt-3 border-t border-[color:var(--line)] pt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="font-mono text-label text-[color:var(--text-3)] transition-colors hover:text-[color:var(--text)]"
      >
        {open ? '▾' : '▸'} {tools} step{tools === 1 ? '' : 's'} · {totalMs}ms
        {failed > 0 && (
          <span className="text-[color:var(--down)]">
            {' '}
            · {failed} failed
          </span>
        )}
      </button>
      {open && (
        <div data-trace-timeline="true" className="mt-2 space-y-1">
          {steps.map((s, i) => (
            <div key={i} className="font-mono text-label">
              <div className="flex items-baseline gap-2">
                <span className={`shrink-0 ${STATUS_TONE[s.status]}`}>{stepGlyph(s.status)}</span>
                <span className="text-[color:var(--text-2)]">{s.label}</span>
                <span className="ml-auto shrink-0 text-[color:var(--text-4)]">{s.ms}ms</span>
              </div>
              <div className="mt-0.5 flex h-0.5 overflow-hidden pl-5">
                <div
                  data-step-bar={s.ms}
                  className={`h-full rounded-sm ${BAR_TONE[s.status]}`}
                  style={{ width: `${Math.max(1, Math.round((s.ms / slowest) * 100))}%` }}
                />
              </div>
              {(s.error || s.meta) && (
                <div
                  className={`mt-0.5 break-words pl-5 ${
                    s.error ? 'text-[color:var(--down)]' : 'text-[color:var(--text-4)]'
                  }`}
                >
                  {s.error || s.meta}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// DD-12: a Tunisian listing is quoted in dinar; the header printed a dollar
// sign on every asset regardless. Sub-1 prices keep 4 decimals because a
// 2-decimal TND micro-cap would round to zero.
export function quotePrice(price: number, isTN: boolean): string {
  const n = price < 1 ? price.toFixed(4) : price.toFixed(2);
  return isTN ? `${n} TND` : `$${n}`;
}

// DD-11 / F12: the confirmation was gated on `isDrawing`, a flag derived from
// the reply rather than read from it, so a chart mutation could not name itself.
// It is driven by `reply.actions` now — and it names what was drawn, from the
// gated args the server sent. Every price here already passed the DX-5 gate and
// was snapped to a level the engine computed, so these are real levels.
const DRAW_LABEL: Record<string, string> = {
  support_resistance: 'support / resistance',
  order_block: 'order block',
  fibonacci: 'Fibonacci retracement',
  pattern: 'pattern',
};

/** What a drawing put on the chart, said in the terms the args actually carry. */
export function describeAction(action: ClientAction): string {
  const name = DRAW_LABEL[action.type] ?? action.type.replace(/_/g, ' ');
  const args = action.args ?? {};
  const levels = Array.isArray(args.levels)
    ? (args.levels as unknown[]).filter((n) => Number.isFinite(n as number))
    : [];
  const points = Array.isArray(args.points) ? (args.points as unknown[]) : [];
  const n = levels.length + points.length;
  return n > 0 ? `${name} · ${n} level${n === 1 ? '' : 's'}` : name;
}

export const ChartActions: React.FC<{ actions?: ClientAction[] }> = ({ actions }) => {
  if (!actions || actions.length === 0) return null;
  return (
    <motion.div
      data-chart-actions={actions.length}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      className="mt-3 w-fit rounded-sm border border-[color:var(--line-strong)] bg-[color:var(--surface)] px-3 py-2"
    >
      <div className="flex items-center gap-2 font-mono text-label text-[color:var(--accent)]">
        <BarChart2 className="w-4 h-4 shrink-0" />
        drawn on the chart
      </div>
      <ul className="mt-1 space-y-0.5">
        {actions.map((a, i) => (
          <li key={i} className="font-mono text-label text-[color:var(--text-2)] break-words">
            · {describeAction(a)}
          </li>
        ))}
      </ul>
    </motion.div>
  );
};

// DD-3 / F9: bubble geometry is right for a question and wrong for a research
// answer. A user turn stays a compact right-aligned bubble; an assistant turn is
// a full-width document marked by a left rule — no avatar column stealing 56px,
// no 85% cap. The user's own words are typed plain text, so they render plain
// (whitespace preserved), never through the markdown map.
export const Turn: React.FC<{ msg: Message; traceOpen?: boolean }> = ({ msg, traceOpen }) => {
  if (msg.role === 'user') {
    return (
      <div className="flex flex-row-reverse gap-4">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border bg-[color:var(--accent)] border-[color:var(--accent)]">
          <User className="w-5 h-5 text-[color:var(--accent-ink)]" />
        </div>
        <div className="max-w-[85%] rounded-xl rounded-tr-none p-4 bg-[color:var(--accent)] text-[color:var(--accent-ink)]">
          <div className="text-body whitespace-pre-wrap break-words">{msg.content}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="w-full border-l-2 border-[color:var(--line)] pl-4">
      <FabricatedBanner fabricated={msg.fabricatedCites} />
      <AnswerBody
        text={msg.content}
        citations={msg.citations}
        anchorScope={msg.id}
        uncited={msg.uncitedFigures}
      />
      <ChartActions actions={msg.actions} />
      {msg.trust && (
        <TrustStrip trust={msg.trust} uncitedCount={msg.uncitedFigures?.length ?? 0} />
      )}
      <EvidencePanel citations={msg.citations} steps={msg.steps} scope={msg.id} />
      {msg.steps && <TracePanel steps={msg.steps} defaultOpen={traceOpen} />}
    </div>
  );
};

// DD-10 / F11: a run can take minutes and showed one spinner line for all of
// it. The checklist states the pipeline the router chose before it runs, then
// ticks each stage as its event lands — with the real duration the step
// reported. A stage is never marked done ahead of the event that finished it.
const STAGE_GLYPH: Record<StageState['status'], string> = {
  pending: '·',
  running: '▸',
  ok: '✓',
  empty: '○',
  failed: '✗',
};

const STAGE_TONE: Record<StageState['status'], string> = {
  pending: 'text-[color:var(--text-4)]',
  running: 'text-[color:var(--accent)]',
  ok: 'text-[color:var(--up)]',
  empty: 'text-amber-400',
  failed: 'text-[color:var(--down)]',
};

export const StageChecklist: React.FC<{ stages: StageState[] }> = ({ stages }) => {
  if (stages.length === 0) return null;
  return (
    <div data-stage-checklist="true" className="mt-2 space-y-0.5">
      {stages.map((s, i) => (
        <div key={`${s.tool}-${i}`} className="flex items-baseline gap-2 font-mono text-label">
          <span className={`shrink-0 ${STAGE_TONE[s.status]}`}>{STAGE_GLYPH[s.status]}</span>
          <span
            className={
              s.status === 'pending'
                ? 'text-[color:var(--text-4)]'
                : 'text-[color:var(--text-2)]'
            }
          >
            {s.label}
          </span>
          {s.ms !== undefined && (
            <span className="ml-auto shrink-0 text-[color:var(--text-4)]">{s.ms}ms</span>
          )}
        </div>
      ))}
    </div>
  );
};

interface AssistantProps {
  onDraw: (type: string, data: any) => void;
  currentAsset: string;
  onClose?: () => void;
  market?: import('../../lib/markets').MarketId;
  assetName?: string;
}

const GREETING: Message = {
  id: '1',
  role: 'assistant',
  content: 'Hello! I am your AI Trading Assistant. I can analyze charts, identify patterns, and draw technical indicators like order blocks and Fibonacci retracements. How can I help you today?',
};

export const Assistant: React.FC<AssistantProps> = ({ onDraw, currentAsset, onClose, market, assetName }) => {
  const isTN = market === 'tunisia';
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [stages, setStages] = useState<StageState[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<ChatMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // DX-16: one session per asset. Switching to ETH and back should not lose
  // what was already said about BTC.
  const sessionKey = `dexter_session_${market ?? 'us'}_${currentAsset}`;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let isMounted = true;
    setCurrentPrice(null);

    const isCrypto = isCryptoAsset(currentAsset);

    if (isCrypto) {
      const connectWebSocket = (useUS: boolean = false) => {
        if (!isMounted) return;
        const baseUrl = useUS ? 'wss://stream.binance.us' : 'wss://stream.binance.com';
        ws = new WebSocket(`${baseUrl}/ws/${currentAsset.toLowerCase()}usdt@ticker`);
        
        ws.onmessage = (event) => {
          if (!isMounted) return;
          try {
            const data = JSON.parse(event.data);
            if (data.c !== undefined) {
              setCurrentPrice(parseFloat(data.c));
            } else if (data.code || data.msg) {
              if (!useUS) {
                if (ws) ws.close();
                connectWebSocket(true);
              }
            }
          } catch (e) {
            console.error('WS parse error:', e);
          }
        };

        ws.onerror = () => {
          if (!useUS && isMounted) {
            if (ws) ws.close();
            connectWebSocket(true);
          }
        };
      };

      connectWebSocket(false);
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      ws.onopen = () => {
        ws?.send(JSON.stringify({ type: 'subscribe', symbol: currentAsset, interval: '1m' }));
      };
      ws.onmessage = (event) => {
        if (!isMounted) return;
        const data = JSON.parse(event.data);
        if (data.type === 'trade' && data.symbol === currentAsset) {
          setCurrentPrice(data.close);
        }
      };
    }

    return () => {
      isMounted = false;
      if (ws) ws.close();
    };
  }, [currentAsset]);

  // The tool belt lives server-side now (dexterTools.ts): one POST runs the
  // whole tool loop next to the model, and the browser only applies the chart
  // actions that come back. Nothing here fetches market data any more.
  // DX-16: streamed as NDJSON so the stage the server is on shows up while it
  // runs. `onStage` fires when a step STARTS, `onStep` when it lands with its
  // real duration — the ticker never claims a stage finished before it did.
  const postAgent = async (
    messages: ChatMessage[],
    onStage: (label: string) => void,
    signal: AbortSignal,
    onPlan?: (stages: PlannedStage[]) => void,
    onStageEvent?: (ev: StageEvent) => void,
  ): Promise<AgentReply> => {
    const res = await fetch('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        stream: true,
        messages,
        asset: {
          symbol: currentAsset,
          isTN,
          isCrypto: !isTN && isCryptoAsset(currentAsset),
          name: assetName,
          price: currentPrice,
        },
      }),
    });

    if (!res.ok || !res.body) {
      const json = await res.json().catch(() => ({ error: `agent/chat HTTP ${res.status}` }));
      throw Object.assign(new Error(json.error || `agent/chat HTTP ${res.status}`), { steps: json.steps });
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done: AgentReply | null = null;

    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let ev: any;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'plan') onPlan?.(ev.stages ?? []);
        else if (ev.type === 'stage') { onStage(ev.label); onStageEvent?.(ev as StageEvent); }
        else if (ev.type === 'step') onStageEvent?.(ev as StageEvent);
        else if (ev.type === 'error') throw Object.assign(new Error(ev.error), { steps: ev.steps });
        else if (ev.type === 'done') done = ev as AgentReply;
      }
    }
    if (!done) throw new Error('the run ended without producing an answer');
    return done;
  };


  const systemPrompt = () =>
    `You are Dexter, an AI financial analyst and trading assistant. You answer with live market data
        pulled through your tools, and you say plainly when a number is not available rather than
        estimating it. Never state a price, level, or ratio you did not read from a tool result.

        The user's chart currently displays:
        - Asset: ${currentAsset}${isTN ? ` (${assetName || currentAsset} — listed on the Bourse de Tunis / BVMT, quoted in Tunisian Dinar TND)` : ''}
        - Current Real-time Price: ${currentPrice !== null ? (isTN ? currentPrice + ' TND' : '$' + currentPrice) : 'Unknown'}${isTN ? `

        IMPORTANT — Tunisian listing: all prices are in TND, not USD. Chart data
        comes live from the BVMT feed (intraday candles; daily history is short —
        it accumulates one bar per session). Fundamental ratios (P/E, EPS) and
        financial statements are NOT available yet for BVMT listings; getFundamentalData
        returns live market stats (price, change, volume, turnover, bid/ask, ISIN)
        plus a deterministic 4-factor Engine score (momentum/volume/news/liquidity).
        Answer in the user's language (French is common for Tunisian finance).` : ''}
        - Candlestick price action
        - Volume histogram at the bottom
        - 20-period Simple Moving Average (SMA 20) in blue
        - 50-period Simple Moving Average (SMA 50) in orange
        
        You have access to the following tools:
        1. getChartData: Retrieves recent OHLCV data for the currently viewed asset (${currentAsset}). Use this to analyze price action, volume, and moving averages before making recommendations or drawing.
        2. drawTechnicalAnalysis: Draws indicators on the chart. Use this when the user asks you to find support/resistance, order blocks, fibonacci levels, or identify patterns like head and shoulders, double tops/bottoms, etc.
        3. getFundamentalData: Retrieves fundamental data (P/E ratio, Market Cap, Revenue, etc.) for the current asset. Use this when the user asks for fundamental analysis.
        4. getFinancialStatements: Retrieves detailed financial statements (income statement, balance sheet, cash flow) for the current asset. Use this for deep fundamental research.
        
        When analyzing, always provide clear insights and predictions based on technical indicators and historical data. Be professional, concise, and thoroughly explain your reasoning. If you draw something, explain what you drew and why. For patterns, use the "points" array to specify the time and price of each key point (e.g., left shoulder, head, right shoulder) and provide a label for each.`;

  const sendMessage = async (text: string) => {
    if (!text.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const history = historyRef.current;
      if (history.length === 0) history.push({ role: 'system', content: systemPrompt() });
      const contextMessage = `[System Context: Current Asset is ${currentAsset}. Real-time Price is ${currentPrice !== null ? (isTN ? currentPrice + ' TND' : '$' + currentPrice) : 'Unknown'}.]\n\n${text}`;
      history.push({ role: 'user', content: contextMessage });
      const controller = new AbortController();
      abortRef.current = controller;
      setStages([]);
      const reply = await postAgent(
        history,
        setStage,
        controller.signal,
        (planned) => setStages(toStageStates(planned)),
        (ev) => setStages((prev) => applyStageEvent(prev, ev)),
      );
      history.push({ role: 'assistant', content: reply.text });
      for (const action of reply.actions) onDraw(action.type, action.args);

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'assistant',
          content: reply.text,
          actions: reply.actions,
          steps: reply.steps,
          citations: reply.citations,
          fabricatedCites: reply.fabricatedCites,
          uncitedFigures: reply.uncitedFigures,
          trust: reply.trust,
          provider: reply.provider,
          model: reply.model,
          ms: reply.ms,
        },
      ]);
    } catch (error: any) {
      const cancelled = error?.name === 'AbortError';
      if (!cancelled) console.error('Error calling /api/agent/chat:', error);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'assistant',
          content: cancelled
            ? 'Cancelled — nothing further was run.'
            : `Sorry, I encountered an error: ${error.message}`,
          steps: error?.steps,
        },
      ]);
    } finally {
      setIsLoading(false);
      setStage(null);
      abortRef.current = null;
    }
  };

  const handleSend = () => sendMessage(input);

  const handleAnalyze = () => {
    sendMessage(`Please analyze the current chart for ${currentAsset}, provide insights, predictions based on technical indicators, and explain your reasoning.`);
  };

  // Restore this asset's session, or start a fresh one. The system prompt is
  // asset-scoped, so the model history is rebuilt from the next message either
  // way; only what the user can see is persisted.
  useEffect(() => {
    historyRef.current = [];
    abortRef.current?.abort();
    setStage(null);
    try {
      const saved = localStorage.getItem(sessionKey);
      setMessages(saved ? JSON.parse(saved) : [GREETING]);
    } catch {
      setMessages([GREETING]);
    }
  }, [sessionKey]);

  useEffect(() => {
    if (messages.length <= 1) return;
    try { localStorage.setItem(sessionKey, JSON.stringify(messages.slice(-40))); } catch { /* quota */ }
  }, [messages, sessionKey]);

  return (
    <div className="flex flex-col h-full bg-[color:var(--bg)] border-l border-[color:var(--line)] shadow-xl">
      {/* Header — a terminal strip, the same shape as the app's own Topbar:
          one 40px row, name left, live quote in Martian Mono, actions right. */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[color:var(--line)] bg-[color:var(--surface)] px-3">
        <Bot className="w-4 h-4 shrink-0 text-[color:var(--accent)]" />
        <h2 className="shrink-0 font-display text-body font-semibold text-[color:var(--text)]">
          Dexter
        </h2>
        {currentPrice !== null && (
          <div className="flex min-w-0 items-baseline gap-1.5 truncate font-mono text-label">
            <span className="text-[color:var(--text-3)]">{currentAsset}</span>
            <span className="text-[color:var(--text)]">{quotePrice(currentPrice, isTN)}</span>
          </div>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            onClick={handleAnalyze}
            disabled={isLoading}
            title={`Analyze ${currentAsset}`}
            className="flex items-center gap-1.5 rounded-sm bg-[color:var(--accent)] px-2.5 py-1 font-display text-label font-semibold text-[color:var(--accent-ink)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <BarChart2 className="w-3 h-3" />
            <span className="hidden sm:inline">ANALYZE</span>
          </button>
          {onClose && (
            <button
              onClick={onClose}
              title="Close"
              className="rounded-sm p-1 text-[color:var(--text-3)] transition-colors hover:bg-[color:var(--surface-2)] hover:text-[color:var(--text)]"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[color:var(--bg)] custom-scrollbar">
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            >
              <Turn msg={msg} />
            </motion.div>
          ))}
          {isLoading && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="w-full border-l-2 border-[color:var(--line)] pl-4"
            >
              {/* The live ticker DX-3 deferred: the stage named here is the one
                  the server told us it had started, never a guess. An in-flight
                  answer sits where the answer will land — same document rule. */}
              <div className="flex items-center gap-3 py-2">
                <Loader2 className="w-4 h-4 text-[color:var(--accent)] animate-spin" />
                <span className="text-body text-[color:var(--text-2)]">{stage ?? 'Starting'}…</span>
                {stages.length > 0 && (
                  <span className="font-mono text-label text-[color:var(--text-4)]">
                    {stagesDone(stages)}/{stages.length}
                  </span>
                )}
                <button
                  onClick={() => abortRef.current?.abort()}
                  className="ml-2 text-label text-[color:var(--text-3)] hover:text-[color:var(--down)] underline transition-colors"
                >
                  cancel
                </button>
              </div>
              <StageChecklist stages={stages} />
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={messagesEndRef} className="h-4" />
      </div>

      {/* Input Area */}
      {/* Composer — while a run is in flight the send control becomes a stop
          control, so the cancel affordance is where the hand already is rather
          than buried in the streaming row. */}
      <div className="shrink-0 border-t border-[color:var(--line)] bg-[color:var(--bg)] p-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={`Ask about ${currentAsset}…`}
            className="min-w-0 flex-1 rounded-sm border border-[color:var(--line)] bg-[color:var(--surface-2)] px-3 py-2 text-body text-[color:var(--text)] transition-all placeholder-[color:var(--text-4)] focus:border-[color:var(--accent)] focus:outline-none"
            disabled={isLoading}
          />
          {isLoading ? (
            <button
              onClick={() => abortRef.current?.abort()}
              title="Stop this run"
              className="flex shrink-0 items-center gap-1.5 rounded-sm border border-[color:var(--down)] px-2.5 py-2 font-display text-label font-semibold text-[color:var(--down)] transition-colors hover:bg-[color:var(--surface-2)]"
            >
              <X className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">STOP</span>
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              title="Send"
              className="shrink-0 rounded-sm bg-[color:var(--accent)] p-2 text-[color:var(--accent-ink)] transition-all hover:brightness-110 disabled:bg-[color:var(--surface-2)] disabled:text-[color:var(--text-4)]"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="mt-2 flex justify-center">
          <EngineMeta meta={lastAgentMeta(messages)} />
        </div>
      </div>
    </div>
  );
};
