import React, { useRef } from 'react';
import { GripVertical } from 'lucide-react';

/**
 * Draggable vertical divider for resizing a side panel.
 * - `value` is the current panel width (px); `onChange` is called as you drag.
 * - `dir = 1` when the panel being resized is to the LEFT of the handle
 *   (drag right → wider); `dir = -1` when the panel is to the RIGHT.
 */
export const ResizeHandle: React.FC<{
  value: number;
  min: number;
  max: number;
  dir: 1 | -1;
  onChange: (v: number) => void;
  ariaLabel?: string;
}> = ({ value, min, max, dir, onChange, ariaLabel }) => {
  const start = useRef<{ x: number; v: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    start.current = { x: e.clientX, v: value };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    onChange(Math.max(min, Math.min(max, start.current.v + dir * dx)));
  };

  const end = (e: React.PointerEvent) => {
    if (!start.current) return;
    start.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  // keyboard accessibility: arrow keys nudge the width
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 24 : 8;
    if (e.key === 'ArrowLeft') { e.preventDefault(); onChange(Math.max(min, Math.min(max, value - step))); }
    if (e.key === 'ArrowRight') { e.preventDefault(); onChange(Math.max(min, Math.min(max, value + step))); }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel || 'Resize panel'}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      className="group relative w-1.5 shrink-0 cursor-col-resize bg-[color:var(--line)] hover:bg-[color:color-mix(in_oklch,var(--accent)_45%,var(--line))] focus:bg-[color:var(--accent)] focus:outline-none transition-colors"
    >
      {/* grip handle — subtle always, brighter on hover/focus */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center w-4 h-9 rounded-md bg-[color:var(--surface-2)] border border-[color:var(--line-strong)] opacity-40 group-hover:opacity-100 group-focus:opacity-100 transition-opacity shadow-sm">
        <GripVertical className="w-3 h-3 text-[color:var(--text-3)] group-hover:text-[color:var(--accent)]" />
      </div>
    </div>
  );
};
