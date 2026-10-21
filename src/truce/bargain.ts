/**
 * The referee's maths: every possible evening, the fair one, and how far each
 * agent may give ground at each turn.
 *
 * The fair evening is the weighted Nash bargaining solution: the bundle that
 * maximises Σ α_i·ln U_i over the people taking part. With equal weights it
 * favours evenings everyone likes over evenings one person loves; the ledger
 * moves the α to give whoever gave ground last time more pull.
 *
 * The agents never see this bundle. Each has a private reservation level
 * that starts at its best evening and falls toward its share of the fair
 * one over the turns, so they walk toward fairness by their own route and
 * cannot be talked below it.
 */
import { tiltSpan } from './ledger';
import { SLOTS, at, type Bundle, type PerSide, type Side, type Slot, type Utilities, type Weights } from './types';
import { bundleUtility } from './utility';

export interface Scored {
  bundle: Bundle;
  /** Each member's utility for the bundle, 0–1. */
  u: PerSide<number>;
}

/** Every bundle that picks one item per slot from the pools. */
export function enumerateBundles(pools: Record<Slot, readonly string[]>): Bundle[] {
  let partial: Partial<Bundle>[] = [{}];
  for (const s of SLOTS) partial = partial.flatMap((p) => pools[s].map((id) => ({ ...p, [s]: id })));
  return partial as Bundle[];
}

export function scoreBundles(
  bundles: readonly Bundle[],
  members: readonly Side[],
  people: PerSide<{ utilities: Utilities; weights: Weights }>,
): Scored[] {
  return bundles.map((bundle) => {
    const u: PerSide<number> = {};
    for (const s of members) {
      const p = at(people, s);
      u[s] = bundleUtility(p.utilities, p.weights, bundle);
    }
    return { bundle, u };
  });
}

const EPS = 1e-6;
const total = (x: Scored, members: readonly Side[]) => members.reduce((t, s) => t + at(x.u, s), 0);

/** The weighted Nash bundle. Ties go to the larger total utility, then to enumeration order. */
export function nashBundle(scored: readonly Scored[], members: readonly Side[], alpha: PerSide<number>): Scored {
  if (!scored.length) throw new Error('nashBundle: no bundles');
  const value = (x: Scored) => members.reduce((v, s) => v + at(alpha, s) * Math.log(at(x.u, s) + EPS), 0);
  let best = scored[0]!;
  let bestValue = value(best);
  for (const x of scored) {
    const v = value(x);
    if (v - bestValue > 1e-12 || (Math.abs(v - bestValue) <= 1e-12 && total(x, members) > total(best, members))) {
      best = x;
      bestValue = v;
    }
  }
  return best;
}

const dominates = (x: Scored, y: Scored, members: readonly Side[]) =>
  members.every((s) => at(x.u, s) >= at(y.u, s) - 1e-12) && total(x, members) > total(y, members) + 1e-9;

/** The bundles no other bundle beats for everyone at once. */
export function paretoFrontier(scored: readonly Scored[], members: readonly Side[]): Scored[] {
  return scored.filter((x) => !scored.some((y) => dominates(y, x, members)));
}

/** The bundle everyone likes at least as much as `offer`, someone strictly more, with the most total utility; null if none. */
export function betterForAll(scored: readonly Scored[], offer: Scored, members: readonly Side[]): Scored | null {
  let best: Scored | null = null;
  for (const x of scored) {
    if (dominates(x, offer, members) && (!best || total(x, members) > total(best, members))) best = x;
  }
  return best;
}

/**
 * How eagerly a side concedes, from its bargaining weight among `n` people:
 * 1 at the even weight 1/n, below 1 (holds out, "Boulware") when the ledger
 * favours it, above 1 (gives ground early) when it favours the others.
 */
export function eagerness(alpha: number, n: number): number {
  return 2 ** ((1 / n - alpha) / tiltSpan(n));
}

/**
 * The lowest utility a side may accept at `turn` of `turns` (1-based):
 * R(t) = best − (best − floor)·(t/T)^(1/e), from its best evening down to
 * `floor` on the last turn.
 */
export function reservation(args: { turn: number; turns: number; best: number; floor: number; eagerness: number }): number {
  const { turn, turns, best, floor, eagerness: e } = args;
  const progress = Math.min(Math.max(turn / turns, 0), 1);
  return best - (best - floor) * progress ** (1 / e);
}

/**
 * A side's floor: its utility in the fair bundle, minus a margin. The margin
 * is the room for a real deal: with no margin the only evening everyone may
 * accept is the referee's own ruling, and nobody has a reason to agree (seen
 * in live runs at 0.03). Deals inside the margin favour someone a little;
 * the ledger evens that out over the next truces.
 */
export const FLOOR_MARGIN = 0.1;
export function floorOf(fairUtility: number): number {
  return Math.max(0, fairUtility - FLOOR_MARGIN);
}
