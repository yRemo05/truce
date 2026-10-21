import type { Side } from '@contract';
import { cx } from './cx';

interface ScoreMeterProps {
  side: Side;
  name: string;
  /** 0–100. */
  value: number;
  size?: 'sm' | 'md' | 'lg' | 'stack';
  /** What the number is, for screen readers: "Qloo fit for Maya". */
  label?: string;
}

/** Qloo data: a person's fit as a bar in their colour, their name beside it. */
export function ScoreMeter({ side, name, value, size = 'md', label }: ScoreMeterProps) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      className={cx('meter', `p-${side}`, `meter--${size}`)}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      aria-label={label ?? `Qloo fit for ${name}`}
    >
      <span className="meter__name" aria-hidden="true">
        {name}
      </span>
      <span className="meter__track" aria-hidden="true">
        <span className="meter__fill" style={{ transform: `scaleX(${v / 100})` }} />
      </span>
      <span className="meter__value" aria-hidden="true">
        {v}
      </span>
    </div>
  );
}
