import type { CardItem } from '@contract';
import { Icon, Thumb } from '@/ui';
import { SLOT_ICON, SLOT_LABEL, SLOTS, type Bundle } from '@/lib/truce';
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

/** Three picks, one per slot: the compact evening inside a move. */
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
              <span className="evening__slot">
                <Icon name={SLOT_ICON[slot]} size={16} />
                {SLOT_LABEL[slot]}
              </span>
              <span className="evening__name">{item?.name ?? 'Unknown pick'}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
