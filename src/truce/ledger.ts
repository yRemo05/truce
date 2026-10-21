/**
 * The fairness ledger: who gave ground, and how that tilts the next truce.
 *
 * A person's concession in one truce is how far the evening fell short of
 * their own best one (both on the 0–1 utility scale). Their balance sums how
 * far their concession sat above the group's average, over the group's
 * history, recent truces counting more (each older one by a further factor
 * λ). A positive balance means they have given more than their share, so the
 * next truce gives them more bargaining weight; as they get their way, the
 * balance drifts back toward zero. With two people this is exactly "A's
 * concessions minus B's", halved.
 *
 * The concession starts as predicted, from Qloo's scores. When someone says
 * how the evening actually went (the check-in), their realised value is the
 * average of the prediction and their own ratings, so an evening that
 * disappointed them counts as more ground given.
 */
import { SLOTS, at, perSide, type PerSide, type Side, type Slot, type Weights } from './types';

export interface LedgerEntry {
  /** One value per person who took part in that truce. */
  concession: PerSide<number>;
}

/** Each truce back in time counts this much less than the one after it. */
export const LEDGER_DECAY = 0.7;
/** With two people, the most the ledger can move a weight away from 0.5. */
export const MAX_TILT = 0.15;
/** With two people, a balance difference of this size moves the weight ~76% of the way to MAX_TILT. */
export const TILT_SCALE = 0.3;

/** The most the ledger can move one person's weight away from the even 1/n. */
export const tiltSpan = (n: number) => (2 * MAX_TILT) / n;

/** Oldest entry first. Per member: positive when they have conceded more than the group's average. */
export function ledgerBalance(entries: readonly LedgerEntry[], members: readonly Side[], decay = LEDGER_DECAY): PerSide<number> {
  const balance = perSide(members, () => 0);
  for (const e of entries) {
    const present = members.filter((s) => e.concession[s] !== undefined);
    const mean = present.reduce((t, s) => t + at(e.concession, s), 0) / Math.max(present.length, 1);
    for (const s of members) {
      const c = e.concession[s];
      balance[s] = at(balance, s) * decay + (c === undefined ? 0 : c - mean);
    }
  }
  return balance;
}

/** Each member's bargaining weight for the next truce; they sum to 1, and are all 1/n on an even ledger. */
export function alphaFromBalance(balance: PerSide<number>, members: readonly Side[]): PerSide<number> {
  const n = members.length;
  const raw = perSide(members, (s) => 1 / n + tiltSpan(n) * Math.tanh((n * at(balance, s)) / TILT_SCALE));
  const sum = members.reduce((t, s) => t + at(raw, s), 0);
  return perSide(members, (s) => at(raw, s) / sum);
}

/** Each weight on a −1…1 scale: −1 is the least say the ledger can give someone, 1 the most. */
export function tiltOf(alpha: PerSide<number>, members: readonly Side[]): PerSide<number> {
  const n = members.length;
  return perSide(members, (s) => Math.max(-1, Math.min(1, (at(alpha, s) - 1 / n) / tiltSpan(n))));
}

/** The person the ledger favours most, for display; null when everyone is within the dead zone. */
export function owed(balance: PerSide<number>, members: readonly Side[], deadZone = 0.01): Side | null {
  let top: Side | null = null;
  for (const s of members) if (at(balance, s) > deadZone && (top === null || at(balance, s) > at(balance, top))) top = s;
  return top;
}

export function concession(best: number, got: number): number {
  return Math.max(0, best - got);
}

/** How the check-in ratings translate to a 0–1 value for an item. */
export const RATING_VALUE = { loved: 1, fine: 0.6, not_for_me: 0 } as const;
export type Rating = keyof typeof RATING_VALUE;

/**
 * A person's experienced value of the evening: their weights over their
 * ratings, with an unrated slot standing at its predicted utility.
 */
export function experienced(weights: Weights, predicted: Record<Slot, number>, ratings: Partial<Record<Slot, Rating>>): number {
  let value = 0;
  for (const s of SLOTS) {
    const r = ratings[s];
    value += weights[s] * (r ? RATING_VALUE[r] : predicted[s]);
  }
  return value;
}

/** The concession the ledger counts: from the prediction alone, or halfway to what the person reported. */
export function realisedConcession(best: number, predicted: number, reported: number | null): number {
  return concession(best, reported === null ? predicted : (predicted + reported) / 2);
}
