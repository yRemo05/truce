/**
 * From the StreamEvent log to what the live page shows. A pure reducer, so
 * a replayed truce and a live one end in exactly the same state.
 */
import type { CardItem, PerSide, Side, Slot, StreamEvent, StrikeCode, Tonight, TruceResult } from '@contract';
import type { IconName } from '@/ui/Icon';
import { agentOf } from './people';

export type Bundle = TruceResult['bundle'];
export type EventOf<T extends StreamEvent['type']> = Extract<StreamEvent, { type: T }>;
export type MoveEvent = EventOf<'move'>;
export type ScoutStep = EventOf<'scout'>;

export const SLOTS: readonly Slot[] = ['film', 'restaurant', 'music'];
export const SLOT_LABEL: Record<Slot, string> = { film: 'Film', restaurant: 'Restaurant', music: 'Music' };
/** The slot in the middle of a sentence: "swap the film". */
export const SLOT_NOUN: Record<Slot, string> = { film: 'film', restaurant: 'restaurant', music: 'music' };
export const SLOT_ICON: Record<Slot, IconName> = { film: 'film', restaurant: 'restaurant', music: 'music' };

/** One value per slot. */
export const bySlot = <T>(fn: (slot: Slot) => T) => Object.fromEntries(SLOTS.map((s) => [s, fn(s)])) as Record<Slot, T>;

/** The referee's default when the start event hasn't said otherwise. */
const DEFAULT_TURNS = 6;

export type FeedEntry = { key: string; live: boolean } & (
  | { kind: 'start'; event: EventOf<'start'> }
  | { kind: 'move'; event: MoveEvent }
  | { kind: 'rejected'; event: EventOf<'rejected'> }
  /** The referee opens the last calls: the first thinking event after the last turn. */
  | { kind: 'lastcall'; event: EventOf<'thinking'>; offer: MoveEvent | null }
  /** Each agent's last turn begins: the referee now shows the mover a shortlist. */
  | { kind: 'finalround'; event: EventOf<'thinking'> }
  | { kind: 'declined'; event: EventOf<'declined'> }
  | { kind: 'agreement'; event: EventOf<'agreement'> }
  | { kind: 'ruling'; event: EventOf<'ruling'> }
  | { kind: 'polish'; event: EventOf<'polish'> }
);

export interface TruceState {
  phase: 'connecting' | 'gathering' | 'scouting' | 'negotiating' | 'settled' | 'done' | 'failed';
  brain: 'claude' | 'rules' | null;
  /** Qloo's taste words per person, and the vetoes in play. */
  tastes: EventOf<'tastes'> | null;
  /** Each agent's scouting steps, in order. */
  scouts: PerSide<ScoutStep[]>;
  pool: Record<Slot, CardItem[]> | null;
  items: Record<string, CardItem>;
  indifferent: PerSide<Record<Slot, boolean>> | null;
  tonight: Tonight | null;
  start: EventOf<'start'> | null;
  /** Turns before the last calls. */
  turns: number;
  feed: FeedEntry[];
  thinking: { side: Side; turn: number; struck: boolean } | null;
  /** The latest offer and who has said yes to it. */
  onTable: MoveEvent | null;
  /** No deal by the last call: the referee ruled. */
  ruled: boolean;
  result: TruceResult | null;
  ledger: EventOf<'ledger'> | null;
  error: EventOf<'error'> | null;
  /** True once anything arrived live (not from the replay at load). */
  sawLive: boolean;
}

export const initialTruce: TruceState = {
  phase: 'connecting',
  brain: null,
  tastes: null,
  scouts: {},
  pool: null,
  items: {},
  indifferent: null,
  tonight: null,
  start: null,
  turns: DEFAULT_TURNS,
  feed: [],
  thinking: null,
  onTable: null,
  ruled: false,
  result: null,
  ledger: null,
  error: null,
  sawLive: false,
};

export interface Arrival {
  event: StreamEvent;
  live: boolean;
}

const EARLY: readonly TruceState['phase'][] = ['connecting', 'gathering', 'scouting'];

export function applyEvent(state: TruceState, { event, live }: Arrival): TruceState {
  const s: TruceState = live && !state.sawLive ? { ...state, sawLive: true } : state;
  const key = `${s.feed.length}-${event.type}`;
  const add = (entry: FeedEntry): TruceState => ({ ...s, feed: [...s.feed, entry] });

  switch (event.type) {
    case 'status':
      return { ...s, brain: event.brain, phase: EARLY.includes(s.phase) ? event.phase : s.phase };
    case 'tastes':
      return { ...s, tastes: event };
    case 'scout':
      return { ...s, scouts: { ...s.scouts, [event.side]: [...(s.scouts[event.side] ?? []), event] } };
    case 'pool': {
      const items: Record<string, CardItem> = {};
      for (const slot of SLOTS) for (const item of event.items[slot]) items[item.id] = item;
      return { ...s, pool: event.items, items, indifferent: event.indifferent, tonight: event.tonight };
    }
    case 'start':
      return { ...add({ kind: 'start', key, live, event }), start: event, turns: event.turns, phase: 'negotiating' };
    case 'thinking': {
      const thinking = { side: event.side, turn: event.turn, struck: false };
      const opensLastCall = isLastCall(event.turn, s.turns) && !s.feed.some((e) => e.kind === 'lastcall');
      if (opensLastCall) return { ...add({ kind: 'lastcall', key, live, event, offer: s.onTable }), thinking };
      const seats = s.start?.order.length ?? 0;
      const opensFinal = seats > 0 && event.turn === s.turns - seats + 1 && !s.feed.some((e) => e.kind === 'finalround');
      return opensFinal ? { ...add({ kind: 'finalround', key, live, event }), thinking } : { ...s, thinking };
    }
    case 'rejected':
      return {
        ...add({ kind: 'rejected', key, live, event }),
        thinking: s.thinking && s.thinking.side === event.side ? { ...s.thinking, struck: true } : s.thinking,
      };
    case 'move':
      return { ...add({ kind: 'move', key, live, event }), thinking: null, onTable: event };
    case 'declined':
      return { ...add({ kind: 'declined', key, live, event }), thinking: null };
    case 'agreement':
      return { ...add({ kind: 'agreement', key, live, event }), phase: 'settled', thinking: null };
    case 'ruling':
      return { ...add({ kind: 'ruling', key, live, event }), phase: 'settled', ruled: true, thinking: null };
    case 'polish':
      return add({ kind: 'polish', key, live, event });
    case 'done':
      return { ...s, result: event.result, ruled: event.result.how === 'ruled', phase: 'done', thinking: null };
    case 'ledger':
      return { ...s, ledger: event };
    case 'error':
      return { ...s, error: event, phase: 'failed', thinking: null };
  }
}

/** Found from everyone's tastes together, or from more than one person's. */
export const isBridge = (item: Pick<CardItem, 'origins'>) =>
  item.origins.includes('joint') || item.origins.filter((o) => o !== 'joint' && o !== 'scout').length > 1;

export const isLastCall = (turn: number, turns: number) => turn > turns;
export const turnLabel = (turn: number, turns: number) => (isLastCall(turn, turns) ? 'Last call' : `Turn ${turn}`);

type TurnEntry = Extract<FeedEntry, { kind: 'move' | 'declined' }>;
export const isTurnEntry = (e: FeedEntry): e is TurnEntry => e.kind === 'move' || e.kind === 'declined';

/** One move per turn, in order, for the turn track. */
export const turnsOf = (feed: readonly FeedEntry[]) =>
  feed.filter(isTurnEntry).map((e) => ({
    turn: e.event.turn,
    side: e.event.side,
    action: e.kind === 'declined' ? ('decline' as const) : e.event.action,
  }));

/** Who gave the most ground in one truce, by the ledger's measure; null when everyone is within a hair. */
export function gaveGround(concession: PerSide<number>, members: readonly Side[]): Side | null {
  const values = members.map((s) => concession[s] ?? 0);
  const mean = values.reduce((t, v) => t + v, 0) / Math.max(values.length, 1);
  let top: Side | null = null;
  for (const s of members) {
    const above = (concession[s] ?? 0) - mean;
    if (above > 0.02 && (top === null || above > (concession[top] ?? 0) - mean)) top = s;
  }
  return top;
}

const STRIKE: Record<StrikeCode, (agent: string, name: string) => string> = {
  agent_failed: (agent) => `${agent} couldn’t answer.`,
  no_counter: (agent) => `${agent} didn’t put an evening on the table.`,
  nothing_to_accept: (agent) => `${agent} accepted an offer nobody had made.`,
  unknown_item: (agent) => `${agent} named something that isn’t in the pool.`,
  below_minimum: (agent, name) => `${agent} went below what ${name} should settle for this early.`,
};

/** Why the referee struck a move, in plain words. */
export function strikeReason(event: Pick<EventOf<'rejected'>, 'code' | 'reason'>, mover: string): string {
  const say = STRIKE[event.code];
  return say ? say(agentOf(mover), mover) : event.reason.charAt(0).toUpperCase() + event.reason.slice(1) + '.';
}

/** The truce page's three tabs, one per phase. */
export type PhaseTab = 'research' | 'discussion' | 'decision';
export const PHASE_TABS: readonly PhaseTab[] = ['research', 'discussion', 'decision'];
export const PHASE_LABEL: Record<PhaseTab, string> = { research: 'Research', discussion: 'Discussion', decision: 'Decision' };
export const isPhaseTab = (s: string | null): s is PhaseTab => s !== null && (PHASE_TABS as readonly string[]).includes(s);

const settledIn = (feed: readonly FeedEntry[]) => feed.some((e) => e.kind === 'agreement' || e.kind === 'ruling');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** How many picks the agents added while scouting. */
export const findsOf = (state: TruceState) =>
  Object.values(state.scouts).reduce((t, steps) => t + (steps?.filter((s) => s.step === 'add').length ?? 0), 0);

/** Where an error belongs: the phase it stopped, or Decision once the evening was settled. */
export function errorTab(state: TruceState): PhaseTab {
  return state.result || settledIn(state.feed) ? 'decision' : state.start ? 'discussion' : 'research';
}

/** The tab a reader following along should see now. */
export function liveTab(state: TruceState): PhaseTab {
  if (state.error) return errorTab(state);
  if (state.phase === 'settled' || state.phase === 'done') return 'decision';
  return state.start ? 'discussion' : 'research';
}

/** The short count beside each tab: "6 finds", "Turn 5 of 9", "Deal". */
export function tabMeta(state: TruceState, tab: PhaseTab): string {
  if (state.error && errorTab(state) === tab) return 'Stopped';
  switch (tab) {
    case 'research': {
      const finds = findsOf(state);
      if (finds) return plural(finds, 'find', 'finds');
      if (state.pool) return plural(SLOTS.reduce((t, s) => t + state.pool![s].length, 0), 'option', 'options');
      return state.error ? '' : 'Gathering';
    }
    case 'discussion': {
      if (!state.start) return 'Not yet';
      const turns = turnsOf(state.feed).length;
      if (settledIn(state.feed) || state.error) return plural(turns, 'turn', 'turns');
      const now = state.thinking?.turn ?? Math.max(turns, 1);
      return isLastCall(now, state.turns) ? 'Last call' : `Turn ${now} of ${state.turns}`;
    }
    case 'decision':
      return state.ruled ? 'Ruling' : settledIn(state.feed) ? 'Deal' : state.error ? 'None' : 'Waiting';
  }
}

/** Grows whenever a tab gets something new to read; the page compares it with what the reader has seen. */
export function tabVersion(state: TruceState, tab: PhaseTab): number {
  const stopped = state.error && errorTab(state) === tab ? 1 : 0;
  switch (tab) {
    case 'research':
      return stopped + (state.tastes ? 1 : 0) + Object.values(state.scouts).reduce((t, s) => t + (s?.length ?? 0), 0) + (state.pool ? 1 : 0);
    case 'discussion':
      return stopped + state.feed.length;
    case 'decision':
      return stopped + (state.result ? 1 : 0) + (state.ledger ? 1 : 0);
  }
}
