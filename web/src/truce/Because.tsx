import type { CardItem, Side } from '@contract';
import { Monogram } from '@/ui';
import { useTruceCtx } from './context';

/** Qloo's explanation of one person's score for one pick: the things they named that drive it. */
export function Because({ item, side, withScore }: { item: CardItem; side: Side; withScore?: boolean }) {
  const { names, letters } = useTruceCtx();
  return (
    <p className="why__line">
      <Monogram side={side} letters={letters[side]} size="xs" />
      <span className="why__who">{names[side]}</span>
      <span className="data why__data">
        {withScore && <span className="why__score">{item.scores[side]}</span>}
        {item.because[side].length ? item.because[side].join(' · ') : 'no single pick stands out'}
      </span>
    </p>
  );
}
