import React, { useEffect, useState } from 'react';
import { Globe, Github, Twitter, MessageCircle, ExternalLink, Building2, Newspaper } from 'lucide-react';
import { motion } from 'motion/react';
import type { MarketId, MarketDef } from '../../../lib/markets';
import type { AssetRow } from '../../../services/marketsHub';
import { assetLinks } from '../MarketList';

interface AboutTabProps {
  asset: string;
  name?: string;
  market?: MarketId;
}

// Sectors for the well-known BVMT listings. Unknowns fall back to "BVMT-listed".
const TN_SECTOR: Record<string, string> = {
  AB: 'Banking', BIAT: 'Banking', BNA: 'Banking', ATB: 'Banking', ATTIJARI: 'Banking',
  BT: 'Banking', BH: 'Banking', UIB: 'Banking', STB: 'Banking', UBCI: 'Banking', WIFACK: 'Banking',
  SFBT: 'Beverages', DELICE: 'Food & Dairy', SAH: 'Consumer Goods', CIL: 'Leasing',
  PGH: 'Diversified Holding', TLNET: 'Technology', CELLCOM: 'Electronics', SOTUVER: 'Materials',
  TPR: 'Industrials', ARTES: 'Automotive', ENNAKL: 'Automotive', STAR: 'Insurance', ASTREE: 'Insurance',
};

interface CryptoProfile {
  id: string;
  name: string;
  symbol: string;
  description: string;
  image: string;
  genesisDate: string;
  hashingAlgorithm: string;
  categories: string[];
  circulatingSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
  rank: number | null;
  links: {
    homepage: string;
    whitepaper: string;
    blockchainSite: string[];
    twitter: string;
    repos: string[];
  };
}

// ── Tunisian company profile (real data only) ──────────────────────────────
const TnAbout: React.FC<{ asset: string; name?: string }> = ({ asset, name }) => {
  const [isin, setIsin] = useState<string | null>(null);
  const [rf, setRf] = useState<any>(null);
  useEffect(() => {
    let live = true;
    Promise.all([
      fetch('/api/tn/markets').then((r) => r.json()).catch(() => ({})),
      fetch('/api/tn/ref').then((r) => r.json()).catch(() => ({ ref: {} })),
    ]).then(([mk, refJson]) => {
      if (!live) return;
      setIsin((mk.rows || []).find((x: any) => x.symbol === asset)?.isin ?? null);
      setRf(refJson?.ref?.[asset] || null);
    });
    return () => { live = false; };
  }, [asset]);

  const company = name || asset;
  const sector = rf?.sector ? rf.sector.charAt(0) + rf.sector.slice(1).toLowerCase() : (TN_SECTOR[asset] || 'BVMT-listed');
  const details = [
    { label: 'Exchange', value: 'Bourse de Tunis (BVMT)' },
    { label: 'Sector', value: sector },
    { label: 'Currency', value: 'Tunisian Dinar (TND)' },
    { label: 'ISIN', value: isin || rf?.isin || '—' },
    ...(rf?.issuer ? [{ label: 'Issuer', value: rf.issuer }] : []),
    ...(rf?.shares ? [{ label: 'Shares outstanding', value: rf.shares.toLocaleString('en-US') }] : []),
    ...(rf?.listingDate ? [{ label: 'Listed since', value: rf.listingDate }] : []),
  ];
  const icons: Record<string, any> = { BVMT: Building2, ILBOURSA: Globe };
  const links = [
    ...assetLinks({ id: 'tunisia' } as MarketDef, { symbol: asset, isin: isin || undefined } as unknown as AssetRow)
      .map((l) => ({ ...l, icon: icons[l.label] || ExternalLink })),
    { label: 'News', url: `https://news.google.com/search?q=${encodeURIComponent(`${company} Bourse Tunis`)}&hl=fr&gl=TN`, icon: Newspaper },
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-[color:var(--bg)]">
      <div className="max-w-4xl p-6 space-y-6">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[color:var(--accent)] to-[color:var(--up)] flex items-center justify-center text-h3 font-bold text-white">
              {asset.charAt(0)}
            </div>
            <div>
              <h1 className="text-h2 font-bold text-[color:var(--text)]">{company}</h1>
              <div className="flex items-center gap-2">
                <p className="text-body text-[color:var(--text-3)]">{asset} • BVMT</p>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-[color:var(--surface-2)] border border-[color:var(--line)] text-[color:var(--text-2)]">{sector}</span>
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <h3 className="text-body font-semibold text-[color:var(--text)] mb-2">About</h3>
          <p className="text-body text-[color:var(--text-2)] leading-relaxed">
            {company} is a company listed on the Bourse des Valeurs Mobilières de Tunis (BVMT){sector !== 'BVMT-listed' ? `, operating in the ${sector.toLowerCase()} sector` : ''}. Quotes, intraday candles and news on this desk are sourced live from the BVMT public feed and Tunisian financial press.
          </p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <h3 className="text-body font-semibold text-[color:var(--text)] mb-3">Listing Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {details.map((item, idx) => (
              <motion.div key={item.label} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 + idx * 0.05 }}
                className="p-3 bg-[color:var(--surface)] border border-[color:var(--line)] rounded-sm">
                <div className="label text-[color:var(--text-3)] mb-1">{item.label}</div>
                <div className="text-body font-semibold text-[color:var(--text)] font-mono">{item.value}</div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <h3 className="text-body font-semibold text-[color:var(--text)] mb-3">Resources</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {links.map((link, idx) => {
              const Icon = link.icon;
              return (
                <motion.a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 + idx * 0.05 }}
                  className="flex items-center gap-2 p-3 bg-[color:var(--surface)] border border-[color:var(--line)] hover:border-[color:var(--line-strong)] hover:bg-[color:var(--surface-2)] rounded-sm transition-colors group">
                  <Icon className="w-4 h-4 text-[color:var(--text-3)] group-hover:text-[color:var(--accent)] transition-colors" />
                  <span className="text-label font-semibold text-[color:var(--text-2)] group-hover:text-[color:var(--text)] transition-colors">{link.label}</span>
                  <ExternalLink className="w-3 h-3 text-[color:var(--text-3)] opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
                </motion.a>
              );
            })}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }} className="p-3 bg-[color:var(--surface)] border border-[color:var(--line)] rounded-sm">
          <p className="text-label text-[color:var(--text-3)]">ℹ️ For educational purposes only, not investment advice. BVMT market data is indicative.</p>
        </motion.div>
      </div>
    </div>
  );
};

const CryptoAbout: React.FC<{ asset: string; name?: string }> = ({ asset, name }) => {
  const [profile, setProfile] = useState<CryptoProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(false);
    Promise.resolve()
      .then(async () => {
        const baseR = await fetch(`/api/crypto/markets`).then(r => r.json()).catch(() => []);
        const row = Array.isArray(baseR) ? baseR.find((r: any) => r.symbol === asset) : null;
        if (!row?.id) throw new Error('id not found');
        const profileR = await fetch(`/api/crypto/markets?view=profile&id=${encodeURIComponent(row.id)}`);
        if (!profileR.ok) throw new Error(`${profileR.status}`);
        return profileR.json();
      })
      .then(p => { if (live) setProfile(p); })
      .catch(() => { if (live) setError(true); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [asset]);

  if (loading) return (
    <div className="flex-1 overflow-y-auto bg-[color:var(--bg)]">
      <div className="max-w-4xl p-6 space-y-6">
        <div className="h-24 bg-[color:var(--surface)] rounded-sm animate-pulse" />
        <div className="space-y-2">
          <div className="h-4 bg-[color:var(--surface)] rounded w-3/4 animate-pulse" />
          <div className="h-4 bg-[color:var(--surface)] rounded w-1/2 animate-pulse" />
        </div>
      </div>
    </div>
  );

  if (error || !profile) return (
    <div className="flex-1 overflow-y-auto bg-[color:var(--bg)] flex items-center justify-center">
      <div className="max-w-md text-center p-6">
        <p className="text-body text-[color:var(--text-2)] mb-4">Data temporarily unavailable for {name || asset}</p>
        <button onClick={() => window.location.reload()} className="px-4 py-2 bg-[color:var(--accent)] text-white rounded-sm text-label font-semibold hover:opacity-90">Retry</button>
      </div>
    </div>
  );

  const links = [
    profile.links.homepage && { label: 'Website', url: profile.links.homepage, icon: Globe },
    profile.links.whitepaper && { label: 'Whitepaper', url: profile.links.whitepaper, icon: ExternalLink },
    ...(profile.links.repos.length > 0 ? [{ label: 'GitHub', url: profile.links.repos[0], icon: Github }] : []),
    profile.links.twitter && { label: 'Twitter', url: profile.links.twitter, icon: Twitter },
  ].filter(Boolean);

  const supplyRows = [
    profile.circulatingSupply !== null && { label: 'Circulating Supply', value: profile.circulatingSupply.toLocaleString() },
    profile.totalSupply !== null && { label: 'Total Supply', value: profile.totalSupply.toLocaleString() },
    profile.maxSupply !== null && { label: 'Max Supply', value: profile.maxSupply.toLocaleString() },
    !profile.maxSupply && { label: 'Max Supply', value: '—' },
  ].filter(Boolean);

  return (
    <div className="flex-1 overflow-y-auto bg-[color:var(--bg)]">
      <div className="max-w-4xl p-6 space-y-6">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[color:var(--accent)] to-[color:var(--up)] flex items-center justify-center text-h3 font-bold text-white overflow-hidden">
              {profile.image ? <img src={profile.image} alt={profile.name} className="w-full h-full object-cover" /> : profile.symbol.charAt(0)}
            </div>
            <div>
              <h1 className="text-h2 font-bold text-[color:var(--text)]">{profile.name}</h1>
              <p className="text-body text-[color:var(--text-3)]">{profile.symbol} • Rank #{profile.rank ?? '—'}</p>
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <h3 className="text-body font-semibold text-[color:var(--text)] mb-2">About</h3>
          <p className="text-body text-[color:var(--text-2)] leading-relaxed">{profile.description || '—'}</p>
        </motion.div>

        {supplyRows.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <h3 className="text-body font-semibold text-[color:var(--text)] mb-3">Supply</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {supplyRows.map((item: any, idx) => (
                <motion.div key={item.label} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 + idx * 0.05 }}
                  className="p-3 bg-[color:var(--surface)] border border-[color:var(--line)] rounded-sm">
                  <div className="label text-[color:var(--text-3)] mb-1">{item.label}</div>
                  <div className="text-body font-semibold text-[color:var(--text)] font-mono">{item.value}</div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {links.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <h3 className="text-body font-semibold text-[color:var(--text)] mb-3">Resources</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {links.map((link: any, idx) => {
                const Icon = link.icon;
                return (
                  <motion.a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 + idx * 0.05 }}
                    className="flex items-center gap-2 p-3 bg-[color:var(--surface)] border border-[color:var(--line)] hover:border-[color:var(--line-strong)] hover:bg-[color:var(--surface-2)] rounded-sm transition-colors group">
                    <Icon className="w-4 h-4 text-[color:var(--text-3)] group-hover:text-[color:var(--accent)] transition-colors" />
                    <span className="text-label font-semibold text-[color:var(--text-2)] group-hover:text-[color:var(--text)] transition-colors">{link.label}</span>
                    <ExternalLink className="w-3 h-3 text-[color:var(--text-3)] opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
                  </motion.a>
                );
              })}
            </div>
          </motion.div>
        )}

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }} className="p-3 bg-[color:var(--surface)] border border-[color:var(--line)] rounded-sm">
          <p className="text-label text-[color:var(--text-3)]">ℹ️ For educational purposes only, not investment advice.</p>
        </motion.div>
      </div>
    </div>
  );
};

export const AboutTab: React.FC<AboutTabProps> = ({ asset, name, market }) => {
  if (market === 'tunisia') return <TnAbout asset={asset} name={name} />;
  return <CryptoAbout asset={asset} name={name} />;
};
