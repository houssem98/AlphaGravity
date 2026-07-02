import { useState, useEffect } from "react";
import {
  Search,
  Globe,
  User,
  ChevronDown,
  ArrowRight,
  Bitcoin,
  X,
  Facebook,
  Youtube,
  Instagram,
  Linkedin,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts";

/* ──────────── Data ──────────── */
const chartData = [
  { time: "10:00", value: 5202 },
  { time: "10:15", value: 5208 },
  { time: "10:30", value: 5205 },
  { time: "10:45", value: 5215 },
  { time: "11:00", value: 5218 },
  { time: "11:15", value: 5225 },
  { time: "11:30", value: 5222 },
  { time: "11:45", value: 5230 },
  { time: "12:00", value: 5234 },
];

const cryptoPieData = [
  { name: "Bitcoin", value: 65, color: "#FF9800" },
  { name: "Ethereum", value: 35, color: "#2962FF" },
];

const tunindexData = [
  { day: "Mon", value: 9640 },
  { day: "Tue", value: 9710 },
  { day: "Wed", value: 9680 },
  { day: "Thu", value: 9820 },
  { day: "Fri", value: 9790 },
  { day: "Sat", value: 9880 },
  { day: "Sun", value: 9847 },
];

const goldSparkline = [
  { t: 1, v: 2340 },
  { t: 2, v: 2342 },
  { t: 3, v: 2341 },
  { t: 4, v: 2344 },
  { t: 5, v: 2343 },
  { t: 6, v: 2345 },
  { t: 7, v: 2344 },
  { t: 8, v: 2346 },
];

const oilSparkline = [
  { t: 1, v: 80 },
  { t: 2, v: 79.5 },
  { t: 3, v: 79.8 },
  { t: 4, v: 78.9 },
  { t: 5, v: 78.5 },
  { t: 6, v: 78.2 },
  { t: 7, v: 78.6 },
  { t: 8, v: 78.45 },
];

const bondData = [
  { name: "US 10Y", value: 4.25, color: "#2962FF" },
  { name: "DE 10Y", value: 2.45, color: "#7B61FF" },
  { name: "UK 10Y", value: 4.05, color: "#00BCD4" },
  { name: "JP 10Y", value: 0.75, color: "#FF9800" },
];

const indices = [
  { name: "S&P 500", ticker: "SPX", value: "5,234.12", change: "+0.42%", color: "#2962FF", positive: true },
  { name: "Nasdaq 100", ticker: "NDX", value: "18,456.78", change: "+0.68%", color: "#7B61FF", positive: true },
  { name: "Dow Jones", ticker: "DJI", value: "38,765.43", change: "-0.15%", color: "#00BCD4", positive: false },
  { name: "FTSE 100", ticker: "UKX", value: "7,892.34", change: "+0.23%", color: "#FF9800", positive: true },
  { name: "DAX", ticker: "DAX", value: "17,234.56", change: "-0.31%", color: "#2962FF", positive: false },
  { name: "Nikkei 225", ticker: "N225", value: "39,876.54", change: "+1.12%", color: "#E91E63", positive: true },
];

const tickerItems = [
  { symbol: "AAPL", price: "189.45", change: "+1.24%", letter: "A", color: "#2962FF", positive: true },
  { symbol: "MSFT", price: "423.78", change: "+0.89%", letter: "M", color: "#22AB46", positive: true },
  { symbol: "GOOGL", price: "175.23", change: "-0.45%", letter: "G", color: "#2962FF", positive: false },
  { symbol: "AMZN", price: "178.12", change: "+1.56%", letter: "Z", color: "#FF9800", positive: true },
  { symbol: "TSLA", price: "248.56", change: "-2.13%", letter: "T", color: "#F7525F", positive: false },
  { symbol: "META", price: "512.34", change: "+0.67%", letter: "F", color: "#2962FF", positive: true },
  { symbol: "NVDA", price: "875.12", change: "+2.34%", letter: "N", color: "#22AB46", positive: true },
  { symbol: "BTC", price: "67,234", change: "+1.24%", letter: "B", color: "#FF9800", positive: true },
  { symbol: "ETH", price: "3,456", change: "+0.89%", letter: "E", color: "#7B61FF", positive: true },
  { symbol: "SPY", price: "523.45", change: "+0.42%", letter: "S", color: "#2962FF", positive: true },
  { symbol: "QQQ", price: "445.67", change: "+0.68%", letter: "Q", color: "#7B61FF", positive: true },
  { symbol: "GLD", price: "198.34", change: "+0.15%", letter: "L", color: "#FF9800", positive: true },
];

const tunisianStocks = [
  { name: "BIAT", price: "18.45", currency: "TND", change: "+0.92%", color: "#22AB46", positive: true },
  { name: "BNA", price: "9.12", currency: "TND", change: "-0.33%", color: "#2962FF", positive: false },
  { name: "ATB", price: "14.78", currency: "TND", change: "+1.15%", color: "#FF9800", positive: true },
  { name: "CELLCOM", price: "6.32", currency: "TND", change: "-0.55%", color: "#7B61FF", positive: false },
];

/* ──────────── Crosshair SVG Component ──────────── */
function Crosshair({ size = 80, duration = 20 }: { size?: number; duration?: number }) {
  const s = 100;
  const outerR = 40;
  const cx = s / 2;
  const cy = s / 2;

  const arcPath = (startAngle: number, endAngle: number) => {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const x1 = cx + outerR * Math.cos(toRad(startAngle));
    const y1 = cy + outerR * Math.sin(toRad(startAngle));
    const x2 = cx + outerR * Math.cos(toRad(endAngle));
    const y2 = cy + outerR * Math.sin(toRad(endAngle));
    return `M ${x1} ${y1} A ${outerR} ${outerR} 0 0 1 ${x2} ${y2}`;
  };

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        width: size,
        height: size,
        animation: `spin ${duration}s linear infinite`,
        willChange: "transform",
      }}
      aria-hidden="true"
    >
      <svg viewBox={`0 0 ${s} ${s}`} width={size} height={size}>
        <path d={arcPath(180, 90)} stroke="rgba(255,255,255,0.35)" strokeWidth={12} strokeLinecap="round" fill="none" vectorEffect="non-scaling-stroke" />
        <path d={arcPath(270, 180)} stroke="rgba(255,255,255,0.35)" strokeWidth={12} strokeLinecap="round" fill="none" vectorEffect="non-scaling-stroke" />
        <path d={arcPath(0, 270)} stroke="rgba(255,255,255,0.35)" strokeWidth={12} strokeLinecap="round" fill="none" vectorEffect="non-scaling-stroke" />
        <path d={arcPath(90, 0)} stroke="rgba(255,255,255,0.35)" strokeWidth={12} strokeLinecap="round" fill="none" vectorEffect="non-scaling-stroke" />
        <circle cx={cx} cy={cy} r={2.5} fill="rgba(255,255,255,0.6)" />
      </svg>
    </div>
  );
}

/* ──────────── Navbar ──────────── */
function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 h-16 flex items-center transition-all duration-300 ${
        scrolled
          ? "bg-white/95 backdrop-blur-md border-b border-[#E8EAF0] shadow-sm"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-[1200px] mx-auto w-full px-6 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <span className={`text-lg font-bold ${scrolled ? "text-[#131722]" : "text-white"}`}>
            TradeVerse
          </span>
          <div className={`hidden md:flex items-center gap-6 text-sm font-medium ${scrolled ? "text-[#131722]" : "text-white/90"}`}>
            <span className="cursor-pointer hover:opacity-70 transition-opacity flex items-center gap-1">Products <ChevronDown size={14} /></span>
            <span className="cursor-pointer hover:opacity-70 transition-opacity flex items-center gap-1">Community <ChevronDown size={14} /></span>
            <span className="cursor-pointer hover:opacity-70 transition-opacity">Markets</span>
            <span className="cursor-pointer hover:opacity-70 transition-opacity">Brokers</span>
            <span className="cursor-pointer hover:opacity-70 transition-opacity flex items-center gap-1">More <ChevronDown size={14} /></span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Search size={18} className={scrolled ? "text-[#131722]" : "text-white/80"} />
          <div className={`hidden sm:flex items-center gap-1 text-sm ${scrolled ? "text-[#131722]" : "text-white/80"}`}>
            <Globe size={16} /> EN
          </div>
          <User size={18} className={`hidden sm:block ${scrolled ? "text-[#131722]" : "text-white/80"}`} />
          <button className="bg-[#2962FF] text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-[#1E54E6] transition-colors">
            Get Started
          </button>
        </div>
      </div>
    </nav>
  );
}

/* ──────────── Hero ──────────── */
function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-[#0A1628]">
      {/* Radial gradient overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at 50% 50%, #112240 0%, transparent 70%)",
        }}
      />

      {/* Crosshairs */}
      <div className="hidden md:block" style={{ position: "absolute", left: "15%", top: "25%" }}>
        <Crosshair size={80} duration={20} />
      </div>
      <div className="hidden md:block" style={{ position: "absolute", right: "12%", top: "20%" }}>
        <Crosshair size={60} duration={25} />
      </div>
      <div className="hidden md:block" style={{ position: "absolute", right: "15%", bottom: "22%" }}>
        <Crosshair size={70} duration={22} />
      </div>
      <div className="hidden md:block" style={{ position: "absolute", left: "18%", bottom: "18%" }}>
        <Crosshair size={50} duration={28} />
      </div>

      {/* Mobile crosshairs */}
      <div className="md:hidden" style={{ position: "absolute", left: "5%", top: "12%" }}>
        <Crosshair size={48} duration={20} />
      </div>
      <div className="md:hidden" style={{ position: "absolute", right: "5%", top: "15%" }}>
        <Crosshair size={36} duration={25} />
      </div>

      {/* Content */}
      <div className="relative z-10 text-center px-6 max-w-2xl mx-auto">
        <p className="text-xs uppercase tracking-[0.15em] text-[#787B86] mb-6">
          The future of trading starts here
        </p>
        <h1 className="text-4xl sm:text-5xl lg:text-[56px] font-bold text-white leading-[1.1] mb-6">
          <span className="block">Look first <span className="text-[#2962FF]">/</span></span>
          <span className="block">Then leap.</span>
        </h1>
        <p className="text-base sm:text-lg text-[#B2B5BE] font-normal mb-8 max-w-[480px] mx-auto">
          The best trades require research, then commitment.
        </p>
        <button className="bg-white text-[#131722] px-7 py-3.5 rounded-lg text-base font-medium hover:bg-gray-100 transition-colors mb-3">
          Get Started for Free
        </button>
        <p className="text-[13px] text-[#787B86]">$0 forever, no credit card needed</p>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
        <ChevronDown size={24} className="text-[#787B86]" />
      </div>
    </section>
  );
}

/* ──────────── Market Overview ──────────── */
function MarketOverview() {
  return (
    <section className="bg-white py-20 px-6">
      <div className="max-w-[1200px] mx-auto">
        {/* Section header */}
        <p className="text-xs uppercase tracking-[0.08em] text-[#787B86] mb-2">Market Overview</p>
        <h2 className="text-3xl sm:text-4xl font-semibold text-[#131722] mb-10">Markets at a Glance</h2>

        {/* Top: Chart + Indices */}
        <div className="flex flex-col lg:flex-row gap-8 mb-8">
          {/* Chart */}
          <div className="flex-1 bg-white border border-[#E8EAF0] rounded-2xl p-6">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="areaGreen" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22AB46" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="#22AB46" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{ fontSize: 12, fill: "#B2B5BE" }} axisLine={false} tickLine={false} />
                <YAxis domain={[5195, 5240]} tick={{ fontSize: 12, fill: "#B2B5BE" }} axisLine={false} tickLine={false} width={50} />
                <Area type="monotone" dataKey="value" stroke="#22AB46" strokeWidth={2} fill="url(#areaGreen)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Indices list */}
          <div className="lg:w-[380px] bg-white border border-[#E8EAF0] rounded-2xl p-6">
            <div className="space-y-4">
              {indices.map((idx) => (
                <div key={idx.ticker} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-semibold" style={{ backgroundColor: idx.color }}>
                      {idx.ticker[0]}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[#131722]">{idx.name}</p>
                      <p className="text-xs text-[#787B86]">{idx.ticker}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-[#131722]">{idx.value}</p>
                    <p className={`text-xs font-medium ${idx.positive ? "text-[#22AB46]" : "text-[#F7525F]"}`}>
                      {idx.change}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <button className="mt-5 text-sm text-[#2962FF] font-medium flex items-center gap-1 hover:underline">
              See all major indices <ArrowRight size={14} />
            </button>
          </div>
        </div>

        {/* Bottom: Market Cards Grid - 2x2 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Crypto Card */}
          <div className="bg-white border border-[#E8EAF0] rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-[#131722]">Crypto</h3>
              <ArrowRight size={16} className="text-[#787B86]" />
            </div>
            <div className="flex justify-center mb-4">
              <PieChart width={80} height={80}>
                <Pie data={cryptoPieData} cx={40} cy={40} innerRadius={22} outerRadius={38} dataKey="value" startAngle={90} endAngle={-270}>
                  {cryptoPieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-[#FF9800] flex items-center justify-center text-white text-xs">
                    <Bitcoin size={14} />
                  </div>
                  <span className="text-sm text-[#131722]">Bitcoin</span>
                </div>
                <div className="text-right">
                  <span className="text-sm text-[#131722]">67,234.50</span>
                  <span className="text-xs text-[#22AB46] ml-2">+1.24%</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-[#2962FF] flex items-center justify-center text-white text-xs font-semibold">
                    Ξ
                  </div>
                  <span className="text-sm text-[#131722]">Ethereum</span>
                </div>
                <div className="text-right">
                  <span className="text-sm text-[#131722]">3,456.78</span>
                  <span className="text-xs text-[#22AB46] ml-2">+0.89%</span>
                </div>
              </div>
            </div>
            <button className="mt-4 text-[13px] text-[#2962FF] font-medium">See all crypto</button>
          </div>

          {/* Tunisian Market Card */}
          <div className="bg-white border border-[#E8EAF0] rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-[#131722]">Tunisian Market</h3>
              <ArrowRight size={16} className="text-[#787B86]" />
            </div>
            {/* TUNINDEX mini chart */}
            <div className="mb-4">
              <ResponsiveContainer width="100%" height={90}>
                <AreaChart data={tunindexData}>
                  <defs>
                    <linearGradient id="tunisGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2962FF" stopOpacity={0.12} />
                      <stop offset="100%" stopColor="#2962FF" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="value" stroke="#2962FF" strokeWidth={2} fill="url(#tunisGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {/* TUNINDEX value */}
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#E8EAF0]">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-[#E91E63] flex items-center justify-center text-white text-[10px] font-bold">
                  TN
                </div>
                <span className="text-sm font-medium text-[#131722]">TUNINDEX</span>
              </div>
              <div className="text-right">
                <span className="text-sm font-medium text-[#131722]">9,847.32</span>
                <span className="text-xs text-[#F7525F] ml-2">-0.18%</span>
              </div>
            </div>
            {/* Tunisian stocks */}
            <div className="space-y-3">
              {tunisianStocks.map((stock) => (
                <div key={stock.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-semibold" style={{ backgroundColor: stock.color }}>
                      {stock.name[0]}
                    </div>
                    <span className="text-sm text-[#131722]">{stock.name}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm text-[#131722]">{stock.price} <span className="text-[11px] text-[#787B86]">{stock.currency}</span></span>
                    <span className={`text-xs ml-2 ${stock.positive ? "text-[#22AB46]" : "text-[#F7525F]"}`}>
                      {stock.change}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <button className="mt-4 text-[13px] text-[#2962FF] font-medium flex items-center gap-1 hover:underline">
              See all Tunisian stocks <ArrowRight size={12} />
            </button>
            <p className="mt-2 text-[11px] text-[#B2B5BE] italic">Prices in Tunisian Dinar (TND)</p>
          </div>

          {/* Commodities Card */}
          <div className="bg-white border border-[#E8EAF0] rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-[#131722]">Commodities</h3>
              <ArrowRight size={16} className="text-[#787B86]" />
            </div>
            {/* Sparklines */}
            <div className="flex gap-4 mb-4">
              <div className="flex-1">
                <ResponsiveContainer width="100%" height={50}>
                  <LineChart data={goldSparkline}>
                    <Line type="monotone" dataKey="v" stroke="#22AB46" strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
                <p className="text-xs text-[#787B86] mt-1">Gold</p>
              </div>
              <div className="flex-1">
                <ResponsiveContainer width="100%" height={50}>
                  <LineChart data={oilSparkline}>
                    <Line type="monotone" dataKey="v" stroke="#F7525F" strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
                <p className="text-xs text-[#787B86] mt-1">Crude Oil</p>
              </div>
            </div>
            <div className="flex gap-4 mb-4 text-sm">
              <div>
                <span className="text-[#131722] font-medium">2,345.60</span>
                <span className="text-xs text-[#22AB46] ml-1">+0.15%</span>
              </div>
              <div>
                <span className="text-[#131722] font-medium">78.45</span>
                <span className="text-xs text-[#22AB46] ml-1">+1.05%</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { name: "Gold", price: "2,345.60", color: "#FF9800" },
                { name: "Silver", price: "27.89", color: "#B2B5BE" },
                { name: "Crude Oil", price: "78.45", color: "#131722" },
                { name: "Natural Gas", price: "3.12", color: "#2962FF" },
              ].map((c) => (
                <div key={c.name} className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-semibold" style={{ backgroundColor: c.color }}>
                    {c.name[0]}
                  </div>
                  <div>
                    <p className="text-xs text-[#131722]">{c.name}</p>
                    <p className="text-[11px] text-[#787B86]">{c.price}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bonds Card */}
          <div className="bg-white border border-[#E8EAF0] rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-[#131722]">Bonds</h3>
              <ArrowRight size={16} className="text-[#787B86]" />
            </div>
            <div className="space-y-3 mb-4">
              {bondData.map((b) => (
                <div key={b.name} className="flex items-center gap-3">
                  <span className="text-xs text-[#787B86] w-14">{b.name}</span>
                  <div className="flex-1 h-2.5 bg-[#F8F9FD] rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(b.value / 5) * 100}%`, backgroundColor: b.color }} />
                  </div>
                  <span className="text-xs text-[#131722] font-medium w-10 text-right">{b.value}%</span>
                </div>
              ))}
            </div>
            <div className="border-t border-[#E8EAF0] pt-4">
              <p className="text-[11px] uppercase tracking-wider text-[#787B86] mb-1">US Interest Rate</p>
              <p className="text-3xl font-bold text-[#131722]">5.25<span className="text-lg font-normal text-[#787B86]">%</span></p>
              <div className="flex gap-4 mt-1">
                <span className="text-xs text-[#787B86]">Forecast: 5.00%</span>
                <span className="text-xs text-[#787B86]">Next: Jan 29</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ──────────── Screener Section ──────────── */
function ScreenerSection() {
  return (
    <section className="bg-[#0A1628] py-24 px-6">
      <div className="max-w-[1200px] mx-auto flex flex-col lg:flex-row items-center gap-12">
        <div className="flex-1">
          <p className="text-xs uppercase tracking-[0.08em] text-[#787B86] mb-3">Screeners</p>
          <h2 className="text-3xl sm:text-4xl font-semibold text-white mb-4">Find your next opportunity</h2>
          <p className="text-base text-[#B2B5BE] max-w-[400px] mb-6 leading-relaxed">
            Filter through thousands of stocks, crypto, and forex pairs with powerful screeners. Set custom criteria and discover hidden gems.
          </p>
          <button className="text-sm text-[#00BCD4] font-medium flex items-center gap-1 hover:gap-2 transition-all">
            Explore Screeners <ArrowRight size={14} />
          </button>
        </div>
        <div className="flex-1 flex justify-center">
          <img
            src="/screener-mockup.png"
            alt="Screener interface"
            className="w-full max-w-[500px] rounded-xl"
            loading="lazy"
          />
        </div>
      </div>
    </section>
  );
}

/* ──────────── Community Section ──────────── */
function CommunitySection() {
  return (
    <section className="bg-[#070F1D] py-24 px-6">
      <div className="max-w-[1200px] mx-auto flex flex-col-reverse lg:flex-row items-center gap-12">
        <div className="flex-1 flex justify-center">
          <img
            src="/community-mockup.png"
            alt="Community interface"
            className="w-full max-w-[500px] rounded-xl"
            loading="lazy"
          />
        </div>
        <div className="flex-1">
          <p className="text-xs uppercase tracking-[0.08em] text-[#787B86] mb-3">Community</p>
          <h2 className="text-3xl sm:text-4xl font-semibold text-white mb-4">Learn from 100M+ traders</h2>
          <p className="text-base text-[#B2B5BE] max-w-[400px] mb-6 leading-relaxed">
            Share ideas, follow top traders, and discuss strategies in the world's largest social network for investors.
          </p>
          <button className="text-sm text-[#00BCD4] font-medium flex items-center gap-1 hover:gap-2 transition-all">
            Join the Community <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </section>
  );
}

/* ──────────── Community Ideas / Ticker ──────────── */
function CommunityIdeas() {
  const [activeTab, setActiveTab] = useState("Editor's Picks");
  const tabs = ["Editor's Picks", "Most Popular", "Recent"];

  return (
    <section className="bg-white py-10 px-6">
      <div className="max-w-[1200px] mx-auto">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
          <p className="text-xs uppercase tracking-[0.08em] text-[#787B86]">Community Ideas</p>
          <div className="flex bg-[#F8F9FD] rounded-lg p-1 gap-1">
            {tabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  activeTab === tab ? "bg-white text-[#131722] shadow-sm" : "text-[#787B86] hover:text-[#131722]"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Ticker row */}
        <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
          {tickerItems.map((item) => (
            <div
              key={item.symbol}
              className="flex items-center gap-2.5 px-4 py-3 bg-white border border-[#E8EAF0] rounded-xl min-w-[160px] flex-shrink-0 hover:shadow-md transition-shadow cursor-pointer"
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                style={{ backgroundColor: item.color }}
              >
                {item.letter}
              </div>
              <div>
                <p className="text-sm font-semibold text-[#131722]">{item.symbol}</p>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[#131722]">{item.price}</span>
                  <span className={`text-xs ${item.positive ? "text-[#22AB46]" : "text-[#F7525F]"}`}>
                    {item.change}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="text-center mt-6">
          <button className="border border-[#E8EAF0] rounded-lg px-6 py-2.5 text-sm font-medium text-[#131722] hover:bg-[#F8F9FD] transition-colors">
            Load More
          </button>
        </div>
      </div>
    </section>
  );
}

/* ──────────── CTA Section ──────────── */
function CTASection() {
  return (
    <section className="bg-[#2962FF] py-20 px-6 text-center">
      <div className="max-w-[600px] mx-auto">
        <h2 className="text-3xl sm:text-4xl font-semibold text-white mb-4">Ready to start trading smarter?</h2>
        <p className="text-base text-white/80 mb-8">
          Join millions of traders on the world's most powerful charting platform.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button className="bg-white text-[#2962FF] px-6 py-3 rounded-lg text-sm font-medium hover:bg-gray-100 transition-colors w-full sm:w-auto">
            Get Started for Free
          </button>
          <button className="border border-white/50 text-white px-6 py-3 rounded-lg text-sm font-medium hover:bg-white/10 transition-colors w-full sm:w-auto">
            View Pricing
          </button>
        </div>
      </div>
    </section>
  );
}

/* ──────────── Footer ──────────── */
function Footer() {
  return (
    <footer className="bg-white border-t border-[#E8EAF0] py-16 px-6">
      <div className="max-w-[1200px] mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-10">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <p className="text-lg font-bold text-[#131722] mb-2">TradeVerse</p>
            <p className="text-[13px] text-[#787B86] mb-4">Made by traders, for traders.</p>
            <div className="flex gap-3">
              {[X, Facebook, Youtube, Instagram, Linkedin].map((Icon, i) => (
                <Icon key={i} size={16} className="text-[#787B86] hover:text-[#131722] cursor-pointer transition-colors" />
              ))}
            </div>
          </div>

          {/* Products */}
          <div>
            <p className="text-xs uppercase tracking-wider text-[#787B86] mb-3">Products</p>
            <ul className="space-y-2">
              {["Supercharts", "Screeners", "Heatmaps", "Economic Calendar", "Pine Script"].map((item) => (
                <li key={item} className="text-sm text-[#131722] hover:text-[#2962FF] cursor-pointer transition-colors">{item}</li>
              ))}
            </ul>
          </div>

          {/* Markets */}
          <div>
            <p className="text-xs uppercase tracking-wider text-[#787B86] mb-3">Markets</p>
            <ul className="space-y-2">
              {["Stocks", "Crypto", "Forex", "Futures", "Bonds", "Indices"].map((item) => (
                <li key={item} className="text-sm text-[#131722] hover:text-[#2962FF] cursor-pointer transition-colors">{item}</li>
              ))}
            </ul>
          </div>

          {/* Community */}
          <div>
            <p className="text-xs uppercase tracking-wider text-[#787B86] mb-3">Community</p>
            <ul className="space-y-2">
              {["Ideas", "Scripts", "Streams", "House Rules", "Moderators"].map((item) => (
                <li key={item} className="text-sm text-[#131722] hover:text-[#2962FF] cursor-pointer transition-colors">{item}</li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <p className="text-xs uppercase tracking-wider text-[#787B86] mb-3">Company</p>
            <ul className="space-y-2">
              {["About", "Careers", "Blog", "Press", "Contact Us"].map((item) => (
                <li key={item} className="text-sm text-[#131722] hover:text-[#2962FF] cursor-pointer transition-colors">{item}</li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between pt-6 border-t border-[#E8EAF0] gap-4">
          <p className="text-xs text-[#787B86]">© 2026 TradeVerse, Inc.</p>
          <div className="flex gap-4">
            <span className="text-xs text-[#787B86] hover:text-[#131722] cursor-pointer">Terms</span>
            <span className="text-xs text-[#787B86] hover:text-[#131722] cursor-pointer">Privacy</span>
            <span className="text-xs text-[#787B86] hover:text-[#131722] cursor-pointer">Cookies</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ──────────── App ──────────── */
function App() {
  return (
    <div className="min-h-screen">
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        @media (prefers-reduced-motion: reduce) {
          * {
            animation-play-state: paused !important;
          }
        }
      `}</style>
      <Navbar />
      <Hero />
      <MarketOverview />
      <ScreenerSection />
      <CommunitySection />
      <CommunityIdeas />
      <CTASection />
      <Footer />
    </div>
  );
}

export default App;
