/**
 * The planned evening as a calendar event (RFC 5545): tonight 19:00–23:00 in
 * the restaurant's own time zone, written in UTC so every calendar app reads
 * it the same, with the restaurant as the location and the film and music
 * (and their links) in the notes.
 */
import type { CardItem, Tonight } from '../contract';
import { SLOTS, type Slot } from '../truce/types';

const START = 19;
const END = 23;

/** The UTC instant of a wall-clock hour on a date in a time zone. */
export function zonedHourToUtc(date: string, hour: number, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, hour);
  // The zone's offset at that moment: what its clock shows, minus UTC.
  const offsetAt = (t: number) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(t));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - t;
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);
  return new Date(t);
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Escapes a TEXT value: backslash, semicolon, comma and newlines. */
const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');

/** Folds a content line at 74 characters, continuation lines starting with a space. */
function fold(line: string): string {
  const out: string[] = [];
  for (let rest = line; rest.length; rest = rest.slice(74)) out.push((out.length ? ' ' : '') + rest.slice(0, 74));
  return out.join('\r\n');
}

const LABEL: Record<Slot, string> = { film: 'Film', restaurant: 'Restaurant', music: 'Music' };

export function eveningIcs(args: { truceId: string; tonight: Tonight; items: Record<Slot, CardItem>; host: string }): string {
  const { truceId, tonight, items } = args;
  const start = zonedHourToUtc(tonight.date, START, tonight.timeZone);
  const end = zonedHourToUtc(tonight.date, END, tonight.timeZone);
  const place = items.restaurant;
  const notes = SLOTS.map((s) => {
    const item = items[s];
    const link = item.links.find((l) => l.kind !== 'phone');
    return `${LABEL[s]}: ${item.name}${link ? ` (${link.url})` : ''}`;
  }).join('\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Truce//Evening//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${truceId}@${args.host}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escapeText(`Tonight: ${items.film.name} · ${place.name} · ${items.music.name}`)}`,
    `LOCATION:${escapeText([place.name, place.address].filter(Boolean).join(', '))}`,
    `DESCRIPTION:${escapeText(`${notes}\n\nPlanned with Truce.`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
