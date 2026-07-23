import { useEffect, useRef } from 'react';

// Attach to a horizontally-scrollable container: moving the pointer within
// `zone` px of the left or right edge auto-scrolls that way, so off-screen
// columns come into view without touching the wheel or the scrollbar. Fires on
// both hover (mousemove) and column drag (dragover) — a native drag suppresses
// mousemove, so dragging a header to the edge would otherwise never scroll.
// Only scrolls when there is actual overflow that direction, so the edges are
// inert once fully scrolled. rAF-driven; cleans itself up.
export function useEdgeAutoScroll<T extends HTMLElement>(zone = 64, speed = 16) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let dir = 0;
    let raf = 0;
    const step = () => {
      const canGo = dir < 0 ? el.scrollLeft > 0 : el.scrollLeft < el.scrollWidth - el.clientWidth - 1;
      if (!dir || !canGo) { dir = 0; raf = 0; return; }
      el.scrollLeft += dir * speed;
      raf = requestAnimationFrame(step);
    };
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const next = x < zone ? -1 : x > r.width - zone ? 1 : 0;
      if (next === dir) return;
      dir = next;
      if (dir && !raf) raf = requestAnimationFrame(step);
    };
    const stop = () => { dir = 0; };
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', stop);
    el.addEventListener('dragover', onMove); // DragEvent is a MouseEvent — clientX is present
    el.addEventListener('dragleave', stop);
    el.addEventListener('drop', stop);
    el.addEventListener('dragend', stop);
    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', stop);
      el.removeEventListener('dragover', onMove);
      el.removeEventListener('dragleave', stop);
      el.removeEventListener('drop', stop);
      el.removeEventListener('dragend', stop);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [zone, speed]);
  return ref;
}
