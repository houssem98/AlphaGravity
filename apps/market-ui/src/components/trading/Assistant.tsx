import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, BarChart2, X, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { ChatMessage } from '../../services/dexterLlm';
import type { AgentReply, DexterCitation } from '../../services/dexterTools';
import { stepGlyph, traceSummary, type CellStep } from '../../services/gridTrace';
import { chipPropsFor, type AnswerTrust } from '../../services/dexterTrust';
import { isCryptoAsset } from '../../constants/tradingAssets';
import { motion, AnimatePresence } from 'motion/react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isDrawing?: boolean;
  steps?: CellStep[];
  citations?: DexterCitation[];
  fabricatedCites?: number[];
  uncitedFigures?: string[];
  trust?: AnswerTrust;
}

// DX-7: the grade the answer earned, with the reasons it earned it. Honest-empty
// gets its own tone — an answer that admits a gap is not a failed answer.
const TRUST_TONE: Record<string, string> = {
  green: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  amber: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  red: 'bg-red-500/10 text-red-400 border-red-500/30',
  honest: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
};

const TrustChip: React.FC<{ trust: AnswerTrust }> = ({ trust }) => {
  const { label, tone, title } = chipPropsFor(trust);
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-mono font-bold ${TRUST_TONE[tone]}`}
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
const EvidencePanel: React.FC<{
  citations?: DexterCitation[];
  fabricated?: number[];
  uncited?: string[];
}> = ({ citations = [], fabricated = [], uncited = [] }) => {
  if (citations.length === 0 && fabricated.length === 0 && uncited.length === 0) return null;
  return (
    <div className="mt-3 space-y-1">
      {citations.map((c) => (
        <div key={c.id} className="text-[11px] font-mono flex gap-2 text-gray-500">
          <span className="text-blue-400 shrink-0">[{c.id}]</span>
          <span className="text-gray-400 shrink-0">{c.title}</span>
          <span className="truncate">{c.text}</span>
        </div>
      ))}
      {fabricated.length > 0 && (
        <div className="text-[11px] font-mono text-red-400">
          ✗ cites {fabricated.map((n) => `[${n}]`).join(' ')} — no such source
        </div>
      )}
      {uncited.length > 0 && (
        <div className="text-[11px] font-mono text-amber-400">
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
    <div className="mt-3 border-t border-gray-700/50 pt-2">
      <button
        onClick={() => setOpen(!open)}
        className="text-[11px] font-mono text-gray-500 hover:text-gray-300 transition-colors"
      >
        {open ? '▾' : '▸'} {tools} step{tools === 1 ? '' : 's'} · {totalMs}ms
        {failed > 0 && <span className="text-red-400"> · {failed} failed</span>}
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          {steps.map((s, i) => (
            <div key={i} className="text-[11px] font-mono flex gap-2">
              <span className={s.status === 'failed' ? 'text-red-400' : s.status === 'empty' ? 'text-amber-400' : 'text-emerald-400'}>
                {stepGlyph(s.status)}
              </span>
              <span className="text-gray-400 shrink-0">{s.label}</span>
              <span className="text-gray-600">{s.ms}ms</span>
              {(s.error || s.meta) && (
                <span className={`truncate ${s.error ? 'text-red-400/80' : 'text-gray-600'}`}>{s.error || s.meta}</span>
              )}
            </div>
          ))}
        </div>
      )}
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
    <div className="flex flex-col h-full bg-[#0B0E14] border-l border-[#1F2937] shadow-xl">
      {/* Header */}
      <div className="p-4 border-b border-[#1F2937] bg-gradient-to-r from-[#0B0E14] to-[#1F2937]/30 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Bot className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-white font-bold flex items-center gap-2 text-lg">
              Dexter AI
              <Sparkles className="w-4 h-4 text-yellow-500" />
            </h2>
            {currentPrice !== null && (
              <div className="text-xs text-gray-400 font-mono flex items-center gap-1">
                {/* A Tunisian listing is quoted in dinar; the header used to
                    print a dollar sign on every asset regardless. */}
                {currentAsset}: <span className="text-white">
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
            className="flex items-center gap-2 px-4 py-2 bg-[#2962FF] hover:bg-[#2962FF]/80 text-white text-sm font-medium rounded-lg transition-all shadow-lg shadow-blue-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <BarChart2 className="w-4 h-4" />
            <span className="hidden sm:inline">Analyze</span>
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-white hover:bg-[#1F2937] rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#0B0E14] custom-scrollbar">
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className={`flex gap-4 ${
                msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
              }`}
            >
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-md ${
                  msg.role === 'user' 
                    ? 'bg-gradient-to-br from-blue-500 to-blue-600' 
                    : 'bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700'
                }`}
              >
                {msg.role === 'user' ? (
                  <User className="w-5 h-5 text-white" />
                ) : (
                  <Bot className="w-5 h-5 text-blue-400" />
                )}
              </div>
              <div
                className={`max-w-[85%] rounded-2xl p-4 shadow-sm ${
                  msg.role === 'user'
                    ? 'bg-[#2962FF] text-white rounded-tr-none'
                    : 'bg-[#1F2937] text-gray-200 rounded-tl-none border border-gray-700/50'
                }`}
              >
                <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-[#0B0E14] prose-pre:border prose-pre:border-gray-800">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
                {msg.isDrawing && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="mt-3 flex items-center gap-2 text-xs text-blue-400 font-medium bg-blue-500/10 px-3 py-2 rounded-lg border border-blue-500/20 w-fit"
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
                  fabricated={msg.fabricatedCites}
                  uncited={msg.uncitedFigures}
                />
                {msg.steps && <TracePanel steps={msg.steps} />}
              </div>
            </motion.div>
          ))}
          {isLoading && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex gap-4"
            >
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700 flex items-center justify-center shrink-0 shadow-md">
                <Bot className="w-5 h-5 text-blue-400" />
              </div>
              {/* The live ticker DX-3 deferred: the stage named here is the one
                  the server told us it had started, never a guess. */}
              <div className="bg-[#1F2937] rounded-2xl rounded-tl-none p-4 flex items-center gap-3 border border-gray-700/50 shadow-sm">
                <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                <span className="text-sm text-gray-400">{stage ?? 'Starting'}…</span>
                <button
                  onClick={() => abortRef.current?.abort()}
                  className="ml-2 text-xs text-gray-500 hover:text-red-400 underline transition-colors"
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
      <div className="p-4 border-t border-[#1F2937] bg-[#0B0E14]">
        <div className="relative group">
          <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl opacity-0 group-hover:opacity-20 transition duration-500 blur"></div>
          <div className="relative flex items-center">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Ask Dexter to analyze patterns, draw support/resistance..."
              className="w-full bg-[#1F2937] text-white rounded-xl pl-5 pr-14 py-4 border border-gray-700 focus:outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF] transition-all shadow-inner placeholder-gray-500"
              disabled={isLoading}
            />
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5 bg-[#2962FF] hover:bg-[#2962FF]/80 text-white rounded-lg disabled:opacity-50 disabled:bg-gray-700 transition-all shadow-md"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="mt-3 flex justify-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1"><Sparkles className="w-3 h-3" /> Powered by Gemini 3.1 Pro</span>
        </div>
      </div>
    </div>
  );
};
