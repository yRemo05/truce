import type { Mode, PerSide, Side } from '@contract';

/** Everyone's first name, per side. Only the members' keys are present. */
export type Names = PerSide<string>;

const SIDES: readonly Side[] = ['a', 'b', 'c', 'd'];
export const MIN_PEOPLE = 2;
export const MAX_PEOPLE = 4;

/** The sides of a group of `n` people, in order. */
export const membersOf = (n: number): Side[] => SIDES.slice(0, n);
export const isSide = (s: string): s is Side => (SIDES as readonly string[]).includes(s);

/** A member's name; an empty string for a side that isn't in the group. */
export const nameOf = (names: Names, side: Side) => names[side] ?? '';

/** A value per member. */
export function perSide<T>(members: readonly Side[], f: (side: Side) => T): PerSide<T> {
  const out: PerSide<T> = {};
  for (const s of members) out[s] = f(s);
  return out;
}

/** "Maya's", "Jess's". */
export const possessive = (name: string) => `${name}’s`;

/** "Maya's agent". */
export const agentOf = (name: string) => `${possessive(name)} agent`;

/** "Maya", "Maya and Deniz", "Ömer, Ecrin and Lina". */
export function listNames(list: readonly string[]): string {
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/** Everyone's names in seat order, as one phrase. */
export const groupNames = (names: Names, members: readonly Side[]) => listNames(members.map((s) => nameOf(names, s)));

/** One letter each, or two for people whose names start alike. */
export function monograms(names: Names, members: readonly Side[]): Names {
  const chars = (s: Side) => Array.from(nameOf(names, s).trim());
  const first = (s: Side) => chars(s)[0]?.toLocaleUpperCase() ?? '?';
  return perSide(members, (s) => {
    const clash = members.some((o) => o !== s && first(o) === first(s));
    return clash ? first(s) + (chars(s)[1] ?? '').toLocaleLowerCase() : first(s);
  });
}

export const modeLabel = (mode: Mode) => (mode === 'couple' ? 'Couple' : 'Friends');
