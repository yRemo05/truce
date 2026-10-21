import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'wouter';
import { cx } from './cx';

function Wordmark() {
  return (
    <Link href="/" className="wordmark" aria-label="Truce, home">
      <span aria-hidden="true">Truce</span>
      <span className="wordmark__seal" aria-hidden="true" />
    </Link>
  );
}

/** The bar on every screen: wordmark, what you're looking at, and the screen's sticky actions. */
export function TopBar({ context, actions, sticky, below }: { context?: ReactNode; actions?: ReactNode; sticky?: boolean; below?: ReactNode }) {
  const ref = useRef<HTMLElement>(null);

  // A sticky bar publishes its real height, so scroll targets and the pool rail clear it at any text size.
  useEffect(() => {
    const el = ref.current;
    if (!sticky || !el) return;
    const root = document.documentElement.style;
    const observer = new ResizeObserver(() => root.setProperty('--header-h', `${el.offsetHeight}px`));
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.removeProperty('--header-h');
    };
  }, [sticky]);

  return (
    <header ref={ref} className={cx('topbar', sticky && 'topbar--sticky')}>
      <div className="wrap topbar__row">
        <Wordmark />
        {context && <div className="topbar__context">{context}</div>}
        {actions && <div className="topbar__actions">{actions}</div>}
      </div>
      {below && <div className="wrap topbar__below">{below}</div>}
    </header>
  );
}
