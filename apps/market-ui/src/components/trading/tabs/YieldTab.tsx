import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';

// CP-3: real DeFi pools from yields.llama.fi via ?view=yield&sym= (1h blob).
// The invented CeFi APY table is gone — TRUTH doctrine.
interface YieldPool {
  project: string;
  chain: string;
  symbol: string;
  apy: number;
  tvlUsd: number;
  stablecoin: boolean;
}

interface YieldTabProps {
  asset: string;
  name?: string;
}

const fmtTvl = (n: number) => `$${Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n)}`;
const prettyProject = (p: string) => p.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export const YieldTab: React.FC<YieldTabProps> = ({ asset, name }) => {
  const [pools, setPools] = useState<YieldPool[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(false);
    setPools(null);
    fetch(`/api/crypto/markets?view=yield&sym=${encodeURIComponent(asset)}`)
      .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then((d) => { if (live) setPools(Array.isArray(d) ? d : []); })
      .catch(() => { if (live) setError(true); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [asset, retryKey]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-[color:var(--bg)]">
      {/* Header */}
      <div className="p-4 border-b border-[color:var(--line)] flex items-center gap-3">
        <span className="text-body font-semibold text-[color:var(--text)]">{asset} Yield</span>
        <span className="ml-auto text-label text-[color:var(--text-3)]">Decentralized pools via DefiLlama</span>
      </div>

      {/* Yield table */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="p-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-10 bg-[color:var(--surface)] rounded-sm animate-pulse" />
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="py-16 text-center">
            <p className="text-body text-[color:var(--text-3)] mb-4">Data temporarily unavailable for {name || asset}</p>
            <button onClick={() => setRetryKey((k) => k + 1)} className="px-4 py-2 bg-[color:var(--accent)] text-[color:var(--accent-ink)] rounded-sm text-label font-semibold hover:opacity-90">Retry</button>
          </div>
        )}

        {!loading && !error && pools && pools.length === 0 && (
          <div className="py-16 text-center text-[color:var(--text-3)] text-sm">
            No verified decentralized yield pools found for {name || asset}.
          </div>
        )}

        {!loading && !error && pools && pools.length > 0 && (
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-[color:var(--surface-2)] border-b border-[color:var(--line)]">
              <tr>
                <th className="px-4 py-3 label text-[color:var(--text-3)]">#</th>
                <th className="px-4 py-3 label text-[color:var(--text-3)]">Service Provider</th>
                <th className="px-4 py-3 label text-[color:var(--text-3)]">Chain</th>
                <th className="px-4 py-3 label text-[color:var(--text-3)] text-right">Net APY</th>
                <th className="px-4 py-3 label text-[color:var(--text-3)] text-right">TVL</th>
              </tr>
            </thead>
            <tbody>
              {pools.map((pool, idx) => (
                <motion.tr
                  key={`${pool.project}-${pool.chain}-${idx}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: idx * 0.02 }}
                  className="border-b border-[color:var(--line)] hover:bg-[color:var(--surface-2)] transition-colors"
                >
                  <td className="px-4 py-3 text-data text-[color:var(--text-3)]">{idx + 1}</td>
                  <td className="px-4 py-3 text-body font-medium text-[color:var(--text)]">
                    {prettyProject(pool.project)}
                    {pool.stablecoin && (
                      <span className="ml-2 px-2 py-0.5 rounded-sm text-[10px] uppercase bg-[color:var(--accent)]/10 text-[color:var(--text-3)]">Stable</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-label text-[color:var(--text-2)]">{pool.chain}</td>
                  <td className="px-4 py-3 text-data font-semibold text-[color:var(--up)] text-right">{pool.apy.toFixed(2)}%</td>
                  <td className="px-4 py-3 text-data font-mono text-[color:var(--text-2)] text-right">{fmtTvl(pool.tvlUsd)}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
