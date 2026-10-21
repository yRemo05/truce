import type { Side } from '@contract';
import { cx } from './cx';

/** A person's round initial in their colour. Decorative; the name sits beside it. */
export function Avatar({ side, letters, size = 'md' }: { side: Side; letters: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={cx('avatar', `p-${side}`, `avatar--${size}`)} aria-hidden="true">
      {letters}
    </span>
  );
}
