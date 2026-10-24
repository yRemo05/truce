import type { CardItem } from '@contract';
import { cx, Icon } from '@/ui';
import { ratingLine } from '@/lib/plan';
import { useTruceCtx } from './context';

const count = new Intl.NumberFormat('en-GB');

/**
 * A restaurant's standing, as small facts on one quiet line: "★ 4.5
 * Tripadvisor · 13,365 reviews", "Michelin Guide", "Books for 4" (or, quieter,
 * "Resy doesn't book for 5"). Nothing when Qloo knows none of it. `compact`
 * (the options list) drops the review count.
 */
export function Venue({ item, compact = false }: { item: CardItem; compact?: boolean }) {
  const { members } = useTruceCtx();
  const venue = item.venue;
  if (!venue || (!venue.rating && !venue.michelin && venue.fitsGroup === null)) return null;
  const size = members.length;
  const { rating } = venue;
  return (
    <ul className={cx('venue', compact ? 'venue--compact' : 'small')} aria-label={`About ${item.name}`}>
      {rating && (
        <li className="venue__fact">
          <Icon name="star" size={16} className="venue__star" />
          <span>
            {ratingLine(rating)}
            {!compact && rating.count !== null && <span className="muted"> · {count.format(rating.count)} reviews</span>}
          </span>
        </li>
      )}
      {venue.michelin && (
        <li className="venue__fact">
          <Icon name="award" size={16} className="venue__icon" />
          <span>Michelin Guide</span>
        </li>
      )}
      {venue.fitsGroup === true && (
        <li className="venue__fact">
          <Icon name="users" size={16} className="venue__icon" />
          <span>Books for {size}</span>
        </li>
      )}
      {venue.fitsGroup === false && (
        <li className="venue__fact muted">
          <Icon name="users" size={16} />
          <span>Resy doesn’t book for {size}</span>
        </li>
      )}
    </ul>
  );
}
