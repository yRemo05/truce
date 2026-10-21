import type { CardItem, PerSide } from '@contract';
import { InfoTip, ScoreMeter, Thumb } from '@/ui';
import { EXPLAIN } from '@/lib/glossary';
import { nameOf } from '@/lib/people';
import { SLOT_LABEL, SLOTS, type Bundle } from '@/lib/truce';
import { useTruceCtx } from './context';

/** Where a restaurant is, from Qloo's facts: the neighbourhood, else the address. */
function placeLine(item: CardItem): string | null {
  return item.facts.neighborhood ?? item.disambiguation ?? null;
}

/** A film's or artist's second line: the year, or Qloo's disambiguation. */
export function subLine(item: CardItem): string | null {
  if (item.slot === 'restaurant') return placeLine(item);
  return item.disambiguation ?? item.facts.genres ?? null;
}

/** Three picks, one per slot: thumbnail, kind, name. */
export function Evening({ bundle }: { bundle: Bundle }) {
  const { items } = useTruceCtx();
  return (
    <ul className="evening">
      {SLOTS.map((slot) => {
        const item = items[bundle[slot]];
        return (
          <li key={slot} className="evening__item">
            <Thumb name={item?.name ?? '?'} imageUrl={item?.imageUrl ?? null} slot={slot} />
            <span className="evening__text">
              <span className="evening__name">{item?.name ?? 'Unknown pick'}</span>
              <span className="evening__slot">{SLOT_LABEL[slot]}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Everyone's scores for an evening, one named bar each, with the ⓘ that says what a score is. */
export function Scores({ scores, size = 'sm' }: { scores: PerSide<number>; size?: 'sm' | 'md' }) {
  const { names, members } = useTruceCtx();
  return (
    <div className="scores">
      <div className="scores__bars">
        {members.map((side) => (
          <ScoreMeter
            key={side}
            side={side}
            name={nameOf(names, side)}
            value={scores[side] ?? 0}
            size={size}
            label={`How well this fits ${nameOf(names, side)}: ${scores[side] ?? 0} of 100`}
          />
        ))}
      </div>
      <InfoTip label="What the scores mean">
        {EXPLAIN.score}
      </InfoTip>
    </div>
  );
}
