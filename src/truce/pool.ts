/**
 * The shared pool: what's on the table for each slot, and what each person
 * thinks of every item on it.
 *
 * Gathering: per slot, Qloo recommendations from each person's seeds and
 * from everyone's together (the joint seeds find bridge candidates no single
 * list holds) are merged round-robin. Every seed a person named counts as
 * their signal in every slot, which is what lets a film and an artist inform
 * a restaurant. The group's vetoes hold throughout: Qloo is asked to leave
 * vetoed tags, titles and prices out, and every candidate is checked again
 * here, along with restaurants that are closed for good or closed tonight.
 *
 * Scouting (agents/scout.ts) may then add items. Scoring comes last, once
 * per person over exactly the same items, so each person's numbers compare
 * with each other. See docs/DESIGN.md.
 */
import type { QlooClient } from '../qloo/client';
import { recommend, scoreShortlist, type PlaceFilter } from '../qloo/queries';
import type { Entity, ScoredEntity } from '../qloo/schemas';
import { hoursTonight } from './tonight';
import { KIND_OF_SLOT, SLOTS, at, perSide, type PerSide, type Side, type Slot, type Utilities } from './types';
import { scaleSlot } from './utility';

export interface PersonSeeds {
  /** Confirmed Qloo entity ids the person loves, per slot. */
  seeds: Record<Slot, string[]>;
}

/** What the group's briefs and check-ins rule out tonight. */
export interface Constraints {
  /** Entities nobody gets offered: seen films, named skips, past "not for me"s. */
  excludeEntities: string[];
  /** Per slot, Qloo tags no item may carry. */
  excludeTags: Record<Slot, string[]>;
  /** The lowest price cap anyone set, 1–4, or null. */
  maxPrice: number | null;
}

export const NO_CONSTRAINTS: Constraints = {
  excludeEntities: [],
  excludeTags: { film: [], restaurant: [], music: [] },
  maxPrice: null,
};

export interface PoolOptions {
  place: PlaceFilter;
  constraints?: Constraints;
  /** The evening's weekday where the restaurant is ("tuesday"): restaurants closed then are left out. */
  weekday?: string;
  /** Items per slot after merging, before scouting. */
  perSlot?: number;
  /** Candidates kept from each recommendation call. */
  perQuery?: number;
}

/** Where an item came from: one person's taste, everyone's together (a bridge), or an agent's scouting. */
export type Origin = Side | 'joint' | 'scout';

export interface PoolItem extends Entity {
  origins: Origin[];
  /** The agent that added it while scouting, and the reason it gave. */
  scoutedBy: Side | null;
  scoutWhy: string | null;
}

export type Candidates = Record<Slot, PoolItem[]>;

export interface Pool {
  members: Side[];
  items: Candidates;
  /** Raw Qloo affinity per person, slot and item (absent when Qloo left it unscored). */
  affinity: PerSide<Record<Slot, Record<string, number>>>;
  /** Which of a person's seeds drove each item's affinity. */
  drivers: PerSide<Record<Slot, Record<string, { seedId: string; share: number }[]>>>;
  utilities: PerSide<Utilities>;
  indifferent: PerSide<Record<Slot, boolean>>;
}

export const signalOf = (p: PersonSeeds) => [...new Set(SLOTS.flatMap((s) => p.seeds[s]))];

/** Whether an entity may be offered tonight under the group's vetoes and opening hours. */
export function admissible(e: Entity, slot: Slot, c: Constraints, weekday?: string): boolean {
  if (c.excludeEntities.includes(e.id)) return false;
  const banned = c.excludeTags[slot];
  if (banned.length && e.tags.some((t) => banned.includes(t.id))) return false;
  if (slot === 'restaurant') {
    if (e.isClosed) return false;
    if (c.maxPrice !== null && e.priceLevel !== null && e.priceLevel > c.maxPrice) return false;
    if (weekday && hoursTonight(e.hours, weekday).openTonight === false) return false;
  }
  return true;
}

export function toPoolItem(e: Entity | ScoredEntity, origin: Origin): PoolItem {
  const { affinity: _a, drivers: _d, ...entity } = e as ScoredEntity;
  return { ...entity, origins: [origin], scoutedBy: null, scoutWhy: null };
}

/** Round-robin merge so every person's list and the bridge list are all represented. */
export function mergeLists(lists: readonly (readonly [Origin, readonly Entity[]])[], limit: number): PoolItem[] {
  const byId = new Map<string, PoolItem>();
  const longest = Math.max(0, ...lists.map(([, l]) => l.length));
  for (let i = 0; i < longest; i++) {
    for (const [origin, list] of lists) {
      const e = list[i];
      if (!e) continue;
      const seen = byId.get(e.id);
      if (seen) {
        if (!seen.origins.includes(origin)) seen.origins.push(origin);
      } else if (byId.size < limit) {
        byId.set(e.id, toPoolItem(e, origin));
      }
    }
  }
  return [...byId.values()];
}

/** Everything a recommendation for `slot` must respect, as `recommend` arguments. */
export function slotQuery(slot: Slot, opts: PoolOptions, exclude: readonly string[]) {
  const c = opts.constraints ?? NO_CONSTRAINTS;
  const kind = KIND_OF_SLOT[slot];
  return {
    kind,
    exclude: [...new Set([...exclude, ...c.excludeEntities])],
    excludeTags: c.excludeTags[slot],
    place:
      kind === 'place'
        ? {
            ...opts.place,
            priceMax: c.maxPrice ?? opts.place.priceMax,
            priceMin: c.maxPrice !== null && opts.place.priceMin !== undefined ? Math.min(opts.place.priceMin, c.maxPrice) : opts.place.priceMin,
          }
        : undefined,
  };
}

/** The unscored candidates: per slot, every person's recommendations and the joint ones, merged. */
export async function gatherCandidates(
  qloo: QlooClient,
  members: readonly Side[],
  people: PerSide<PersonSeeds>,
  opts: PoolOptions,
): Promise<Candidates> {
  const perSlot = opts.perSlot ?? 8;
  const perQuery = opts.perQuery ?? 6;
  const c = opts.constraints ?? NO_CONSTRAINTS;
  const signal = perSide(members, (s) => signalOf(at(people, s)));
  if (members.some((s) => !at(signal, s).length)) throw new Error('gatherCandidates: everyone needs at least one seed');
  const joint = [...new Set(members.flatMap((s) => at(signal, s)))];

  const slotCandidates = async (slot: Slot) => {
    const query = slotQuery(slot, opts, joint);
    // Ask for a few more than needed: vetoes and closing times may drop some.
    const ask = async (seeds: string[]) =>
      (await recommend(qloo, { ...query, seeds, take: perQuery + 4 }))
        .filter((e) => admissible(e, slot, c, opts.weekday))
        .slice(0, perQuery);
    const lists = await Promise.all([...members.map((s) => ask(at(signal, s))), ask(joint)]);
    const origins: Origin[] = [...members, 'joint'];
    return [slot, mergeLists(origins.map((o, i) => [o, lists[i]!] as const), perSlot)] as const;
  };
  return Object.fromEntries(await Promise.all(SLOTS.map(slotCandidates))) as Candidates;
}

/** Scores the candidates once per person and rescales each person's scores within each slot. */
export async function scorePool(
  qloo: QlooClient,
  members: readonly Side[],
  people: PerSide<PersonSeeds>,
  items: Candidates,
): Promise<Pool> {
  const pool: Pool = { members: [...members], items, affinity: {}, drivers: {}, utilities: {}, indifferent: {} };
  for (const s of members) {
    pool.affinity[s] = {} as Record<Slot, Record<string, number>>;
    pool.drivers[s] = {} as Record<Slot, Record<string, { seedId: string; share: number }[]>>;
    pool.utilities[s] = {} as Utilities;
    pool.indifferent[s] = {} as Record<Slot, boolean>;
  }
  await Promise.all(
    SLOTS.flatMap((slot) => {
      const ids = items[slot].map((i) => i.id);
      return members.map(async (side) => {
        const { scored } = await scoreShortlist(qloo, { kind: KIND_OF_SLOT[slot], seeds: signalOf(at(people, side)), ids });
        const affinity: Record<string, number> = {};
        const drivers: Record<string, { seedId: string; share: number }[]> = {};
        for (const e of scored) {
          affinity[e.id] = e.affinity;
          drivers[e.id] = e.drivers;
        }
        const scale = scaleSlot(ids, affinity);
        at(pool.affinity, side)[slot] = affinity;
        at(pool.drivers, side)[slot] = drivers;
        at(pool.utilities, side)[slot] = scale.utilities;
        at(pool.indifferent, side)[slot] = scale.indifferent;
      });
    }),
  );
  return pool;
}

/** Gathers and scores in one go, with no scouting (scripts and tests). */
export async function buildPool(
  qloo: QlooClient,
  members: readonly Side[],
  people: PerSide<PersonSeeds>,
  opts: PoolOptions,
): Promise<Pool> {
  return scorePool(qloo, members, people, await gatherCandidates(qloo, members, people, opts));
}
