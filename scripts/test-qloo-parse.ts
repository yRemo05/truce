/**
 * Qloo layer: parsing and client behaviour on hand-made fixtures that copy
 * the live API's shapes (Qloo's data itself may not live in a public repo).
 * Covers the drift between /search and /v2/insights, the two error bodies,
 * retries, the cache and the throttle. No network.
 * Run with `npm run test:qloo`.
 */
import { QlooError, createQlooClient, requestKey, type QlooCache } from '../src/qloo/client';
import { scoreShortlist, searchEntities } from '../src/qloo/queries';
import {
  errorMessageOf,
  fromInsights,
  fromSearch,
  insightsEntitySchema,
  searchEntitySchema,
} from '../src/qloo/schemas';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
}

// Shapes as /search returns them: types[], tag_id, external as an object,
// duration as {} on artists, short descriptions with `language`.
const searchFilm = {
  entity_id: 'F-1',
  name: 'A Quiet Film',
  types: ['urn:entity:movie'],
  popularity: 0.97,
  disambiguation: '2001',
  tags: [{ name: 'Drama', tag_id: 'urn:tag:genre:media:drama', type: 'urn:tag:genre:media' }],
  properties: {
    release_year: 2001,
    image: { url: 'https://images.example/f1.jpg' },
    short_descriptions: [
      { language: 'fr', value: 'Un film calme.' },
      { language: 'en', value: 'A quiet film.' },
    ],
    external: { imdb: { id: 'tt0000001' } },
    akas: [{ language: 'tr', value: 'Sessiz Bir Film' }],
  },
};
const searchArtist = {
  entity_id: 'A-1',
  name: 'A Band',
  types: ['urn:entity:artist'],
  popularity: 1,
  properties: { duration: {}, short_description: 'A band.' },
};

// Shapes as /v2/insights returns them: type + subtype, tags with `id` (one
// without a name, as seen live), external arrays, the dotted explainability key.
const insightsPlace = {
  entity_id: 'P-1',
  name: 'Small Bistro',
  type: 'urn:entity',
  subtype: 'urn:entity:place',
  popularity: 0.81,
  location: { lat: 40.73, lon: -74.0, geohash: 'dr5rs' },
  tags: [
    { id: 'urn:tag:genre:place:restaurant:french', name: 'French', type: 'urn:tag:genre:place', weight: null },
    { id: 'urn:tag:keyword:qloo:x', type: 'urn:tag:keyword:qloo' },
  ],
  external: { google_place: [{ id: 'g1', place_id: 'g1' }] },
  properties: {
    address: '1 Example St',
    neighborhood: 'West Village',
    price_level: 3,
    cuisine_description: 'Seasonal French plates.',
    ambience_description: 'Candlelit and quiet.',
    specialty_dishes: [{ id: 'urn:tag:specialty_dish:place:onion_soup', name: 'Onion soup', type: 'x', weight: 0 }],
    hours: { friday: [{ opens: 'T17:00:00', closes: 'T23:00:00', closed: false }] },
    is_closed: false,
  },
  query: {
    affinity: 0.88,
    distance: 1200,
    measurements: { audience_growth: 0 },
    explainability: {
      'signal.interests.entities': [
        { entity_id: 'SEED-1', score: 0.7 },
        { entity_id: 'SEED-2', score: 0.3 },
      ],
    },
  },
};

{
  const film = fromSearch(searchEntitySchema.parse(searchFilm));
  check('search: kind from types[]', film.kind === 'movie');
  check('search: English blurb chosen over French', film.blurb === 'A quiet film.');
  check('search: tag ids come from tag_id', film.tags[0]?.id === 'urn:tag:genre:media:drama');
  check('search: year and image', film.year === 2001 && film.imageUrl === 'https://images.example/f1.jpg');

  const artist = fromSearch(searchEntitySchema.parse(searchArtist));
  check('search: artist with duration {} parses', artist.kind === 'artist' && artist.blurb === 'A band.');
}

{
  const place = fromInsights(insightsEntitySchema.parse(insightsPlace));
  check('insights: kind from subtype', place.kind === 'place');
  check('insights: affinity from query', place.affinity === 0.88);
  check('insights: drivers from the dotted explainability key', place.drivers.length === 2 && place.drivers[0]?.seedId === 'SEED-1');
  check('insights: nameless tags are dropped', place.tags.length === 1 && place.tags[0]?.name === 'French');
  check('insights: place facts', place.facts.price === '$$$' && place.facts.dishes === 'Onion soup' && place.facts.neighborhood === 'West Village');
  check('insights: location', place.location?.lat === 40.73 && place.address === '1 Example St');

  const unknown = fromInsights(insightsEntitySchema.parse({ entity_id: 'X', name: 'X', subtype: 'urn:entity:brand' }));
  check('insights: unknown subtype is "other", no affinity is 0', unknown.kind === 'other' && unknown.affinity === 0);
  const nullTags = fromInsights(insightsEntitySchema.parse({ entity_id: 'Y', name: 'Y', tags: null, properties: null }));
  check('insights: null tags and properties parse', nullTags.tags.length === 0 && nullTags.blurb === null);
}

check('error: /v2/insights shape', errorMessageOf({ errors: [{ message: 'bad signal' }] }) === 'bad signal');
check('error: /search shape', errorMessageOf({ error: { reason: 'Bad Request', message: 'bad location', code: 400 } }) === 'bad location');
check('error: anything else is null', errorMessageOf({ hello: 1 }) === null && errorMessageOf('oops') === null);

check(
  'requestKey: sorted, empty values dropped',
  requestKey('/v2/insights', { take: 5, 'filter.type': 'urn:entity:movie', x: undefined, y: '' }) ===
    '/v2/insights?filter.type=urn%3Aentity%3Amovie&take=5',
);

// --- Client behaviour on a fake fetch ---------------------------------------
type Reply = { status: number; body: unknown; headers?: Record<string, string> };
function fakeFetch(replies: Reply[]) {
  const calls: { url: string; at: number; key: string | null }[] = [];
  const fn = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), at: Date.now(), key: headers.get('X-Api-Key') });
    const r = replies.length > 1 ? replies.shift()! : replies[0]!;
    return new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers });
  }) as typeof fetch;
  return { fn, calls };
}
const memoryCache = (): QlooCache & { size(): number } => {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k), set: (k, v) => void m.set(k, v), size: () => m.size };
};

{
  const f = fakeFetch([
    { status: 429, body: { errors: [{ message: 'slow down' }] } },
    { status: 200, body: { results: [searchFilm] }, headers: { 'x-month-ratelimit-limit': '50000', 'x-month-ratelimit-remaining': '49990' } },
  ]);
  const cache = memoryCache();
  const qloo = createQlooClient({ baseUrl: 'https://qloo.test', apiKey: 'k', fetch: f.fn, cache });
  const first = await searchEntities(qloo, 'quiet', 'movie');
  check('client: retries a 429, then succeeds', first[0]?.name === 'A Quiet Film' && f.calls.length === 2);
  check('client: sends the key as X-Api-Key', f.calls.every((c) => c.key === 'k'));
  check('client: tracks the monthly quota', qloo.quota().monthRemaining === 49990);
  await searchEntities(qloo, 'quiet', 'movie');
  check('client: the second identical request comes from the cache', f.calls.length === 2 && cache.size() === 1);
}

{
  const f = fakeFetch([{ status: 400, body: { errors: [{ message: 'at least one valid signal or filter is required' }] } }]);
  const qloo = createQlooClient({ baseUrl: 'https://qloo.test', apiKey: 'k', fetch: f.fn });
  let caught: unknown;
  try {
    await qloo.get('/v2/insights', { 'filter.type': 'urn:entity:movie' });
  } catch (err) {
    caught = err;
  }
  check('client: a 400 is not retried', f.calls.length === 1);
  check(
    'client: a 400 surfaces Qloo\'s message',
    caught instanceof QlooError && caught.status === 400 && !caught.retryable && caught.message.includes('valid signal'),
  );
}

{
  const f = fakeFetch([{ status: 503, body: 'down' }]);
  const qloo = createQlooClient({ baseUrl: 'https://qloo.test', apiKey: 'k', fetch: f.fn, retries: 2 });
  const failed = await qloo.get('/search', { query: 'x' }).then(() => false, (e) => e instanceof QlooError && e.retryable);
  check('client: retries are bounded (1 + 2 attempts)', failed && f.calls.length === 3);
}

{
  const f = fakeFetch([{ status: 200, body: { results: [] } }]);
  const qloo = createQlooClient({ baseUrl: 'https://qloo.test', apiKey: 'k', fetch: f.fn, perSecond: 3 });
  const t0 = Date.now();
  await Promise.all([1, 2, 3, 4].map((i) => qloo.get('/search', { query: `q${i}` })));
  const fourth = f.calls[3]!.at - t0;
  check('client: throttle holds the 4th of 3-per-second to the next second', fourth >= 950, `${fourth} ms`);
}

{
  const f = fakeFetch([{ status: 200, body: { success: true, results: { entities: [insightsPlace] } } }]);
  const qloo = createQlooClient({ baseUrl: 'https://qloo.test', apiKey: 'k', fetch: f.fn });
  const { scored, missing } = await scoreShortlist(qloo, { kind: 'place', seeds: ['SEED-1'], ids: ['P-1', 'P-2'] });
  check('shortlist: scored ids come back', scored.length === 1 && scored[0]?.id === 'P-1');
  check('shortlist: unscored ids are reported, not guessed', missing.length === 1 && missing[0] === 'P-2');
  const url = new URL(f.calls[0]!.url);
  check(
    'shortlist: asks for explainability over exactly the pool',
    url.searchParams.get('feature.explainability') === 'true' && url.searchParams.get('filter.results.entities') === 'P-1,P-2',
  );
}

{
  // Seen live: a film search where one hit had `image: {}`, which used to fail the whole search.
  const noImage = { ...searchFilm, entity_id: 'F-2', properties: { ...searchFilm.properties, image: {} } };
  const unreadable = { entity_id: 'F-3', types: ['urn:entity:movie'] };
  const f = fakeFetch([{ status: 200, body: { results: [searchFilm, noImage, unreadable] } }]);
  const qloo = createQlooClient({ baseUrl: 'https://qloo.test', apiKey: 'k', fetch: f.fn });
  const hits = await searchEntities(qloo, 'quiet', 'movie');
  check('search: an image with no url is no image', hits.find((h) => h.id === 'F-2')?.imageUrl === null);
  check('search: an entity we cannot read is dropped, not the search', hits.length === 2 && !hits.some((h) => h.id === 'F-3'));

  const g = fakeFetch([{ status: 200, body: { results: 'nope' } }]);
  const broken = createQlooClient({ baseUrl: 'https://qloo.test', apiKey: 'k', fetch: g.fn });
  const err = await searchEntities(broken, 'quiet', 'movie').then(() => null, (e: unknown) => e);
  check('search: an unreadable answer is a QlooError, not a request error', err instanceof QlooError && err.status === 502);
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
