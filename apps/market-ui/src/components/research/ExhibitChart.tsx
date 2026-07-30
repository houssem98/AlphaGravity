// G2b — inline SVG bar exhibits. No chart dependency: the whole shape is a
// list of rects, and adding a charting library for that would cost more than
// it returns. Values arrive already extracted from the report's own tables
// (exhibitExtract), so a bar can only plot a number the report states.

import { barGeometry } from '../../services/exhibitExtract';
import { themeTokens, type ReportTheme } from '../../services/reportTheme';
import type { ExhibitSpec } from '../../services/reportQaGates';

const TRACK = 260;      // px of plot area
const LABEL_W = 116;

function formatValue(value: number, unit: string): string {
    const n = Number.isInteger(value) ? value : value.toFixed(1);
    if (unit.startsWith('$')) return `$${n}${unit.slice(1)}`;
    return unit ? `${n}${unit === 'x' ? '×' : unit}` : `${n}`;
}

export function ExhibitChart(
    { spec, theme, accent }: { spec: ExhibitSpec; theme?: ReportTheme; accent?: string },
) {
    const t = themeTokens(theme);
    // An explicit tone-driven accent from the design loop outranks the theme's.
    const ink = accent ?? t.accent;
    const bars = spec.bars.slice(0, 8);
    if (bars.length < 2) return null;

    const { bars: boxes, zeroX } = barGeometry(bars.map(b => b.value), TRACK);
    const rowH = t.rowGap;
    const height = bars.length * rowH + 8;
    const hasNegative = bars.some(b => b.value < 0);

    return (
        <figure className="my-6 px-4 py-4"
            style={{ border: `1px solid ${t.rule}`, background: t.surface, borderRadius: t.radius, fontFamily: t.fontFamily }}>
            <figcaption className="text-[12px] font-semibold mb-3" style={{ color: t.ink }}>
                {spec.title}
                {spec.unit && <span className="ml-2 font-normal" style={{ color: t.inkFaint }}>({spec.unit})</span>}
            </figcaption>

            <svg width="100%" viewBox={`0 0 ${LABEL_W + TRACK + 62} ${height}`} role="img"
                aria-label={`${spec.title}: ${bars.map(b => `${b.label} ${formatValue(b.value, spec.unit)}`).join(', ')}`}>
                {hasNegative && (
                    <line x1={LABEL_W + zeroX} y1={0} x2={LABEL_W + zeroX} y2={height - 8}
                        stroke={t.rule} strokeWidth={1} />
                )}
                {bars.map((bar, i) => {
                    const y = i * rowH + 4;
                    return (
                        <g key={i}>
                            <text x={LABEL_W - 8} y={y + 12} textAnchor="end"
                                fontSize={10.5} fill={t.inkMuted}>
                                {bar.label.length > 16 ? `${bar.label.slice(0, 15)}…` : bar.label}
                            </text>
                            <rect x={LABEL_W + boxes[i].x} y={y + 2} width={Math.max(boxes[i].width, 1)} height={13}
                                rx={2} fill={ink} opacity={bar.value < 0 ? 0.55 : 0.9} />
                            <text x={LABEL_W + boxes[i].x + boxes[i].width + 6} y={y + 12}
                                fontSize={10.5} fill={t.ink} className="tabular-nums">
                                {formatValue(bar.value, spec.unit)}
                            </text>
                        </g>
                    );
                })}
            </svg>
        </figure>
    );
}

export function ExhibitStrip(
    { specs, theme, accent }: { specs: ExhibitSpec[]; theme?: ReportTheme; accent?: string },
) {
    if (specs.length === 0) return null;
    return (
        <div className="mt-10">
            <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: themeTokens(theme).inkFaint }}>
                Exhibits
            </div>
            {specs.map((s, i) => <ExhibitChart key={i} spec={s} theme={theme} accent={accent} />)}
        </div>
    );
}
