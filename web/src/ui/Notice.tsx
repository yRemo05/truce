import type { ReactNode } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

type NoticeTone = 'info' | 'warn' | 'error';

const GLYPH: Record<NoticeTone, IconName> = { info: 'info', warn: 'warning', error: 'error' };

/** Every inline message: leads with its glyph, says what happened, offers the next step. */
export function Notice({
  tone = 'info',
  icon,
  title,
  children,
  action,
  className,
  live,
}: {
  tone?: NoticeTone;
  /** A glyph that says more than the tone's own: a swap, a replan. */
  icon?: IconName;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Announce to screen readers when it appears. */
  live?: boolean;
}) {
  return (
    <div className={cx('notice', `notice--${tone}`, className)} role={live ? (tone === 'error' ? 'alert' : 'status') : undefined}>
      <Icon name={icon ?? GLYPH[tone]} size={20} className="notice__glyph" />
      <div className="notice__body">
        {title && <p className="notice__title">{title}</p>}
        {children && <div className="notice__text">{children}</div>}
      </div>
      {action && <div className="notice__action">{action}</div>}
    </div>
  );
}
