/**
 * Swaps in plain words: the reasons offered per slot, who still has to
 * answer, and the sentences the vote card, the banners and the history share,
 * so the same request reads the same everywhere.
 */
import type { Side, Slot, SwapReason, SwapsView, SwapView } from '@contract';
import type { IconName } from '@/ui/Icon';
import { agentOf, listNames, nameOf, type Names } from './people';
import { SLOT_NOUN } from './truce';

/** The glyph for a request wherever it shows: a swap, or planning again. */
export const KIND_ICON: Record<SwapView['kind'], IconName> = { swap: 'exchange', replan: 'retry' };

/** "the film", "the restaurant", "the music". */
const theSlot = (slot: Slot | null) => `the ${slot ? SLOT_NOUN[slot] : 'item'}`;

/** The reasons offered per slot, the fact first. */
export const REASONS: Record<Slot, readonly SwapReason[]> = {
  film: ['unavailable', 'seen', 'not_feeling'],
  restaurant: ['unavailable', 'not_feeling'],
  music: ['unavailable', 'not_feeling'],
};

const UNAVAILABLE: Record<Slot, string> = { film: 'Can’t watch it', restaurant: 'Booked or closed', music: 'Can’t play it' };

export const reasonLabel = (slot: Slot, reason: SwapReason) =>
  reason === 'unavailable' ? UNAVAILABLE[slot] : reason === 'seen' ? 'Seen it' : 'Not feeling it';

/** Something that can't happen, as opposed to a matter of taste. Both go to a vote; the agents take a fact on the asker's word. */
export const isFact = (reason: SwapReason) => reason === 'unavailable';

/** The request waiting for votes, if any. */
export const openOf = (view: SwapsView | null) => view?.swaps.find((s) => s.status === 'open') ?? null;

/** Whether anything in the evening was actually replaced. */
export const wasSwapped = (view: SwapsView | null): view is SwapsView => Boolean(view?.swaps.some((s) => s.status === 'swapped'));

/** Swaps whose item the group wanted gone: swapped out, or with nothing fair to put in. A replan leaves these out. */
export const swappedAway = (swaps: readonly SwapView[]) =>
  swaps.filter((s) => s.kind === 'swap' && s.from && (s.status === 'swapped' || s.status === 'no_alternative'));

/** What planning again does, in one sentence. */
export const replanLine = (view: SwapsView) =>
  `The agents plan the evening again from everyone’s favourites${swappedAway(view.swaps).length ? ', without what was swapped away' : ''}.`;

/** Whether the person on this phone can still answer: anyone on a shared phone, else only someone the vote waits for. */
export const canVote = (open: { waiting: readonly Side[] }, mine: Side | null) => mine === null || open.waiting.includes(mine);

/** "Waiting for Deniz.", "Waiting for Ecrin and Lina." */
export const waitingLine = (waiting: readonly Side[], names: Names) => `Waiting for ${listNames(waiting.map((s) => nameOf(names, s)))}.`;

/** Who still has to answer an open request, in seat order. */
export const pendingOf = (swap: Pick<SwapView, 'votes'>, members: readonly Side[]) => members.filter((s) => !swap.votes[s]);

export const yesCount = (swap: Pick<SwapView, 'votes'>) => Object.values(swap.votes).filter((v) => v?.vote === 'yes').length;

/** "10 min", or "30 s" for the mock's short window. */
const minutesLabel = (minutes: number) => (minutes >= 1 ? `${Math.round(minutes)} min` : `${Math.round(minutes * 60)} s`);

/** "8 min left", "25 s left"; null once the time is up. */
export function timeLeft(deadline: string, now: number): string | null {
  const ms = Date.parse(deadline) - now;
  if (ms <= 0) return null;
  return ms >= 60_000 ? `${Math.ceil(ms / 60_000)} min left` : `${Math.ceil(ms / 1000)} s left`;
}

/** A request as much as the group page knows it: no reason there. */
export type Asked = Pick<SwapView, 'kind' | 'side' | 'slot'> & { reason?: SwapReason | null };

/** "Deniz asked to swap the film (Not feeling it)", "Deniz asked to plan tonight again". */
export function askedLine(swap: Asked, names: Names): string {
  const who = nameOf(names, swap.side);
  if (swap.kind === 'replan' || !swap.slot) return `${who} asked to plan tonight again`;
  return `${who} asked to swap ${theSlot(swap.slot)}${swap.reason ? ` (${reasonLabel(swap.slot, swap.reason)})` : ''}`;
}

/**
 * What a vote needs, in one line: "Deniz needs to be OK with it." for a
 * couple, "Asks the group: 3 of 4 need to be OK with an alternative." for more.
 * `asker` is null while nobody has said who's asking. On a `fact`, silence
 * counts as OK, since an agent can't check whether the place is booked.
 */
export function voteRule(
  kind: SwapView['kind'],
  asker: Side | null,
  members: readonly Side[],
  names: Names,
  needed: number,
  voteMinutes: number,
  fact = false,
): string {
  const ok = kind === 'swap' ? 'be OK with it' : 'agree';
  const window = minutesLabel(voteMinutes);
  if (members.length === 2) {
    const other = asker && members.find((s) => s !== asker);
    if (!other) return `Both of you need to ${ok}.`;
    const name = nameOf(names, other);
    return fact
      ? `${name} needs to be OK with swapping it. If ${name} hasn’t answered in ${window}, it’s swapped.`
      : `${name} needs to ${ok}. If ${name} hasn’t answered in ${window}, ${agentOf(name)} answers.`;
  }
  const what = kind === 'swap' ? 'be OK with an alternative' : 'agree to plan again';
  return fact
    ? `Asks the group: ${needed} of ${members.length} need to be OK with swapping it. Anyone who hasn’t answered in ${window} counts as OK.`
    : `Asks the group: ${needed} of ${members.length} need to ${what}. Anyone who hasn’t answered in ${window} is answered for by their agent.`;
}

/** "Ecrin’s agent answered No: The Lobster matters to Ecrin tonight." */
export function agentVoteLine(side: Side, vote: NonNullable<SwapView['votes'][Side]>, names: Names): string {
  const answer = vote.vote === 'yes' ? 'OK' : 'No';
  return `${agentOf(nameOf(names, side))} answered ${answer}${vote.why ? `: ${vote.why}` : '.'}`;
}

/** "1 of 2 OK". */
export const tallyLine = (swap: Pick<SwapView, 'votes'>, members: readonly Side[]) => `${yesCount(swap)} of ${members.length} OK`;

/** A request as one sentence; the history draws a swap's "from → to" itself. */
export function outcomeLine(swap: SwapView, members: readonly Side[], names: Names): string {
  const who = nameOf(names, swap.side);
  const what = swap.kind === 'replan' ? 'plan tonight again' : `swap ${theSlot(swap.slot)}`;
  switch (swap.status) {
    case 'kept':
      return swap.kind === 'replan'
        ? `${askedLine(swap, names)}. The group kept tonight’s plan, ${tallyLine(swap, members)}.`
        : `${askedLine(swap, names)}. The group kept ${swap.from?.name ?? 'it'}, ${tallyLine(swap, members)}.`;
    case 'no_alternative':
      return swap.needed > 0
        ? `The group was OK with swapping ${theSlot(swap.slot)}, but no fair replacement was left.`
        : `${who} asked to swap ${theSlot(swap.slot)}, but no fair replacement was left.`;
    case 'replanned':
      return `${askedLine(swap, names)}. Planned again.`;
    case 'cancelled':
      return swap.cancelled === 'superseded'
        ? `${askedLine(swap, names)}. Called off: the group planned a newer evening.`
        : `${who} withdrew their request to ${what}.`;
    case 'swapped':
      return `${who} swapped ${swap.from?.name ?? theSlot(swap.slot)} for ${swap.to?.name ?? 'something else'}.`;
    case 'open':
      return `${askedLine(swap, names)}.`;
  }
}

/** "Maya 62 → 70 · Deniz 81 → 74". */
export function scoreChange(scores: NonNullable<SwapView['scores']>, members: readonly Side[], names: Names): string | null {
  const after = scores.after;
  if (!after) return null;
  return members.map((s) => `${nameOf(names, s)} ${scores.before[s] ?? 0} → ${after[s] ?? 0}`).join(' · ');
}

/** "Lina has used their swap for tonight", or "You’ve used…" for the person on this phone. */
export const usedLine = (side: Side, mine: Side | null, names: Names) =>
  side === mine ? 'You’ve used your swap for tonight.' : `${nameOf(names, side)} has used their swap for tonight.`;

/** "then Lina’s agent answers", "then their agents answer". */
export const thenAgents = (pending: readonly Side[], names: Names) =>
  pending.length === 1 ? `then ${agentOf(nameOf(names, pending[0]!))} answers` : 'then their agents answer';
