/**
 * Runs truces in the background and fans their events out live.
 *
 * Starting a truce picks the bargaining weight from the pair's ledger, the
 * opener (sides take turns opening), and the agents: Claude while today's
 * model-run truces are under the daily cap, the rule-based agents after it.
 * Every event is appended to the truce's stored log as it happens, so a page
 * that connects late, or reconnects, replays the whole truce.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { randomBytes } from 'node:crypto';
import { RuleBrain, type AgentBrain } from '../agents/brain';
import { ClaudeBrain, type UsageReport } from '../agents/claude-brain';
import type { CardItem, LedgerView, SideInput, StreamEvent } from '../contract';
import type { QlooClient } from '../qloo/client';
import { alphaFromBalance, ledgerBalance, owed } from '../truce/ledger';
import { menuFor, negotiate } from '../truce/negotiate';
import { buildPool, type Pool } from '../truce/pool';
import { SLOTS, type Side, type Slot } from '../truce/types';
import { normalizeWeights } from '../truce/utility';
import type { Store, TruceRow } from './db';

export const newId = () => randomBytes(9).toString('base64url');

/** Price of Claude Haiku 5.5 under 100K-token prompts, $ per token: input, cache read, 5-min cache write, output. */
const PRICE = { input: 0.1e-6, cacheRead: 0.01e-6, cacheWrite: 0.125e-6, output: 0.5e-6 };

export function ledgerOf(truces: readonly TruceRow[]): LedgerView {
  const done = truces.filter((t) => t.status === 'done' && t.concession && t.result);
  const balance = ledgerBalance(done.map((t) => ({ concessionA: t.concession!.a, concessionB: t.concession!.b })));
  return {
    balance,
    alphaA: alphaFromBalance(balance),
    owed: owed(balance),
    entries: done.map((t) => ({
      truceId: t.id,
      at: t.createdAt,
      concession: t.concession!,
      evening: eveningNames(t),
    })),
  };
}

function eveningNames(t: TruceRow): Record<Slot, string> {
  const pool = t.events.find((e): e is Extract<StreamEvent, { type: 'pool' }> => e.type === 'pool');
  return Object.fromEntries(
    SLOTS.map((s) => [s, pool?.items[s].find((i) => i.id === t.result!.bundle[s])?.name ?? '']),
  ) as Record<Slot, string>;
}

export function cardsOf(pool: Pool, seedNames: Record<string, string>): Record<Slot, CardItem[]> {
  const menus = { a: menuFor(pool, 'a', seedNames), b: menuFor(pool, 'b', seedNames) };
  return Object.fromEntries(
    SLOTS.map((slot) => [
      slot,
      pool.items[slot].map((item): CardItem => {
        const of = (side: Side) => menus[side].find((m) => m.id === item.id && m.slot === slot)!;
        return {
          id: item.id,
          slot,
          name: item.name,
          disambiguation: item.disambiguation,
          imageUrl: item.imageUrl,
          blurb: item.blurb,
          facts: item.facts,
          scores: { a: of('a').score, b: of('b').score },
          origins: item.origins,
          because: { a: of('a').because, b: of('b').because },
        };
      }),
    ]),
  ) as Record<Slot, CardItem[]>;
}

const startOfUtcDay = () => `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;

export interface RunnerDeps {
  store: Store;
  qloo: QlooClient;
  anthropic: Anthropic | null;
  /** Model-run truces allowed per UTC day before the rule-based agents take over. */
  dailyCap: number;
  log?: (msg: string) => void;
}

interface Live {
  events: StreamEvent[];
  listeners: Set<(e: StreamEvent) => void>;
}

export function createRunner(deps: RunnerDeps) {
  const { store, qloo, anthropic } = deps;
  const log = deps.log ?? ((m: string) => console.log(m));
  const live = new Map<string, Live>();
  const rules = new RuleBrain();

  async function run(truceId: string, pairId: string, sides: Record<Side, SideInput>, alphaA: number, opener: Side, brain: 'claude' | 'rules') {
    const pair = store.pair(pairId)!;
    const state: Live = { events: [], listeners: new Set() };
    live.set(truceId, state);
    const push = (e: StreamEvent) => {
      state.events.push(e);
      store.saveEvents(truceId, state.events);
      for (const fn of state.listeners) fn(e);
    };
    const usage: UsageReport[] = [];
    const started = Date.now();

    try {
      push({ type: 'status', phase: 'scouting', brain });
      const seedNames: Record<string, string> = {};
      const seeds = (side: Side) =>
        Object.fromEntries(
          SLOTS.map((s) => {
            for (const seed of sides[side].seeds[s]) seedNames[seed.id] = seed.name;
            return [s, sides[side].seeds[s].map((seed) => seed.id)];
          }),
        ) as Record<Slot, string[]>;
      const people = { a: { seeds: seeds('a') }, b: { seeds: seeds('b') } };

      const pool = await buildPool(qloo, people, {
        place: { locationQuery: pair.location, priceMin: 2, popularityMin: 0.5 },
      });
      const empty = SLOTS.filter((s) => pool.items[s].length === 0);
      if (empty.length) {
        throw new UserFacingError(
          empty.includes('restaurant')
            ? `Qloo found no restaurants for "${pair.location}". Try a city or neighbourhood name like "Manhattan" or "Istanbul".`
            : `Qloo found no ${empty.join(' or ')} options for these tastes. Try adding another favourite.`,
        );
      }
      push({ type: 'pool', items: cardsOf(pool, seedNames), indifferent: pool.indifferent });
      push({ type: 'status', phase: 'negotiating', brain });

      const before = ledgerOf(store.trucesOf(pairId));
      const agent: AgentBrain =
        brain === 'claude' && anthropic ? new ClaudeBrain(anthropic, { onUsage: (u) => usage.push(u) }) : rules;
      const result = await negotiate(
        pool,
        {
          mode: pair.mode,
          names: pair.names,
          weights: { a: normalizeWeights(sides.a.weights), b: normalizeWeights(sides.b.weights) },
          seedNames,
          seeds: { a: people.a.seeds, b: people.b.seeds },
          alphaA,
          opener,
        },
        { a: agent, b: agent },
        push,
      );
      store.finishTruce(truceId, result);
      const after = ledgerOf(store.trucesOf(pairId));
      push({
        type: 'ledger',
        before: { balance: before.balance, alphaA: before.alphaA },
        after: { balance: after.balance, alphaA: after.alphaA, owed: after.owed },
      });
    } catch (err) {
      const message =
        err instanceof UserFacingError ? err.message : 'Something went wrong while planning this evening. Please try again.';
      log(`truce ${truceId} failed: ${(err as Error).stack ?? err}`);
      store.failTruce(truceId);
      push({ type: 'error', message });
    } finally {
      const sum = (k: keyof UsageReport) => usage.reduce((t, u) => t + u[k], 0);
      const cost =
        sum('inputTokens') * PRICE.input +
        sum('cacheReadTokens') * PRICE.cacheRead +
        sum('cacheWriteTokens') * PRICE.cacheWrite +
        sum('outputTokens') * PRICE.output;
      log(
        `truce ${truceId} ${brain} ${((Date.now() - started) / 1000).toFixed(1)}s, ${usage.length} model calls, ≈$${cost.toFixed(4)}, qloo quota left ${qloo.quota().monthRemaining ?? '?'}`,
      );
      live.delete(truceId);
    }
  }

  return {
    /**
     * Starts a truce for a pair whose two sides are ready. Returns the running
     * truce instead when one is already in progress, so a double tap costs nothing.
     */
    start(pairId: string): string {
      const running = store.runningTruceOf(pairId);
      if (running) return running;
      const sides = store.sides(pairId);
      if (!sides.a || !sides.b) throw new UserFacingError('Both people need to finish their picks first.', 409);
      const past = store.trucesOf(pairId);
      const alphaA = ledgerOf(past).alphaA;
      const opener: Side = past.filter((t) => t.status === 'done').length % 2 === 0 ? 'a' : 'b';
      const brain = anthropic && store.claudeTrucesSince(startOfUtcDay()) < deps.dailyCap ? 'claude' : 'rules';
      const id = newId();
      store.createTruce(id, pairId, brain, alphaA, opener);
      void run(id, pairId, { a: sides.a, b: sides.b }, alphaA, opener, brain);
      return id;
    },

    /**
     * The events so far plus a subscription to the rest, taken in one tick so
     * nothing falls between them. Null when the truce isn't running here.
     */
    follow(truceId: string, onEvent: (e: StreamEvent) => void): { past: StreamEvent[]; stop: () => void } | null {
      const state = live.get(truceId);
      if (!state) return null;
      state.listeners.add(onEvent);
      return { past: [...state.events], stop: () => state.listeners.delete(onEvent) };
    },
  };
}

export type Runner = ReturnType<typeof createRunner>;

/** An error whose message is safe and useful to show the person. */
export class UserFacingError extends Error {
  constructor(
    message: string,
    readonly status = 422,
  ) {
    super(message);
  }
}
