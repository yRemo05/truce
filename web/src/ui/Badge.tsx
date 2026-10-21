import type { ReactNode } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive';

/** One badge for every status and label in the product: an optional glyph and a short word. */
export function Badge({ variant = 'secondary', icon, children, className }: { variant?: BadgeVariant; icon?: IconName; children: ReactNode; className?: string }) {
  return (
    <span className={cx('badge', `badge--${variant}`, className)}>
      {icon && <Icon name={icon} size={16} />}
      <span>{children}</span>
    </span>
  );
}
