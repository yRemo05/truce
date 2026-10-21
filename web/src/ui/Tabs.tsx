import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

export interface TabItem<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  /** A short count or state beside the label: "6 finds", "Deal". */
  meta?: ReactNode;
  /** New content the reader hasn't seen yet. */
  dot?: boolean;
}

interface TabsProps<T extends string> {
  label: string;
  /** Prefix for the tab ids; the panel is labelled by `${idBase}-${value}`. */
  idBase: string;
  panelId: string;
  value: T;
  items: readonly TabItem<T>[];
  onChange: (value: T) => void;
  className?: string;
}

const STEP: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };

/** One tab strip everywhere: a pill track, arrow keys move between tabs, the panel is the caller's. */
export function Tabs<T extends string>({ label, idBase, panelId, value, items, onChange, className }: TabsProps<T>) {
  const refs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});

  // Arrows move from the focused tab, which is the selected one unless focus was placed by hand.
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = items.findIndex((t) => t.value === e.currentTarget.dataset.value);
    const step = STEP[e.key];
    const next = step ? items[(i + step + items.length) % items.length] : e.key === 'Home' ? items[0] : e.key === 'End' ? items[items.length - 1] : undefined;
    if (!next) return;
    e.preventDefault();
    onChange(next.value);
    refs.current[next.value]?.focus();
  };

  return (
    <div className={cx('tabs', className)} role="tablist" aria-label={label}>
      {items.map((t) => (
        <button
          key={t.value}
          ref={(el) => {
            refs.current[t.value] = el;
          }}
          type="button"
          role="tab"
          id={`${idBase}-${t.value}`}
          aria-selected={t.value === value}
          aria-controls={panelId}
          data-value={t.value}
          tabIndex={t.value === value ? 0 : -1}
          className={cx('tabs__tab', t.value === value && 'is-on')}
          onClick={() => onChange(t.value)}
          onKeyDown={onKey}
        >
          {t.icon && <Icon name={t.icon} size={16} />}
          <span className="tabs__label">{t.label}</span>
          {t.meta && <span className="tabs__meta">{t.meta}</span>}
          {t.dot && (
            <>
              <span className="tabs__dot" aria-hidden="true" />
              <span className="visually-hidden">, new</span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}
