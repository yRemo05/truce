import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  icon?: IconName;
  /** Something inside the field's right edge: a spinner, a clear button. */
  trailing?: ReactNode;
  hideLabel?: boolean;
  ref?: Ref<HTMLInputElement>;
}

/** One field look everywhere: label above (never wrapping), hint and error below in reserved space. */
export function TextField({ label, hint, error, icon, trailing, hideLabel, className, id, ref, ...input }: TextFieldProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx('field', error && 'field--error', className)}>
      <label htmlFor={fieldId} className={cx('field__label', hideLabel && 'visually-hidden')}>
        {label}
      </label>
      <div className="field__control">
        {icon && <Icon name={icon} size={20} className="field__icon" />}
        <input
          ref={ref}
          id={fieldId}
          className={cx('field__input', icon && 'field__input--icon', trailing ? 'field__input--trailing' : null)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...input}
        />
        {trailing && <span className="field__trailing">{trailing}</span>}
      </div>
      {hint && !error && (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="field__error">
          <Icon name="warning" size={16} />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
