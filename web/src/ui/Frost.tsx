import { useLayoutEffect, useRef } from 'react';
import { cx } from './cx';

/**
 * Fake glass, for something that moves over the page's photo backdrop: a
 * small pre-blurred copy of the photo under the same scrim, lined up with the
 * fixed backdrop, behind the element's own translucent fill. A live
 * `backdrop-filter` on a floating element re-blurs every frame; this paints
 * once. Keeping it lined up while the page scrolls only moves its image layer
 * (no blur, no repaint), and while it floats the image rides along, a few
 * pixels off at most, which the blur hides.
 *
 * Place it as the first child of a positioned parent that makes a stacking
 * context (`isolation: isolate`); size it with `inset`. It sits under the
 * parent's content. Needs the Page `backdrop`.
 */
export function Frost({ className }: { className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const frost = ref.current;
    const image = frost?.firstElementChild as HTMLElement | null;
    const backdrop = document.querySelector<HTMLElement>('.backdrop');
    if (!frost || !image || !backdrop) return;
    let frame = 0;
    let size = '';
    const align = () => {
      frame = 0;
      const b = backdrop.getBoundingClientRect();
      const f = frost.getBoundingClientRect();
      // The image is the backdrop's own size, so `cover` crops it the same way; only a resize changes that.
      const next = `${b.width}x${b.height}`;
      if (next !== size) {
        size = next;
        image.style.width = `${b.width}px`;
        image.style.height = `${b.height}px`;
      }
      image.style.translate = `${b.left - f.left}px ${b.top - f.top}px`;
    };
    const queue = () => {
      frame ||= requestAnimationFrame(align);
    };
    align();
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    // An entrance animation on a parent moves it without a scroll, resize or reflow.
    document.addEventListener('animationend', queue);
    // Text reflowing above it (a web font arriving, a notice) moves it without a scroll or resize.
    const observer = new ResizeObserver(queue);
    observer.observe(document.body);
    observer.observe(frost);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', queue);
      window.removeEventListener('resize', queue);
      document.removeEventListener('animationend', queue);
      observer.disconnect();
    };
  }, []);

  return (
    <span ref={ref} className={cx('frost', className)} aria-hidden="true">
      <span className="frost__image" />
    </span>
  );
}
