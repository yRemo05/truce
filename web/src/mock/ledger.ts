/**
 * The fairness ledger, ported from the server (src/truce/ledger.ts) so the
 * mock's numbers behave the same: decayed balances around the group's mean,
 * weights that tilt by at most 2·0.15/n, and check-ins that count halfway
 * between Qloo's prediction and the person's own ratings.
 */
import type { PerSide, Rating, Side, Slot } from '@contract';
import { perSide } from '@/lib/people';
import { SLOTS } from '@/lib/truce';

const DECAY = 0.7;
const MAX_TILT = 0.15;
const TILT_SCALE = 0.3;
const span = (n: number) => (2 * MAX_TILT) / n;

const RATING_VALUE: Record<Rating, number> = { loved: 1, fine: 0.6, not_for_me: 0 };

const get = (m: PerSide<number>, s: Side) => m[s] ?? 0;

/** Oldest first. Per person: positive when they have conceded more than the group's average. */
export function balanceOf(concessions: readonly PerSide<number>[], members: readonly Side[]): PerSide<number> {
  const balance = perSide(members, () => 0);
  for (const c of concessions) {
    const mean = members.reduce((t, s) => t + get(c, s), 0) / members.length;
    for (const s of members) balance[s] = get(balance, s) * DECAY + (get(c, s) - mean);
  }
  return balance;
}

export function alphaOf(balance: PerSide<number>, members: readonly Side[]): PerSide<number> {
  const n = members.length;
  const raw = perSide(members, (s) => 1 / n + span(n) * Math.tanh((n * get(balance, s)) / TILT_SCALE));
  const sum = members.reduce((t, s) => t + get(raw, s), 0);
  return perSide(members, (s) => get(raw, s) / sum);
}

export function tiltOf(alpha: PerSide<number>, members: readonly Side[]): PerSide<number> {
  const n = members.length;
  return perSide(members, (s) => Math.max(-1, Math.min(1, (get(alpha, s) - 1 / n) / span(n))));
}

export function owedOf(balance: PerSide<number>, members: readonly Side[]): Side | null {
  let top: Side | null = null;
  for (const s of members) if (get(balance, s) > 0.01 && (top === null || get(balance, s) > get(balance, top))) top = s;
  return top;
}

/** What a person's evening was worth to them by their own ratings; an unrated slot stays as predicted. */
export function experienced(weights: Record<Slot, number>, predicted: Record<Slot, number>, ratings: Partial<Record<Slot, Rating>>): number {
  return SLOTS.reduce((t, s) => {
    const r = ratings[s];
    return t + weights[s] * (r ? RATING_VALUE[r] : predicted[s]);
  }, 0);
}

export const realised = (best: number, predicted: number, reported: number | null) =>
  Math.max(0, best - (reported === null ? predicted : (predicted + reported) / 2));
