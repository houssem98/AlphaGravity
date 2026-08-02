import React, { useState, useRef, useEffect } from 'react';
import { BarChart2, Activity, ChevronDown, TrendingUp, SlidersHorizontal } from 'lucide-react';
import type { ChartColors } from './Chart';

const COIN_TABS = ['Chart', 'Markets', 'News', 'Yield', 'Holders', 'About'] as const;
// BVMT has no crypto exchanges / whale holders / staking yield — hide those.
const TN_TABS = ['Chart', 'News', 'About'] as const;
const TIMEFRAMES = ['1h', '24h', '1W', '1M', '1Y', 'ALL'];

interface TopbarProps {
  currentAsset?: string;
  onAssetChange?: (asset: string) => void;
  currentTimeframe: string;
  onTimeframeChange: (tf: string) => void;
  chartColors: ChartColors;
  onChartColorsChange: (colors: ChartColors) => void;
  onToolClick?: (toolLabel: string) => void;
  isOrderBookOpen?: boolean;
  onToggleOrderBook?: () => void;
  onSellClick?: () => void;
  onBuyClick?: () => void;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  market?: import('../../lib/markets').MarketId;
  chartMode?: 'price' | 'mcap';
  onChartModeChange?: (mode: 'price' | 'mcap') => void;
  activeIndicators?: string[];
  onIndicatorToggle?: (indicator: string) => void;
}

const INDICATOR_LIST = ['SMA 20', 'SMA 50', 'SMA 200', 'EMA 20', 'EMA 50', 'EMA 200', 'RSI', 'MACD'];

/** Two-row topbar: section tabs + CTA, then chart controls.
 *  Density: Bloomberg. Radii: 2-4px. Accent: amber, single use. */
export const Topbar: React.FC<TopbarProps> = ({
  currentAsset = 'BTC',
  currentTimeframe,
  onTimeframeChange,
  chartColors,
  onChartColorsChange,
  onBuyClick,
  activeTab = 'Chart',
  onTabChange,
  market,
  chartMode = 'price',
  onChartModeChange,
  activeIndicators = [],
  onIndicatorToggle,
}) => {
  const tabs = market === 'tunisia' ? TN_TABS : COIN_TABS;

  const [chartType, setChartType] = useState<'candles' | 'line'>('candles');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isIndicatorsOpen, setIsIndicatorsOpen] = useState(false);
  const [dexMode, setDexMode] = useState(false);
  const [showAllTf, setShowAllTf] = useState(false);

  const visibleTf = TIMEFRAMES.slice(0, 3);

  // MB-5 · a strip that scrolls is only usable if the active item is in it.
  // Switching tab from elsewhere (the TN guard in TradingAssistantPage snaps
  // Markets/Yield/Holders back to Chart) can otherwise leave the current tab
  // parked off the visible run of the strip.
  const activeTabRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [activeTab]);

  return (
    <div className="shrink-0 bg-[color:var(--surface)] border-b border-[color:var(--line)]">
      {/* ── Row 1 : section tabs + CTA ─────────────────────────────── */}
      <div className="flex items-stretch h-11 lg:h-10 border-b border-[color:var(--line)]">
        {/* min-w-0 lets the strip shrink so it scrolls instead of shoving the
            CTA out of a clipped row — the buttons were unreachable, not just
            off-screen, because the ancestor is overflow-hidden. */}
        <div className="flex items-stretch overflow-x-auto min-w-0 snap-x">
          {tabs.map((tab) => {
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                ref={isActive ? activeTabRef : undefined}
                onClick={() => onTabChange?.(tab)}
                className={`relative flex items-center px-4 snap-start shrink-0 text-body font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? 'text-[color:var(--text)]'
                    : 'text-[color:var(--text-3)] hover:text-[color:var(--text-2)]'
                }`}
              >
                {tab}
                {tab === 'Yield' && (
                  <span className="ml-1.5 w-1 h-1 rounded-full bg-[color:var(--up)] inline-block" />
                )}
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-px bg-[color:var(--accent)]" />
                )}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-2 px-3 shrink-0">
          <button
            onClick={onBuyClick}
            className="px-3 min-h-[44px] lg:min-h-0 py-1 rounded-sm text-label font-semibold transition-colors bg-[color:var(--accent)] text-[color:var(--accent-ink)] hover:brightness-110 press shiny chrome cta-glow"
            style={{ letterSpacing: '0.04em' }}
          >
            BUY {currentAsset}
          </button>

          <button
            onClick={() => setDexMode(!dexMode)}
            className="hidden lg:flex items-center gap-2 px-2.5 py-1 rounded-sm text-label font-semibold transition-colors bg-[color:var(--bg)] border border-[color:var(--line)] text-[color:var(--text-2)] hover:border-[color:var(--line-strong)]"
            style={{ letterSpacing: '0.06em' }}
          >
            DEX MODE
            <span
              className="w-6 h-3 rounded-full relative transition-colors shrink-0"
              style={{ background: dexMode ? 'var(--accent)' : 'var(--line)' }}
            >
              <span
                className="absolute top-0.5 w-2 h-2 rounded-full bg-[color:var(--text)] transition-all"
                style={{ left: dexMode ? '14px' : '2px' }}
              />
            </span>
          </button>
        </div>
      </div>

      {/* ── Row 2 : chart controls ──────────────────────────────────── */}
      <div className="flex items-center h-11 lg:h-9 px-2 overflow-x-auto">
        <div className="flex items-center gap-0.5 shrink-0">
          {/* Price / MCap segmented (CP-5: wired) */}
          <div className="flex items-center rounded-sm p-0.5 bg-[color:var(--bg)]">
            <button
              onClick={() => onChartModeChange?.('price')}
              className={`px-2 py-0.5 text-label font-semibold rounded-[2px] ${
                chartMode === 'price'
                  ? 'bg-[color:var(--surface-2)] text-[color:var(--text)]'
                  : 'text-[color:var(--text-3)] hover:text-[color:var(--text-2)]'
              }`}
            >
              PRICE
            </button>
            <button
              onClick={() => onChartModeChange?.('mcap')}
              className={`px-2 py-0.5 text-label font-semibold rounded-[2px] ${
                chartMode === 'mcap'
                  ? 'bg-[color:var(--surface-2)] text-[color:var(--text)]'
                  : 'text-[color:var(--text-3)] hover:text-[color:var(--text-2)]'
              }`}
            >
              MCAP
            </button>
          </div>

          <span className="w-px h-4 mx-1.5 bg-[color:var(--line)]" />

          <button
            onClick={() => setChartType(chartType === 'candles' ? 'line' : 'candles')}
            className="flex items-center px-1.5 py-1 rounded-sm transition-colors text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface-2)]"
            title="Chart type"
          >
            <BarChart2 className="w-3.5 h-3.5" />
          </button>

          <button className="flex items-center gap-1.5 px-2 py-1 rounded-sm text-label font-semibold text-[color:var(--text-2)] hover:text-[color:var(--text)] bg-[color:var(--bg)] border border-[color:var(--line)] hover:border-[color:var(--line-strong)] transition-colors">
            <TrendingUp className="w-3 h-3 text-[color:var(--accent)]" />
            TRADINGVIEW
          </button>
        </div>

        <div className="ml-auto flex items-center gap-0.5 shrink-0 pl-2">
          {/* CP-5: wired — same toggle list as the Sidebar dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsIndicatorsOpen(!isIndicatorsOpen)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-sm text-label font-semibold bg-[color:var(--bg)] border transition-colors ${
                isIndicatorsOpen
                  ? 'text-[color:var(--accent)] border-[color:var(--line-strong)]'
                  : 'text-[color:var(--text-2)] hover:text-[color:var(--text)] border-[color:var(--line)] hover:border-[color:var(--line-strong)]'
              }`}
            >
              <Activity className="w-3 h-3" />
              INDICATORS
            </button>
            {isIndicatorsOpen && (
              <div className="absolute top-9 right-0 rounded-[4px] py-1 shadow-xl z-50 min-w-[160px] bg-[color:var(--surface-2)] border border-[color:var(--line-strong)]">
                {INDICATOR_LIST.map((indicator) => {
                  const isActive = activeIndicators.includes(indicator);
                  return (
                    <button
                      key={indicator}
                      onClick={() => onIndicatorToggle?.(indicator)}
                      className={`w-full flex items-center justify-between px-3 py-1.5 text-data transition-colors ${
                        isActive
                          ? 'text-[color:var(--accent)]'
                          : 'text-[color:var(--text-2)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface)]'
                      }`}
                    >
                      <span className="font-mono">{indicator}</span>
                      {isActive && <span className="text-[10px]">✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <span className="w-px h-4 mx-1.5 bg-[color:var(--line)]" />

          {/* Timeframes */}
          <div className="flex items-center font-mono">
            {(showAllTf ? TIMEFRAMES : visibleTf).map((tf) => {
              const isActive = currentTimeframe === tf;
              return (
                <button
                  key={tf}
                  onClick={() => onTimeframeChange(tf)}
                  className={`px-2 py-0.5 text-label font-semibold rounded-sm transition-colors ${
                    isActive
                      ? 'text-[color:var(--accent)] bg-[color:color-mix(in_oklch,var(--accent)_12%,transparent)]'
                      : 'text-[color:var(--text-3)] hover:text-[color:var(--text)]'
                  }`}
                >
                  {tf}
                </button>
              );
            })}
            <button
              onClick={() => setShowAllTf(!showAllTf)}
              className="flex items-center p-1 rounded-sm text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface-2)] transition-colors"
            >
              <ChevronDown
                className="w-3 h-3"
                style={{ transform: showAllTf ? 'rotate(180deg)' : 'none', transition: 'transform 160ms' }}
              />
            </button>
          </div>

          <span className="w-px h-4 mx-1.5 bg-[color:var(--line)]" />

          <div className="relative">
            <button
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className={`p-1 rounded-sm transition-colors ${
                isSettingsOpen
                  ? 'text-[color:var(--accent)] bg-[color:color-mix(in_oklch,var(--accent)_12%,transparent)]'
                  : 'text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface-2)]'
              }`}
              title="Chart settings"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </button>

            {isSettingsOpen && (
              <div className="absolute top-9 right-0 rounded-[4px] p-3 shadow-xl z-50 w-56 bg-[color:var(--surface-2)] border border-[color:var(--line-strong)]">
                <p className="label mb-2.5">Chart Settings</p>
                <div className="space-y-2.5">
                  {([['Up color', 'upColor'], ['Down color', 'downColor']] as const).map(([label, key]) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-body text-[color:var(--text-2)]">{label}</span>
                      <button
                        className="w-5 h-5 rounded-sm cursor-pointer border border-[color:var(--line)] hover:border-[color:var(--line-strong)]"
                        style={{ backgroundColor: chartColors[key] }}
                        onClick={() => {
                          const input = document.createElement('input');
                          input.type = 'color';
                          input.value = chartColors[key];
                          input.onchange = (e) =>
                            onChartColorsChange({ ...chartColors, [key]: (e.target as HTMLInputElement).value });
                          input.click();
                        }}
                      />
                    </div>
                  ))}
                  {([['Borders', 'borderVisible'], ['Wicks', 'wickVisible']] as const).map(([label, key]) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-body text-[color:var(--text-2)]">{label}</span>
                      <input
                        type="checkbox"
                        checked={chartColors[key] as boolean}
                        onChange={e => onChartColorsChange({ ...chartColors, [key]: e.target.checked })}
                        className="w-3.5 h-3.5 rounded-sm cursor-pointer"
                        style={{ accentColor: 'var(--accent)' }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
