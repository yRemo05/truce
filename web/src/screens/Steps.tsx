import { cx } from '@/ui';

const STEPS = ['The two of you', 'How you’ll play', 'Your favourites'];

/** Setup progress: "Step 2 of 3", the step's name, and three short bars. */
export function Steps({ current, className }: { current: 1 | 2 | 3; className?: string }) {
  return (
    <nav className={cx('steps-nav', className)} aria-label="Setup progress">
      <p className="small muted">
        Step {current} of {STEPS.length} · {STEPS[current - 1]}
      </p>
      <ol className="steps-nav__bars" aria-hidden="true">
        {STEPS.map((label, i) => (
          <li key={label} className={cx('steps-nav__bar', i < current && 'is-on')} />
        ))}
      </ol>
    </nav>
  );
}
