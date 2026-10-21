/**
 * From Qloo affinities to one person's utilities.
 *
 * Qloo normalises affinity per query, so a person's scores compare with each
 * other (one shortlist query per person) but never with the other person's.
 * Each person's scores are therefore rescaled to 0–1 within each slot's
 * pool: their favourite in the pool is 1, their least favourite 0.
 *
 * When a person's scores over a pool barely differ (Qloo saw no taste signal
 * there, as with restaurants from film seeds alone), the slot is marked
 * indifferent: every item is worth 0.5 to them, which makes it the natural
 * slot to give away in a trade.
 */
import { SLOTS, type Bundle, type Slot, type Utilities, type Weights } from './types';

/** Below this affinity spread across a pool, a person has no real preference in it. */
export const INDIFFERENCE_SPREAD = 0.02;

export interface SlotScale {
  utilities: Record<string, number>;
  indifferent: boolean;
}

/**
 * Rescales one person's affinities over one slot's pool. Pool items Qloo left
 * unscored count as the person's least favourite.
 */
export function scaleSlot(
  pool: readonly string[],
  affinity: Readonly<Record<string, number>>,
  spreadFloor = INDIFFERENCE_SPREAD,
): SlotScale {
  const known = pool.map((id) => affinity[id]).filter((a): a is number => a !== undefined);
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  const utilities: Record<string, number> = {};
  if (!known.length || hi - lo < spreadFloor) {
    for (const id of pool) utilities[id] = 0.5;
    return { utilities, indifferent: true };
  }
  for (const id of pool) {
    const a = affinity[id];
    utilities[id] = a === undefined ? 0 : (a - lo) / (hi - lo);
  }
  return { utilities, indifferent: false };
}

/** Non-negative weights summing to 1; all-zero or invalid input falls back to equal. */
export function normalizeWeights(raw: Partial<Record<Slot, number>>): Weights {
  const clean = SLOTS.map((s) => {
    const w = raw[s];
    return typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : 0;
  });
  const total = clean.reduce((x, y) => x + y, 0);
  const equal = 1 / SLOTS.length;
  return Object.fromEntries(SLOTS.map((s, i) => [s, total > 0 ? clean[i]! / total : equal])) as Weights;
}

/** A person's utility for a whole evening: the weighted sum over slots. */
export function bundleUtility(u: Utilities, w: Weights, b: Bundle): number {
  let total = 0;
  for (const s of SLOTS) total += w[s] * (u[s][b[s]] ?? 0);
  return total;
}
