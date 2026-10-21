/**
 * The plan you can act on, and the rules around it: opening hours and
 * "tonight" in the city's own time, links built safely from Qloo ids, the
 * calendar file, and the vetoes that keep things off the table. Synthetic
 * fixtures only (no Qloo data in the repo); no network.
 * Run with `npm run test:plan`.
 */
import type { CardItem } from '../src/contract';
import { fromInsights, fromSearch, insightsEntitySchema, searchEntitySchema } from '../src/qloo/schemas';
import { eveningIcs, zonedHourToUtc } from '../src/server/calendar';
import { constraintsOf, vetoLabels } from '../src/server/runner';
import { linksOf } from '../src/truce/links';
import { NO_CONSTRAINTS, admissible } from '../src/truce/pool';
import { hoursTonight, tonightAt } from '../src/truce/tonight';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
}

// --- Parsing hours and outside ids, in both shapes -----------------------------
const place = fromInsights(
  insightsEntitySchema.parse({
    entity_id: '00000000-0000-0000-0000-000000000001',
    name: 'Test Bistro',
    subtype: 'urn:entity:place',
    tags: [{ id: 'urn:tag:genre:place:restaurant:vegetarian', name: 'Vegetarian' }],
    properties: {
      address: '1 Test St, Testville',
      price_level: 3,
      phone: '+90 (555) 123-45 67',
      website: 'javascript:alert(1)',
      menu_url: 'https://example.com/menu',
      is_closed: false,
      hours: {
        monday: [{ opens: 'T17:00:00', closes: 'T02:00:00', closed: false }],
        tuesday: [{ opens: 'T11:00:00', closes: 'T15:00:00', closed: false }],
        wednesday: [{ closed: true }],
      },
    },
    external: { google_place: [{ id: 'x', place_id: 'ChIJ_test' }] },
    query: { affinity: 0.5 },
  }),
);
check('parse: hours become HH:MM periods', place.hours?.monday?.[0]?.opens === '17:00' && place.hours?.monday?.[0]?.closes === '02:00');
check('parse: a closed day has no periods', Array.isArray(place.hours?.wednesday) && place.hours!.wednesday!.length === 0);
check('parse: google place id from the Insights array shape', place.googlePlaceId === 'ChIJ_test');

const film = fromSearch(
  searchEntitySchema.parse({
    entity_id: '00000000-0000-0000-0000-000000000002',
    name: 'Test Film',
    types: ['urn:entity:movie'],
    properties: { external: { imdb: { id: 'tt0000001' }, letterboxd: { id: 'test film/../x' }, netflix: { id: '123abc' } } },
  }),
);
check('parse: external ids from the Search object shape', film.external.imdb === 'tt0000001');

const artist = fromInsights(
  insightsEntitySchema.parse({
    entity_id: '00000000-0000-0000-0000-000000000003',
    name: 'Test Artist',
    subtype: 'urn:entity:artist',
    external: { spotify: [{ id: '4CvTDPKA6W06DRfBnZKrau' }] },
    query: { affinity: 0.4 },
  }),
);

// --- Tonight ---------------------------------------------------------------------
check('tonight: past-midnight closing covers the evening', hoursTonight(place.hours, 'monday').openTonight === true);
check('tonight: a lunch-only day is closed tonight', hoursTonight(place.hours, 'tuesday').openTonight === false);
check('tonight: a closed day says so', hoursTonight(place.hours, 'wednesday').today === 'Closed');
check('tonight: no hours for the day is unknown', hoursTonight(place.hours, 'friday').openTonight === null);
check('tonight: no hours at all is unknown', hoursTonight(null, 'monday').openTonight === null);
check('tonight: today reads as a range', hoursTonight(place.hours, 'monday').today === '17:00–02:00');

const noon = new Date('2026-10-21T09:00:00Z');
const ist = tonightAt(41.01, 28.98, noon);
const nyc = tonightAt(40.77, -73.97, noon);
check('tonight: Istanbul time zone', ist.timeZone === 'Europe/Istanbul' && ist.date === '2026-10-21' && ist.weekday === 'wednesday');
check('tonight: New York time zone', nyc.timeZone === 'America/New_York' && nyc.date === '2026-10-21');
const lateUtc = new Date('2026-10-21T23:30:00Z');
check('tonight: the date is the city\'s, not UTC\'s', tonightAt(41.01, 28.98, lateUtc).date === '2026-10-22' && tonightAt(40.77, -73.97, lateUtc).date === '2026-10-21');

// --- Links -------------------------------------------------------------------------
const placeLinks = linksOf(place, 'restaurant');
check('links: a map link that opens the right place', placeLinks.some((l) => l.kind === 'maps' && l.url.includes('query_place_id=ChIJ_test')));
check('links: a script "website" is dropped', !placeLinks.some((l) => l.kind === 'website'));
check('links: the menu is kept', placeLinks.some((l) => l.kind === 'menu' && l.url === 'https://example.com/menu'));
check('links: the phone is digits only', placeLinks.some((l) => l.kind === 'phone' && l.url === 'tel:+9055512345 67'.replace(' ', '')));
const filmLinks = linksOf(film, 'film');
check('links: IMDb from the id', filmLinks.some((l) => l.url === 'https://www.imdb.com/title/tt0000001/'));
check('links: a Letterboxd slug is encoded', filmLinks.some((l) => l.kind === 'letterboxd' && !l.url.includes('/../')));
check('links: a malformed Netflix id is dropped', !filmLinks.some((l) => l.kind === 'netflix'));
check('links: Spotify for an artist', linksOf(artist, 'music').some((l) => l.url === 'https://open.spotify.com/artist/4CvTDPKA6W06DRfBnZKrau'));
check('links: every link is http(s) or tel', [...placeLinks, ...filmLinks].every((l) => /^(https?:|tel:)/.test(l.url)));

// --- Calendar ------------------------------------------------------------------------
check('calendar: 19:00 in Istanbul is 16:00 UTC', zonedHourToUtc('2026-10-21', 19, 'Europe/Istanbul').toISOString() === '2026-10-21T16:00:00.000Z');
check('calendar: 19:00 in New York (EDT) is 23:00 UTC', zonedHourToUtc('2026-10-21', 19, 'America/New_York').toISOString() === '2026-10-21T23:00:00.000Z');
check('calendar: across a DST change (New York, EST)', zonedHourToUtc('2026-11-20', 19, 'America/New_York').toISOString() === '2026-11-21T00:00:00.000Z');
const card = (name: string, slot: CardItem['slot'], extra: Partial<CardItem> = {}): CardItem => ({
  id: name, slot, name, disambiguation: null, imageUrl: null, blurb: null, facts: {}, scores: {}, origins: [], because: {},
  scout: null, links: [], hours: null, address: null, ...extra,
});
const ics = eveningIcs({
  truceId: 'T1',
  host: 'truce.example',
  tonight: { date: '2026-10-21', weekday: 'wednesday', timeZone: 'Europe/Istanbul' },
  items: {
    film: card('Film, With; Commas', 'film', { links: [{ kind: 'imdb', label: 'IMDb', url: 'https://www.imdb.com/title/tt0000001/' }] }),
    restaurant: card('Test Bistro', 'restaurant', { address: '1 Test St, Testville' }),
    music: card('Test Artist', 'music'),
  },
});
check('calendar: starts and ends in UTC', ics.includes('DTSTART:20261021T160000Z') && ics.includes('DTEND:20261021T200000Z'));
check('calendar: text is escaped', ics.includes('Film\\, With\\; Commas'));
check('calendar: the restaurant is the location', ics.includes('LOCATION:Test Bistro\\, 1 Test St\\, Testville'));
check('calendar: lines are folded to 75 characters', ics.split('\r\n').every((l) => l.length <= 75));
check('calendar: CRLF line endings', ics.endsWith('\r\n') && !/[^\r]\n/.test(ics));

// --- Vetoes ------------------------------------------------------------------------------
const veg = 'urn:tag:genre:place:restaurant:vegetarian';
const c = { ...NO_CONSTRAINTS, excludeTags: { ...NO_CONSTRAINTS.excludeTags, restaurant: [veg] } };
check('veto: a vetoed tag keeps an item out', !admissible(place, 'restaurant', c));
check('veto: an excluded entity is out', !admissible(film, 'film', { ...NO_CONSTRAINTS, excludeEntities: [film.id] }));
check('veto: a price cap keeps pricier places out', !admissible(place, 'restaurant', { ...NO_CONSTRAINTS, maxPrice: 2 }) && admissible(place, 'restaurant', { ...NO_CONSTRAINTS, maxPrice: 3 }));
check('veto: closed tonight is out', !admissible(place, 'restaurant', NO_CONSTRAINTS, 'tuesday') && admissible(place, 'restaurant', NO_CONSTRAINTS, 'monday'));
check('veto: closed for good is out', !admissible({ ...place, isClosed: true }, 'restaurant', NO_CONSTRAINTS));

const brief = (excludeTags: string[], excludeEntities: string[], maxPrice: number | null, vetoes: { kind: 'taste' | 'title' | 'price'; matched: string }[]) => ({
  view: { text: '', wishes: [], vetoes: vetoes.map((v) => ({ ...v, slot: null, said: '' })), note: null, unmatched: [] },
  rules: { wishTags: { film: [], restaurant: [], music: [] }, excludeTags: { film: excludeTags, restaurant: [], music: [] }, excludeEntities, maxPrice },
});
const briefs = {
  a: brief(['urn:tag:genre:media:horror'], ['e1'], 3, [{ kind: 'taste', matched: 'Horror' }, { kind: 'price', matched: 'Up to $$$' }]),
  b: brief(['urn:tag:genre:media:horror'], [], 2, [{ kind: 'taste', matched: 'Horror' }, { kind: 'title', matched: 'Dune (2021)' }]),
  c: null,
};
const learned = { a: { loved: { film: [], restaurant: [], music: [] }, avoided: [{ id: 'e2', name: 'X' }] } };
const combined = constraintsOf(['a', 'b', 'c'], briefs, learned);
check('group vetoes: tags are merged without repeats', combined.excludeTags.film.length === 1);
check('group vetoes: titles and past "not for me"s both stay off', combined.excludeEntities.includes('e1') && combined.excludeEntities.includes('e2'));
check('group vetoes: the lowest price cap wins', combined.maxPrice === 2);
check('group vetoes: labels read plainly and once', vetoLabels(['a', 'b', 'c'], briefs).join(' · ') === 'No Horror · Up to $$$ · Not Dune (2021)');

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
