import type { Mode, Side } from '@contract';

export type Names = Record<Side, string>;

export const SIDES: readonly Side[] = ['a', 'b'];

/** "Maya's", "Jess's". */
export const possessive = (name: string) => `${name}\u2019s`;

/** "Maya's agent". */
export const agentOf = (name: string) => `${possessive(name)} agent`;

/** One letter each, or two when both names start alike. */
export function monograms(names: Names): Names {
  const first = (n: string) => Array.from(n.trim())[0]?.toLocaleUpperCase() ?? '?';
  const a = first(names.a);
  const b = first(names.b);
  if (a !== b) return { a, b };
  const two = (n: string) => {
    const chars = Array.from(n.trim());
    return (chars[0] ?? '?').toLocaleUpperCase() + (chars[1] ?? '').toLocaleLowerCase();
  };
  return { a: two(names.a), b: two(names.b) };
}

export const modeLabel = (mode: Mode) => (mode === 'couple' ? 'Couple' : 'Best friends');
