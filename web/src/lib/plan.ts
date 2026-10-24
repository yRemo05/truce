import type { CardItem, Tonight } from '@contract';
import { eveningLabel } from './format';
import { SLOT_LABEL } from './truce';

/** Booking links, in the order the server gives them: they come first among a restaurant's links. */
export const isBooking = (kind: CardItem['links'][number]['kind']) => kind === 'resy' || kind === 'opentable';

/** "4.5 Tripadvisor", or "4.4 rating" for Qloo's own business rating. */
export function ratingLine(rating: NonNullable<NonNullable<CardItem['venue']>['rating']>): string {
  const value = rating.value.toFixed(1);
  return rating.source ? `${value} ${rating.source}` : `${value} rating`;
}

/** One pick's lines: what it is, then for a restaurant where and when, then where to act on it. */
function itemLines(item: CardItem): string[] {
  const detail = item.slot === 'restaurant' ? (item.facts.neighborhood ?? null) : item.disambiguation;
  const lines = [`${SLOT_LABEL[item.slot]}: ${item.name}${detail && detail !== item.name ? ` (${detail})` : ''}`];
  if (item.slot === 'restaurant') {
    const where = item.address ?? (item.disambiguation !== detail ? item.disambiguation : null);
    if (where) lines.push(`  ${where}`);
    if (item.hours?.openTonight === false) lines.push(`  May be closed tonight${item.hours.today ? ` (listed hours today: ${item.hours.today})` : ''}`);
    else if (item.hours?.today) lines.push(`  Open today ${item.hours.today}`);
    if (item.venue?.rating) lines.push(`  ${ratingLine(item.venue.rating)}${item.venue.michelin ? ' · Michelin Guide' : ''}`);
    else if (item.venue?.michelin) lines.push('  Michelin Guide');
  }
  for (const link of item.links) {
    lines.push(link.kind === 'phone' ? `  Phone: ${link.url.replace(/^tel:/, '')}` : `  ${link.label}: ${link.url}`);
  }
  return lines;
}

/**
 * The evening as plain text, to share or paste anywhere: the date, each pick
 * with its details and links, and the plan's own address last when given
 * (a share sheet takes the address on its own, so it isn't sent twice).
 */
export function planText({ who, tonight, location, items, url }: { who: string; tonight: Tonight | null; location: string; items: CardItem[]; url: string | null }): string {
  const when = [tonight && eveningLabel(tonight.date, tonight.weekday), location].filter(Boolean).join(' · ');
  const lines = [`Tonight’s plan for ${who}`, when, '', ...items.flatMap((i) => [...itemLines(i), ''])];
  return (url ? [...lines, `The whole plan: ${url}`] : lines).join('\n').trimEnd();
}
