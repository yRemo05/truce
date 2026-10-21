import type { Side } from '@contract';
import { cx } from './cx';

/** A person's mark: solid for the first person, open for the second. Decorative; the name sits beside it. */
export function Monogram({ side, letters, size = 'md' }: { side: Side; letters: string; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  return (
    <span className={cx('monogram', `monogram--${side}`, `monogram--${size}`)} aria-hidden="true">
      {letters}
    </span>
  );
}
