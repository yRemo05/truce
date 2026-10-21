/**
 * The fairness ledger: who gave ground, and how that tilts the next truce.
 *
 * A side's concession in one truce is how far the agreed evening fell short
 * of its own best one (both on the 0–1 utility scale). The balance sums the
 * difference A − B over the pair's history, recent truces counting more
 * (each older one by a further factor λ). A positive balance means A has
 * given more, so the next truce gives A more bargaining weight; as A gets
 * its way, the balance drifts back toward zero.
 */

export interface LedgerEntry {
  concessionA: number;
  concessionB: number;
}

/** Each truce back in time counts this much less than the one after it. */
export const LEDGER_DECAY = 0.7;
/** The most the ledger can move a side's bargaining weight away from 0.5. */
export const MAX_TILT = 0.15;
/** A balance of this size moves the weight ~76% of the way to MAX_TILT. */
export const TILT_SCALE = 0.3;

/** Oldest entry first. Positive: A has conceded more; negative: B has. */
export function ledgerBalance(entries: readonly LedgerEntry[], decay = LEDGER_DECAY): number {
  let balance = 0;
  for (const e of entries) balance = balance * decay + (e.concessionA - e.concessionB);
  return balance;
}

/** A's bargaining weight α_A for the next truce; B's is 1 − α_A. */
export function alphaFromBalance(balance: number): number {
  return 0.5 + MAX_TILT * Math.tanh(balance / TILT_SCALE);
}

export function concession(best: number, got: number): number {
  return Math.max(0, best - got);
}

/** Who the ledger currently favours, for display; null when it is even. */
export function owed(balance: number, deadZone = 0.02): 'a' | 'b' | null {
  if (balance > deadZone) return 'a';
  if (balance < -deadZone) return 'b';
  return null;
}
