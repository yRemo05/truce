import type { CardItem, LinkKind, Slot } from '@contract';
import type { CSSProperties, ReactNode } from 'react';
import { cx, Icon, Thumb, type IconName } from '@/ui';
import { SLOT_ICON, SLOT_LABEL } from '@/lib/truce';
import { Hours } from './Hours';
import { ScoreRow } from './ScoreRow';
import { Serves } from './Serves';

/** The first few items of a comma-separated Qloo list. */
const firstOf = (list: string | undefined, n = 2) =>
  list
    ?.split(',')
    .slice(0, n)
    .map((s) => s.trim())
    .join(', ');

/** The line under each pick's name. */
const DETAIL: Record<Slot, (item: CardItem) => (string | null | undefined)[]> = {
  film: (i) => [i.disambiguation, firstOf(i.facts.genres), i.facts.minutes && `${i.facts.minutes} min`],
  restaurant: (i) => [i.facts.cuisineType, i.facts.price],
  music: (i) => [firstOf(i.facts.genres) ?? i.disambiguation],
};

const LINK_ICON: Record<LinkKind, IconName> = {
  imdb: 'film',
  letterboxd: 'film',
  netflix: 'play',
  spotify: 'music',
  maps: 'pin',
  website: 'link',
  menu: 'restaurant',
  phone: 'phone',
};

/** Where to act on a pick: watch, listen, find, book. */
function Links({ item }: { item: CardItem }) {
  if (!item.links.length) return null;
  return (
    <ul className="act-links" aria-label={`Links for ${item.name}`}>
      {item.links.map((l) => (
        <li key={l.url}>
          <a className="btn btn--outline btn--sm" href={l.url} {...(l.kind === 'phone' ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>
            <Icon name={LINK_ICON[l.kind]} size={16} />
            <span className="btn__label">{l.label}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Where a restaurant is: its neighbourhood, then the street address. */
function Where({ item }: { item: CardItem }) {
  if (item.slot !== 'restaurant') return null;
  const area = item.facts.neighborhood;
  const address = item.address ?? item.disambiguation;
  if (!area && !address) return null;
  return (
    <p className="icon-line icon-line--text small">
      <Icon name="pin" size={16} className="muted" />
      <span>
        {area}
        {area && address && address !== area && <span className="muted"> · </span>}
        {address && address !== area && <span className="muted">{address}</span>}
      </span>
    </p>
  );
}

interface PlanRowProps {
  item: CardItem;
  /** Badges beside the slot's name: "Swapped", "Vote open". */
  status?: ReactNode;
  /** The row's own action, at its end: Swap. */
  action?: ReactNode;
  /** Explain the fit scores; the first row does, so the ⓘ shows once. */
  explain: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * One item of the evening as a full-width row: what it is and how it fits
 * everyone on the left, where and how to act on it on the right (stacked on
 * a phone), and the row's own action at its end.
 */
export function PlanRow({ item, status, action, explain, className, style }: PlanRowProps) {
  const detail = DETAIL[item.slot](item).filter(Boolean).join(' · ');
  return (
    <li className={cx('plan-row', className)} style={style}>
      <Thumb name={item.name} imageUrl={item.imageUrl} slot={item.slot} size="lg" className="plan-row__thumb" />
      <div className="plan-row__top">
        <p className="plan-row__kind small muted">
          <Icon name={SLOT_ICON[item.slot]} size={16} />
          {SLOT_LABEL[item.slot]}
        </p>
        {status}
        {action && <span className="plan-row__action">{action}</span>}
      </div>
      <div className="plan-row__what">
        <h3 className="plan-row__name">{item.name}</h3>
        {detail && <p className="small muted">{detail}</p>}
        <ScoreRow scores={item.scores} explain={explain} />
        <Serves item={item} />
      </div>
      <div className="plan-row__act">
        <Where item={item} />
        <Hours hours={item.hours} />
        <Links item={item} />
      </div>
    </li>
  );
}
