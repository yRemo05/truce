/**
 * The vocabulary of a truce: three slots make an evening, two to four people
 * (sides a–d) negotiate it, and a bundle is one pick per slot.
 */
import type { SlotKind } from '../qloo/queries';

export const SLOTS = ['film', 'restaurant', 'music'] as const;
export type Slot = (typeof SLOTS)[number];

export const KIND_OF_SLOT: Record<Slot, SlotKind> = {
  film: 'movie',
  restaurant: 'place',
  music: 'artist',
};

export const SIDES = ['a', 'b', 'c', 'd'] as const;
export type Side = (typeof SIDES)[number];
export const MIN_PEOPLE = 2;
export const MAX_PEOPLE = 4;

/** One value per person taking part; the member list says which keys are there. */
export type PerSide<T> = Partial<Record<Side, T>>;

/** The sides of a group of `n` people, in order: a, b, … */
export const membersOf = (n: number): Side[] => SIDES.slice(0, n);

/** Builds a per-side map over the members. */
export function perSide<T>(members: readonly Side[], f: (side: Side) => T): PerSide<T> {
  const out: PerSide<T> = {};
  for (const s of members) out[s] = f(s);
  return out;
}

/** A member's value from a per-side map; a missing one is a bug, not a case to handle. */
export function at<T>(map: PerSide<T>, side: Side): T {
  const v = map[side];
  if (v === undefined) throw new Error(`no value for side "${side}"`);
  return v;
}

/** One entity id per slot. */
export type Bundle = Record<Slot, string>;

/** How much each slot matters to one person tonight; sums to 1. */
export type Weights = Record<Slot, number>;

/** Per slot, per entity id: how much one person likes it, 0–1 within the pool. */
export type Utilities = Record<Slot, Record<string, number>>;

export const bundleKey = (b: Bundle) => SLOTS.map((s) => b[s]).join('|');
export const sameBundle = (x: Bundle, y: Bundle) => SLOTS.every((s) => x[s] === y[s]);
