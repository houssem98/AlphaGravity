import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, BarChart2, X, Sparkles } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage } from '../../services/dexterLlm';
import {
  figureSpans,
  uncitedFigures,
  type AgentReply,
  type DexterCitation,
} from '../../services/dexterTools';
import { stepGlyph, traceSummary, type CellStep } from '../../services/gridTrace';
import { chipPropsFor, type AnswerTrust } from '../../services/dexterTrust';
import { isCryptoAsset } from '../../constants/tradingAssets';
import { motion, AnimatePresence } from 'motion/react';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isDrawing?: boolean;
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
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-sm border border-[color:var(--line)] bg-[color:var(--bg)] p-3 font-mono text-data text-[color:var(--text-2)]">
      {children}
    </pre>
  ),
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

const TrustChip: React.FC<{ trust: AnswerTrust }> = ({ trust }) => {
  const { label, tone, title } = chipPropsFor(trust);
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm border bg-[color:var(--surface-2)] text-label font-mono font-bold ${TRUST_TONE[tone]}`}
    >
      {label}
      <span className="font-normal opacity-70">{trust.score}</span>
      {trust.rounds > 1 && <span className="font-normal opacity-70">·{trust.rounds}r</span>}
    </span>
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
  uncited?: string[];
  steps?: CellStep[];
  scope?: string;
}> = ({ citations = [], uncited = [], steps, scope = '' }) => {
  if (citations.length === 0 && uncited.length === 0) return null;
  return (
    <div className="mt-3 space-y-1">
      {citations.length > 0 && (
        <div className="font-display text-label font-semibold uppercase text-[color:var(--text-3)]">
          Sources
        </div>
      )}
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
      {uncited.length > 0 && (
        <div className="font-mono text-label text-amber-400">
          ⚠ uncited figure{uncited.length === 1 ? '' : 's'}: {uncited.slice(0, 6).join(', ')}
          {uncited.length > 6 && ` +${uncited.length - 6}`}
        </div>
      )}
    </div>
  );
};

// DX-3: what actually ran, under the answer. A step is here iff its call
// executed, so a failed feed shows its real error rather than disappearing.
const TracePanel: React.FC<{ steps: CellStep[] }> = ({ steps }) => {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;
  const { tools, failed, totalMs } = traceSummary(steps);

  return (
    <div className="mt-3 border-t border-[color:var(--line)] pt-2">
      <button
        onClick={() => setOpen(!open)}
        className="text-label font-mono text-[color:var(--text-3)] hover:text-[color:var(--text)] transition-colors"
      >
        {open ? '▾' : '▸'} {tools} step{tools === 1 ? '' : 's'} · {totalMs}ms
        {failed > 0 && <span className="text-[color:var(--down)]"> · {failed} failed</span>}
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          {steps.map((s, i) => (
            <div key={i} className="text-label font-mono flex gap-2">
              <span className={s.status === 'failed' ? 'text-[color:var(--down)]' : s.status === 'empty' ? 'text-amber-400' : 'text-[color:var(--up)]'}>
                {stepGlyph(s.status)}
              </span>
              <span className="text-[color:var(--text-2)] shrink-0">{s.label}</span>
              <span className="text-[color:var(--text-4)]">{s.ms}ms</span>
              {(s.error || s.meta) && (
                <span className={`truncate ${s.error ? 'text-[color:var(--down)]' : 'text-[color:var(--text-4)]'}`}>{s.error || s.meta}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// DD-3 / F9: bubble geometry is right for a question and wrong for a research
// answer. A user turn stays a compact right-aligned bubble; an assistant turn is
// a full-width document marked by a left rule — no avatar column stealing 56px,
// no 85% cap. The user's own words are typed plain text, so they render plain
// (whitespace preserved), never through the markdown map.
export const Turn: React.FC<{ msg: Message }> = ({ msg }) => {
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
      {msg.isDrawing && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mt-3 flex items-center gap-2 text-data text-[color:var(--accent)] font-medium bg-[color:var(--surface)] px-3 py-2 rounded-sm border border-[color:var(--line-strong)] w-fit"
        >
          <BarChart2 className="w-4 h-4" />
          Chart updated with analysis
        </motion.div>
      )}
      {msg.trust && (
        <div className="mt-3">
          <TrustChip trust={msg.trust} />
        </div>
      )}
      <EvidencePanel
        citations={msg.citations}
        uncited={msg.uncitedFigures}
        steps={msg.steps}
        scope={msg.id}
      />
      {msg.steps && <TracePanel steps={msg.steps} />}
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
        if (ev.type === 'stage') onStage(ev.label);
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
      const reply = await postAgent(history, setStage, controller.signal);
      history.push({ role: 'assistant', content: reply.text });
      for (const action of reply.actions) onDraw(action.type, action.args);

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'assistant',
          content: reply.text,
          isDrawing: reply.actions.length > 0,
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
      {/* Header */}
      <div className="p-4 border-b border-[color:var(--line)] bg-[color:var(--surface)] flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[color:var(--surface-2)] border border-[color:var(--line-strong)] flex items-center justify-center">
            <Bot className="w-6 h-6 text-[color:var(--accent)]" />
          </div>
          <div>
            <h2 className="text-[color:var(--text)] font-display font-bold flex items-center gap-2 text-lg">
              Dexter AI
              <Sparkles className="w-4 h-4 text-amber-400" />
            </h2>
            {currentPrice !== null && (
              <div className="text-label text-[color:var(--text-3)] font-mono flex items-center gap-1">
                {/* A Tunisian listing is quoted in dinar; the header used to
                    print a dollar sign on every asset regardless. */}
                {currentAsset}: <span className="text-[color:var(--text)]">
                  {isTN ? '' : '$'}{currentPrice < 1 ? currentPrice.toFixed(4) : currentPrice.toFixed(2)}{isTN ? ' TND' : ''}
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleAnalyze}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-[color:var(--accent)] hover:brightness-110 text-[color:var(--accent-ink)] text-data font-semibold rounded-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <BarChart2 className="w-4 h-4" />
            <span className="hidden sm:inline">Analyze</span>
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface-2)] rounded-sm transition-colors"
            >
              <X className="w-5 h-5" />
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
                <button
                  onClick={() => abortRef.current?.abort()}
                  className="ml-2 text-label text-[color:var(--text-3)] hover:text-[color:var(--down)] underline transition-colors"
                >
                  cancel
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={messagesEndRef} className="h-4" />
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-[color:var(--line)] bg-[color:var(--bg)]">
        <div className="relative">
          <div className="relative flex items-center">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Ask Dexter to analyze patterns, draw support/resistance..."
              className="w-full bg-[color:var(--surface-2)] text-[color:var(--text)] text-body rounded-xl pl-5 pr-14 py-4 border border-[color:var(--line)] focus:outline-none focus:border-[color:var(--accent)] focus:ring-1 focus:ring-[color:var(--accent)] transition-all placeholder-[color:var(--text-4)]"
              disabled={isLoading}
            />
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5 bg-[color:var(--accent)] hover:brightness-110 text-[color:var(--accent-ink)] rounded-sm disabled:opacity-50 disabled:bg-[color:var(--surface-2)] transition-all"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="mt-3 flex justify-center gap-4">
          <EngineMeta meta={lastAgentMeta(messages)} />
        </div>
      </div>
    </div>
  );
};
