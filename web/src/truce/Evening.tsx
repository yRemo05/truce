import type { CardItem, Side } from '@contract';
import { InfoTip, ScoreMeter, Thumb } from '@/ui';
import { EXPLAIN } from '@/lib/glossary';
import { SIDES } from '@/lib/people';
import { SLOT_LABEL, SLOTS, type Bundle } from '@/lib/truce';
import { useTruceCtx } from './context';

/** Where a restaurant is, from Qloo's facts: the neighbourhood, else the address. */
export function placeLine(item: CardItem): string | null {
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

/** Both people's scores for an evening, named, with the ⓘ that says what a score is. */
export function Scores({ scores, size = 'sm' }: { scores: Record<Side, number>; size?: 'sm' | 'md' }) {
  const { names } = useTruceCtx();
  return (
    <div className="scores">
      <div className="scores__bars">
        {SIDES.map((side) => (
          <ScoreMeter key={side} side={side} name={names[side]} value={scores[side]} size={size} label={`How well this fits ${names[side]}: ${scores[side]} of 100`} />
        ))}
      </div>
      <InfoTip label="What the scores mean">
        {EXPLAIN.score}
      </InfoTip>
    </div>
  );
}
