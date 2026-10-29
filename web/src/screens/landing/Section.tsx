import type { ReactNode } from 'react';
import { cx } from '@/ui';

interface SectionProps {
  id: string;
  title: ReactNode;
  /** One or two sentences under the title. */
  lede?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** One landing section: an anchor the nav links to, a title, a short lede, then its content. */
export function Section({ id, title, lede, className, children }: SectionProps) {
  return (
    <section id={id} className={cx('l-section', className)} aria-labelledby={`${id}-title`}>
      <header className="l-section__head">
        <h2 id={`${id}-title`} className="l-section__title">
          {title}
        </h2>
        {lede && <p className="l-section__lede">{lede}</p>}
      </header>
      {children}
    </section>
  );
}
