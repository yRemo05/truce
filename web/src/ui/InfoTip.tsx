import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { cx } from './cx';
import { Icon } from './Icon';

const WIDTH = 288;
const MARGIN = 8;

/**
 * A small ⓘ that explains a term. Tap or press to toggle, hover to peek,
 * Escape, a tap elsewhere or scrolling to close. The text is announced when it
 * opens. The bubble is fixed to the viewport, so scrolling panels can't clip it.
 */
export function InfoTip({ label, children }: { label: string; children: string }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [place, setPlace] = useState<CSSProperties>({});
  const ref = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const shown = open || hover;

  useEffect(() => {
    if (!shown || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const width = Math.min(WIDTH, window.innerWidth - 2 * MARGIN);
    const left = Math.max(MARGIN, Math.min(r.left - MARGIN, window.innerWidth - width - MARGIN));
    const below = r.bottom + 6 + 120 < window.innerHeight;
    setPlace(below ? { left, width, top: r.bottom + 6 } : { left, width, bottom: window.innerHeight - r.top + 6 });
  }, [shown]);

  useEffect(() => {
    if (!shown) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setHover(false);
      }
    };
    const scroll = () => {
      setOpen(false);
      setHover(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', scroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', scroll, { capture: true });
    };
  }, [shown]);

  return (
    <span
      ref={ref}
      className="info"
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(false)}
    >
      <button
        ref={button}
        type="button"
        className="info__btn"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <Icon name="info" size={16} />
      </button>
      <span id={id} role="status" className={cx('info__pop', shown && 'is-open')} style={place}>
        {shown ? children : ''}
      </span>
    </span>
  );
}
