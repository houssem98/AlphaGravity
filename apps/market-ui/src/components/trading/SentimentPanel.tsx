import React, { useState, useEffect } from 'react';
import { Activity, TrendingUp, TrendingDown, Minus, Loader2, ExternalLink } from 'lucide-react';
import { safeUrl } from '../../lib/safeUrl';

interface SentimentPanelProps {
  asset: string;
}

interface SentimentData {
  score: number;
  label: string;
  summary: string;
  sources: { title: string; uri: string }[];
}

export const SentimentPanel: React.FC<SentimentPanelProps> = ({ asset }) => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SentimentData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Reset when asset changes
  useEffect(() => {
    setData(null);
    setError(null);
    setExpanded(false);
  }, [asset]);

  // DX-1: this panel used to build a GoogleGenAI client in the BROWSER from
  // `process.env.GEMINI_API_KEY` — a Node variable that does not exist in a Vite
  // bundle, so the button has never produced a reading. Its whole value came
  // from Gemini's googleSearch grounding (real headlines behind the score), and
  // the surviving provider chain has no grounded search channel yet. Rather
  // than score sentiment from an ungrounded model (doctrine rule 2: the model
  // never emits a figure it did not read), the panel says so until the News /
  // Social analysts land in DX-8.
  const analyzeSentiment = async () => {
    setError(
      'Sentiment needs grounded headlines, not a model guess. The news + social ' +
      'channels land with the analyst layer (roadmap DX-8) — until then this ' +
      'panel would only be inventing a number.',
    );
  };

  const getIcon = (label: string) => {
    if (label.includes('Bullish')) return <TrendingUp className="w-5 h-5 text-emerald-500" />;
    if (label.includes('Bearish')) return <TrendingDown className="w-5 h-5 text-red-500" />;
    return <Minus className="w-5 h-5 text-gray-400" />;
  };

  const getColor = (score: number) => {
    if (score >= 60) return 'text-emerald-500';
    if (score <= 40) return 'text-red-500';
    return 'text-gray-400';
  };

  const getBgColor = (score: number) => {
    if (score >= 60) return 'bg-emerald-500/10 border-emerald-500/20';
    if (score <= 40) return 'bg-red-500/10 border-red-500/20';
    return 'bg-gray-500/10 border-gray-500/20';
  };

  return (
    <div className="absolute top-4 right-4 z-20 flex flex-col items-end">
      {!data && !loading && (
        <button
          onClick={analyzeSentiment}
          className="flex items-center gap-2 bg-[#1e222d] hover:bg-[#2a2e39] text-gray-300 px-4 py-2 rounded-lg border border-gray-800 shadow-lg transition-colors"
        >
          <Activity className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-medium">Analyze Sentiment</span>
        </button>
      )}

      {loading && (
        <div className="flex items-center gap-2 bg-[#1e222d] text-gray-300 px-4 py-2 rounded-lg border border-gray-800 shadow-lg">
          <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
          <span className="text-sm font-medium">Analyzing {asset}...</span>
        </div>
      )}

      {error && (
        <div className="flex flex-col gap-2 bg-[#1e222d] text-red-400 px-4 py-3 rounded-lg border border-red-900/50 shadow-lg max-w-xs">
          <span className="text-sm font-medium">Analysis Failed</span>
          <span className="text-xs opacity-80">{error}</span>
          <button onClick={() => setError(null)} className="text-xs underline mt-1 text-gray-400 hover:text-gray-300 text-left">Dismiss</button>
        </div>
      )}

      {data && (
        <div className={`bg-[#1e222d] border border-gray-800 shadow-xl rounded-xl overflow-hidden transition-all duration-300 ${expanded ? 'w-80' : 'w-auto'}`}>
          {/* Header (Always visible when data exists) */}
          <div 
            className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[#2a2e39] transition-colors ${getBgColor(data.score)} border-b`}
            onClick={() => setExpanded(!expanded)}
          >
            {getIcon(data.label)}
            <div className="flex flex-col">
              <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">{asset} Sentiment</span>
              <div className="flex items-baseline gap-2">
                <span className={`text-base font-bold ${getColor(data.score)}`}>{data.label}</span>
                <span className="text-xs text-gray-500">({data.score}/100)</span>
              </div>
            </div>
          </div>

          {/* Expanded Content */}
          {expanded && (
            <div className="p-4 flex flex-col gap-4">
              <div className="text-sm text-gray-300 leading-relaxed">
                {data.summary}
              </div>
              
              {data.sources.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-xs text-gray-500 font-medium uppercase">Sources</span>
                  <div className="flex flex-col gap-1.5">
                    {data.sources.map((source, idx) => (
                      <a 
                        key={idx} 
                        href={safeUrl(source.uri)}
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1.5 truncate"
                      >
                        <ExternalLink className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{source.title}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
              
              <button 
                onClick={(e) => { e.stopPropagation(); analyzeSentiment(); }}
                className="mt-2 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 py-1.5 rounded transition-colors"
              >
                Refresh Analysis
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
