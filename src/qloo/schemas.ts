/**
 * Qloo response shapes, as the live hackathon API returns them (probed
 * 2026-10-21), and their normalisation into one `Entity`.
 *
 * The same entity looks different per endpoint: /search and /entities give
 * `types[]`, tags with `tag_id`, and `properties.external` as an object;
 * /v2/insights gives `type` + `subtype`, tags with `id` (sometimes `null`),
 * `external` at the top level as arrays, and a `query` block with the
 * affinity. Schemas are loose (unknown keys pass) and every field the API
 * has been seen to omit or null is optional, so a new field never breaks a
 * parse and a missing one degrades to `null`.
 */
import { z } from 'zod';

export type EntityKind = 'movie' | 'artist' | 'place' | 'other';

export interface Tag {
  id: string;
  name: string;
  type: string;
}

export interface Entity {
  id: string;
  name: string;
  kind: EntityKind;
  /** Qloo's own disambiguation: a year for films, an address for places. */
  disambiguation: string | null;
  /** 0–1 percentile within the entity's domain. */
  popularity: number | null;
  imageUrl: string | null;
  year: number | null;
  /** One English sentence, when Qloo has one. */
  blurb: string | null;
  tags: Tag[];
  /** Agent-facing facts (tone, cuisine, ambience…), flattened and trimmed. */
  facts: Record<string, string>;
  location: { lat: number; lon: number } | null;
  address: string | null;
  priceLevel: number | null;
  /** Places: opening periods per weekday ("monday"…), times as "HH:MM". Null when Qloo has none. */
  hours: Hours | null;
  /** Places: closed for good. */
  isClosed: boolean;
  /** The first id per outside service: imdb, letterboxd, netflix, spotify, google_place… */
  external: Record<string, string>;
  /** Google's place id, for a maps link that opens the right place. */
  googlePlaceId: string | null;
  website: string | null;
  menuUrl: string | null;
  phone: string | null;
  /** Places: ratings, a Michelin Guide listing and booking pages, when Qloo knows them. */
  venue: Venue | null;
}

export interface Venue {
  /** Out of 5, best-known first: Tripadvisor and Resy with their review counts, then Qloo's business rating. */
  ratings: { source: 'Tripadvisor' | 'Resy' | null; value: number; count: number | null }[];
  michelin: boolean;
  /** Booking pages as Qloo gives them (links.ts keeps only http(s) ones). */
  opentable: string | null;
  resy: string | null;
  /** The party sizes Resy takes bookings for. */
  party: { min: number; max: number } | null;
}

export interface Period {
  opens: string;
  closes: string;
}
export type Hours = Record<string, Period[]>;

export interface ScoredEntity extends Entity {
  /** Qloo affinity to the query's signal, 0–1, comparable only within one query. */
  affinity: number;
  /** Which seeds drove the affinity (feature.explainability), shares sum to ~1. */
  drivers: { seedId: string; share: number }[];
}

const named = z.looseObject({ name: z.string() });
// Seen live: an artist tag with no `name` at all (Pixies, tag #93).
const tagSchema = z.looseObject({
  id: z.string().optional(),
  tag_id: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
});
const textItem = z.looseObject({
  value: z.string(),
  language: z.string().optional(),
  languages: z.array(z.string()).optional(),
});

const propertiesSchema = z
  .looseObject({
    description: z.string().nullish(),
    short_description: z.string().nullish(),
    short_descriptions: z.array(textItem).nullish(),
    // Seen live: `image: {}` with no url (a TV special in a film search).
    image: z.looseObject({ url: z.string().nullish() }).nullish(),
    release_year: z.number().nullish(),
    // A number on Insights films, `{}` on searched artists, absent elsewhere.
    duration: z.unknown().optional(),
    content_rating: z.string().nullish(),
    genres: z.array(z.string()).nullish(),
    primary_genres: z.array(z.string()).nullish(),
    adjectives_for_music: z.array(z.string()).nullish(),
    emotional_tone_description: z.string().nullish(),
    situational_contexts: z.string().nullish(),
    style_description: z.string().nullish(),
    address: z.string().nullish(),
    neighborhood: z.string().nullish(),
    price_level: z.number().nullish(),
    business_rating: z.number().nullish(),
    cuisine_description: z.string().nullish(),
    ambience_description: z.string().nullish(),
    specialty_dishes: z.array(named).nullish(),
    good_for: z.array(named).nullish(),
    is_closed: z.boolean().nullish(),
    // Shapes these may take vary by endpoint, so they are read by hand below.
    hours: z.unknown().optional(),
    external: z.unknown().optional(),
    website: z.unknown().optional(),
    menu_url: z.unknown().optional(),
    phone: z.unknown().optional(),
  })
  .nullish();

const locationSchema = z.looseObject({ lat: z.number(), lon: z.number() }).nullish();

/** An entity from /search or /entities. */
export const searchEntitySchema = z.looseObject({
  entity_id: z.string(),
  name: z.string(),
  types: z.array(z.string()).nullish(),
  popularity: z.number().nullish(),
  disambiguation: z.string().nullish(),
  tags: z.array(tagSchema).nullish(),
  properties: propertiesSchema,
  location: locationSchema,
});

/** An entity from /v2/insights. */
export const insightsEntitySchema = z.looseObject({
  entity_id: z.string(),
  name: z.string(),
  type: z.string().nullish(),
  subtype: z.string().nullish(),
  popularity: z.number().nullish(),
  disambiguation: z.string().nullish(),
  tags: z.array(tagSchema).nullish(),
  properties: propertiesSchema,
  location: locationSchema,
  // Insights puts external ids at the top level, as arrays.
  external: z.unknown().optional(),
  query: z
    .looseObject({
      affinity: z.number(),
      // The key is the literal dotted string, not a nested path.
      explainability: z
        .looseObject({
          'signal.interests.entities': z
            .array(z.looseObject({ entity_id: z.string(), score: z.number() }))
            .nullish(),
        })
        .nullish(),
    })
    .nullish(),
});

// Envelopes only: the entities in them are read one at a time (`eachEntity`).
export const searchResponseSchema = z.looseObject({ results: z.array(z.unknown()) });
export const insightsResponseSchema = z.looseObject({
  results: z.looseObject({ entities: z.array(z.unknown()) }),
});

/**
 * Entities parsed one at a time: one in a shape we can't read is dropped and
 * logged, rather than failing the whole answer (a search, a pool, a score).
 */
export function eachEntity<S extends z.ZodType, T>(
  raws: readonly unknown[],
  schema: S,
  to: (raw: z.infer<S>) => T,
  onDrop: (why: string) => void = (why) => console.warn(`Qloo entity dropped: ${why}`),
): T[] {
  return raws.flatMap((raw) => {
    const parsed = schema.safeParse(raw);
    if (parsed.success) return [to(parsed.data)];
    const issue = parsed.error.issues[0];
    onDrop(`${issue?.path.join('.') || '(entity)'}: ${issue?.message}`);
    return [];
  });
}

/** The locality a `filter.location.query` resolved to, which Insights echoes under `query.localities.filter`. */
export const localityResponseSchema = z.looseObject({
  query: z
    .looseObject({
      localities: z
        .looseObject({
          filter: z
            .array(
              z.looseObject({
                name: z.string(),
                disambiguation: z.string().nullish(),
                location: z.looseObject({ lat: z.number(), lon: z.number() }),
              }),
            )
            .nullish(),
        })
        .nullish(),
    })
    .nullish(),
});

/** The two error bodies Qloo uses: `{errors:[…]}` on /v2/insights, `{error:{…}}` on /search. */
const insightsErrorSchema = z.looseObject({
  errors: z.array(z.looseObject({ message: z.string() })).min(1),
});
const searchErrorSchema = z.looseObject({ error: z.looseObject({ message: z.string() }) });

export function errorMessageOf(body: unknown): string | null {
  const insights = insightsErrorSchema.safeParse(body);
  if (insights.success) return insights.data.errors[0]!.message;
  const search = searchErrorSchema.safeParse(body);
  return search.success ? search.data.error.message : null;
}

const KIND_BY_URN: Record<string, EntityKind> = {
  'urn:entity:movie': 'movie',
  'urn:entity:artist': 'artist',
  'urn:entity:place': 'place',
};

export const URN_BY_KIND: Record<Exclude<EntityKind, 'other'>, string> = {
  movie: 'urn:entity:movie',
  artist: 'urn:entity:artist',
  place: 'urn:entity:place',
};

const FACT_LENGTH = 240;
const trim = (s: string, max = FACT_LENGTH) => (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s);
const list = (xs: readonly string[] | null | undefined, max = 6) =>
  xs && xs.length ? xs.slice(0, max).join(', ') : null;

type Properties = z.infer<typeof propertiesSchema>;

/** The English one-liner: Qloo's short descriptions come in mixed languages. */
function englishBlurb(p: Properties): string | null {
  const english = p?.short_descriptions?.find(
    (d) => d.language === 'en' || d.languages?.includes('en'),
  );
  const text = english?.value ?? p?.short_description ?? null;
  return text ? trim(text) : null;
}

function factsOf(kind: EntityKind, p: Properties): Record<string, string> {
  if (!p) return {};
  const facts: Record<string, string | null | undefined> =
    kind === 'movie'
      ? {
          genres: list(p.genres),
          tone: p.emotional_tone_description,
          when: p.situational_contexts,
          style: p.style_description,
          minutes: typeof p.duration === 'number' ? String(p.duration) : null,
          rating: p.content_rating,
        }
      : kind === 'artist'
        ? { genres: list(p.primary_genres), sound: list(p.adjectives_for_music) }
        : kind === 'place'
          ? {
              neighborhood: p.neighborhood,
              cuisine: p.cuisine_description,
              ambience: p.ambience_description,
              dishes: list(p.specialty_dishes?.map((d) => d.name), 4),
              goodFor: list(p.good_for?.map((d) => d.name), 4),
              price: p.price_level ? '$'.repeat(p.price_level) : null,
            }
          : {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(facts)) if (v) out[k] = trim(v);
  return out;
}

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** "T17:00:00" or "17:00" → "17:00"; anything else → null. */
function clock(v: unknown): string | null {
  const m = typeof v === 'string' ? /^T?(\d{1,2}):(\d{2})/.exec(v.trim()) : null;
  return m ? `${m[1]!.padStart(2, '0')}:${m[2]}` : null;
}

/** Qloo's `hours`: `{ monday: [{ opens: "T17:00:00", closes: "T01:00:00", closed: false }], … }`. */
function hoursOf(raw: unknown): Hours | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Hours = {};
  for (const [day, periods] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(periods)) continue;
    out[day.toLowerCase()] = periods.flatMap((p) => {
      if (!p || typeof p !== 'object' || (p as { closed?: unknown }).closed === true) return [];
      const opens = clock((p as { opens?: unknown }).opens);
      const closes = clock((p as { closes?: unknown }).closes);
      return opens && closes ? [{ opens, closes }] : [];
    });
  }
  return Object.keys(out).length ? out : null;
}

/**
 * External ids, from either shape: `{ imdb: [{ id }] }` (Insights, top level)
 * or `{ imdb: { id } }` (Search and Entities, under properties).
 */
function externalOf(...sources: unknown[]): { ids: Record<string, string>; googlePlaceId: string | null } {
  const ids: Record<string, string> = {};
  let googlePlaceId: string | null = null;
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const [service, value] of Object.entries(source as Record<string, unknown>)) {
      const first = Array.isArray(value) ? value[0] : value;
      if (!first || typeof first !== 'object') continue;
      const id = text((first as { id?: unknown }).id);
      if (id && !ids[service]) ids[service] = id;
      if (service === 'google_place') googlePlaceId ??= text((first as { place_id?: unknown }).place_id);
    }
  }
  return { ids, googlePlaceId };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * A place's ratings, Michelin listing and booking pages, from either external
 * shape (Insights arrays at the top level, Search objects under properties).
 * Seen live in Manhattan: every place had a business rating, most had
 * Tripadvisor and OpenTable, a few Resy (with party sizes) and Michelin.
 */
function venueOf(businessRating: unknown, ...sources: unknown[]): Venue | null {
  const first = (service: string): Record<string, unknown> | null => {
    for (const source of sources) {
      if (!source || typeof source !== 'object') continue;
      const value = (source as Record<string, unknown>)[service];
      const item = Array.isArray(value) ? value[0] : value;
      if (item && typeof item === 'object') return item as Record<string, unknown>;
    }
    return null;
  };
  const ta = first('tripadvisor');
  const resy = first('resy');
  const ot = first('opentable');
  const ratings: Venue['ratings'] = [];
  for (const [source, item] of [['Tripadvisor', ta], ['Resy', resy]] as const) {
    const value = num(item?.rating);
    if (value !== null && value > 0 && value <= 5) ratings.push({ source, value: Math.round(value * 10) / 10, count: num(item?.rating_count) });
  }
  const business = num(businessRating);
  if (business !== null && business > 0 && business <= 5) ratings.push({ source: null, value: Math.round(business * 10) / 10, count: null });
  const min = num(resy?.min_party_size);
  const max = num(resy?.max_party_size);
  const venue: Venue = {
    ratings,
    michelin: first('michelin') !== null,
    opentable: text(ot?.url),
    resy: text(resy?.url),
    party: min !== null && max !== null && max >= min ? { min, max } : null,
  };
  return venue.ratings.length || venue.michelin || venue.opentable || venue.resy ? venue : null;
}

/** A restaurant's cuisine as a short label ("Italian"), from its genre tags. */
const CUISINE_TAG = 'urn:tag:genre:place:restaurant:';

function baseEntity(
  raw: z.infer<typeof searchEntitySchema> | z.infer<typeof insightsEntitySchema>,
  kind: EntityKind,
): Entity {
  const p = raw.properties;
  const external = externalOf('external' in raw ? raw.external : undefined, p?.external);
  const facts = factsOf(kind, p);
  const venue = kind === 'place' ? venueOf(p?.business_rating, 'external' in raw ? raw.external : undefined, p?.external) : null;
  if (kind === 'place') {
    // Prefer a cuisine ("Korean") over a format ("Fine dining restaurant", "Wine bar").
    const tags = (raw.tags ?? []).filter((t) => (t.id ?? t.tag_id ?? '').startsWith(CUISINE_TAG) && t.name);
    const isFormat = (name: string) => /restaurant|\bbar\b|takeout|cafe|shop/i.test(name);
    const cuisine = tags.find((t) => !isFormat(t.name!)) ?? tags[0];
    if (cuisine?.name) facts.cuisineType = cuisine.name;
    // Facts the agents can cite: "4.5 on Tripadvisor (13,365 reviews)", "In the Michelin Guide".
    const top = venue?.ratings[0];
    if (top) facts.rating = `${top.value} ${top.source ? `on ${top.source}` : 'rating'}${top.count ? ` (${top.count.toLocaleString('en-US')} reviews)` : ''}`;
    if (venue?.michelin) facts.michelin = 'In the Michelin Guide';
  }
  return {
    id: raw.entity_id,
    name: raw.name,
    kind,
    disambiguation: raw.disambiguation ?? null,
    popularity: raw.popularity ?? null,
    imageUrl: p?.image?.url ?? null,
    year: p?.release_year ?? null,
    blurb: englishBlurb(p),
    tags: (raw.tags ?? []).flatMap((t) => {
      const id = t.id ?? t.tag_id;
      return id && t.name ? [{ id, name: t.name, type: t.type ?? '' }] : [];
    }),
    facts,
    location: raw.location ? { lat: raw.location.lat, lon: raw.location.lon } : null,
    address: p?.address ?? null,
    priceLevel: p?.price_level ?? null,
    hours: hoursOf(p?.hours),
    isClosed: p?.is_closed === true,
    external: external.ids,
    googlePlaceId: external.googlePlaceId,
    website: text(p?.website),
    menuUrl: text(p?.menu_url),
    phone: text(p?.phone),
    venue,
  };
}

export function fromSearch(raw: z.infer<typeof searchEntitySchema>): Entity {
  const kind = raw.types?.map((t) => KIND_BY_URN[t]).find(Boolean) ?? 'other';
  return baseEntity(raw, kind);
}

export function fromInsights(raw: z.infer<typeof insightsEntitySchema>): ScoredEntity {
  const kind = (raw.subtype && KIND_BY_URN[raw.subtype]) || 'other';
  return {
    ...baseEntity(raw, kind),
    affinity: raw.query?.affinity ?? 0,
    drivers: (raw.query?.explainability?.['signal.interests.entities'] ?? []).map((d) => ({
      seedId: d.entity_id,
      share: d.score,
    })),
  };
}
