const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

export const dayMonth = (d: Date | string) => shortDate.format(new Date(d));

const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
export const spelled = (n: number) => NUMBERS[n] ?? String(n);

export const capitalise = (s: string) => (s ? s[0]!.toLocaleUpperCase() + s.slice(1) : s);

const monthFormat = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' });

/** "Wednesday 22 October", from a YYYY-MM-DD date and its weekday in the evening's own city. */
export const eveningLabel = (date: string, weekday: string) =>
  `${capitalise(weekday)} ${Number(date.slice(8))} ${monthFormat.format(new Date(`${date}T12:00:00Z`))}`;

const relative = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });

/** "just now", "5 min ago", "yesterday", "3 days ago", else the date. */
export function timeAgo(d: Date | string, now = Date.now()): string {
  const minutes = Math.round((now - new Date(d).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return relative.format(-hours, 'hour');
  const days = Math.round(hours / 24);
  return days < 7 ? relative.format(-days, 'day') : dayMonth(d);
}
