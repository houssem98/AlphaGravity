// Global background-activity indicator. Mounted once at the router level, so it
// shows on every route and persists across navigation. Reads backgroundStore:
// when a task (deep research, a company brief) is running in the background, a
// pill appears bottom-right with a live count; expand it to see each job with
// its elapsed time, and click a job to jump back to the view that owns it.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, X, Search, Building2 } from 'lucide-react';
import { useBackgroundStore } from '../stores/backgroundStore';

const elapsed = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};

export default function BackgroundActivity() {
    const jobs = useBackgroundStore((s) => s.jobs);
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    // Re-render once a second while anything runs, so elapsed times tick.
    const [, force] = useState(0);
    const timer = useRef<number | null>(null);
    useEffect(() => {
        if (jobs.length && timer.current === null) {
            timer.current = window.setInterval(() => force((n) => n + 1), 1000);
        } else if (!jobs.length && timer.current !== null) {
            clearInterval(timer.current);
            timer.current = null;
            setOpen(false);
        }
        return () => { if (timer.current !== null) { clearInterval(timer.current); timer.current = null; } };
    }, [jobs.length]);

    if (!jobs.length) return null;
    const now = Date.now();

    return (
        <div className="fixed bottom-4 right-4 z-[9999] flex flex-col items-end gap-2 font-sans">
            {open && (
                <div className="w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-[color:var(--line)] bg-[color:var(--surface)] shadow-2xl overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-[color:var(--line)]">
                        <span className="text-xs font-semibold tracking-wide text-[color:var(--text-2)] uppercase">Running in background</span>
                        <button onClick={() => setOpen(false)} className="text-[color:var(--text-3)] hover:text-[color:var(--text)]" aria-label="close"><X className="w-3.5 h-3.5" /></button>
                    </div>
                    <ul className="max-h-64 overflow-y-auto">
                        {jobs.map((j) => (
                            <li key={j.id}>
                                <button
                                    onClick={() => { navigate(j.href); setOpen(false); }}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[color:var(--surface-2)] transition-colors"
                                >
                                    {j.kind === 'research' ? <Search className="w-4 h-4 shrink-0 text-[color:var(--accent)]" /> : <Building2 className="w-4 h-4 shrink-0 text-[color:var(--accent)]" />}
                                    <span className="flex-1 min-w-0 truncate text-sm text-[color:var(--text)]">{j.label}</span>
                                    <span className="shrink-0 text-xs font-mono text-[color:var(--text-3)] tabular-nums">{elapsed(now - j.startedAt)}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            <button
                onClick={() => setOpen((v) => !v)}
                className="flex items-center gap-2 rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] pl-3 pr-3.5 py-2 shadow-2xl hover:border-[color:var(--accent)] transition-colors"
            >
                <Loader2 className="w-4 h-4 animate-spin text-[color:var(--accent)]" />
                <span className="text-sm font-semibold text-[color:var(--text)]">{jobs.length} running</span>
            </button>
        </div>
    );
}
