import { useEffect, type ReactNode } from 'react';
import { cx } from './cx';
import { Footer } from './Footer';
import { TopBar } from './TopBar';

export function useTitle(title: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · Truce` : 'Truce · Plan tonight together';
  }, [title]);
}

interface PageProps {
  title: string | null;
  context?: ReactNode;
  actions?: ReactNode;
  /** A second row in the bar, e.g. the turn track. */
  below?: ReactNode;
  stickyBar?: boolean;
  /** Span the window with a modest gutter instead of the centred column (the truce page). */
  wide?: boolean;
  skipLabel?: string;
  className?: string;
  children: ReactNode;
}

/** The shell every screen shares: bar, main landmark, footer credit. */
export function Page({ title, context, actions, below, stickyBar, wide, skipLabel = 'Skip to content', className, children }: PageProps) {
  useTitle(title);
  return (
    <div className={cx('page', wide && 'page--wide')}>
      <a className="skip-link" href="#main">
        {skipLabel}
      </a>
      <TopBar context={context} actions={actions} below={below} sticky={stickyBar} />
      <main id="main" className={cx('wrap page__main', className)}>
        {children}
      </main>
      <Footer />
    </div>
  );
}
