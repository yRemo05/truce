import { useId, type ReactNode, type Ref, type TextareaHTMLAttributes } from 'react';
import { cx } from './cx';

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: ReactNode;
  hint?: ReactNode;
  /** Shown as "n / max" under the field; the browser stops typing at the limit. */
  hideLabel?: boolean;
  maxLength: number;
  value: string;
  ref?: Ref<HTMLTextAreaElement>;
}

/** The text field's look for a few lines of free text, with a character count. */
export function TextArea({ label, hint, hideLabel, maxLength, value, className, id, ref, ...area }: TextAreaProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  const hintId = `${fieldId}-hint`;
  const left = maxLength - value.length;
  return (
    <div className={cx('field', className)}>
      <label htmlFor={fieldId} className={cx('field__label', hideLabel && 'visually-hidden')}>
        {label}
      </label>
      <textarea ref={ref} id={fieldId} className="field__input field__area" maxLength={maxLength} value={value} aria-describedby={hintId} {...area} />
      <p id={hintId} className="field__hint field__foot">
        <span>{hint}</span>
        <span className={cx('num', left <= 20 && 'field__count--low')} aria-label={`${left} characters left`}>
          {value.length} / {maxLength}
        </span>
      </p>
    </div>
  );
}
