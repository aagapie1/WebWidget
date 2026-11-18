import type { RefObject } from 'preact';
import { useEffect, useState } from 'preact/hooks';

/**
 * Keeps an element (the preview column) inside the visible window: its height is the space from
 * where it starts — never above `minTop`, the bottom of the sticky status bar — to the bottom of
 * the window. At the top of the page it starts below the header; once scrolled, it sticks under
 * the bar. CSS alone does not know these offsets.
 */
export function useFitToViewport(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  minTop: () => number = () => 0,
): void {
  useEffect(() => {
    const element = ref.current;
    if (!active || !element) return;
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = Math.max(element.getBoundingClientRect().top, minTop(), 0);
        element.style.setProperty('--column-height', `${String(window.innerHeight - top)}px`);
        element.style.setProperty('--column-top', `${String(minTop())}px`);
      });
    };
    fit();
    window.addEventListener('resize', fit, { passive: true });
    window.addEventListener('scroll', fit, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', fit);
      window.removeEventListener('scroll', fit);
    };
  }, [ref, active, minTop]);
}

/** Whether a media query matches, following changes (window resized, zoom). */
export function useMediaQuery(query: string): boolean {
  const read = () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const update = () => {
      setMatches(list.matches);
    };
    update();
    list.addEventListener('change', update);
    return () => {
      list.removeEventListener('change', update);
    };
  }, [query]);
  return matches;
}
