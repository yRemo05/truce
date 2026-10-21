/**
 * The Qloo questions Truce asks:
 *   1. search: resolve a name a person typed into Qloo entities to confirm;
 *   2. locate: the locality a place name resolves to, so a restaurant search
 *      can stay near the pair's city;
 *   3. recommend: candidates for one slot from one set of seeds;
 *   4. scoreShortlist: one fixed pool scored against one person's seeds, with
 *      the seeds' contributions (explainability). Scoring the same pool once
 *      per person is what makes the two people's utilities comparable within
 *      themselves; see docs/QLOO_FIELD_NOTES.md.
 */
import { QlooError, type QlooClient } from './client';
import {
  URN_BY_KIND,
  fromInsights,
  fromSearch,
  insightsResponseSchema,
  localityResponseSchema,
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

/**
 * How far a `near` search reaches, in miles (Qloo's unit here: radius 10 kept
 * hits within 16 km, 100 within 134 km; the default is 10, the maximum 100).
 * A locality's point can sit far off its centre (Istanbul's is ~25 km from
 * Kadıköy), so this is wide enough for a whole metro area.
 */
const NEAR_RADIUS_MILES = 50;

export interface Locality {
  /** Qloo's name for it, e.g. "Istanbul". */
  name: string;
  disambiguation: string | null;
  lat: number;
  lon: number;
}

export async function searchEntities(
  qloo: QlooClient,
  query: string,
  kind: SlotKind,
  take = 5,
  /** Only places within NEAR_RADIUS_MILES of this point. */
  near?: Pick<Locality, 'lat' | 'lon'>,
): Promise<Entity[]> {
  const body = await qloo.get('/search', {
    query,
    types: URN_BY_KIND[kind],
    // /search wants "lat,lon" here; it ignores `filter.location.query`.
    'filter.location': near ? `${near.lat},${near.lon}` : undefined,
    'filter.radius': near ? NEAR_RADIUS_MILES : undefined,
    take,
  });
  return searchResponseSchema.parse(body).results.map(fromSearch);
}

/**
 * The locality Qloo resolves `query` to, through the same resolver the
 * restaurant pool uses (`filter.location.query`), or null if it knows no such
 * place. /search would find localities too, but could pick a different one.
 */
export async function locate(qloo: QlooClient, query: string): Promise<Locality | null> {
  let body: unknown;
  try {
    body = await qloo.get('/v2/insights', {
      'filter.type': URN_BY_KIND.place,
      'filter.tags': RESTAURANT_TAG,
      'filter.location.query': query,
      take: 1,
    });
  } catch (err) {
    // "filter.location.query is unable to resolve to a valid locality."
    if (err instanceof QlooError && err.status === 400) return null;
    throw err;
  }
  const found = localityResponseSchema.parse(body).query?.localities?.filter?.[0];
  return found
    ? { name: found.name, disambiguation: found.disambiguation ?? null, lat: found.location.lat, lon: found.location.lon }
    : null;
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
