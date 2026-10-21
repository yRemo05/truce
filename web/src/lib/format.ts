const dateFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

export const longDate = (d: Date | string) => dateFormat.format(new Date(d));
export const dayMonth = (d: Date | string) => shortDate.format(new Date(d));

const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
export const spelled = (n: number) => NUMBERS[n] ?? String(n);

export const capitalise = (s: string) => (s ? s[0]!.toLocaleUpperCase() + s.slice(1) : s);
