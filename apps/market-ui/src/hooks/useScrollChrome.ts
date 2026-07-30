import { useEffect, type RefObject } from 'react';

// Publishes the scroll direction and an idle flag of a scroll container on
// <html>, so chrome anywhere in the tree can get out of the way in CSS:
//   [data-nav="down"]                     → scrolling down past the top
//   [data-nav="down"][data-scrolling="1"] → still moving (fades the column head)
// The trading shell scrolls in an inner container, not the window, so the state
// has to travel out of the component that owns the scroller.
export function useScrollChrome(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    let last = el.scrollTop;
    let idle: ReturnType<typeof setTimeout>;

    const onScroll = () => {
      const y = el.scrollTop;
      if (y > last && y > 64) root.dataset.nav = 'down';
      else if (y < last) root.dataset.nav = 'up';
      root.dataset.scrolling = '1';
      clearTimeout(idle);
      idle = setTimeout(() => { root.dataset.scrolling = '0'; }, 180);
      last = y;
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      clearTimeout(idle);
      delete root.dataset.nav;
      delete root.dataset.scrolling;
    };
  }, [ref]);
}
