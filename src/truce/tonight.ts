/**
 * "Tonight", where the evening happens: the date and weekday in the city's
 * own time zone, and whether a restaurant's opening hours cover the evening.
 *
 * Qloo gives a place's hours per weekday as periods ("17:00"–"01:00"); a
 * closing time at or before the opening time means past midnight. The
 * evening is 19:00–22:00 local: a restaurant counts as open tonight when one
 * of today's periods overlaps it, closed when none does (or today is marked
 * closed), and unknown when Qloo has no hours for today.
 */
import tzLookup from '@photostructure/tz-lookup';
import type { Hours } from '../qloo/schemas';

export interface Tonight {
  /** YYYY-MM-DD in the city's time zone. */
  date: string;
  /** Lower-case English weekday, as Qloo keys hours: "tuesday". */
  weekday: string;
  timeZone: string;
}

/** The evening, in minutes after local midnight. */
export const EVENING = { from: 19 * 60, to: 22 * 60 };

const FALLBACK_ZONE = 'UTC';

/** Today in the time zone at (lat, lon); the zone falls back to UTC if the lookup fails. */
export function tonightAt(lat: number, lon: number, now = new Date()): Tonight {
  let timeZone = FALLBACK_ZONE;
  try {
    timeZone = tzLookup(lat, lon);
  } catch {
    // Coordinates out of range: keep UTC.
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    weekday: part('weekday').toLowerCase(),
    timeZone,
  };
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export interface TonightHours {
  /** Today's periods as "17:00–01:00, …", or null when Qloo has no hours for today. */
  today: string | null;
  /** True when a period covers part of the evening; false when the place is closed for it; null when unknown. */
  openTonight: boolean | null;
}

export function hoursTonight(hours: Hours | null, weekday: string): TonightHours {
  if (!hours) return { today: null, openTonight: null };
  const periods = hours[weekday];
  if (!periods) return { today: null, openTonight: null };
  if (!periods.length) return { today: 'Closed', openTonight: false };
  const open = periods.some((p) => {
    const from = minutes(p.opens);
    let to = minutes(p.closes);
    if (to <= from) to += 24 * 60;
    return from < EVENING.to && to > EVENING.from;
  });
  return { today: periods.map((p) => `${p.opens}–${p.closes}`).join(', '), openTonight: open };
}
