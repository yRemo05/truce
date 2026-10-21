import { cx, Icon } from '@/ui';

const STEPS = ['The two of you', 'How you\u2019ll play', 'Your picks'];

/** Setup progress: a list beside the form on wide screens, one line above it on a phone. */
export function Steps({ current, className }: { current: 1 | 2 | 3; className?: string }) {
  return (
    <nav className={cx('steps-nav', className)} aria-label="Setup progress">
      <p className="steps-nav__count eyebrow">
        Step {current} of {STEPS.length}
      </p>
      <ol className="steps-nav__list">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const state = n < current ? 'done' : n === current ? 'now' : 'next';
          return (
            <li key={label} className={cx('steps-nav__item', `is-${state}`)} aria-current={state === 'now' ? 'step' : undefined}>
              <span className="steps-nav__mark" aria-hidden="true">
                {state === 'done' ? <Icon name="check" size={16} /> : n}
              </span>
              <span className="steps-nav__label">{label}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
