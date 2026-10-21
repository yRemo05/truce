import type { CardItem, Side } from '@contract';
import { useTruceCtx } from './context';

/** Qloo's explanation of one person's score for one pick: the favourites of theirs that drive it. */
export function Because({ item, side }: { item: CardItem; side: Side }) {
  const { names } = useTruceCtx();
  // "In the Mood for Love (56%)" → "In the Mood for Love": the order already says which counts most.
  const lines = item.because[side].map((line) => line.replace(/\s*\(\d+%\)$/, ''));
  return (
    <p className="because small">
      <span className="because__who">
        For {names[side]} <span className="num">({item.scores[side]})</span>:
      </span>{' '}
      <span className="muted">{lines.length ? `because of ${lines.join(', ')}` : 'no single favourite stands out'}</span>
    </p>
  );
}
