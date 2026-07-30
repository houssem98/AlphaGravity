// G2b — inline SVG bar exhibits. No chart dependency: the whole shape is a
// list of rects, and adding a charting library for that would cost more than
// it returns. Values arrive already extracted from the report's own tables
// (exhibitExtract), so a bar can only plot a number the report states.

import { barGeometry } from '../../services/exhibitExtract';
import type { ExhibitSpec } from '../../services/reportQaGates';

const ACCENT = '#3D7FF6';
const TRACK = 260;      // px of plot area
const ROW_H = 26;
const LABEL_W = 116;

function formatValue(value: number, unit: string): string {
    const n = Number.isInteger(value) ? value : value.toFixed(1);
    if (unit.startsWith('$')) return `$${n}${unit.slice(1)}`;
    return unit ? `${n}${unit === 'x' ? '×' : unit}` : `${n}`;
}

export function ExhibitChart({ spec, accent = ACCENT }: { spec: ExhibitSpec; accent?: string }) {
    const bars = spec.bars.slice(0, 8);
    if (bars.length < 2) return null;

    const { bars: boxes, zeroX } = barGeometry(bars.map(b => b.value), TRACK);
    const height = bars.length * ROW_H + 8;
    const hasNegative = bars.some(b => b.value < 0);

    return (
        <figure className="my-6 rounded-xl px-4 py-4"
            style={{ border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
            <figcaption className="text-[12px] font-semibold mb-3" style={{ color: '#C8D4EC' }}>
                {spec.title}
                {spec.unit && <span className="ml-2 font-normal" style={{ color: '#5A6480' }}>({spec.unit})</span>}
            </figcaption>

            <svg width="100%" viewBox={`0 0 ${LABEL_W + TRACK + 62} ${height}`} role="img"
                aria-label={`${spec.title}: ${bars.map(b => `${b.label} ${formatValue(b.value, spec.unit)}`).join(', ')}`}>
                {hasNegative && (
                    <line x1={LABEL_W + zeroX} y1={0} x2={LABEL_W + zeroX} y2={height - 8}
                        stroke="rgba(255,255,255,0.16)" strokeWidth={1} />
                )}
                {bars.map((bar, i) => {
                    const y = i * ROW_H + 4;
                    return (
                        <g key={i}>
                            <text x={LABEL_W - 8} y={y + 12} textAnchor="end"
                                fontSize={10.5} fill="#8894AD">
                                {bar.label.length > 16 ? `${bar.label.slice(0, 15)}…` : bar.label}
                            </text>
                            <rect x={LABEL_W + boxes[i].x} y={y + 2} width={Math.max(boxes[i].width, 1)} height={13}
                                rx={2} fill={accent} opacity={bar.value < 0 ? 0.55 : 0.9} />
                            <text x={LABEL_W + boxes[i].x + boxes[i].width + 6} y={y + 12}
                                fontSize={10.5} fill="#C8D4EC" className="tabular-nums">
                                {formatValue(bar.value, spec.unit)}
                            </text>
                        </g>
                    );
                })}
            </svg>
        </figure>
    );
}

export function ExhibitStrip({ specs, accent }: { specs: ExhibitSpec[]; accent?: string }) {
    if (specs.length === 0) return null;
    return (
        <div className="mt-10">
            <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#5A6480' }}>
                Exhibits
            </div>
            {specs.map((s, i) => <ExhibitChart key={i} spec={s} accent={accent} />)}
        </div>
    );
}
