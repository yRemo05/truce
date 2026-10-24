/**
 * Swaps on a decided evening: requests, votes, the agents' answers when a
 * vote closes, and a replan when nothing fair is left. The rules are in
 * truce/swap.ts; the shapes and endpoints in the contract.
 *
 * Swaps are kept apart from the truce's event log (which ends with the deal),
 * and change the stored result in place, so the plan, the calendar, check-ins
 * and the ledger all see the evening as it now stands. A vote closes on a
 * timer, and again on any read once its deadline has passed, so a restart
 * loses none.
 */
import type { CardItem, StreamEvent, SwapInput, SwapLock, SwapsView, SwapView, SwapVote, Tonight } from '../contract';
import { concession } from '../truce/ledger';
import {
  FACT_SWAPS_PER_PERSON,
  REQUESTS_MAX,
  TASTE_SWAPS_PER_PERSON,
  VOTE_MINUTES,
  agentVote,
  fairAlternative,
  isFact,
  majority,
  scoresOf,
  tally,
  type AgentWhy,
  type Evening,
} from '../truce/swap';
import { SLOTS, at, perSide, type Bundle, type PerSide, type Side, type Slot } from '../truce/types';
import type { PairRow, Store, SwapRow, TruceRow } from './db';
import { AVOIDED_MAX, newId, pairLedger, UserFacingError, type Runner } from './runner';

const SLOT_WORD: Record<Slot, string> = { film: 'film', restaurant: 'restaurant', music: 'music pick' };

const LOCKED: Record<Exclude<SwapLock, 'open'>, string> = {
  not_done: "This evening isn't decided yet.",
  history: "This earlier evening can't be changed.",
  replanned: 'This evening was planned again. Swap on the new plan instead.',
  superseded: 'The group has planned a newer evening since, so this one stays as it was.',
  checked_in: 'Someone already checked in, so this evening is settled.',
  past: 'This evening has passed.',
};

function agentWords(why: AgentWhy, name: string, slot: Slot | null, item: string | null, asker: string): string {
  const what = slot ? SLOT_WORD[slot] : 'evening';
  switch (why) {
    case 'trusts':
      return `It can't check whether ${item ?? `the ${what}`} is off tonight, so it takes ${asker}'s word.`;
    case 'no_worse':
      return `The new ${what} suits ${name} as well or better.`;
    case 'small_cost':
      return `The new ${what} costs ${name} little.`;
    case 'too_costly':
      return `${item ?? `This ${what}`} matters to ${name} tonight.`;
    case 'nothing_fair':
      return `Nothing fair is left to swap in for ${name}.`;
    case 'fair_share':
      return `Tonight gives ${name} no more than a fair share.`;
    case 'ahead':
      return `Tonight already suits ${name} better than a fair share.`;
  }
}

type Pool = Extract<StreamEvent, { type: 'pool' }>;
const poolOf = (truce: TruceRow) => truce.events.find((e): e is Pool => e.type === 'pool') ?? null;

/** YYYY-MM-DD where the evening happens. */
const localDate = (timeZone: string, at: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

/** What the referee needs from a decided truce, or null when it isn't one it can change. */
export function eveningOf(truce: TruceRow, pair: PairRow): Evening | null {
  const pool = poolOf(truce);
  const r = truce.result;
  if (!pool || !r?.weights || !r.fair || !r.items) return null;
  const members = pair.members.filter((s) => r.utilities[s] !== undefined);
  const talked = Object.fromEntries(SLOTS.map((s) => [s, new Set<string>()])) as Record<Slot, Set<string>>;
  for (const e of truce.events) if (e.type === 'move') for (const s of SLOTS) talked[s].add(e.bundle[s]);
  return {
    members,
    weights: r.weights,
    alpha: truce.alpha,
    // Menu scores, as the agents and the referee used them in the talks.
    utilities: perSide(members, (side) =>
      Object.fromEntries(
        SLOTS.map((slot) => [slot, Object.fromEntries(pool.items[slot].map((i: CardItem) => [i.id, (i.scores[side] ?? 0) / 100]))]),
      ) as Record<Slot, Record<string, number>>,
    ),
    items: Object.fromEntries(SLOTS.map((s) => [s, pool.items[s].map((i: CardItem) => i.id)])) as Record<Slot, string[]>,
    fair: r.fair.u,
    fairBundle: r.fair.bundle,
    talked,
  };
}

const plainVotes = (votes: PerSide<SwapVote>) =>
  Object.fromEntries(Object.entries(votes).map(([s, v]) => [s, v!.vote])) as PerSide<'yes' | 'no'>;

/** Items the group swapped away from an evening, or wanted gone with nothing to put in: a replan leaves them out. */
export function swappedAway(swaps: readonly SwapRow[]): string[] {
  return [
    ...new Set(swaps.filter((s) => s.kind === 'swap' && s.from && (s.status === 'swapped' || s.status === 'no_alternative')).map((s) => s.from!.id)),
  ];
}

/**
 * Whether a replan may go ahead without a vote: the last settled swap was an
 * item that can't happen (a fact) with nothing left to put in its place, and
 * it is still in the plan.
 */
export function replanNow(swaps: readonly SwapRow[], bundle: Bundle | null): boolean {
  const last = [...swaps].reverse().find((s) => s.kind === 'swap' && s.status !== 'open' && s.status !== 'cancelled');
  return Boolean(
    bundle && last?.status === 'no_alternative' && last.reason === 'unavailable' && last.slot && last.from && bundle[last.slot] === last.from.id,
  );
}

export function toSwapView(s: SwapRow): SwapView {
  return {
    id: s.id,
    kind: s.kind,
    side: s.side,
    slot: s.slot,
    reason: s.reason,
    status: s.status,
    createdAt: s.createdAt,
    deadline: s.deadline,
    resolvedAt: s.resolvedAt,
    needed: s.needed,
    votes: s.votes,
    from: s.from,
    to: s.to,
    scores: s.scores,
    truceId: s.newTruce,
    cancelled: s.status === 'cancelled' ? (s.cancelReason ?? 'withdrawn') : null,
  };
}

export interface SwapsDeps {
  store: Store;
  runner: Runner;
  log?: (msg: string) => void;
  now?: () => number;
  /** How long votes stay open, in ms (VOTE_MINUTES by default). */
  voteMs?: number;
}

export function createSwaps(deps: SwapsDeps) {
  const { store, runner } = deps;
  const log = deps.log ?? ((m: string) => console.log(m));
  const now = deps.now ?? (() => Date.now());
  const voteMs = deps.voteMs ?? VOTE_MINUTES * 60_000;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const load = (truceId: string) => {
    const truce = store.truce(truceId);
    if (!truce) throw new UserFacingError('This truce does not exist.', 404, 'not_found');
    return { truce, pair: store.pair(truce.pairId)! };
  };

  const nameOf = (truce: TruceRow, slot: Slot, id: string) =>
    poolOf(truce)?.items[slot].find((i) => i.id === id)?.name ?? truce.evening?.[slot] ?? id;

  /** A newer truce (planning or planned, not failed) has taken this evening's place. */
  const superseded = (truce: TruceRow) =>
    store.trucesOf(truce.pairId).some((t) => !t.earlier && t.id !== truce.id && t.createdAt > truce.createdAt && t.status !== 'failed');

  function lockOf(truce: TruceRow, pair: PairRow, swaps: readonly SwapRow[]): SwapLock | null {
    if (truce.earlier) return 'history';
    if (truce.status !== 'done' || !truce.result) return 'not_done';
    if (!eveningOf(truce, pair)) return 'history';
    if (truce.replacedBy) return 'replanned';
    // Changing it now would rewrite the history a newer truce's weights came from.
    if (superseded(truce)) return 'superseded';
    if (store.checkinsOf(truce.id).length) return 'checked_in';
    const tonight: Tonight | undefined = poolOf(truce)?.tonight;
    if (tonight && localDate(tonight.timeZone, now()) > tonight.date) return 'past';
    if (swaps.some((s) => s.status === 'open')) return 'open';
    return null;
  }

  /** Adds a taste swap's item to the asker's avoided picks: they told the group they don't want it. */
  function learnDislike(swap: SwapRow, pair: PairRow) {
    if (swap.kind !== 'swap' || !swap.from || !swap.reason || isFact(swap.reason)) return;
    const learned = store.sides(pair.id)[swap.side]?.learned;
    if (!learned) return;
    learned.avoided = [swap.from, ...learned.avoided.filter((x) => x.id !== swap.from!.id)].slice(0, AVOIDED_MAX);
    store.setLearned(pair.id, swap.side, learned);
  }

  /** Puts the referee's replacement in, or records that there is none. */
  function swapIn(swap: SwapRow, truce: TruceRow, pair: PairRow) {
    const e = eveningOf(truce, pair)!;
    const r = truce.result!;
    const slot = swap.slot!;
    const removed = new Set(swappedAway(store.swapsOf(truce.id)));
    const alternative = fairAlternative(e, r.bundle, slot, removed, isFact(swap.reason!));
    if (!alternative) {
      if (store.resolveSwap(swap.id, 'no_alternative', { scores: swap.scores })) learnDislike(swap, pair);
      return;
    }
    const bundle = { ...r.bundle, [slot]: alternative.id };
    const to = { id: alternative.id, name: nameOf(truce, slot, alternative.id) };
    if (!store.resolveSwap(swap.id, 'swapped', { to, scores: { before: swap.scores!.before, after: scoresOf(e, bundle) } })) return;
    // Only the swapped slot changes: the other two keep the exact utilities the talks used.
    const items = perSide(e.members, (s) => ({ ...at(r.items, s), [slot]: at(e.utilities, s)[slot][alternative.id] ?? 0 }));
    const utilities = perSide(e.members, (s) => at(r.utilities, s) + at(r.weights, s)[slot] * (at(items, s)[slot] - at(r.items, s)[slot]));
    store.updateResult(
      truce.id,
      {
        ...r,
        bundle,
        utilities,
        concession: perSide(e.members, (s) => concession(at(r.best, s), at(utilities, s))),
        items,
      },
      { ...(truce.evening ?? ({} as Record<Slot, string>)), [slot]: to.name },
    );
    learnDislike(swap, pair);
    log(`truce ${truce.id}: ${slot} swapped (${swap.reason}) ${swap.from?.name} → ${to.name}${alternative.belowMinimum ? ' (below a minimum)' : ''}`);
  }

  /** Plans the evening again, without what was swapped away. */
  function replan(swap: SwapRow, truce: TruceRow, pair: PairRow) {
    if (store.runningTruceOf(pair.id)) {
      store.resolveSwap(swap.id, 'kept');
      throw new UserFacingError('A new truce is already being planned for this group.', 409, 'locked');
    }
    // Everything swapped away from this evening, and from any evening it replanned before.
    const exclude = new Set<string>();
    for (let t: string | null = truce.id, hops = 0; t && hops < 20; t = store.replacedOf(t), hops++) {
      for (const id of swappedAway(store.swapsOf(t))) exclude.add(id);
    }
    let id: string;
    try {
      id = runner.start(pair.id, { exclude: [...exclude], replaces: truce.id });
    } catch (err) {
      // Couldn't start (the server is at a limit): tonight stays as it is, and the request doesn't hang open.
      store.resolveSwap(swap.id, 'kept');
      throw err;
    }
    store.resolveSwap(swap.id, 'replanned', { newTruce: id });
    log(`truce ${truce.id}: replanned as ${id}`);
  }

  function decide(swap: SwapRow, truce: TruceRow, pair: PairRow, outcome: 'passed' | 'failed') {
    if (outcome === 'failed') {
      if (store.resolveSwap(swap.id, 'kept')) learnDislike(swap, pair);
      return;
    }
    if (swap.kind === 'replan') replan(swap, truce, pair);
    else swapIn(swap, truce, pair);
  }

  /** A vote's deadline: the agents answer for anyone silent, and the vote is settled. */
  function close(swapId: string) {
    timers.delete(swapId);
    const swap = store.swap(swapId);
    if (!swap || swap.status !== 'open') return;
    const { truce, pair } = load(swap.truceId);
    const e = eveningOf(truce, pair);
    if (!e || truce.replacedBy || superseded(truce)) {
      store.resolveSwap(swap.id, 'cancelled', { cancelReason: 'superseded' });
      return;
    }
    const bundle = truce.result!.bundle;
    const fact = swap.kind === 'swap' && isFact(swap.reason!);
    const alternative =
      swap.kind === 'swap' ? fairAlternative(e, bundle, swap.slot!, new Set(swappedAway(store.swapsOf(truce.id))), fact) : null;
    const votes = { ...swap.votes };
    for (const s of e.members) {
      if (votes[s]) continue;
      const answer = agentVote(e, swap.kind, s, bundle, alternative, fact);
      const why = agentWords(answer.why, at(pair.names, s), swap.slot, swap.from?.name ?? null, at(pair.names, swap.side));
      votes[s] = { vote: answer.vote, by: 'agent', why };
    }
    if (!store.setSwapVotes(swap.id, votes)) return;
    const outcome = tally(e.members, plainVotes(votes), swap.needed);
    try {
      decide({ ...swap, votes }, truce, pair, outcome === 'passed' ? 'passed' : 'failed');
    } catch (err) {
      log(`swap ${swap.id} could not be settled: ${(err as Error).message}`);
    }
  }

  function schedule(swap: SwapRow) {
    if (!swap.deadline || timers.has(swap.id)) return;
    const wait = Math.max(0, Date.parse(swap.deadline) - now());
    const timer = setTimeout(() => close(swap.id), wait);
    timer.unref?.();
    timers.set(swap.id, timer);
  }

  /**
   * Closes any vote of this truce whose deadline has passed (a timer may have
   * been lost to a restart), and calls off one whose evening a newer truce
   * has since taken over.
   */
  function sweep(truceId: string) {
    const truce = store.truce(truceId);
    if (!truce) return;
    const over = superseded(truce);
    for (const s of store.swapsOf(truceId)) {
      if (s.status !== 'open') continue;
      if (over) store.resolveSwap(s.id, 'cancelled', { cancelReason: 'superseded' });
      else if (s.deadline && Date.parse(s.deadline) <= now()) close(s.id);
    }
  }

  function view(truceId: string): SwapsView {
    sweep(truceId);
    const { truce, pair } = load(truceId);
    const swaps = store.swapsOf(truce.id);
    const e = eveningOf(truce, pair);
    const decided = truce.status === 'done' && truce.result ? truce.result.bundle : null;
    const ledger = pairLedger(store, pair);
    return {
      bundle: decided,
      scores: e && decided ? scoresOf(e, decided) : null,
      // The ledger's own figure, so "how close" and who is owed next time never disagree.
      concession: decided ? (ledger.entries.find((x) => x.truceId === truce.id)?.concession ?? truce.result!.concession) : null,
      ledger: { alpha: ledger.alpha, tilt: ledger.tilt, owed: ledger.owed },
      swaps: swaps.map(toSwapView),
      lock: lockOf(truce, pair, swaps),
      canAsk: perSide(
        pair.members,
        (s) => swaps.filter((x) => x.kind === 'swap' && x.side === s && x.status !== 'cancelled' && x.reason && !isFact(x.reason)).length < TASTE_SWAPS_PER_PERSON,
      ),
      needed: majority(pair.members.length),
      voteMinutes: Math.round(voteMs / 60_000),
      replanNow: replanNow(swaps, decided),
      replacedBy: truce.replacedBy,
    };
  }

  const memberOf = (pair: PairRow, side: Side) => {
    if (!pair.members.includes(side)) throw new UserFacingError('Nobody sits there in this group.', 404, 'not_found');
  };

  return {
    view,

    /** A request to swap one item, or to plan the evening again. */
    ask(truceId: string, input: SwapInput): SwapsView {
      sweep(truceId);
      const { truce, pair } = load(truceId);
      memberOf(pair, input.side);
      const swaps = store.swapsOf(truce.id);
      const lock = lockOf(truce, pair, swaps);
      if (lock === 'open') throw new UserFacingError('Another request is waiting for votes. Ask again once it is settled.', 409, 'swap_open');
      if (lock) throw new UserFacingError(LOCKED[lock], 409, 'locked');
      const live = swaps.filter((s) => s.status !== 'cancelled');
      if (live.length >= REQUESTS_MAX) throw new UserFacingError("That's a lot of changes for one evening. Plan it again instead.", 409, 'too_many');
      const e = eveningOf(truce, pair)!;
      const bundle = truce.result!.bundle;
      const mine = live.filter((s) => s.side === input.side);
      const yes: PerSide<SwapVote> = { [input.side]: { vote: 'yes', by: 'person', why: null } };
      const id = newId();

      if (input.kind === 'swap') {
        const fact = isFact(input.reason);
        if (fact && mine.filter((s) => s.kind === 'swap' && s.reason && isFact(s.reason)).length >= FACT_SWAPS_PER_PERSON) {
          throw new UserFacingError("That's a lot of swaps for one evening. Plan it again instead.", 409, 'too_many');
        }
        if (!fact && mine.filter((s) => s.kind === 'swap' && s.reason && !isFact(s.reason)).length >= TASTE_SWAPS_PER_PERSON) {
          throw new UserFacingError(
            "You've used your swap for tonight. Something that can't happen (booked, closed, can't watch it) can still go to the group.",
            409,
            'swap_used',
          );
        }
        // A fact goes to the vote too; once it passes, the item has to change (see swapIn).
        store.createSwap({
          id,
          truceId: truce.id,
          kind: 'swap',
          side: input.side,
          slot: input.slot,
          reason: input.reason,
          needed: majority(e.members.length),
          votes: yes,
          from: { id: bundle[input.slot], name: nameOf(truce, input.slot, bundle[input.slot]) },
          scores: { before: scoresOf(e, bundle), after: null },
          deadline: new Date(now() + voteMs).toISOString(),
        });
      } else {
        // A replan whose new truce failed gave this evening back, and doesn't count.
        if (mine.some((s) => s.kind === 'replan' && !(s.newTruce && store.truce(s.newTruce)?.status === 'failed'))) {
          throw new UserFacingError("You've already asked to plan tonight again.", 409, 'swap_used');
        }
        if (store.runningTruceOf(pair.id)) throw new UserFacingError('A new truce is already being planned for this group.', 409, 'locked');
        if (runner.capacity()) throw new UserFacingError('Truce is too busy to plan again right now. Try again in a minute.', 503, 'capacity');
        const atOnce = replanNow(swaps, bundle);
        store.createSwap({
          id,
          truceId: truce.id,
          kind: 'replan',
          side: input.side,
          slot: null,
          reason: null,
          needed: atOnce ? 0 : majority(e.members.length),
          votes: yes,
          from: null,
          scores: null,
          deadline: atOnce ? null : new Date(now() + voteMs).toISOString(),
        });
        if (atOnce) replan(store.swap(id)!, truce, pair);
      }
      const created = store.swap(id)!;
      if (created.status === 'open') schedule(created);
      return view(truce.id);
    },

    vote(truceId: string, swapId: string, side: Side, vote: 'yes' | 'no'): SwapsView {
      sweep(truceId);
      const { truce, pair } = load(truceId);
      memberOf(pair, side);
      const swap = store.swap(swapId);
      if (!swap || swap.truceId !== truce.id) throw new UserFacingError('This request does not exist.', 404, 'not_found');
      if (swap.status !== 'open') throw new UserFacingError('This request is already settled.', 409, 'locked');
      if (swap.side === side) throw new UserFacingError('You asked for this one, so your yes is already in.', 409, 'not_voter');
      if (swap.votes[side]) throw new UserFacingError("You've already answered.", 409, 'not_voter');
      const votes = { ...swap.votes, [side]: { vote, by: 'person', why: null } satisfies SwapVote };
      if (!store.setSwapVotes(swap.id, votes)) throw new UserFacingError('This request is already settled.', 409, 'locked');
      const members = eveningOf(truce, pair)?.members ?? pair.members;
      const outcome = tally(members, plainVotes(votes), swap.needed);
      if (outcome !== 'open') decide({ ...swap, votes }, truce, pair, outcome);
      return view(truce.id);
    },

    /** The asker withdraws a request still waiting for votes. */
    cancel(truceId: string, swapId: string, side: Side): SwapsView {
      sweep(truceId);
      const { truce, pair } = load(truceId);
      memberOf(pair, side);
      const swap = store.swap(swapId);
      if (!swap || swap.truceId !== truce.id) throw new UserFacingError('This request does not exist.', 404, 'not_found');
      if (swap.status !== 'open') throw new UserFacingError('This request is already settled.', 409, 'locked');
      if (swap.side !== side) throw new UserFacingError('Only the person who asked can withdraw it.', 409, 'not_voter');
      store.resolveSwap(swap.id, 'cancelled', { cancelReason: 'withdrawn' });
      return view(truce.id);
    },

    /** The request waiting for votes on an evening, if any (after closing any whose time is up). */
    openOf(truceId: string): SwapRow | null {
      sweep(truceId);
      return store.swapsOf(truceId).find((s) => s.status === 'open') ?? null;
    },

    /** At boot: votes already due close now; the rest get their timers back. */
    resume() {
      for (const s of store.openSwaps()) {
        if (s.deadline && Date.parse(s.deadline) <= now()) close(s.id);
        else schedule(s);
      }
    },
  };
}

export type Swaps = ReturnType<typeof createSwaps>;
