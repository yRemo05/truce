/**
 * The three Qloo questions Truce asks:
 *   1. search: resolve a name a person typed into Qloo entities to confirm;
 *   2. recommend: candidates for one slot from one set of seeds;
 *   3. scoreShortlist: one fixed pool scored against one person's seeds, with
 *      the seeds' contributions (explainability). Scoring the same pool once
 *      per person is what makes the two people's utilities comparable within
 *      themselves; see docs/QLOO_FIELD_NOTES.md.
 */
import type { QlooClient } from './client';
import {
  URN_BY_KIND,
  fromInsights,
  fromSearch,
  insightsResponseSchema,
  searchResponseSchema,
  type Entity,
  type ScoredEntity,
} from './schemas';

export type SlotKind = 'movie' | 'artist' | 'place';

/** Where and what kind of restaurant; only used for the `place` slot. */
export interface PlaceFilter {
  /** A Qloo locality name, e.g. "Manhattan" ("New York" leaks into New Jersey). */
  locationQuery: string;
  priceMin?: number;
  priceMax?: number;
  popularityMin?: number;
}

const RESTAURANT_TAG = 'urn:tag:category:place:restaurant';

export async function searchEntities(
  qloo: QlooClient,
  query: string,
  kind: SlotKind,
  take = 5,
): Promise<Entity[]> {
  const body = await qloo.get('/search', { query, types: URN_BY_KIND[kind], take });
  return searchResponseSchema.parse(body).results.map(fromSearch);
}

export async function recommend(
  qloo: QlooClient,
  args: {
    kind: SlotKind;
    seeds: readonly string[];
    exclude?: readonly string[];
    take: number;
    place?: PlaceFilter;
  },
): Promise<ScoredEntity[]> {
  const { kind, seeds, exclude = [], take, place } = args;
  if (!seeds.length) return [];
  const body = await qloo.get('/v2/insights', {
    'filter.type': URN_BY_KIND[kind],
    'signal.interests.entities': seeds.join(','),
    'filter.exclude.entities': exclude.length ? exclude.join(',') : undefined,
    ...(kind === 'place' && place
      ? {
          'filter.tags': RESTAURANT_TAG,
          'filter.location.query': place.locationQuery,
          'filter.price_level.min': place.priceMin,
          'filter.price_level.max': place.priceMax,
          'filter.popularity.min': place.popularityMin,
        }
      : {}),
    take,
  });
  return insightsResponseSchema.parse(body).results.entities.map(fromInsights);
}

/**
 * Scores every id in `ids` against `seeds`. Ids Qloo leaves out of the answer
 * come back as `missing` rather than being guessed.
 */
export async function scoreShortlist(
  qloo: QlooClient,
  args: { kind: SlotKind; seeds: readonly string[]; ids: readonly string[] },
): Promise<{ scored: ScoredEntity[]; missing: string[] }> {
  const { kind, seeds, ids } = args;
  if (!seeds.length || !ids.length) return { scored: [], missing: [...ids] };
  const body = await qloo.get('/v2/insights', {
    'filter.type': URN_BY_KIND[kind],
    'signal.interests.entities': seeds.join(','),
    'filter.results.entities': ids.join(','),
    'feature.explainability': true,
    take: ids.length,
  });
  const scored = insightsResponseSchema.parse(body).results.entities.map(fromInsights);
  const seen = new Set(scored.map((e) => e.id));
  return { scored, missing: ids.filter((id) => !seen.has(id)) };
}
