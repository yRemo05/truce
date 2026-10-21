/**
 * From the StreamEvent log to what the live page shows. A pure reducer, so
 * a replayed truce and a live one end in exactly the same state.
 */
import type { CardItem, Side, Slot, StreamEvent, StrikeCode, TruceResult } from '@contract';
import type { IconName } from '@/ui/Icon';
import { agentOf } from './people';

export type Bundle = TruceResult['bundle'];
export type EventOf<T extends StreamEvent['type']> = Extract<StreamEvent, { type: T }>;
export type MoveEvent = EventOf<'move'>;

export const SLOTS: readonly Slot[] = ['film', 'restaurant', 'music'];
export const SLOT_LABEL: Record<Slot, string> = { film: 'Film', restaurant: 'Restaurant', music: 'Music' };
export const SLOT_ICON: Record<Slot, IconName> = { film: 'film', restaurant: 'restaurant', music: 'music' };

/** One value per slot. */
export const bySlot = <T>(fn: (slot: Slot) => T) => Object.fromEntries(SLOTS.map((s) => [s, fn(s)])) as Record<Slot, T>;

/** The referee's default when the start event hasn't said otherwise. */
const DEFAULT_TURNS = 6;

export type FeedEntry = { key: string; live: boolean } & (
  | { kind: 'start'; event: EventOf<'start'> }
  | { kind: 'move'; event: MoveEvent }
  | { kind: 'rejected'; event: EventOf<'rejected'> }
  /** The referee calls the last call: the thinking event that opens it. */
  | { kind: 'lastcall'; event: EventOf<'thinking'> }
  | { kind: 'declined'; event: EventOf<'declined'> }
  | { kind: 'agreement'; event: EventOf<'agreement'>; accepted: MoveEvent | null }
  | { kind: 'ruling'; event: EventOf<'ruling'> }
  | { kind: 'polish'; event: EventOf<'polish'> }
);

export interface TruceState {
  phase: 'connecting' | 'scouting' | 'negotiating' | 'settled' | 'done' | 'failed';
  brain: 'claude' | 'rules' | null;
  pool: Record<Slot, CardItem[]> | null;
  items: Record<string, CardItem>;
  indifferent: Record<Side, Record<Slot, boolean>> | null;
  start: EventOf<'start'> | null;
  /** Turns before the last call. */
  turns: number;
  feed: FeedEntry[];
  thinking: { side: Side; turn: number; struck: boolean } | null;
  /** The latest full evening offered or accepted. */
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
  pool: null,
  items: {},
  indifferent: null,
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

export function applyEvent(state: TruceState, { event, live }: Arrival): TruceState {
  const s: TruceState = live && !state.sawLive ? { ...state, sawLive: true } : state;
  const key = `${s.feed.length}-${event.type}`;
  const add = (entry: FeedEntry): TruceState => ({ ...s, feed: [...s.feed, entry] });

  switch (event.type) {
    case 'status':
      return { ...s, brain: event.brain, phase: s.phase === 'connecting' || s.phase === 'scouting' ? event.phase : s.phase };
    case 'pool': {
      const items: Record<string, CardItem> = {};
      for (const slot of SLOTS) for (const item of event.items[slot]) items[item.id] = item;
      return { ...s, pool: event.items, items, indifferent: event.indifferent };
    }
    case 'start':
      return { ...add({ kind: 'start', key, live, event }), start: event, turns: event.turns, phase: 'negotiating' };
    case 'thinking': {
      const thinking = { side: event.side, turn: event.turn, struck: false };
      const opensLastCall = isLastCall(event.turn, s.turns) && !s.feed.some((e) => e.kind === 'lastcall');
      return opensLastCall ? { ...add({ kind: 'lastcall', key, live, event }), thinking } : { ...s, thinking };
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
    case 'agreement': {
      const accepted = s.onTable?.action === 'accept' ? s.onTable : null;
      return { ...add({ kind: 'agreement', key, live, event, accepted }), phase: 'settled', thinking: null };
    }
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

export const isBridge = (item: Pick<CardItem, 'origins'>) =>
  item.origins.includes('joint') || (item.origins.includes('a') && item.origins.includes('b'));

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

/** Who gave more ground in one truce, by the ledger's measure; null when it's within a hair. */
export function gaveGround(concession: Record<Side, number>): Side | null {
  const gap = concession.a - concession.b;
  return Math.abs(gap) < 0.02 ? null : gap > 0 ? 'a' : 'b';
}

const STRIKE: Record<StrikeCode, (agent: string, name: string) => string> = {
  agent_failed: (agent) => `${agent} didn\u2019t answer in time.`,
  no_counter: (agent) => `${agent} didn\u2019t put an evening on the table.`,
  nothing_to_accept: (agent) => `${agent} accepted an offer nobody had made.`,
  unknown_item: (agent) => `${agent} named something that isn\u2019t in the pool.`,
  below_minimum: (agent, name) => `${agent} went below what ${name} should settle for this early.`,
};

/** Why the referee struck a move, in plain words. */
export function strikeReason(event: Pick<EventOf<'rejected'>, 'code' | 'reason'>, mover: string): string {
  const say = STRIKE[event.code];
  return say ? say(agentOf(mover), mover) : event.reason.charAt(0).toUpperCase() + event.reason.slice(1) + '.';
}
