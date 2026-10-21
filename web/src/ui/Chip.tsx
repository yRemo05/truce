import type { ButtonHTMLAttributes } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  pressed: boolean;
  icon?: IconName;
}

/** A small toggle: a suggestion to tap, or one choice in a row of them. */
export function Chip({ pressed, icon, className, children, ...button }: ChipProps) {
  return (
    <button type="button" className={cx('btn btn--sm btn--outline chip', pressed && 'is-on', className)} aria-pressed={pressed} {...button}>
      {icon && <Icon name={icon} size={16} />}
      <span className="btn__label">{children}</span>
    </button>
  );
}
