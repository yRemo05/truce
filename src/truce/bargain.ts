/**
 * The referee's maths: every possible evening, the fair one, and how far each
 * agent may give ground at each turn.
 *
 * The fair evening is the weighted Nash bargaining solution: the bundle that
 * maximises α_A·ln U_A + α_B·ln U_B. With equal weights it favours evenings
 * both people like over evenings one person loves; the ledger moves α to give
 * whoever gave ground last time more pull.
 *
 * The agents never see this bundle. Each has a private reservation level
 * that starts at its best evening and falls toward its share of the fair
 * one over the turns, so they walk toward fairness by their own route and
 * cannot be talked below it.
 */
import { SLOTS, type Bundle, type Side, type Slot, type Utilities, type Weights } from './types';
import { bundleUtility } from './utility';

export interface Scored {
  bundle: Bundle;
  a: number;
  b: number;
}

/** Every bundle that picks one item per slot from the pools. */
export function enumerateBundles(pools: Record<Slot, readonly string[]>): Bundle[] {
  let partial: Partial<Bundle>[] = [{}];
  for (const s of SLOTS) partial = partial.flatMap((p) => pools[s].map((id) => ({ ...p, [s]: id })));
  return partial as Bundle[];
}

export function scoreBundles(
  bundles: readonly Bundle[],
  people: Record<Side, { utilities: Utilities; weights: Weights }>,
): Scored[] {
  return bundles.map((bundle) => ({
    bundle,
    a: bundleUtility(people.a.utilities, people.a.weights, bundle),
    b: bundleUtility(people.b.utilities, people.b.weights, bundle),
  }));
}

const EPS = 1e-6;

/** The weighted Nash bundle. Ties go to the larger joint utility, then to enumeration order. */
export function nashBundle(scored: readonly Scored[], alphaA: number): Scored {
  if (!scored.length) throw new Error('nashBundle: no bundles');
  const value = (x: Scored) => alphaA * Math.log(x.a + EPS) + (1 - alphaA) * Math.log(x.b + EPS);
  let best = scored[0]!;
  for (const x of scored) {
    const dv = value(x) - value(best);
    if (dv > 1e-12 || (Math.abs(dv) <= 1e-12 && x.a + x.b > best.a + best.b)) best = x;
  }
  return best;
}

/** The bundles no other bundle beats for both people at once, sorted by A's utility. */
export function paretoFrontier(scored: readonly Scored[]): Scored[] {
  const sorted = [...scored].sort((x, y) => y.a - x.a || y.b - x.b);
  const frontier: Scored[] = [];
  let bestB = -Infinity;
  for (const x of sorted) {
    if (x.b > bestB + 1e-12) {
      frontier.push(x);
      bestB = x.b;
    }
  }
  return frontier;
}

/** A bundle both people like at least as much, and one of them strictly more, if any. */
export function betterForBoth(scored: readonly Scored[], offer: Scored): Scored | null {
  let best: Scored | null = null;
  for (const x of scored) {
    const dominates = x.a >= offer.a - 1e-12 && x.b >= offer.b - 1e-12 && x.a + x.b > offer.a + offer.b + 1e-9;
    if (dominates && (!best || x.a + x.b > best.a + best.b)) best = x;
  }
  return best;
}

/**
 * How eagerly a side concedes, from its bargaining weight: 1 at α = 0.5,
 * below 1 (holds out, "Boulware") when the ledger favours it, above 1
 * (gives ground early) when the ledger favours the other side.
 */
export function eagerness(alpha: number): number {
  return 2 ** ((0.5 - alpha) / 0.15);
}

/**
 * The lowest utility a side may accept at `turn` of `turns` (1-based):
 * R(t) = 1 − (1 − floor)·(t/T)^(1/e), from 1 (only its best evening) down to
 * `floor` on the last turn. `best` rescales the curve when a side's best
 * evening is worth less than 1 (an indifferent slot caps it).
 */
export function reservation(args: { turn: number; turns: number; best: number; floor: number; eagerness: number }): number {
  const { turn, turns, best, floor, eagerness: e } = args;
  const progress = Math.min(Math.max(turn / turns, 0), 1);
  return best - (best - floor) * progress ** (1 / e);
}

/** A side's floor: its utility in the fair bundle, minus a small margin so a deal near it can close. */
export const FLOOR_MARGIN = 0.03;
export function floorOf(fairUtility: number): number {
  return Math.max(0, fairUtility - FLOOR_MARGIN);
}
