import { useEffect } from 'react';
import type { RefObject } from 'react';

// Keeps the column labels visible once the real header scrolls out of view.
//
// CSS `position: sticky` can't do this here: the table sits in its own
// overflow-x container (so the page doesn't drag sideways), and a nested scroll
// container becomes the scrollport a sticky <th> resolves against — it would pin
// inside that box, not at the top of the page. So we mirror the header instead:
// a fixed-position clone of <thead>, shown only while the original is off-screen,
// its column widths copied each frame and its horizontal offset synced to the
// table's own scrollLeft. Clicks are forwarded to the real <th> so sorting keeps
// working while pinned.
export function useFloatingTableHeader(scrollRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const wrap = scrollRef.current;
    if (!wrap) return;

    // The vertical scroller the page actually uses — the clone pins to its top
    // edge, not the viewport's, so it never rides over the app chrome above.
    const scroller = (() => {
      let el = wrap.parentElement;
      while (el) {
        const oy = getComputedStyle(el).overflowY;
        if (oy === 'auto' || oy === 'scroll') return el;
        el = el.parentElement;
      }
      return null;
    })();

    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;overflow:hidden;z-index:30;display:none;';
    let table: HTMLTableElement | null = null;
    let head: HTMLTableSectionElement | null = null;
    let cloneTable: HTMLTableElement | null = null;
    let cloneHead: HTMLTableSectionElement | null = null;

    const build = () => {
      host.replaceChildren();
      cloneTable = null;
      cloneHead = null;
      table = wrap.querySelector('table');
      head = table?.tHead ?? null;
      if (!table || !head) return;
      cloneTable = table.cloneNode(false) as HTMLTableElement;
      cloneTable.style.borderCollapse = 'collapse';
      cloneHead = head.cloneNode(true) as HTMLTableSectionElement;
      cloneTable.appendChild(cloneHead);
      host.appendChild(cloneTable);
    };

    build();
    wrap.parentElement?.appendChild(host);

    let raf = 0;
    const sync = () => {
      raf = 0;
      if (!table || !head || !cloneTable || !cloneHead) return;
      const wrapRect = wrap.getBoundingClientRect();
      const headRect = head.getBoundingClientRect();
      const top = scroller ? Math.max(0, scroller.getBoundingClientRect().top) : 0;
      // Show only while the real header is above the fold and rows are still visible.
      const show = headRect.bottom <= top && wrapRect.bottom > top + headRect.height;
      host.style.display = show ? 'block' : 'none';
      if (!show) return;
      host.style.top = `${top}px`;
      host.style.left = `${wrapRect.left}px`;
      host.style.width = `${wrapRect.width}px`;
      host.style.height = `${headRect.height}px`;
      cloneTable.style.width = `${table.offsetWidth}px`;
      cloneTable.style.transform = `translateX(${-wrap.scrollLeft}px)`;
      // Widths are layout-derived, so they have to be copied, not inherited.
      const src = head.querySelectorAll('th');
      const dst = cloneHead.querySelectorAll('th');
      src.forEach((th, i) => {
        const d = dst[i] as HTMLElement | undefined;
        if (!d) return;
        const w = `${(th as HTMLElement).offsetWidth}px`;
        d.style.width = w;
        d.style.minWidth = w;
        d.style.maxWidth = w;
      });
    };

    const onScroll = () => { if (!raf) raf = requestAnimationFrame(sync); };

    // Forward clicks to the matching real <th> so sort still works while pinned.
    host.addEventListener('click', (e) => {
      if (!cloneHead || !head) return;
      const th = (e.target as HTMLElement).closest('th');
      if (!th) return;
      const i = Array.prototype.indexOf.call(cloneHead.querySelectorAll('th'), th);
      (head.querySelectorAll('th')[i] as HTMLElement | undefined)?.click();
    });

    // Column set changes (chooser, tab switch) invalidate the snapshot.
    const mo = new MutationObserver(() => { build(); sync(); });
    if (head) mo.observe(head, { childList: true, subtree: true, characterData: true });

    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    wrap.addEventListener('scroll', onScroll);
    sync();

    return () => {
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      wrap.removeEventListener('scroll', onScroll);
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
      host.remove();
    };
  }, [scrollRef]);
}
