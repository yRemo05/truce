/**
 * Runs truces in the background and fans their events out live.
 *
 * A truce goes: gather (Qloo candidates from everyone's favourites, under the
 * group's vetoes and tonight's opening hours, plus each person's taste
 * words), scout (each agent searches Qloo itself and may add finds), score
 * (once per person, then the pool is frozen), negotiate, and record the
 * ledger. Starting one picks the bargaining weights from the ledger, the
 * opener (people take turns opening), and the agents: Claude while today's
 * model-run truces are under the daily cap, the rule-based agents (and no
 * scouting) after it. Every event is appended to the truce's stored log as it
 * happens, so a page that connects late, or reconnects, replays the whole
 * truce.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { randomBytes } from 'node:crypto';
import { agentBriefOf, type InterpretedBrief } from '../agents/brief';
import { RuleBrain, type AgentBrain } from '../agents/brain';
import { ClaudeBrain, type UsageReport } from '../agents/claude-brain';
import { findHotspot, scout, type Hotspot } from '../agents/scout';
import type { CardItem, CheckinInput, CheckinResult, LedgerView, Seed, SideInput, StreamErrorCode, StreamEvent } from '../contract';
import type { QlooClient } from '../qloo/client';
import { locate, tasteWords } from '../qloo/queries';
import {
  alphaFromBalance,
  experienced,
  ledgerBalance,
  owed,
  realisedConcession,
  tiltOf,
} from '../truce/ledger';
import { linksOf } from '../truce/links';
import { menuFor, negotiate } from '../truce/negotiate';
import {
  gatherCandidates,
  scorePool,
  signalOf,
  type Candidates,
  type Constraints,
  type PersonSeeds,
  type Pool,
  type PoolOptions,
} from '../truce/pool';
import { hoursTonight, tonightAt, type Tonight } from '../truce/tonight';
import { SLOTS, at, perSide, type PerSide, type Side, type Slot } from '../truce/types';
import { normalizeWeights } from '../truce/utility';
import type { CheckinRow, Learned, PairRow, Store, TruceRow } from './db';

export const newId = () => randomBytes(9).toString('base64url');

/** Price of Claude Haiku 5.5 under 100K-token prompts, $ per token: input, cache read, 5-min cache write, output. */
const PRICE = { input: 0.1e-6, cacheRead: 0.01e-6, cacheWrite: 0.125e-6, output: 0.5e-6 };
export const costOf = (usage: readonly UsageReport[]) =>
  usage.reduce(
    (t, u) =>
      t + u.inputTokens * PRICE.input + u.cacheReadTokens * PRICE.cacheRead + u.cacheWriteTokens * PRICE.cacheWrite + u.outputTokens * PRICE.output,
    0,
  );

/** Most favourites a person's check-ins can add per slot, newest kept. */
const LEARNED_PER_SLOT = 3;
const AVOIDED_MAX = 30;
/** Most items per slot once scouting has added its finds. */
const MAX_PER_SLOT = 12;

/** The ledger as everyone sees it: realised concessions (after check-ins), balances and next weights. */
export function ledgerOf(members: Side[], truces: readonly TruceRow[], checkins: Map<string, CheckinRow[]>): LedgerView {
  const done = truces.filter((t) => t.status === 'done' && t.result);
  const entries = done.map((t) => {
    const r = t.result!;
    const said = checkins.get(t.id) ?? [];
    const present = members.filter((s) => r.utilities[s] !== undefined);
    const concession = perSide(present, (s) => {
      const c = said.find((x) => x.side === s && x.went);
      const weights = r.weights?.[s];
      const items = r.items?.[s];
      const reported = c && weights && items ? experienced(weights, items, c.ratings) : null;
      return realisedConcession(at(r.best, s), at(r.utilities, s), reported);
    });
    return {
      truceId: t.id,
      at: t.createdAt,
      concession,
      checkedIn: perSide(present, (s) => said.some((x) => x.side === s)),
      evening: t.evening ?? eveningFromEvents(t),
      earlier: t.earlier,
    };
  });
  const balance = ledgerBalance(entries, members);
  const alpha = alphaFromBalance(balance, members);
  return { members, balance, alpha, tilt: tiltOf(alpha, members), owed: owed(balance, members), entries };
}

export function pairLedger(store: Store, pair: PairRow): LedgerView {
  return ledgerOf(pair.members, store.trucesOf(pair.id), store.checkinsOfPair(pair.id));
}

/** The chosen items' names from an old truce's log, for rows stored before names were kept apart. */
function eveningFromEvents(t: TruceRow): Record<Slot, string> {
  const pool = t.events.find((e): e is Extract<StreamEvent, { type: 'pool' }> => e.type === 'pool');
  return Object.fromEntries(
    SLOTS.map((s) => [s, pool?.items[s].find((i) => i.id === t.result?.bundle[s])?.name ?? '']),
  ) as Record<Slot, string>;
}

export function cardsOf(pool: Pool, seedNames: Record<string, string>, tonight: Tonight): Record<Slot, CardItem[]> {
  const menus = perSide(pool.members, (s) => menuFor(pool, s, seedNames));
  return Object.fromEntries(
    SLOTS.map((slot) => [
      slot,
      pool.items[slot].map((item): CardItem => {
        const of = (side: Side) => at(menus, side).find((m) => m.id === item.id && m.slot === slot)!;
        return {
          id: item.id,
          slot,
          name: item.name,
          disambiguation: item.disambiguation,
          imageUrl: item.imageUrl,
          blurb: item.blurb,
          facts: item.facts,
          scores: perSide(pool.members, (s) => of(s).score),
          origins: item.origins,
          because: perSide(pool.members, (s) => of(s).because),
          scout: item.scoutedBy ? { side: item.scoutedBy, why: item.scoutWhy ?? '' } : null,
          serves: slot === 'restaurant' ? perSide(pool.members, (s) => pool.serves[s]?.[item.id] ?? []) : {},
          links: linksOf(item, slot),
          hours: slot === 'restaurant' ? hoursTonight(item.hours, tonight.weekday) : null,
          address: item.address,
        };
      }),
    ]),
  ) as Record<Slot, CardItem[]>;
}

/** Everyone's vetoes and past "not for me"s, combined into what the pool must respect. */
export function constraintsOf(members: readonly Side[], briefs: PerSide<InterpretedBrief | null>, learned: PerSide<Learned>): Constraints {
  const c: Constraints = { excludeEntities: [], excludeTags: { film: [], restaurant: [], music: [] }, maxPrice: null };
  for (const s of members) {
    const rules = briefs[s]?.rules;
    if (rules) {
      c.excludeEntities.push(...rules.excludeEntities);
      for (const slot of SLOTS) c.excludeTags[slot].push(...rules.excludeTags[slot]);
      if (rules.maxPrice !== null) c.maxPrice = Math.min(c.maxPrice ?? 4, rules.maxPrice);
    }
    c.excludeEntities.push(...(learned[s]?.avoided.map((x) => x.id) ?? []));
  }
  c.excludeEntities = [...new Set(c.excludeEntities)];
  for (const slot of SLOTS) c.excludeTags[slot] = [...new Set(c.excludeTags[slot])];
  return c;
}

/** The vetoes in play, as everyone may see them: "No Horror", "Not Dune (2021)", "Up to $$". */
export function vetoLabels(members: readonly Side[], briefs: PerSide<InterpretedBrief | null>): string[] {
  const labels = members.flatMap((s) =>
    (briefs[s]?.view.vetoes ?? []).map((v) => (v.kind === 'price' ? v.matched : v.kind === 'title' ? `Not ${v.matched}` : `No ${v.matched}`)),
  );
  return [...new Set(labels)];
}

/** A person's favourites plus what their check-ins taught their agent. */
function favouritesOf(input: SideInput, learned: Learned): Record<Slot, Seed[]> {
  return Object.fromEntries(
    SLOTS.map((slot) => {
      const all = [...input.seeds[slot], ...learned.loved[slot]];
      return [slot, all.filter((x, i) => all.findIndex((y) => y.id === x.id) === i)];
    }),
  ) as Record<Slot, Seed[]>;
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

  async function run(truceId: string, pair: PairRow, alpha: PerSide<number>, opener: Side, brain: 'claude' | 'rules') {
    const { members } = pair;
    const state: Live = { events: [], listeners: new Set() };
    live.set(truceId, state);
    const push = (e: StreamEvent) => {
      state.events.push(e);
      store.saveEvents(truceId, state.events);
      for (const fn of state.listeners) fn(e);
    };
    const usage: UsageReport[] = [];
    const started = Date.now();
    const useClaude = brain === 'claude' && anthropic !== null;

    try {
      push({ type: 'status', phase: 'gathering', brain });
      const sides = store.sides(pair.id);
      const favourites = perSide(members, (s) => favouritesOf(at(sides, s).input, at(sides, s).learned));
      const briefs = perSide(members, (s) => at(sides, s).brief);
      const seedNames: Record<string, string> = {};
      for (const s of members) for (const slot of SLOTS) for (const seed of at(favourites, s)[slot]) seedNames[seed.id] = seed.name;
      const people: PerSide<PersonSeeds> = perSide(members, (s) => ({
        seeds: Object.fromEntries(SLOTS.map((slot) => [slot, at(favourites, s)[slot].map((x) => x.id)])) as Record<Slot, string[]>,
        foods: at(sides, s).input.foods ?? [],
      }));
      const foods = perSide(members, (s) => (at(people, s).foods ?? []).map((f) => f.name));
      const constraints = constraintsOf(
        members,
        briefs,
        perSide(members, (s) => at(sides, s).learned),
      );

      const locality = await locate(qloo, pair.location);
      if (!locality) {
        throw new UserFacingError(
          `Qloo doesn't know "${pair.location}". Try a city or neighbourhood name like "Manhattan" or "Istanbul".`,
          422,
          'no_restaurants',
        );
      }
      const tonight = tonightAt(locality.lat, locality.lon);
      const options: PoolOptions = {
        place: { locationQuery: pair.location, priceMin: 2, popularityMin: 0.5 },
        constraints,
        weekday: tonight.weekday,
      };

      const [candidates, portraits] = await Promise.all([
        gatherCandidates(qloo, members, people, options),
        Promise.all(members.map(async (s) => [s, await tasteWords(qloo, signalOf(at(people, s))).catch(() => [])] as const)).then(
          (list) => Object.fromEntries(list) as PerSide<string[]>,
        ),
      ]);
      push({ type: 'tastes', portraits, vetoes: vetoLabels(members, briefs) });

      const vetoed = constraints.excludeEntities.length > 0 || constraints.maxPrice !== null || SLOTS.some((s) => constraints.excludeTags[s].length > 0);
      const empty = SLOTS.filter((s) => candidates[s].length === 0);
      if (empty.length) {
        // With vetoes in play the fix is loosening one (no_options), not another place (no_restaurants).
        throw empty.includes('restaurant') && !vetoed
          ? new UserFacingError(
              `Qloo found no restaurants open tonight for "${pair.location}". Try a city or neighbourhood name like "Manhattan" or "Istanbul".`,
              422,
              'no_restaurants',
            )
          : empty.includes('restaurant')
            ? new UserFacingError(
                `Qloo found no restaurants open tonight in "${pair.location}" that fit everyone's vetoes. Loosen a veto in someone's note, or try a nearby neighbourhood.`,
                422,
                'no_options',
              )
            : new UserFacingError(
              `Qloo found no ${empty.join(' or ')} options for these tastes${vetoed ? ' and vetoes' : ''}. Try adding another favourite${vetoed ? ' or loosening a veto' : ''}.`,
              422,
              'no_options',
            );
      }

      if (useClaude) {
        push({ type: 'status', phase: 'scouting', brain });
        let hotspot: Promise<Hotspot | null> | null = null;
        const taken = new Set<string>();
        // Shared by the agents: an add only goes through while its slot has room, so every find announced reaches the table.
        const room = Object.fromEntries(SLOTS.map((s) => [s, MAX_PER_SLOT - candidates[s].length])) as Record<Slot, number>;
        const finds = await Promise.all(
          members.map((side) =>
            scout(
              {
                qloo,
                anthropic: anthropic!,
                mode: pair.mode,
                members,
                names: pair.names,
                location: pair.location,
                options,
                seeds: favourites,
                foods,
                portraits,
                briefs: perSide(members, (s) => agentBriefOf(at(briefs, s))),
                weights: perSide(members, (s) => normalizeWeights(at(sides, s).input.weights)),
                candidates,
                hotspot: () =>
                  (hotspot ??= findHotspot(qloo, [...new Set(members.flatMap((s) => signalOf(at(people, s))))], options.place).catch(() => null)),
                taken,
                room,
                emit: push,
                onUsage: (u) => usage.push(u),
              },
              side,
            ),
          ),
        );
        for (const { slot, item } of finds.flat()) {
          if (!candidates[slot].some((i) => i.id === item.id)) candidates[slot].push(item);
        }
      }

      const pool = await scorePool(qloo, members, people, candidates satisfies Candidates);
      push({ type: 'pool', items: cardsOf(pool, seedNames, tonight), indifferent: pool.indifferent, tonight });
      push({ type: 'status', phase: 'negotiating', brain });

      const before = pairLedger(store, pair);
      const agent: AgentBrain = useClaude ? new ClaudeBrain(anthropic!, { onUsage: (u) => usage.push(u) }) : rules;
      const result = await negotiate(
        pool,
        {
          mode: pair.mode,
          members,
          names: pair.names,
          weights: perSide(members, (s) => normalizeWeights(at(sides, s).input.weights)),
          seedNames,
          seeds: perSide(members, (s) => at(people, s).seeds),
          foods,
          portraits,
          briefs: perSide(members, (s) => agentBriefOf(at(briefs, s))),
          alpha,
          opener,
        },
        perSide(members, () => agent),
        push,
      );
      const evening = Object.fromEntries(
        SLOTS.map((s) => [s, pool.items[s].find((i) => i.id === result.bundle[s])?.name ?? '']),
      ) as Record<Slot, string>;
      store.finishTruce(truceId, result, evening);
      const after = pairLedger(store, pair);
      push({
        type: 'ledger',
        before: { alpha: before.alpha, tilt: before.tilt },
        after: { alpha: after.alpha, tilt: after.tilt, owed: after.owed },
      });
    } catch (err) {
      // A known cause the people can fix (place, favourites, vetoes); anything else is ours and worth a retry.
      const fixable = err instanceof UserFacingError && (err.code === 'no_restaurants' || err.code === 'no_options') ? err : null;
      log(`truce ${truceId} failed: ${(err as Error).stack ?? err}`);
      store.failTruce(truceId);
      push({
        type: 'error',
        code: fixable ? (fixable.code as StreamErrorCode) : 'internal',
        message: fixable ? fixable.message : 'Something went wrong while planning this evening. Please try again.',
        retryable: !fixable,
      });
    } finally {
      log(
        `truce ${truceId} ${brain} ${members.length}p ${((Date.now() - started) / 1000).toFixed(1)}s, ${usage.length} model calls, ≈$${costOf(usage).toFixed(4)}, qloo quota left ${qloo.quota().monthRemaining ?? '?'}`,
      );
      live.delete(truceId);
    }
  }

  return {
    /**
     * Starts a truce for a group whose people are all ready. Returns the
     * running truce instead when one is already in progress, so a double tap
     * costs nothing.
     */
    start(pairId: string): string {
      const running = store.runningTruceOf(pairId);
      if (running) return running;
      const pair = store.pair(pairId);
      if (!pair) throw new UserFacingError('This truce link does not exist.', 404, 'not_found');
      const sides = store.sides(pairId);
      if (pair.members.some((s) => !sides[s])) throw new UserFacingError('Everyone needs to finish their picks first.', 409, 'not_ready');
      const past = store.trucesOf(pairId);
      const { alpha } = pairLedger(store, pair);
      const opener = pair.members[past.filter((t) => t.status === 'done').length % pair.members.length]!;
      const brain = anthropic && store.claudeTrucesSince(startOfUtcDay()) < deps.dailyCap ? 'claude' : 'rules';
      const id = newId();
      store.createTruce(id, pairId, brain, alpha, opener);
      void run(id, pair, alpha, opener, brain);
      return id;
    },

    /**
     * Records how the evening went for one person: the ledger counts it, loved
     * picks join their favourites, and the rest stay off the table.
     */
    checkin(truceId: string, side: Side, input: CheckinInput): CheckinResult {
      const truce = store.truce(truceId);
      if (!truce) throw new UserFacingError('This truce does not exist.', 404, 'not_found');
      if (truce.status !== 'done' || !truce.result || truce.earlier) {
        throw new UserFacingError('Only a finished evening can be checked in.', 409, 'not_ready');
      }
      const pair = store.pair(truce.pairId)!;
      if (!pair.members.includes(side) || truce.result.utilities[side] === undefined) {
        throw new UserFacingError('That person was not part of this evening.', 404, 'not_found');
      }
      store.saveCheckin(truceId, side, input);

      const learnedNow: CheckinResult['learned'] = { loved: [], avoided: [] };
      if (input.went) {
        const learned = store.sides(pair.id)[side]?.learned;
        if (learned) {
          const evening = truce.evening ?? eveningFromEvents(truce);
          for (const slot of SLOTS) {
            const seed: Seed = { id: truce.result.bundle[slot], name: evening[slot] };
            if (input.ratings[slot] === 'loved') {
              learned.loved[slot] = [seed, ...learned.loved[slot].filter((x) => x.id !== seed.id)].slice(0, LEARNED_PER_SLOT);
              learnedNow.loved.push(seed);
            } else if (input.ratings[slot] === 'not_for_me') {
              learned.avoided = [seed, ...learned.avoided.filter((x) => x.id !== seed.id)].slice(0, AVOIDED_MAX);
              learnedNow.avoided.push(seed);
            }
          }
          store.setLearned(pair.id, side, learned);
        }
      }
      return { ledger: pairLedger(store, pair), learned: learnedNow };
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
    readonly code: StreamErrorCode | 'not_ready' | 'not_found' = 'internal',
  ) {
    super(message);
  }
}
