import { useId } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

interface SegmentedProps<T extends string> {
  legend: string;
  hideLegend?: boolean;
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (value: T) => void;
  size?: 'md' | 'sm';
}

/** A radio group drawn as one pill track: arrow keys move, the choice is ink. */
export function Segmented<T extends string>({ legend, hideLegend, value, options, onChange, size = 'md' }: SegmentedProps<T>) {
  const name = useId();
  return (
    <fieldset className={cx('segmented', size === 'sm' && 'segmented--sm')}>
      <legend className={cx('segmented__legend', hideLegend && 'visually-hidden')}>{legend}</legend>
      <div className="segmented__track">
        {options.map((o) => (
          <label key={o.value} className={cx('segmented__option', o.value === value && 'is-on')}>
            <input
              type="radio"
              className="visually-hidden"
              name={name}
              value={o.value}
              checked={o.value === value}
              onChange={() => onChange(o.value)}
            />
            {o.icon && <Icon name={o.icon} size={size === 'sm' ? 16 : 20} />}
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
