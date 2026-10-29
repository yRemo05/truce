import type { CardItem, Side, Slot } from '@contract';
import { cx, Icon } from '@/ui';
import { nameOf, type Names } from '@/lib/people';
import { SLOT_ICON, SLOT_LABEL, SLOTS } from '@/lib/truce';
import { Art } from './Art';

/** Each person's fit for one pick, one per line: the app's dot, name and score. */
export function Fits({ scores, members, names }: { scores: CardItem['scores']; members: readonly Side[]; names: Names }) {
  return (
    <ul className="l-fits small" aria-label="Qloo fit">
      {members.map((s) => (
        <li key={s} className={cx('scorerow__item', `p-${s}`)}>
          <span className="scorerow__dot" aria-hidden="true" />
          {nameOf(names, s)} <strong className="num">{scores[s] ?? 0}</strong>
        </li>
      ))}
    </ul>
  );
}

/** The evening as three pictures: film, restaurant, music, each with everyone's fit. */
export function PlanCards({ plan, members, names, eager = false, className }: { plan: Record<Slot, CardItem>; members: readonly Side[]; names: Names; eager?: boolean; className?: string }) {
  return (
    <ul className={cx('l-plan', className)}>
      {SLOTS.map((slot) => {
        const it = plan[slot];
        return (
          <li key={slot} className="l-plan__card">
            <Art name={it.name} imageUrl={it.imageUrl} slot={slot} width={400} height={500} eager={eager} />
            <p className="l-plan__kind">
              <Icon name={SLOT_ICON[slot]} size={16} />
              {SLOT_LABEL[slot]}
            </p>
            <p className="l-plan__name">{it.name}</p>
            <Fits scores={it.scores} members={members} names={names} />
          </li>
        );
      })}
    </ul>
  );
}
