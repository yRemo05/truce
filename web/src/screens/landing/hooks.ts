import { useEffect, useState, type RefObject } from 'react';

/** Whether the visitor asked for less motion; follows the setting live. */
export function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduce, setReduce] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setReduce(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return reduce;
}

/** Whether the element is on screen (and the tab is showing), so a loop can rest while nobody sees it. */
export function useOnScreen(ref: RefObject<Element | null>): boolean {
  const [seen, setSeen] = useState(true);
  const [shown, setShown] = useState(() => typeof document === 'undefined' || !document.hidden);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setSeen(Boolean(e?.isIntersecting)), { threshold: 0.15 });
    io.observe(el);
    const vis = () => setShown(!document.hidden);
    document.addEventListener('visibilitychange', vis);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', vis);
    };
  }, [ref]);
  return seen && shown;
}
