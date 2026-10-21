/**
 * The shared pool: what's on the table for each slot, and what each person
 * thinks of every item on it.
 *
 * Per slot, three Qloo recommendations are merged: from A's seeds, from B's,
 * and from both together (the joint seeds find bridge candidates neither
 * list holds). Every seed a person named counts as their signal in every
 * slot, which is what lets a film and an artist inform a restaurant. The
 * merged pool is then scored once per person over exactly the same items, so
 * each person's numbers compare with each other. See docs/DESIGN.md.
 */
import type { QlooClient } from '../qloo/client';
import { recommend, scoreShortlist, type PlaceFilter } from '../qloo/queries';
import type { Entity, ScoredEntity } from '../qloo/schemas';
import { KIND_OF_SLOT, SLOTS, type Side, type Slot, type Utilities } from './types';
import { scaleSlot } from './utility';

export interface PersonSeeds {
  /** Confirmed Qloo entity ids the person loves, per slot. */
  seeds: Record<Slot, string[]>;
}

export interface PoolOptions {
  place: PlaceFilter;
  /** Items per slot after merging (the bundle space is perSlot³). */
  perSlot?: number;
  /** Candidates asked from each of the three recommendation calls. */
  perQuery?: number;
}

export type Origin = 'a' | 'b' | 'joint';

export interface PoolItem extends Entity {
  /** Which recommendation lists surfaced it. */
  origins: Origin[];
}

export interface Pool {
  items: Record<Slot, PoolItem[]>;
  /** Raw Qloo affinity per side, slot and item (absent when Qloo left it unscored). */
  affinity: Record<Side, Record<Slot, Record<string, number>>>;
  /** Which of a side's seeds drove each item's affinity. */
  drivers: Record<Side, Record<Slot, Record<string, { seedId: string; share: number }[]>>>;
  utilities: Record<Side, Utilities>;
  indifferent: Record<Side, Record<Slot, boolean>>;
}

const signalOf = (p: PersonSeeds) => [...new Set(SLOTS.flatMap((s) => p.seeds[s]))];

/** Round-robin merge so both people's lists and the bridge list are all represented. */
export function mergeLists(lists: Record<Origin, readonly Entity[]>, limit: number): PoolItem[] {
  const order: Origin[] = ['a', 'b', 'joint'];
  const byId = new Map<string, PoolItem>();
  const longest = Math.max(...order.map((o) => lists[o].length));
  for (let i = 0; i < longest; i++) {
    for (const o of order) {
      const e = lists[o][i];
      if (!e) continue;
      const seen = byId.get(e.id);
      if (seen) {
        if (!seen.origins.includes(o)) seen.origins.push(o);
      } else if (byId.size < limit) {
        byId.set(e.id, { ...stripScore(e), origins: [o] });
      }
    }
  }
  return [...byId.values()];
}

function stripScore(e: Entity | ScoredEntity): Entity {
  const { affinity: _a, drivers: _d, ...entity } = e as ScoredEntity;
  return entity;
}

export async function buildPool(
  qloo: QlooClient,
  people: Record<Side, PersonSeeds>,
  opts: PoolOptions,
): Promise<Pool> {
  const perSlot = opts.perSlot ?? 8;
  const perQuery = opts.perQuery ?? 6;
  const signal = { a: signalOf(people.a), b: signalOf(people.b) };
  const joint = [...new Set([...signal.a, ...signal.b])];
  if (!signal.a.length || !signal.b.length) throw new Error('buildPool: each person needs at least one seed');

  const slotPool = async (slot: Slot) => {
    const kind = KIND_OF_SLOT[slot];
    const ask = (seeds: string[]) =>
      recommend(qloo, { kind, seeds, exclude: joint, take: perQuery, place: kind === 'place' ? opts.place : undefined });
    const [a, b, j] = await Promise.all([ask(signal.a), ask(signal.b), ask(joint)]);
    const items = mergeLists({ a, b, joint: j }, perSlot);
    const ids = items.map((i) => i.id);
    const [scoredA, scoredB] = await Promise.all([
      scoreShortlist(qloo, { kind, seeds: signal.a, ids }),
      scoreShortlist(qloo, { kind, seeds: signal.b, ids }),
    ]);
    return { slot, items, scored: { a: scoredA.scored, b: scoredB.scored } };
  };

  const slots = await Promise.all(SLOTS.map(slotPool));

  const pool: Pool = {
    items: {} as Pool['items'],
    affinity: { a: {} as Pool['affinity']['a'], b: {} as Pool['affinity']['b'] },
    drivers: { a: {} as Pool['drivers']['a'], b: {} as Pool['drivers']['b'] },
    utilities: { a: {} as Utilities, b: {} as Utilities },
    indifferent: { a: {} as Pool['indifferent']['a'], b: {} as Pool['indifferent']['b'] },
  };
  for (const { slot, items, scored } of slots) {
    pool.items[slot] = items;
    const ids = items.map((i) => i.id);
    for (const side of ['a', 'b'] as const) {
      const affinity: Record<string, number> = {};
      const drivers: Record<string, { seedId: string; share: number }[]> = {};
      for (const e of scored[side]) {
        affinity[e.id] = e.affinity;
        drivers[e.id] = e.drivers;
      }
      const scale = scaleSlot(ids, affinity);
      pool.affinity[side][slot] = affinity;
      pool.drivers[side][slot] = drivers;
      pool.utilities[side][slot] = scale.utilities;
      pool.indifferent[side][slot] = scale.indifferent;
    }
  }
  return pool;
}
