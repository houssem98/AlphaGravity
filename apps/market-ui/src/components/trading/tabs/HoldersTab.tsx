import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { ExternalLink, Database } from 'lucide-react';

// CP-3: the 5 hardcoded BTC whale addresses that rendered for EVERY asset are
// gone — TRUTH doctrine. On-chain holder data needs a keyed indexer
// (Etherscan/Solscan class) which this desk doesn't wire; render the honest
// state + the coin's real explorer links from its CG profile (CP-1 blob).

interface HoldersTabProps {
  asset: string;
  name?: string;
}

export const HoldersTab: React.FC<HoldersTabProps> = ({ asset, name }) => {
  const [explorers, setExplorers] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    setExplorers([]);
    (async () => {
      const base = await fetch('/api/crypto/markets').then((r) => r.json()).catch(() => []);
      const row = Array.isArray(base) ? base.find((r: any) => r.symbol === asset) : null;
      if (!row?.id) return [];
      const r = await fetch(`/api/crypto/markets?view=profile&id=${encodeURIComponent(row.id)}`);
      if (!r.ok) return [];
      const p = await r.json();
      return (p?.links?.blockchainSite || []).filter(Boolean).slice(0, 6);
    })()
      .then((links) => { if (live) setExplorers(links); })
      .catch(() => {});
    return () => { live = false; };
  }, [asset]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-[color:var(--bg)]">
      <div className="flex-1 overflow-y-auto flex items-center justify-center">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-lg text-center p-8">
          <Database className="w-12 h-12 text-[color:var(--text-3)] mx-auto mb-4 opacity-50" />
          <p className="text-body text-[color:var(--text-2)] mb-2">
            On-chain holder data requires an indexer key — not wired.
          </p>
          <p className="text-label text-[color:var(--text-3)] mb-6">
            Inspect {name || asset} holders directly on a block explorer:
          </p>
          {explorers.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {explorers.map((url) => (
                <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 p-3 bg-[color:var(--surface)] border border-[color:var(--line)] hover:border-[color:var(--line-strong)] hover:bg-[color:var(--surface-2)] rounded-sm transition-colors group">
                  <span className="text-label font-semibold text-[color:var(--text-2)] group-hover:text-[color:var(--text)] truncate">
                    {new URL(url).hostname.replace('www.', '')}
                  </span>
                  <ExternalLink className="w-3 h-3 text-[color:var(--text-3)] ml-auto flex-none" />
                </a>
              ))}
            </div>
          ) : (
            <p className="text-label text-[color:var(--text-3)]">No explorer links available for {name || asset}.</p>
          )}
        </motion.div>
      </div>
    </div>
  );
};
