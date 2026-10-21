import type { ReactNode } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'seal' | 'ink';

/** One status chip for every state in the product: a glyph, a word, a tone. */
export function Chip({ tone = 'neutral', icon, children, className }: { tone?: Tone; icon?: IconName; children: ReactNode; className?: string }) {
  return (
    <span className={cx('chip', `chip--${tone}`, className)}>
      {icon && <Icon name={icon} size={16} />}
      <span>{children}</span>
    </span>
  );
}
