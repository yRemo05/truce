import type { PerSide, Side } from '@contract';

/** Pass-the-phone mode travels in the URL, so a refresh keeps it. */
const PASS = 'pass';

export const isPassMode = (search: string) => new URLSearchParams(search).get('play') === PASS;
export const withPass = (path: string, pass: boolean) => (pass ? `${path}?play=${PASS}` : path);

/** `?all` on a side page: the whole form, favourites too, even when only tonight's questions are due. */
const ALL = 'all';

export const wantsAll = (search: string) => new URLSearchParams(search).has(ALL);
export const withAll = (path: string) => `${path}${path.includes('?') ? '&' : '?'}${ALL}`;

/** Who picks next on a shared phone: the first person after `side`, in seat order, who isn't ready. */
export function nextUp(members: readonly Side[], ready: PerSide<boolean>, side: Side): Side | null {
  const i = members.indexOf(side);
  const order = [...members.slice(i + 1), ...members.slice(0, i)];
  return order.find((s) => !ready[s]) ?? null;
}
