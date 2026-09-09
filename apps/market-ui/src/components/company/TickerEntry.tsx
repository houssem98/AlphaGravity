// CF-24 · verify what the reader typed before loading a page for it.
//
// A mistyped ticker used to open a full company profile with every surface empty
// — indistinguishable from a real registrant with nothing indexed. "APPL" is not
// Apple, and the page can know that before it fetches anything.
//
// Resolution happens server-side against SEC's whole registrant file (~10,400
// companies), which also means a company NAME works: "lululemon" opens LULU.

import { useState } from 'react';
import { Building2, Search } from 'lucide-react';
import { getAccessToken } from '../../services/supabase';
import { GRAVITY_BASE, authed } from './surfaces';

interface Suggestion { ticker: string; name: string }

interface Resolution {
    status: 'resolved' | 'unknown' | 'error';
    ticker: string | null;
    legal_name?: string | null;
    suggestions: Suggestion[];
    reason?: string | null;
}

export default function TickerEntry({ onOpen }: { onOpen: (ticker: string) => void }) {
    const [value, setValue] = useState('');
    const [checking, setChecking] = useState(false);
    const [result, setResult] = useState<Resolution | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const q = value.trim();
        if (!q) return;
        setChecking(true);
        setResult(null);
        try {
            const tok = await getAccessToken().catch(() => null);
            const res = await fetch(
                `${GRAVITY_BASE}/v1/company/resolve?q=${encodeURIComponent(q)}`,
                { headers: authed(tok) },
            );
            const body: Resolution = await res.json();
            // A confident resolution opens straight away — the reader typed a
            // real company and should not have to confirm it.
            if (body.status === 'resolved' && body.ticker) {
                onOpen(body.ticker);
                return;
            }
            setResult(body);
        } catch {
            // If the check itself cannot run, do not block the reader on it:
            // open what they typed rather than refusing on evidence we lack.
            onOpen(q.toUpperCase());
        } finally {
            setChecking(false);
        }
    };

    return (
        <div className="min-h-[calc(100vh-64px)] flex items-center justify-center p-6">
            <div className="w-full max-w-md text-center">
                <div className="w-12 h-12 rounded-xl bg-[#5B8DF6]/10 flex items-center justify-center mx-auto mb-4">
                    <Building2 className="w-6 h-6 text-[#5B8DF6]" />
                </div>
                <h1 className="text-xl font-semibold text-[#F4F6FF] mb-1">Company Intelligence</h1>
                <p className="text-sm text-[#A7B0C8] mb-5">
                    Enter a ticker or company name — filings, financials and sentiment.
                </p>

                <form onSubmit={submit} className="flex gap-2">
                    <input
                        name="ticker"
                        autoFocus
                        value={value}
                        onChange={e => { setValue(e.target.value); setResult(null); }}
                        placeholder="e.g. NVDA, or lululemon"
                        className="flex-1 px-4 py-2.5 rounded-lg bg-[#0B0E14] border border-[#1F2937] text-[#F4F6FF] placeholder-[#4A5568] focus:outline-none focus:border-[#5B8DF6]"
                    />
                    <button
                        type="submit"
                        disabled={checking || !value.trim()}
                        className="px-4 py-2.5 rounded-lg bg-[#5B8DF6] text-white font-medium text-sm hover:bg-[#5B8DF6]/90 disabled:opacity-40 transition-colors"
                    >
                        {checking ? 'Checking…' : 'View'}
                    </button>
                </form>

                {result && result.status !== 'resolved' && (
                    <div data-resolve-miss className="mt-4 rounded-lg border border-[#F59E0B]/25 bg-[#F59E0B]/[0.04] p-4 text-left">
                        <p className="text-sm text-[#F4F6FF]">{result.reason}</p>
                        {result.suggestions.length > 0 && (
                            <>
                                <p className="text-[10px] uppercase tracking-wider text-[#4A5568] mt-3 mb-1.5">
                                    Did you mean
                                </p>
                                <div className="space-y-1">
                                    {result.suggestions.map(s => (
                                        <button
                                            key={s.ticker}
                                            data-resolve-suggestion={s.ticker}
                                            onClick={() => onOpen(s.ticker)}
                                            className="w-full flex items-baseline gap-2 px-2 py-1.5 rounded-md text-left hover:bg-white/[0.04] transition-colors"
                                        >
                                            <span className="font-mono text-xs text-[#00F0FF]">{s.ticker}</span>
                                            <span className="text-xs text-[#A7B0C8] truncate">{s.name}</span>
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                        {/* Never a dead end: the resolver can be wrong, and a real
                            registrant it does not know is still worth opening. */}
                        <button
                            onClick={() => onOpen(value.trim().toUpperCase())}
                            className="mt-3 flex items-center gap-1.5 text-xs text-[#4A5568] hover:text-[#A7B0C8] transition-colors"
                        >
                            <Search className="w-3 h-3" />
                            Open {value.trim().toUpperCase()} anyway
                        </button>
                    </div>
                )}

                <div className="flex flex-wrap gap-2 justify-center mt-4">
                    {['AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN'].map(t => (
                        <button
                            key={t}
                            onClick={() => onOpen(t)}
                            className="px-3 py-1 rounded-md text-xs bg-[#1F2937] text-[#A7B0C8] hover:text-[#F4F6FF] transition-colors"
                        >
                            {t}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
