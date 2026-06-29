// FirecrawlScrapePanel — paste URL → scrape to markdown → ask AI inline.
// Lives in QA mode as a floating modal. Pipes through market-server's
// /api/firecrawl/scrape and /api/llm/chat so keys stay server-side.

import { useState, useCallback, useEffect } from 'react';
import { X, Globe, ArrowUp, Loader2, ExternalLink, ClipboardCopy, Check, Sparkles, Link as LinkIcon, Cpu } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
    scrapeUrl,
    answerWithContext,
    type FirecrawlScrapeResult,
} from '../../services/firecrawlService';

interface Props {
    open: boolean;
    onClose: () => void;
}

export default function FirecrawlScrapePanel({ open, onClose }: Props) {
    const [url, setUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<FirecrawlScrapeResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [question, setQuestion] = useState('');
    const [answering, setAnswering] = useState(false);
    const [answer, setAnswer] = useState<{ text: string; model: string; latencyMs: number } | null>(null);

    useEffect(() => {
        if (!open) {
            setUrl(''); setResult(null); setError(null); setQuestion('');
            setAnswer(null); setAnswering(false);
        }
    }, [open]);

    const onScrape = useCallback(async () => {
        const trimmed = url.trim();
        if (!trimmed) return;
        let normalized = trimmed;
        if (!/^https?:\/\//i.test(normalized)) normalized = 'https://' + normalized;
        try { new URL(normalized); }
        catch { setError('Invalid URL'); return; }
        setError(null);
        setLoading(true);
        setResult(null);
        setAnswer(null);
        try {
            const r = await scrapeUrl(normalized, { formats: ['markdown', 'links'], onlyMainContent: true });
            setResult(r);
        } catch (e: any) {
            setError(e?.message || 'Scrape failed');
        } finally {
            setLoading(false);
        }
    }, [url]);

    const onCopy = useCallback(async () => {
        if (!result?.markdown) return;
        try {
            await navigator.clipboard.writeText(result.markdown);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch { /* ignore */ }
    }, [result]);

    const onAsk = useCallback(async () => {
        if (!result) return;
        setAnswering(true);
        setAnswer(null);
        setError(null);
        try {
            const a = await answerWithContext(result, question);
            setAnswer(a);
        } catch (e: any) {
            setError(e?.message || 'LLM call failed');
        } finally {
            setAnswering(false);
        }
    }, [result, question]);

    if (!open) return null;

    const meta = result?.metadata;
    const mdPreview = result?.markdown ? result.markdown.slice(0, 4000) : '';
    const mdLen = result?.markdown?.length ?? 0;

    return (
        <>
            <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm" onClick={onClose} />
            <div
                role="dialog"
                aria-modal="true"
                className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
            >
                <div
                    className="pointer-events-auto w-full max-w-2xl max-h-[85vh] flex flex-col rounded-[var(--radius-lg)] border border-[var(--line-strong)] overflow-hidden"
                    style={{ background: 'var(--surface)' }}
                >
                    {/* Header */}
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--line)]">
                        <div
                            className="w-7 h-7 rounded-[var(--radius)] flex items-center justify-center"
                            style={{ background: 'color-mix(in oklch, var(--accent) 16%, transparent)' }}
                        >
                            <Globe className="w-4 h-4 text-[var(--accent)]" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-semibold text-[var(--text)]">Scrape URL → AI</p>
                            <p className="text-[11px] text-[var(--text-3)]">Firecrawl converts any page to clean markdown, then asks an LLM.</p>
                        </div>
                        <button onClick={onClose} className="p-1.5 rounded-[var(--radius)] hover:bg-white/10 transition-colors">
                            <X className="w-4 h-4 text-[var(--text-2)]" />
                        </button>
                    </div>

                    {/* URL input */}
                    <div className="px-4 py-3 border-b border-[var(--line)]">
                        <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-lg)] border border-[var(--line)] focus-within:border-[var(--accent)] bg-white/[0.03]">
                            <LinkIcon className="w-3.5 h-3.5 text-[var(--text-3)]" />
                            <input
                                value={url}
                                onChange={e => setUrl(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && !loading) onScrape(); }}
                                placeholder="https://example.com/article"
                                autoFocus
                                className="flex-1 bg-transparent text-[13px] text-[var(--text)] placeholder:text-[var(--text-4)] outline-none"
                            />
                            <button
                                onClick={onScrape}
                                disabled={loading || !url.trim()}
                                className="flex items-center gap-1.5 px-3 py-1 rounded-[var(--radius)] text-[12px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
                            >
                                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                {loading ? 'Scraping…' : 'Scrape'}
                            </button>
                        </div>
                        {error && <p className="mt-2 text-[11px] text-[var(--down)]">{error}</p>}
                    </div>

                    {/* Result */}
                    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                        {!result && !loading && (
                            <p className="text-center text-[12px] text-[var(--text-3)] py-8">
                                Paste any article, SEC filing, earnings release, blog post, or news URL.
                            </p>
                        )}
                        {loading && (
                            <div className="flex items-center justify-center py-8 gap-2 text-[12px] text-[var(--text-2)]">
                                <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
                                Fetching &amp; parsing…
                            </div>
                        )}
                        {result && (
                            <>
                                {/* Metadata header */}
                                <div className="rounded-[var(--radius-lg)] border border-[var(--line)] p-3 bg-white/[0.02]">
                                    {meta?.title && <p className="text-[13px] font-semibold text-[var(--text)]">{meta.title}</p>}
                                    {meta?.description && <p className="text-[11.5px] text-[var(--text-2)] mt-1 leading-relaxed">{meta.description}</p>}
                                    <div className="flex items-center gap-3 mt-2 text-[10.5px] text-[var(--text-3)]">
                                        <span className="font-num">{mdLen.toLocaleString()} chars</span>
                                        {result.links?.length > 0 && <span>{result.links.length} links</span>}
                                        {result.cached && <span className="text-[var(--up)]">⚡ cached</span>}
                                        {meta?.sourceURL && (
                                            <a
                                                href={meta.sourceURL}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="ml-auto flex items-center gap-1 text-[var(--accent)] hover:underline"
                                            >
                                                Open <ExternalLink className="w-3 h-3" />
                                            </a>
                                        )}
                                    </div>
                                </div>

                                {/* Markdown preview */}
                                <div className="rounded-[var(--radius-lg)] border border-[var(--line)] overflow-hidden">
                                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--line)] bg-white/[0.02]">
                                        <span className="text-[10.5px] uppercase tracking-wider text-[var(--text-3)]">LLM-ready markdown</span>
                                        <button onClick={onCopy} className="flex items-center gap-1 text-[11px] text-[var(--text-2)] hover:text-[var(--accent)] transition-colors">
                                            {copied ? <Check className="w-3 h-3 text-[var(--up)]" /> : <ClipboardCopy className="w-3 h-3" />}
                                            {copied ? 'Copied' : 'Copy'}
                                        </button>
                                    </div>
                                    <pre className="px-3 py-3 text-[11.5px] leading-relaxed text-[var(--text-2)] whitespace-pre-wrap break-words max-h-[28vh] overflow-y-auto font-mono">
                                        {mdPreview}{mdLen > mdPreview.length ? `\n\n… +${(mdLen - mdPreview.length).toLocaleString()} more chars` : ''}
                                    </pre>
                                </div>

                                {/* Ask AI */}
                                <div className="rounded-[var(--radius-lg)] border border-[var(--line)] p-3 bg-white/[0.02]">
                                    <p className="text-[10.5px] uppercase tracking-wider text-[var(--text-3)] mb-2">Ask AI about this page</p>
                                    <textarea
                                        value={question}
                                        onChange={e => setQuestion(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !answering) {
                                                e.preventDefault();
                                                onAsk();
                                            }
                                        }}
                                        placeholder="Default: summarise + flag analyst questions. ⌘/Ctrl+Enter to send."
                                        rows={2}
                                        className="w-full bg-transparent text-[12.5px] text-[var(--text)] placeholder:text-[var(--text-4)] outline-none resize-none"
                                    />
                                    <div className="flex justify-end mt-2">
                                        <button
                                            onClick={onAsk}
                                            disabled={answering}
                                            className="flex items-center gap-1.5 px-3 py-1 rounded-[var(--radius)] text-[12px] font-medium transition-colors disabled:opacity-50"
                                            style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
                                        >
                                            {answering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowUp className="w-3.5 h-3.5" />}
                                            {answering ? 'Thinking…' : 'Ask AI'}
                                        </button>
                                    </div>
                                </div>

                                {/* AI answer */}
                                {answer && (
                                    <div className="rounded-[var(--radius-lg)] border border-[var(--line)] overflow-hidden">
                                        <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--line)] bg-white/[0.02]">
                                            <span className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-[var(--accent)]">
                                                <Cpu className="w-3 h-3" /> Answer
                                            </span>
                                            <span className="text-[10px] text-[var(--text-3)] font-num">
                                                {answer.model} · {answer.latencyMs}ms
                                            </span>
                                        </div>
                                        <div className="px-3 py-3 max-h-[36vh] overflow-y-auto text-[12.5px] leading-relaxed text-[var(--text)]">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer.text}</ReactMarkdown>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
