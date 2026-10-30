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

const quiet = () => typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Scroll reveals for the landing: every `[data-reveal]` inside `.l-main` starts
 * hidden (only once this has run, so without script nothing hides) and gets
 * `is-in` the first time it comes on screen. With reduced motion everything is
 * simply shown. CSS does the rest (landing.css, "Reveals").
 */
export function useReveal() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.l-main');
    if (!root) return;
    const items = root.querySelectorAll<HTMLElement>('[data-reveal]');
    if (quiet() || typeof IntersectionObserver !== 'function') {
      items.forEach((el) => el.classList.add('is-in'));
      return;
    }
    root.classList.add('is-revealing');
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.15 },
    );
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

/**
 * A magnetic pull: the element leans a few pixels toward a fine pointer while
 * it's over it, and springs back on leave. Moves only `translate` (no layout);
 * off for touch and for reduced motion.
 */
export function useMagnet<T extends HTMLElement>(ref: RefObject<T | null>, strength = 0.22, max = 7) {
  useEffect(() => {
    const el = ref.current;
    if (!el || quiet() || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    let frame = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const clamp = (v: number) => Math.max(-max, Math.min(max, v));
        const x = clamp((e.clientX - (r.left + r.width / 2)) * strength);
        const y = clamp((e.clientY - (r.top + r.height / 2)) * strength);
        el.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
      });
    };
    const leave = () => {
      cancelAnimationFrame(frame);
      el.style.translate = '';
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
    };
  }, [ref, strength, max]);
}
