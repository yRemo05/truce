/**
 * Swaps: changing one item of a decided evening without undoing its fairness.
 *
 * Someone asks for a slot to change. If the referee has nothing fair to put
 * in, they're told at once (and offered a replan) instead of a vote that
 * can't change anything. Otherwise every request goes to the group: a
 * strict majority, the asker included, must be OK with an alternative they
 * don't see beforehand. A fact (the place is booked, the film can't be
 * watched) is voted on too, so "it can't happen" can't stand in for a taste
 * the asker has no swap left for. Whoever is silent when the vote closes is
 * answered for by their agent: on a taste it knows its person's scores; on a
 * fact it can't check, so it trusts the asker (the person had the whole vote
 * to say otherwise).
 *
 * The referee, not the asker, picks the replacement: of the items left in
 * that slot, one that keeps everyone at or above their minimum (the fair
 * evening's utility less the referee's margin, as in the talks), items an
 * agent argued for in the talks first, then the fairest by the truce's
 * weighted Nash product. So a swap can't quietly favour anyone, and every
 * voter can be promised they won't end up below their minimum. Everything
 * here works on the scores the truce already has: no Qloo or model calls.
 */
import { floorOf } from './bargain';
import { SLOTS, at, perSide, type Bundle, type PerSide, type Side, type Slot, type Weights } from './types';

/** How long a vote stays open before the agents answer for anyone silent. */
export const VOTE_MINUTES = 10;
/** How much of their evening score (0–1) an agent lets its person lose and still say yes. */
export const AGENT_TOLERANCE = 0.05;
/** Taste swaps each person may ask for per evening; facts aren't limited this way. */
export const TASTE_SWAPS_PER_PERSON = 1;
/** Fact swaps each person may ask for per evening, each voted on. */
export const FACT_SWAPS_PER_PERSON = 3;
/** Requests of any kind per evening. */
export const REQUESTS_MAX = 12;

export type Reason = 'unavailable' | 'seen' | 'not_feeling';
export const isFact = (reason: Reason) => reason === 'unavailable';

/** Yes votes a group of n needs, the asker's included: a strict majority. */
export const majority = (n: number) => Math.floor(n / 2) + 1;

/** What the referee knows about a decided evening; all of it comes from the truce itself. */
export interface Evening {
  members: Side[];
  weights: PerSide<Weights>;
  /** This truce's bargaining weights. */
  alpha: PerSide<number>;
  /** Each person's menu utility (0–1) for every pool item, by slot and id: what the agents and the referee used. */
  utilities: PerSide<Record<Slot, Record<string, number>>>;
  /** Every pool item's id, by slot. */
  items: Record<Slot, string[]>;
  /** Each person's utility for the fair evening (the referee's own pick), exact: minimums come from it, as in the talks. */
  fair: PerSide<number>;
  /** The fair evening itself, to compare with on the menu scale. */
  fairBundle: Bundle;
  /** Items some agent put in an offer during the talks, by slot. */
  talked: Record<Slot, Set<string>>;
}

export const minimumOf = (e: Evening, side: Side) => floorOf(at(e.fair, side));

/** A person's utility for an evening, 0–1: their weights over their item scores. */
export function eveningUtility(e: Evening, side: Side, bundle: Bundle): number {
  const u = at(e.utilities, side);
  const w = at(e.weights, side);
  return SLOTS.reduce((t, s) => t + w[s] * (u[s][bundle[s]] ?? 0), 0);
}

export const scoresOf = (e: Evening, bundle: Bundle) => perSide(e.members, (s) => Math.round(eveningUtility(e, s, bundle) * 100));

export interface Alternative {
  id: string;
  /** Everyone's evening utility with it in place. */
  u: PerSide<number>;
  /** Only when the item can't happen and nothing left kept everyone above their minimum. */
  belowMinimum: boolean;
}

const EPS = 1e-6;
const nash = (e: Evening, u: PerSide<number>) => e.members.reduce((v, s) => v + at(e.alpha, s) * Math.log(at(u, s) + EPS), 0);

/**
 * The referee's replacement for `slot`, or null when none is left. Candidates
 * are the slot's other items, minus any swapped away (`removed`). Those that
 * keep everyone at or above their minimum come first, items argued for in the
 * talks before the rest, then the fairest. When the item can't happen
 * (`mustChange`) and no candidate keeps everyone above their minimum, the
 * fairest one left is taken anyway: keeping the item isn't possible, and the
 * ledger makes it up to whoever loses.
 *
 * On a taste swap the `asker`'s own minimum doesn't count: giving the item up
 * is their choice, and what it costs them goes to the ledger as ground given.
 * Their scores still weigh in the fairness, and the new item has to fit them
 * at all (a score above zero), or the swap would give them nothing.
 */
export function fairAlternative(
  e: Evening,
  bundle: Bundle,
  slot: Slot,
  removed: ReadonlySet<string>,
  mustChange: boolean,
  asker: Side | null = null,
): Alternative | null {
  const options = e.items[slot]
    .filter((id) => id !== bundle[slot] && !removed.has(id))
    .map((id) => {
      const next = { ...bundle, [slot]: id };
      const u = perSide(e.members, (s) => eveningUtility(e, s, next));
      return { id, u, value: nash(e, u), talked: e.talked[slot].has(id) };
    });
  const byFairness = (x: (typeof options)[number], y: (typeof options)[number]) => y.value - x.value;
  const keeps = (o: (typeof options)[number], s: Side) =>
    !mustChange && s === asker ? (at(e.utilities, s)[slot][o.id] ?? 0) > 0 : at(o.u, s) >= minimumOf(e, s) - 1e-9;
  const fair = options.filter((o) => e.members.every((s) => keeps(o, s))).sort((x, y) => Number(y.talked) - Number(x.talked) || byFairness(x, y));
  if (fair[0]) return { id: fair[0].id, u: fair[0].u, belowMinimum: false };
  if (!mustChange) return null;
  const any = [...options].sort(byFairness)[0];
  return any ? { id: any.id, u: any.u, belowMinimum: true } : null;
}

/** Why an agent answered as it did; the server turns these into words. */
export type AgentWhy = 'no_worse' | 'small_cost' | 'too_costly' | 'nothing_fair' | 'fair_share' | 'ahead' | 'trusts';

/**
 * An agent's answer for a person who didn't vote. On a swap it knows what the
 * referee would put in (the person doesn't), and says yes when that costs its
 * person at most AGENT_TOLERANCE of their evening. On a fact it says yes: it
 * can't tell whether the place is booked, and its person was asked. On a
 * replan, which throws the whole evening open, it says yes unless its person
 * is doing better than the fair evening would give them.
 */
export function agentVote(
  e: Evening,
  kind: 'swap' | 'replan',
  side: Side,
  bundle: Bundle,
  alternative: Alternative | null,
  fact = false,
): { vote: 'yes' | 'no'; why: AgentWhy } {
  if (kind === 'swap' && fact) return { vote: 'yes', why: 'trusts' };
  const now = eveningUtility(e, side, bundle);
  if (kind === 'replan') {
    // Both on the menu scale: the stored fair utility is exact and could differ by a rounding.
    return now <= eveningUtility(e, side, e.fairBundle) + 1e-9 ? { vote: 'yes', why: 'fair_share' } : { vote: 'no', why: 'ahead' };
  }
  if (!alternative) return { vote: 'no', why: 'nothing_fair' };
  const then = at(alternative.u, side);
  if (then >= now - 1e-9) return { vote: 'yes', why: 'no_worse' };
  return then >= now - AGENT_TOLERANCE ? { vote: 'yes', why: 'small_cost' } : { vote: 'no', why: 'too_costly' };
}

/** Where a vote stands: passed once enough said yes, failed once the rest can't get it there. */
export function tally(members: readonly Side[], votes: PerSide<'yes' | 'no'>, needed: number): 'passed' | 'failed' | 'open' {
  const yes = members.filter((s) => votes[s] === 'yes').length;
  const pending = members.filter((s) => votes[s] === undefined).length;
  if (yes >= needed) return 'passed';
  return yes + pending < needed ? 'failed' : 'open';
}
