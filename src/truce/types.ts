/**
 * The vocabulary of a truce: three slots make an evening, two sides
 * negotiate it, and a bundle is one pick per slot.
 */
import type { SlotKind } from '../qloo/queries';

export const SLOTS = ['film', 'restaurant', 'music'] as const;
export type Slot = (typeof SLOTS)[number];

export const KIND_OF_SLOT: Record<Slot, SlotKind> = {
  film: 'movie',
  restaurant: 'place',
  music: 'artist',
};

export type Side = 'a' | 'b';
export const other = (side: Side): Side => (side === 'a' ? 'b' : 'a');

/** One entity id per slot. */
export type Bundle = Record<Slot, string>;

/** How much each slot matters to one person tonight; sums to 1. */
export type Weights = Record<Slot, number>;

/** Per slot, per entity id: how much one person likes it, 0–1 within the pool. */
export type Utilities = Record<Slot, Record<string, number>>;

export const bundleKey = (b: Bundle) => SLOTS.map((s) => b[s]).join('|');
export const sameBundle = (x: Bundle, y: Bundle) => SLOTS.every((s) => x[s] === y[s]);
