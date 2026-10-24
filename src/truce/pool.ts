/**
 * The shared pool: what's on the table for each slot, and what each person
 * thinks of every item on it.
 *
 * Gathering: per slot, Qloo recommendations from each person's seeds and
 * from everyone's together (the joint seeds find bridge candidates no single
 * list holds) are merged round-robin. Every seed a person named counts as
 * their signal in every slot, which is what lets a film and an artist inform
 * a restaurant. A food someone named ("Lasagna") brings in places that serve
 * it, ranked by that person's taste. The group's vetoes hold throughout: Qloo is asked to leave
 * vetoed tags, titles and prices out, and every candidate is checked again
 * here, along with restaurants that are closed for good or closed tonight.
 *
 * Scouting (agents/scout.ts) may then add items. Scoring comes last, once
 * per person over exactly the same items, so each person's numbers compare
 * with each other. A place serving a food someone named scores higher for
 * them: Qloo can't score a place against a food, so that part is ours.
 * See docs/DESIGN.md.
 */
import type { QlooClient } from '../qloo/client';
import { FOOD_FAMILIES, foodKey, recommend, scoreShortlist, type PlaceFilter } from '../qloo/queries';
import type { Entity, ScoredEntity } from '../qloo/schemas';
import { hoursTonight } from './tonight';
import { KIND_OF_SLOT, SLOTS, at, perSide, type PerSide, type Side, type Slot, type Utilities } from './types';
import { scaleSlot } from './utility';

export interface PersonSeeds {
  /** Confirmed Qloo entity ids the person loves, per slot. */
  seeds: Record<Slot, string[]>;
  /** Foods they love, each with the Qloo tags that name it. */
  foods?: FoodPick[];
}

export interface FoodPick {
  name: string;
  tags: string[];
}

/**
 * How much a food someone named counts in their restaurant scores, against
 * Qloo's affinity. Over half: for them, a place serving it always outranks
 * one that doesn't, and Qloo orders the places within each group.
 */
export const FOOD_WEIGHT = 0.6;
/**
 * Places kept per food named. Five, so someone who asked for a food still
 * has a few places serving it to fall back on when one is booked or swapped.
 */
const PER_FOOD = 5;
/** Most room the food places add to the restaurant list, on top of `perSlot`. */
const FOOD_ROOM = 6;

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
  /** Foods (as `foodKey`s) Qloo found this place for: it serves them even when its tags don't say. */
  serves: string[];
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
  /** Per person, the foods they named that each restaurant serves, by item id. */
  serves: PerSide<Record<string, string[]>>;
}

export const signalOf = (p: PersonSeeds) => [...new Set(SLOTS.flatMap((s) => p.seeds[s]))];

/** Which of these foods a place serves: Qloo found it for the food, or it carries a food tag by that name. */
export function servedFoods(item: PoolItem, foods: readonly FoodPick[]): string[] {
  return foods
    .filter((f) => {
      const key = foodKey(f.name);
      return (
        item.serves.includes(key) ||
        item.tags.some((t) => f.tags.includes(t.id) || (FOOD_FAMILIES.some((p) => t.id.startsWith(p)) && foodKey(t.name) === key))
      );
    })
    .map((f) => f.name);
}

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
  return { ...entity, origins: [origin], serves: [], scoutedBy: null, scoutWhy: null };
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

  // Each food someone named, asked for once per person who named it.
  const foods = members.flatMap((s) => (at(people, s).foods ?? []).map((food) => ({ side: s, food })));

  const slotCandidates = async (slot: Slot) => {
    const query = slotQuery(slot, opts, joint);
    // Ask for a few more than needed: vetoes and closing times may drop some.
    const ask = async (seeds: string[], take = perQuery, anyTags?: string[]) =>
      (
        await recommend(qloo, {
          ...query,
          // Few places serve any one dish (two lasagnas at $$ in Istanbul), so for a food the dish counts, not fame.
          place: anyTags && query.place ? { ...query.place, popularityMin: undefined } : query.place,
          seeds,
          anyTags,
          take: take + 4,
        })
      )
        .filter((e) => admissible(e, slot, c, opts.weekday))
        .slice(0, take);
    const forFood = slot === 'restaurant' ? foods : [];
    const [foodLists, lists] = await Promise.all([
      Promise.all(forFood.map(({ side, food }) => ask(at(signal, side), PER_FOOD, food.tags))),
      Promise.all([...members.map((s) => ask(at(signal, s))), ask(joint)]),
    ]);
    // A food is something the person asked for by name, so its places come on top of the usual list.
    const merged = mergeLists(
      forFood.map((f, i) => [f.side, foodLists[i]!] as const),
      Math.min(forFood.length * PER_FOOD, FOOD_ROOM),
    );
    const usual: Origin[] = [...members, 'joint'];
    for (const item of mergeLists(usual.map((o, i) => [o, lists[i]!] as const), perSlot)) {
      const seen = merged.find((m) => m.id === item.id);
      if (!seen) merged.push(item);
      else for (const o of item.origins) if (!seen.origins.includes(o)) seen.origins.push(o);
    }
    forFood.forEach(({ food }, i) => {
      for (const e of foodLists[i]!) {
        const item = merged.find((m) => m.id === e.id);
        if (item && !item.serves.includes(foodKey(food.name))) item.serves.push(foodKey(food.name));
      }
    });
    return [slot, merged] as const;
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
  const pool: Pool = { members: [...members], items, affinity: {}, drivers: {}, utilities: {}, indifferent: {}, serves: {} };
  for (const s of members) {
    const foods = at(people, s).foods ?? [];
    pool.serves[s] = Object.fromEntries(
      items.restaurant.flatMap((i) => {
        const served = servedFoods(i, foods);
        return served.length ? [[i.id, served] as const] : [];
      }),
    );
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
        const qlooScale = scaleSlot(ids, affinity);
        const scale = slot === 'restaurant' ? withFoods(qlooScale, ids, at(people, side), at(pool.serves, side)) : qlooScale;
        at(pool.affinity, side)[slot] = affinity;
        at(pool.drivers, side)[slot] = drivers;
        at(pool.utilities, side)[slot] = scale.utilities;
        at(pool.indifferent, side)[slot] = scale.indifferent;
      });
    }),
  );
  return pool;
}

/**
 * A person's restaurant utilities once the foods they named count: a place
 * serving one gains FOOD_WEIGHT of the scale. Someone Qloo finds indifferent
 * still prefers the places with their food.
 */
export function withFoods(
  scale: { utilities: Record<string, number>; indifferent: boolean },
  ids: readonly string[],
  person: PersonSeeds,
  serves: Record<string, string[]>,
): { utilities: Record<string, number>; indifferent: boolean } {
  if (!person.foods?.length) return scale;
  const hit = (id: string) => ((serves[id]?.length ?? 0) > 0 ? 1 : 0);
  const utilities = Object.fromEntries(
    ids.map((id) => [id, (1 - FOOD_WEIGHT) * (scale.utilities[id] ?? 0) + FOOD_WEIGHT * hit(id)]),
  );
  return { utilities, indifferent: scale.indifferent && ids.every((id) => hit(id) === hit(ids[0]!)) };
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
