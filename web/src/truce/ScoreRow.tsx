import type { PerSide } from '@contract';
import { cx, InfoTip } from '@/ui';
import { EXPLAIN } from '@/lib/glossary';
import { nameOf } from '@/lib/people';
import { useTruceCtx } from './context';

/**
 * Everyone's fit in one line: a dot in each person's colour, their name and
 * score. `explain` puts the ⓘ beside "Fit", so it never wraps onto a line of its own.
 */
export function ScoreRow({ scores, explain = true }: { scores: PerSide<number>; explain?: boolean }) {
  const { names, members } = useTruceCtx();
  return (
    <p className="scorerow small">
      <span className="scorerow__label">
        Fit
        {explain && <InfoTip label="What the scores mean">{EXPLAIN.score}</InfoTip>}
      </span>
      {members.map((s) => (
        <span key={s} className={cx('scorerow__item', `p-${s}`)}>
          <span className="scorerow__dot" aria-hidden="true" />
          {nameOf(names, s)} <strong className="num">{scores[s] ?? 0}</strong>
        </span>
      ))}
    </p>
  );
}
