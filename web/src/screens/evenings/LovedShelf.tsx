import type { Slot } from '@contract';
import { Icon, InfoTip, Poster, SectionHeader } from '@/ui';
import { dayMonth } from '@/lib/format';
import { EXPLAIN } from '@/lib/glossary';
import { listNames } from '@/lib/people';
import { SLOT_ICON, SLOTS } from '@/lib/truce';
import type { LovedItem } from './derive';

const SHELF_LABEL: Record<Slot, string> = { film: 'Films', restaurant: 'Restaurants', music: 'Music' };
/** Per shelf, before "and N more": two rows of three. */
const SHOWN = 6;

/** "Maya", "Maya and Ömer", or "3 people" (every name still read out): short enough for a tile. */
const lovedBy = (by: readonly string[]) =>
  by.length <= 2 ? (
    listNames(by)
  ) : (
    <>
      <span aria-hidden="true">{by.length} people</span>
      <span className="visually-hidden">Loved by {listNames(by)}</span>
    </>
  );

/** What people loved, from check-ins sent in this browser: posters and photos per slot, each opening its evening. */
export function LovedShelf({ shelf }: { shelf: Record<Slot, LovedItem[]> }) {
  const any = SLOTS.some((s) => shelf[s].length > 0);
  return (
    <section className="card loved" aria-labelledby="loved-title">
      <SectionHeader icon="heart" id="loved-title" title="Loved" info={<InfoTip label="What Loved means">{EXPLAIN.loved}</InfoTip>} />
      {any ? (
        SLOTS.filter((s) => shelf[s].length > 0).map((slot) => {
          const items = shelf[slot];
          return (
            <section key={slot} className="loved__shelf" aria-labelledby={`loved-${slot}`}>
              <h3 id={`loved-${slot}`} className="loved__title">
                <Icon name={SLOT_ICON[slot]} size={16} />
                {SHELF_LABEL[slot]}
                <span className="muted num">{items.length}</span>
              </h3>
              <ul className="loved__row">
                {items.slice(0, SHOWN).map((item) => (
                  <li key={item.pick.id}>
                    <Poster
                      slot={slot}
                      name={item.pick.name}
                      imageUrl={item.pick.imageUrl}
                      showSlot={false}
                      href={`/t/${item.truceId}?tab=decision`}
                      meta={[lovedBy(item.by), item.evenings > 1 ? `${item.evenings} evenings` : dayMonth(item.at)]}
                    />
                  </li>
                ))}
              </ul>
              {items.length > SHOWN && <p className="small muted">And {items.length - SHOWN} more.</p>}
            </section>
          );
        })
      ) : (
        <p className="loved__none icon-line small muted">
          <Icon name="heart" size={16} />
          Nothing loved yet. Check in after an evening.
        </p>
      )}
    </section>
  );
}
