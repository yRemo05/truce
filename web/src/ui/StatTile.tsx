import { cx } from './cx';
import { Icon, type IconName } from './Icon';
import { Skeleton } from './Skeleton';

interface StatTileProps {
  icon: IconName;
  /** Sentence case, no colon: "Evenings planned". */
  label: string;
  /** A shorter label for a phone; the full one is still read out. */
  short?: string;
  /** Null while it's still being counted: a placeholder the number's size. */
  value: number | null;
  className?: string;
}

/**
 * One headline number with its label. A term-value pair, so place it inside
 * a <dl>: a row of them reads as a list of facts.
 */
export function StatTile({ icon, label, short, value, className }: StatTileProps) {
  return (
    <div className={cx('stat', className)}>
      <dt className="stat__label">
        <Icon name={icon} size={16} />
        <span className={cx(short && 'stat__long')}>{label}</span>
        {short && (
          <span className="stat__short" aria-hidden="true">
            {short}
          </span>
        )}
      </dt>
      <dd className="stat__value">{value === null ? <Skeleton w="2.5rem" h="1.75rem" /> : value.toLocaleString('en-GB')}</dd>
    </div>
  );
}
