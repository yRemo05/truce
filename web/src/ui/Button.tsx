import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'wouter';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
type Size = 'md' | 'sm';

interface Look {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconEnd?: IconName;
  /** Shows a spinner in place of the icon and blocks presses; the label stays so the width holds. */
  busy?: boolean;
  children: ReactNode;
}

const classes = ({ variant = 'secondary', size = 'md' }: Look, className?: string) =>
  cx('btn', `btn--${variant}`, size === 'sm' && 'btn--sm', className);

function Inner({ icon, iconEnd, busy, size, children }: Look) {
  const iconSize = size === 'sm' ? 16 : 20;
  return (
    <>
      {busy ? <Spinner size={iconSize} /> : icon && <Icon name={icon} size={iconSize} />}
      <span className="btn__label">{children}</span>
      {iconEnd && <Icon name={iconEnd} size={iconSize} className="btn__end" />}
    </>
  );
}

export function Button({
  variant,
  size,
  icon,
  iconEnd,
  busy,
  children,
  className,
  disabled,
  type = 'button',
  ...rest
}: Look & ButtonHTMLAttributes<HTMLButtonElement>) {
  const look = { variant, size, icon, iconEnd, busy, children };
  return (
    <button
      type={type}
      className={classes(look, className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      <Inner {...look} />
    </button>
  );
}

export function ButtonLink({
  variant,
  size,
  icon,
  iconEnd,
  children,
  className,
  href,
  ...rest
}: Omit<Look, 'busy'> & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const look = { variant, size, icon, iconEnd, children };
  return (
    <Link href={href} className={classes(look, className)} {...rest}>
      <Inner {...look} />
    </Link>
  );
}
