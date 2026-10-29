import { cx } from './cx';

export interface Stage {
  label: string;
  /** A shorter label for a phone; the full one is still read out. */
  short?: string;
}

interface StageStripProps {
  stages: readonly Stage[];
  /** The stage under way; `stages.length` when every stage is done. */
  current: number;
  /** What the steps are of: "Where this evening is". */
  label: string;
  className?: string;
}

/** Steps in order: done ones filled, the one under way half filled, the rest empty. Labels carry the state, not colour alone. */
export function StageStrip({ stages, current, label, className }: StageStripProps) {
  return (
    <ol className={cx('stages', className)} aria-label={label}>
      {stages.map((stage, i) => {
        const state = i < current ? 'done' : i === current ? 'now' : 'todo';
        return (
          <li key={stage.label} className={cx('stage', `stage--${state}`)} aria-current={state === 'now' ? 'step' : undefined}>
            <span className="stage__bar" aria-hidden="true" />
            <span className="stage__label">
              <span className={cx(stage.short && 'stage__long')}>{stage.label}</span>
              {stage.short && (
                <span className="stage__short" aria-hidden="true">
                  {stage.short}
                </span>
              )}
              <span className="visually-hidden">{state === 'done' ? ', done' : state === 'now' ? ', now' : ', to come'}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
