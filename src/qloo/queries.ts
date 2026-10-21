/**
 * The Qloo questions Truce asks:
 *   1. search: resolve a name a person typed into Qloo entities to confirm;
 *   2. locate: the locality a place name resolves to, so a restaurant search
 *      can stay near the pair's city;
 *   3. recommend: candidates for one slot from one set of seeds, optionally
 *      held to taste tags (a mood) and kept off others (a veto);
 *   4. findTags / tasteWords / tasteHotspot: the tags a plain word stands for,
 *      the words for someone's taste, and where in a city a taste concentrates;
 *   5. scoreShortlist: one fixed pool scored against one person's seeds, with
 *      the seeds' contributions (explainability). Scoring the same pool once
 *      per person is what makes the two people's utilities comparable within
 *      themselves; see docs/QLOO_FIELD_NOTES.md.
 */
import { z } from 'zod';
import { QlooError, type Params, type QlooClient } from './client';
import {
  URN_BY_KIND,
  eachEntity,
  fromInsights,
  fromSearch,
  insightsEntitySchema,
  insightsResponseSchema,
  localityResponseSchema,
  searchEntitySchema,
  searchResponseSchema,
  type Entity,
  type ScoredEntity,
} from './schemas';

/**
 * A Qloo answer we can't read is Qloo's problem, not the person's request, so
 * it fails as a QlooError: the API reports a ZodError as bad input.
 */
function read<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new QlooError(`Qloo answered in an unexpected shape (${issue?.path.join('.')}: ${issue?.message})`, 502, false);
}

const searched = (body: unknown) => eachEntity(read(searchResponseSchema, body).results, searchEntitySchema, fromSearch);
const insights = (body: unknown) =>
  eachEntity(read(insightsResponseSchema, body).results.entities, insightsEntitySchema, fromInsights);

/** /v2/tags, and Insights with `filter.type=urn:tag`: `{ results: { tags: [...] } }`. */
const tagsResponseSchema = z.looseObject({
  results: z.looseObject({
    tags: z.array(
      z.looseObject({
        id: z.string().optional(),
        tag_id: z.string().optional(),
        name: z.string().optional(),
        type: z.string().optional(),
        subtype: z.string().optional(),
      }),
    ),
  }),
});
const heatmapResponseSchema = z.looseObject({
  results: z.looseObject({
    heatmap: z
      .array(
        z.looseObject({
          location: z.looseObject({ latitude: z.number(), longitude: z.number() }),
          query: z.looseObject({ affinity: z.number().optional() }).nullish(),
        }),
      )
      .nullish(),
  }),
});

export type SlotKind = 'movie' | 'artist' | 'place';

/** Where and what kind of restaurant; only used for the `place` slot. */
export interface PlaceFilter {
  /** A Qloo locality name, e.g. "Manhattan" ("New York" leaks into New Jersey). */
  locationQuery: string;
  /** Instead of the locality: a circle around a point (the group's taste hotspot). */
  point?: { lat: number; lon: number; radiusM: number };
  priceMin?: number;
  priceMax?: number;
  popularityMin?: number;
}

export interface QlooTag {
  id: string;
  name: string;
  /** The tag's family, e.g. "urn:tag:genre:media" or "urn:tag:ambience:qloo". */
  type: string;
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
  return searched(body);
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
  const found = read(localityResponseSchema, body).query?.localities?.filter?.[0];
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
    /** Tags every result must carry (a mood: "Cozy", a genre: "Comedy"). */
    tags?: readonly string[];
    /** Tags no result may carry (a veto: "Horror"). */
    excludeTags?: readonly string[];
  },
): Promise<ScoredEntity[]> {
  const { kind, seeds, exclude = [], take, place, tags = [], excludeTags = [] } = args;
  if (!seeds.length) return [];
  const required = kind === 'place' && place ? [RESTAURANT_TAG, ...tags] : [...tags];
  const body = await qloo.get('/v2/insights', {
    'filter.type': URN_BY_KIND[kind],
    'signal.interests.entities': seeds.join(','),
    'filter.exclude.entities': exclude.length ? exclude.join(',') : undefined,
    'filter.tags': required.length ? required.join(',') : undefined,
    'operator.filter.tags': required.length > 1 ? 'intersection' : undefined,
    'filter.exclude.tags': excludeTags.length ? excludeTags.join(',') : undefined,
    ...(kind === 'place' && place
      ? {
          // A point takes WKT here, "POINT(lon lat)", with the radius in metres.
          ...(place.point
            ? { 'filter.location': `POINT(${place.point.lon} ${place.point.lat})`, 'filter.location.radius': place.point.radiusM }
            : { 'filter.location.query': place.locationQuery }),
          'filter.price_level.min': place.priceMin,
          'filter.price_level.max': place.priceMax,
          'filter.popularity.min': place.popularityMin,
        }
      : {}),
    take,
  });
  return insights(body);
}

/** Qloo tags whose names match `query`, across every family ("cozy" → ambience, decor, style…). */
export async function findTags(qloo: QlooClient, query: string, take = 12): Promise<QlooTag[]> {
  const body = await qloo.get('/v2/tags', { 'filter.query': query, take });
  return read(tagsResponseSchema, body).results.tags.flatMap((t) => {
    const id = t.id ?? t.tag_id;
    return id && t.name ? [{ id, name: t.name.trim(), type: t.type ?? t.subtype ?? '' }] : [];
  });
}

/** Tag families that read as taste, best first; media keywords ("madrid spain") and audiences (people, not taste) are left out. */
const TASTE_FAMILIES = ['urn:tag:style:qloo', 'urn:tag:genre:qloo', 'urn:tag:subgenre:qloo', 'urn:tag:archetype:qloo', 'urn:tag:theme:qloo', 'urn:tag:keyword:qloo'];

/** A few words for someone's taste, from their seeds: film-side tastes (styles, genres, themes) and music genres. */
export async function tasteWords(qloo: QlooClient, seeds: readonly string[]): Promise<string[]> {
  if (!seeds.length) return [];
  const ask = async (params: Params) => {
    const body = await qloo.get('/v2/insights', { 'filter.type': 'urn:tag', 'signal.interests.entities': seeds.join(','), ...params });
    return read(tagsResponseSchema, body).results.tags;
  };
  const [film, music] = await Promise.all([
    ask({ 'filter.parents.types': URN_BY_KIND.movie, take: 15 }),
    ask({ 'filter.tag.types': 'urn:tag:genre:music', take: 4 }),
  ]);
  const words: string[] = [];
  const rank = (t: (typeof film)[number]) => TASTE_FAMILIES.indexOf(t.subtype ?? t.type ?? '');
  const tastes = film.filter((t) => rank(t) >= 0).sort((x, y) => rank(x) - rank(y));
  const add = (tags: typeof film, max: number) => {
    let n = 0;
    for (const t of tags) {
      const word = t.name?.trim();
      if (!word || n >= max) continue;
      if (words.some((w) => w.toLowerCase() === word.toLowerCase())) continue;
      words.push(word[0]!.toUpperCase() + word.slice(1));
      n++;
    }
  };
  add(tastes, 4);
  add(music, 2);
  return words;
}

/** Where in a locality a set of seeds' taste concentrates most: the top heatmap cell, or null. */
export async function tasteHotspot(
  qloo: QlooClient,
  seeds: readonly string[],
  locationQuery: string,
): Promise<{ lat: number; lon: number } | null> {
  if (!seeds.length) return null;
  const body = await qloo.get('/v2/insights', {
    'filter.type': 'urn:heatmap',
    'signal.interests.entities': seeds.join(','),
    'filter.location.query': locationQuery,
    take: 10,
  });
  const cells = read(heatmapResponseSchema, body).results.heatmap ?? [];
  const top = [...cells].sort((x, y) => (y.query?.affinity ?? 0) - (x.query?.affinity ?? 0))[0];
  return top ? { lat: top.location.latitude, lon: top.location.longitude } : null;
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
  const scored = insights(body);
  const seen = new Set(scored.map((e) => e.id));
  return { scored, missing: ids.filter((id) => !seen.has(id)) };
}
